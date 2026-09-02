/**
 * Motore dei cluster: traduce le regole in scansioni Firestore, mantiene
 * aggiornata l'appartenenza dei contatti e risolve il pubblico di una
 * newsletter.
 *
 * Strategia di lettura:
 *  1. `planQuery` spinge nel `where` ciò che Firestore sa filtrare;
 *  2. la scansione avviene a pagine con `paginateQuery` (niente `getAll` in RAM);
 *  3. il residuo delle regole è valutato in memoria con `evaluateGroup`.
 *
 * L'appartenenza calcolata viene materializzata su `contacts.dynamicClusterIds`:
 * così le query "chi è nel cluster X" (invio, esclusioni, esportazioni) costano
 * un solo `array-contains` invece di una nuova scansione completa.
 */

import { FieldPath } from 'firebase-admin/firestore';
import {
  LIMITS,
  SENDABLE_STATUSES,
  displayNameFor,
  isValidEmail,
  normalizeEmail,
} from '@alphaink/shared';
import type {
  Cluster,
  ClusterPreview,
  Contact,
  DocId,
  NewsletterAudience,
  Order,
} from '@alphaink/shared';
import { chunk, mapWithConcurrency } from '../lib/async';
import { AppError, notFound } from '../lib/errors';
import {
  FieldValue,
  col,
  commitInBatches,
  db,
  nowIso,
  paginateQuery,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';
import {
  buildPurchaseFacts,
  evaluateGroup,
  groupNeedsPurchaseFacts,
  countConditions,
} from './evaluator';
import type { EvaluationContext, EvaluationOrder, PurchaseFacts, RuleGroup } from './evaluator';
import { planQuery } from './query-planner';
import type { QueryPlan } from './query-planner';

const log = createLogger('clusters.engine');

/** Documenti letti per pagina durante la scansione. */
export const DEFAULT_PAGE_SIZE = 500;

/** Tetto di sicurezza sui membri di un cluster. */
export const MAX_CLUSTER_MEMBERS = LIMITS.maxRecipientsPerCampaign;

/** Documenti massimi analizzati da un'anteprima. */
export const PREVIEW_MAX_SCAN = 20_000;

/** Finestra degli ordini caricati per i filtri `purchasedSku` / `purchasedBrand`. */
export const PURCHASE_FACTS_WINDOW_DAYS = 730;

/**
 * Età massima dell'indice di appartenenza (`dynamicClusterIds`) oltre la quale
 * il cluster viene rivalutato dalle regole invece che letto dall'indice.
 * Coincide con la frequenza del job di refresh.
 */
export const MEMBERSHIP_INDEX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Sottoinsieme di `Cluster` sufficiente a risolvere i membri. */
export type ClusterLike = Pick<Cluster, 'type'> &
  Partial<Pick<Cluster, 'id' | 'name' | 'rules' | 'contactIds' | 'siteGroupName' | 'brevoListId' | 'lastComputedAt'>>;

// -----------------------------------------------------------------------------
// Utility di lettura
// -----------------------------------------------------------------------------

/** Interruzione controllata della scansione al raggiungimento del limite. */
class ScanStopped extends Error {
  constructor() {
    super('scan-stopped');
    this.name = 'ScanStopped';
  }
}

function isMissingIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /requires an index|FAILED_PRECONDITION.*index/i.test(message);
}

/** Documenti letti in un colpo solo con `getAll`. */
const CONTACT_READ_CHUNK = 300;

/**
 * Campi che bastano a decidere se un contatto è un destinatario valido.
 * Usati come proiezione quando serve solo il conteggio del pubblico: un
 * documento `Contact` intero porta con sé statistiche, stampanti e attributi
 * personalizzati che nel conteggio non servono e che, moltiplicati per
 * centinaia di migliaia di destinatari, esaurirebbero la memoria.
 */
const AUDIENCE_FIELD_MASK: string[] = [
  'status',
  'email',
  'emailNormalized',
  'engagement.lastSentAt',
  'stats.lastOrderAt',
];

/** Carica i contatti indicati, a blocchi, saltando i documenti inesistenti. */
export async function loadContactsByIds(ids: readonly string[]): Promise<Contact[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];

  const blocks = chunk(unique, CONTACT_READ_CHUNK);
  const pages = await mapWithConcurrency(blocks, 4, async (block) => {
    const refs = block.map((id) => col.contacts().doc(id));
    const snapshots = await db.getAll(...refs);
    return snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => withId<Contact>(snapshot));
  });

  return pages.flat();
}

/** Ordini recenti dei contatti indicati, aggregati nei fatti d'acquisto. */
export async function loadPurchaseFacts(
  contacts: readonly Contact[],
  now: number,
): Promise<{ byContact: Map<string, PurchaseFacts>; byEmail: Map<string, PurchaseFacts> }> {
  const byContact = new Map<string, PurchaseFacts>();
  const byEmail = new Map<string, PurchaseFacts>();
  if (contacts.length === 0) return { byContact, byEmail };

  const since = new Date(now - PURCHASE_FACTS_WINDOW_DAYS * 86_400_000).toISOString();
  const emails = Array.from(
    new Set(
      contacts
        .map((contact) => contact.emailNormalized || normalizeEmail(contact.email ?? ''))
        .filter((email) => email.length > 0),
    ),
  );

  // `in` accetta 30 valori per query: si procede a blocchi, in parallelo controllato.
  const blocks = chunk(emails, 30);
  const results = await mapWithConcurrency(blocks, 4, async (block) => {
    const snapshot = await col
      .orders()
      .where('emailNormalized', 'in', block)
      .where('placedAt', '>=', since)
      .get();
    return snapshot.docs.map((doc) => withId<Order>(doc));
  });

  const ordersByEmail = new Map<string, EvaluationOrder[]>();
  for (const order of results.flat()) {
    const email = order.emailNormalized || normalizeEmail(order.email ?? '');
    if (!email) continue;
    const list = ordersByEmail.get(email) ?? [];
    list.push({
      contactId: order.contactId ?? null,
      emailNormalized: email,
      skus: order.skus ?? [],
      families: order.families ?? [],
      items: (order.items ?? []).map((item) => ({
        sku: item.sku,
        name: item.name,
        brand: item.brand ?? null,
      })),
      placedAt: order.placedAt,
    });
    ordersByEmail.set(email, list);
  }

  for (const [email, orders] of ordersByEmail) {
    const facts = buildPurchaseFacts(orders);
    byEmail.set(email, facts);
    for (const order of orders) {
      if (order.contactId) byContact.set(order.contactId, facts);
    }
  }

  return { byContact, byEmail };
}

// -----------------------------------------------------------------------------
// Risoluzione dei membri di un cluster
// -----------------------------------------------------------------------------

export interface ResolveClusterOptions {
  /** Numero massimo di contatti raccolti (oltre il quale il risultato è troncato). */
  limit?: number;
  /** Documenti letti per pagina. */
  pageSize?: number;
  /** Istante di riferimento per gli operatori temporali. */
  now?: number;
  /** Se true restituisce anche i documenti completi dei contatti. */
  collectContacts?: boolean;
  /** Quanti contatti includere nel campione di anteprima. */
  sampleSize?: number;
  /** Tetto ai documenti scansionati (anteprime). */
  maxScan?: number;
}

export interface ResolvedCluster {
  contactIds: DocId[];
  contacts: Contact[];
  sample: Array<{ id: DocId; email: string; displayName: string }>;
  contactCount: number;
  sendableCount: number;
  scanned: number;
  truncated: boolean;
  durationMs: number;
  warnings: string[];
}

interface ScanSpec {
  plan: QueryPlan;
  needsPurchaseFacts: boolean;
  /**
   * Regole complete da rivalutare in memoria se la query indicizzata non è
   * eseguibile. È definita solo per i cluster a regole: per `site_group` e
   * `brevo_list` il vincolo È la definizione del cluster e toglierlo
   * restituirebbe tutta la rubrica.
   */
  fallbackRules?: RuleGroup | null;
  allowFullScanFallback: boolean;
}

/** Costruisce la query Firestore a partire dai vincoli del piano. */
function buildQuery(plan: QueryPlan): FirebaseFirestore.Query {
  let query: FirebaseFirestore.Query = col.contacts();
  for (const constraint of plan.constraints) {
    query = query.where(
      constraint.field,
      constraint.operator as FirebaseFirestore.WhereFilterOp,
      constraint.value,
    );
  }
  // Firestore impone che il primo ordinamento sia sul campo del range.
  if (plan.orderByField) query = query.orderBy(plan.orderByField);
  return query.orderBy(FieldPath.documentId());
}

/** Piano di scansione per il tipo di cluster richiesto. */
function scanSpecFor(cluster: ClusterLike, now: number): ScanSpec {
  switch (cluster.type) {
    case 'site_group': {
      const group = cluster.siteGroupName?.trim();
      if (!group) {
        throw new AppError('failed_precondition', 'Il cluster non indica il gruppo cliente del sito.');
      }
      return {
        plan: {
          constraints: [
            { field: 'customerGroup', operator: '==', value: group, conditionId: 'site_group', exact: true },
          ],
          residual: null,
          orderByField: null,
          notes: [],
        },
        needsPurchaseFacts: false,
        allowFullScanFallback: false,
      };
    }
    case 'brevo_list': {
      const listId = cluster.brevoListId;
      if (!listId) {
        throw new AppError('failed_precondition', 'Il cluster non indica la lista Brevo di riferimento.');
      }
      return {
        plan: {
          constraints: [
            { field: 'brevoListIds', operator: 'array-contains', value: listId, conditionId: 'brevo_list', exact: true },
          ],
          residual: null,
          orderByField: null,
          notes: [],
        },
        needsPurchaseFacts: false,
        allowFullScanFallback: false,
      };
    }
    case 'dynamic':
    default: {
      const rules = cluster.rules ?? null;
      return {
        plan: planQuery(rules, now),
        needsPurchaseFacts: groupNeedsPurchaseFacts(rules),
        fallbackRules: rules,
        allowFullScanFallback: true,
      };
    }
  }
}

/** Esegue la scansione applicando il piano e valutando il residuo in memoria. */
async function scanContacts(
  spec: ScanSpec,
  options: ResolveClusterOptions,
): Promise<ResolvedCluster> {
  const startedAt = Date.now();
  const now = options.now ?? startedAt;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const limit = options.limit ?? MAX_CLUSTER_MEMBERS;
  const maxScan = options.maxScan ?? Number.POSITIVE_INFINITY;
  const sampleSize = options.sampleSize ?? LIMITS.previewSampleSize;

  const contactIds: DocId[] = [];
  const contacts: Contact[] = [];
  const sample: ResolvedCluster['sample'] = [];
  const warnings: string[] = [...spec.plan.notes];
  let sendableCount = 0;
  let scanned = 0;
  let truncated = false;

  const handler = async (docs: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<void> => {
    const page = docs.map((doc) => withId<Contact>(doc));
    scanned += page.length;

    let ctx: EvaluationContext = { now };
    if (spec.needsPurchaseFacts) {
      const facts = await loadPurchaseFacts(page, now);
      ctx = { now, purchasesByContact: facts.byContact, purchasesByEmail: facts.byEmail };
    }

    for (const contact of page) {
      if (spec.plan.residual && !evaluateGroup(spec.plan.residual, contact, ctx)) continue;

      contactIds.push(contact.id);
      if (options.collectContacts) contacts.push(contact);
      if (SENDABLE_STATUSES.includes(contact.status)) sendableCount += 1;
      if (sample.length < sampleSize) {
        sample.push({
          id: contact.id,
          email: contact.email,
          displayName: displayNameFor(contact),
        });
      }

      if (contactIds.length >= limit) {
        truncated = true;
        throw new ScanStopped();
      }
    }

    if (scanned >= maxScan) {
      truncated = true;
      throw new ScanStopped();
    }
  };

  const run = async (plan: QueryPlan): Promise<void> => {
    try {
      await paginateQuery(buildQuery(plan), pageSize, handler);
    } catch (error) {
      if (error instanceof ScanStopped) return;
      throw error;
    }
  };

  try {
    await run(spec.plan);
  } catch (error) {
    if (!isMissingIndexError(error) || !spec.allowFullScanFallback) throw error;
    // Indice composito mancante: si ripiega sulla scansione completa così il
    // cluster resta utilizzabile finché l'indice non viene creato. Il residuo
    // torna a essere l'albero di regole completo, perché senza vincoli in query
    // le condizioni "spinte" non sarebbero più applicate da nessuno.
    log.warn('Indice Firestore mancante: scansione completa di ripiego', {
      constraints: spec.plan.constraints,
      error: error instanceof Error ? error.message : String(error),
    });
    warnings.push(
      'Indice Firestore mancante per queste regole: il calcolo è stato eseguito con una scansione completa (più lenta).',
    );
    contactIds.length = 0;
    contacts.length = 0;
    sample.length = 0;
    sendableCount = 0;
    scanned = 0;
    truncated = false;
    await run({
      constraints: [],
      residual: spec.fallbackRules ?? spec.plan.residual,
      orderByField: null,
      notes: [],
    });
  }

  if (truncated) {
    warnings.push(`Risultato parziale: analizzati ${scanned} contatti.`);
  }

  return {
    contactIds,
    contacts,
    sample,
    contactCount: contactIds.length,
    sendableCount,
    scanned,
    truncated,
    durationMs: Date.now() - startedAt,
    warnings,
  };
}

/** Risolve i contatti appartenenti a un cluster, qualunque sia il tipo. */
export async function resolveClusterContacts(
  cluster: ClusterLike,
  options: ResolveClusterOptions = {},
): Promise<ResolvedCluster> {
  const startedAt = Date.now();

  if (cluster.type === 'static') {
    const ids = (cluster.contactIds ?? []).slice(0, options.limit ?? MAX_CLUSTER_MEMBERS);
    const contacts = await loadContactsByIds(ids);
    const sendableCount = contacts.filter((contact) => SENDABLE_STATUSES.includes(contact.status)).length;
    const missing = ids.length - contacts.length;
    return {
      contactIds: contacts.map((contact) => contact.id),
      contacts: options.collectContacts ? contacts : [],
      sample: contacts.slice(0, options.sampleSize ?? LIMITS.previewSampleSize).map((contact) => ({
        id: contact.id,
        email: contact.email,
        displayName: displayNameFor(contact),
      })),
      contactCount: contacts.length,
      sendableCount,
      scanned: ids.length,
      truncated: (cluster.contactIds ?? []).length > ids.length,
      durationMs: Date.now() - startedAt,
      warnings: missing > 0 ? [`${missing} contatti elencati non esistono più e sono stati ignorati.`] : [],
    };
  }

  const now = options.now ?? startedAt;
  return scanContacts(scanSpecFor(cluster, now), { ...options, now });
}

/**
 * Id dei membri di un cluster.
 * Quando l'indice di appartenenza è recente lo si legge direttamente: è molto
 * più economico che rivalutare le regole su tutta la collezione.
 */
export async function resolveClusterMembers(
  cluster: Cluster,
  options: { preferIndex?: boolean; now?: number; limit?: number } = {},
): Promise<DocId[]> {
  if (cluster.type === 'static') {
    return Array.from(new Set(cluster.contactIds ?? []));
  }

  const now = options.now ?? Date.now();
  const computedAt = cluster.lastComputedAt ? Date.parse(cluster.lastComputedAt) : NaN;
  const indexFresh =
    Number.isFinite(computedAt) && now - computedAt <= MEMBERSHIP_INDEX_MAX_AGE_MS && !cluster.computeError;

  if (options.preferIndex !== false && indexFresh) {
    const ids = await readMembershipIndex(cluster.id, options.limit);
    // Un indice vuoto su un cluster che dichiara membri è indice di
    // materializzazione mancata: meglio ricalcolare che inviare a nessuno.
    if (ids.length > 0 || cluster.contactCount === 0) return ids;
  }

  const resolved = await resolveClusterContacts(cluster, { now, limit: options.limit });
  return resolved.contactIds;
}

/** Legge l'indice `dynamicClusterIds` per un cluster. */
async function readMembershipIndex(clusterId: string, limit?: number): Promise<DocId[]> {
  const ids: DocId[] = [];
  const query = col
    .contacts()
    .where('dynamicClusterIds', 'array-contains', clusterId)
    .select()
    .orderBy(FieldPath.documentId());

  try {
    await paginateQuery(query, DEFAULT_PAGE_SIZE, async (docs) => {
      for (const doc of docs) {
        ids.push(doc.id);
        if (limit && ids.length >= limit) throw new ScanStopped();
      }
    });
  } catch (error) {
    if (!(error instanceof ScanStopped)) throw error;
  }
  return ids;
}

// -----------------------------------------------------------------------------
// Anteprima
// -----------------------------------------------------------------------------

/** Anteprima di un insieme di regole, senza salvare nulla. */
export async function previewClusterRules(
  rules: RuleGroup | null | undefined,
  limit: number = LIMITS.previewSampleSize,
  options: { now?: number; maxScan?: number } = {},
): Promise<ClusterPreview> {
  const resolved = await scanContacts(
    {
      plan: planQuery(rules ?? null, options.now ?? Date.now()),
      needsPurchaseFacts: groupNeedsPurchaseFacts(rules),
      fallbackRules: rules ?? null,
      allowFullScanFallback: true,
    },
    {
      now: options.now,
      sampleSize: Math.max(1, Math.min(limit, LIMITS.previewSampleSize)),
      maxScan: options.maxScan ?? PREVIEW_MAX_SCAN,
      limit: MAX_CLUSTER_MEMBERS,
    },
  );

  const warnings = [...resolved.warnings];
  if (!rules || countConditions(rules) === 0) {
    warnings.unshift('Nessuna condizione impostata: il cluster comprende tutti i contatti.');
  }
  if (resolved.contactCount === 0) {
    warnings.push('Nessun contatto soddisfa queste regole.');
  } else if (resolved.sendableCount === 0) {
    warnings.push('Nessun contatto contattabile: i corrispondenti sono disiscritti, in bounce o bloccati.');
  }

  return {
    matchedCount: resolved.contactCount,
    sendableCount: resolved.sendableCount,
    sample: resolved.sample,
    warnings,
  };
}

/** Anteprima di un cluster già configurato (qualunque tipo). */
export async function previewClusterDefinition(
  cluster: ClusterLike,
  limit: number = LIMITS.previewSampleSize,
  options: { now?: number } = {},
): Promise<ClusterPreview> {
  if (cluster.type === 'dynamic') {
    return previewClusterRules(cluster.rules ?? null, limit, options);
  }

  const resolved = await resolveClusterContacts(cluster, {
    now: options.now,
    sampleSize: limit,
    maxScan: PREVIEW_MAX_SCAN,
  });

  const warnings = [...resolved.warnings];
  if (resolved.contactCount === 0) warnings.push('Nessun contatto in questo cluster.');
  else if (resolved.sendableCount === 0) warnings.push('Nessun contatto contattabile in questo cluster.');

  return {
    matchedCount: resolved.contactCount,
    sendableCount: resolved.sendableCount,
    sample: resolved.sample,
    warnings,
  };
}

// -----------------------------------------------------------------------------
// Ricalcolo e materializzazione dell'appartenenza
// -----------------------------------------------------------------------------

export interface RecomputeClusterResult {
  clusterId: DocId;
  name: string;
  contactCount: number;
  sendableCount: number;
  added: number;
  removed: number;
  truncated: boolean;
  durationMs: number;
  warnings: string[];
}

/**
 * Ricalcola il cluster e allinea `contacts.dynamicClusterIds`.
 *
 * I cluster statici non materializzano nulla: la loro appartenenza vive già in
 * `cluster.contactIds` e in `contacts.clusterIds`; qui si aggiornano solo i
 * conteggi.
 */
export async function recomputeCluster(
  clusterId: string,
  options: { now?: number } = {},
): Promise<RecomputeClusterResult> {
  const startedAt = Date.now();
  const ref = col.clusters().doc(clusterId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw notFound('Cluster', clusterId);

  const cluster = withId<Cluster>(snapshot);
  const now = options.now ?? startedAt;

  try {
    const resolved = await resolveClusterContacts(cluster, { now, limit: MAX_CLUSTER_MEMBERS });

    let added = 0;
    let removed = 0;
    if (cluster.type !== 'static') {
      const diff = await syncMembershipIndex(clusterId, resolved.contactIds);
      added = diff.added;
      removed = diff.removed;
    }

    const durationMs = Date.now() - startedAt;
    await ref.update({
      contactCount: resolved.contactCount,
      sendableCount: resolved.sendableCount,
      lastComputedAt: nowIso(),
      computeDurationMs: durationMs,
      computeError: null,
      updatedAt: nowIso(),
    });

    log.info('Cluster ricalcolato', {
      clusterId,
      name: cluster.name,
      contactCount: resolved.contactCount,
      sendableCount: resolved.sendableCount,
      added,
      removed,
      durationMs,
    });

    return {
      clusterId,
      name: cluster.name,
      contactCount: resolved.contactCount,
      sendableCount: resolved.sendableCount,
      added,
      removed,
      truncated: resolved.truncated,
      durationMs,
      warnings: resolved.warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ref
      .update({ computeError: message, lastComputedAt: nowIso(), updatedAt: nowIso() })
      .catch(() => undefined);
    log.error('Ricalcolo cluster fallito', error, { clusterId });
    throw error;
  }
}

/** Allinea l'indice di appartenenza aggiungendo e togliendo solo le differenze. */
async function syncMembershipIndex(
  clusterId: string,
  members: readonly DocId[],
): Promise<{ added: number; removed: number }> {
  const target = new Set(members);
  const current = new Set(await readMembershipIndex(clusterId));

  const toAdd = members.filter((id) => !current.has(id));
  const toRemove = Array.from(current).filter((id) => !target.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return { added: 0, removed: 0 };

  const timestamp = nowIso();
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  for (const id of toAdd) {
    operations.push((batch) =>
      batch.update(col.contacts().doc(id), {
        dynamicClusterIds: FieldValue.arrayUnion(clusterId),
        updatedAt: timestamp,
      }),
    );
  }
  for (const id of toRemove) {
    operations.push((batch) =>
      batch.update(col.contacts().doc(id), {
        dynamicClusterIds: FieldValue.arrayRemove(clusterId),
        updatedAt: timestamp,
      }),
    );
  }

  await commitInBatches(operations);
  return { added: toAdd.length, removed: toRemove.length };
}

/** Rimuove il cluster dall'appartenenza di tutti i contatti. */
export async function detachClusterFromContacts(clusterId: string): Promise<number> {
  const timestamp = nowIso();
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const field of ['dynamicClusterIds', 'clusterIds'] as const) {
    const query = col
      .contacts()
      .where(field, 'array-contains', clusterId)
      .select()
      .orderBy(FieldPath.documentId());
    await paginateQuery(query, DEFAULT_PAGE_SIZE, async (docs) => {
      for (const doc of docs) {
        operations.push((batch) =>
          batch.update(doc.ref, {
            [field]: FieldValue.arrayRemove(clusterId),
            updatedAt: timestamp,
          }),
        );
      }
    });
  }

  if (operations.length === 0) return 0;
  return commitInBatches(operations);
}

// -----------------------------------------------------------------------------
// Pubblico di una newsletter
// -----------------------------------------------------------------------------

export type AudienceExclusionReason =
  | 'not_found'
  | 'not_sendable'
  | 'invalid_email'
  | 'duplicate_email'
  | 'excluded_cluster'
  | 'excluded_contact'
  | 'suppressed_recently_contacted'
  | 'suppressed_recently_purchased';

export type AudienceReasons = Record<AudienceExclusionReason, number>;

export function emptyAudienceReasons(): AudienceReasons {
  return {
    not_found: 0,
    not_sendable: 0,
    invalid_email: 0,
    duplicate_email: 0,
    excluded_cluster: 0,
    excluded_contact: 0,
    suppressed_recently_contacted: 0,
    suppressed_recently_purchased: 0,
  };
}

export interface ResolvedAudience {
  contactIds: DocId[];
  /** Documenti completi: popolati se `includeContacts` non è `false`. */
  contacts: Contact[];
  /** Quanti contatti sono stati scartati rispetto all'unione dei cluster. */
  excludedCount: number;
  reasons: AudienceReasons;
  warnings: string[];
}

export interface ResolveAudienceOptions {
  now?: number;
  /** Se `false` restituisce solo gli id (utile per le sole stime). */
  includeContacts?: boolean;
  /** Tetto ai destinatari raccolti. */
  limit?: number;
  /** Rivaluta sempre le regole invece di leggere l'indice di appartenenza. */
  forceRecompute?: boolean;
}

async function loadClusters(ids: readonly string[]): Promise<Cluster[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const snapshots = await db.getAll(...unique.map((id) => col.clusters().doc(id)));
  return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => withId<Cluster>(snapshot));
}

/**
 * Risolve il pubblico di una newsletter:
 * unione dei cluster inclusi − cluster esclusi ± contatti singoli, poi filtri
 * di contattabilità, soppressioni temporali e deduplica per email.
 */
export async function resolveAudience(
  audience: NewsletterAudience,
  options: ResolveAudienceOptions = {},
): Promise<ResolvedAudience> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? MAX_CLUSTER_MEMBERS;
  const reasons = emptyAudienceReasons();
  const warnings: string[] = [];

  const includedClusters = await loadClusters(audience.clusterIds ?? []);
  const excludedClusters = await loadClusters(audience.excludeClusterIds ?? []);

  const missingIncluded = (audience.clusterIds ?? []).length - includedClusters.length;
  if (missingIncluded > 0) {
    warnings.push(`${missingIncluded} cluster inclusi non esistono più e sono stati ignorati.`);
  }

  const preferIndex = options.forceRecompute ? false : undefined;
  const union = new Set<DocId>();
  for (const cluster of includedClusters) {
    const members = await resolveClusterMembers(cluster, { preferIndex, now, limit });
    for (const id of members) union.add(id);
  }

  const excluded = new Set<DocId>();
  for (const cluster of excludedClusters) {
    const members = await resolveClusterMembers(cluster, { preferIndex, now });
    for (const id of members) excluded.add(id);
  }

  for (const id of audience.includeContactIds ?? []) union.add(id);

  for (const id of excluded) {
    if (union.delete(id)) reasons.excluded_cluster += 1;
  }
  for (const id of audience.excludeContactIds ?? []) {
    if (union.delete(id)) reasons.excluded_contact += 1;
  }

  const candidates = Array.from(union).slice(0, limit);
  if (union.size > candidates.length) {
    warnings.push(`Pubblico troncato a ${limit} destinatari.`);
  }

  const contactedWindow = audience.suppressIfContactedWithinDays ?? null;
  const purchasedWindow = audience.suppressIfPurchasedWithinDays ?? null;
  const includeContacts = options.includeContacts !== false;

  // I candidati si filtrano a blocchi, senza mai accumulare l'intera rubrica:
  // quando serve solo il numero (stima del pubblico) si leggono i soli campi
  // che decidono la contattabilità, perché i documenti interi di centinaia di
  // migliaia di contatti non stanno nella memoria della Function.
  const pages = await mapWithConcurrency(
    chunk(candidates, CONTACT_READ_CHUNK),
    4,
    async (block) => {
      const refs = block.map((id) => col.contacts().doc(id));
      const snapshots = includeContacts
        ? await db.getAll(...refs)
        : await db.getAll(...refs, { fieldMask: AUDIENCE_FIELD_MASK });

      const pageReasons = emptyAudienceReasons();
      const kept: Array<{ id: DocId; email: string; contact: Contact | null }> = [];

      for (const snapshot of snapshots) {
        if (!snapshot.exists) {
          pageReasons.not_found += 1;
          continue;
        }
        const contact = withId<Contact>(snapshot);
        if (!SENDABLE_STATUSES.includes(contact.status)) {
          pageReasons.not_sendable += 1;
          continue;
        }
        const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
        if (!email || !isValidEmail(email)) {
          pageReasons.invalid_email += 1;
          continue;
        }
        if (contactedWindow !== null && contactedWindow > 0) {
          const lastSent = contact.engagement?.lastSentAt ? Date.parse(contact.engagement.lastSentAt) : NaN;
          if (Number.isFinite(lastSent) && lastSent >= now - contactedWindow * 86_400_000) {
            pageReasons.suppressed_recently_contacted += 1;
            continue;
          }
        }
        if (purchasedWindow !== null && purchasedWindow > 0) {
          const lastOrder = contact.stats?.lastOrderAt ? Date.parse(contact.stats.lastOrderAt) : NaN;
          if (Number.isFinite(lastOrder) && lastOrder >= now - purchasedWindow * 86_400_000) {
            pageReasons.suppressed_recently_purchased += 1;
            continue;
          }
        }
        // Il documento proiettato è parziale: si trattiene solo quando il
        // chiamante lo ha chiesto per intero, mai per la sola stima.
        kept.push({ id: contact.id, email, contact: includeContacts ? contact : null });
      }

      return { kept, reasons: pageReasons };
    },
  );

  // La deduplica per email è globale e si applica scorrendo i blocchi nel loro
  // ordine, così l'esito non dipende da quale lettura è tornata per prima.
  const seenEmails = new Set<string>();
  const contactIds: DocId[] = [];
  const selected: Contact[] = [];
  for (const page of pages) {
    for (const [reason, count] of Object.entries(page.reasons) as Array<[AudienceExclusionReason, number]>) {
      reasons[reason] += count;
    }
    for (const entry of page.kept) {
      if (seenEmails.has(entry.email)) {
        reasons.duplicate_email += 1;
        continue;
      }
      seenEmails.add(entry.email);
      contactIds.push(entry.id);
      if (entry.contact) selected.push(entry.contact);
    }
  }

  const excludedCount = Object.values(reasons).reduce((sum, value) => sum + value, 0);

  if (contactIds.length === 0) {
    warnings.push('Nessun destinatario contattabile con questi criteri.');
  }

  return {
    contactIds,
    contacts: includeContacts ? selected : [],
    excludedCount,
    reasons,
    warnings,
  };
}

/** Stima rapida del numero di destinatari, senza materializzare i contatti. */
export async function estimateAudienceSize(
  audience: NewsletterAudience,
  options: ResolveAudienceOptions = {},
): Promise<{ recipients: number; excludedCount: number; reasons: AudienceReasons; warnings: string[] }> {
  const resolved = await resolveAudience(audience, { ...options, includeContacts: false });
  return {
    recipients: resolved.contactIds.length,
    excludedCount: resolved.excludedCount,
    reasons: resolved.reasons,
    warnings: resolved.warnings,
  };
}
