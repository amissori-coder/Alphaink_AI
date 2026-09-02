/**
 * Accesso ai contatti: deduplica, merge non distruttivo e stato di iscrizione.
 *
 * Regole di merge (valgono per import CSV, sincronizzazione sito e webhook):
 *  - la chiave di deduplica è `emailNormalized`, mai l'id esterno: lo stesso
 *    cliente può esistere sia sul B2C sia sul B2B con id diversi;
 *  - un valore vuoto in arrivo non sovrascrive mai un dato già presente;
 *  - `sources` ed `externalIds` si uniscono, non si sostituiscono;
 *  - una disiscrizione (o un bounce/blocco) non viene mai annullata da una
 *    sincronizzazione: serve un opt-in esplicito (`allowResubscribe`).
 */

import {
  EMPTY_ENGAGEMENT,
  computeEngagementScore,
  displayNameFor,
  engagementTierFromScore,
  isValidEmail,
  normalizeEmail,
} from '@alphaink/shared';
import type {
  Contact,
  ContactEngagement,
  ContactStats,
  DocId,
  IsoDate,
  OwnedPrinter,
  SiteSource,
  SubscriptionStatus,
} from '@alphaink/shared';
import { chunk, mapWithConcurrency } from '../lib/async';
import { invalidArgument } from '../lib/errors';
import { auditCreate, auditUpdate, col, db, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('contacts.repository');

/** Stati che una sincronizzazione automatica non può annullare. */
export const PROTECTED_STATUSES: SubscriptionStatus[] = ['unsubscribed', 'blocked', 'bounced'];

/** Statistiche commerciali di un contatto appena creato. */
export function emptyContactStats(): ContactStats {
  return {
    ordersCount: 0,
    totalSpent: 0,
    averageOrderValue: 0,
    firstOrderAt: null,
    lastOrderAt: null,
    averageDaysBetweenOrders: null,
    nextPurchaseDueAt: {},
    spentByFamily: {},
    ordersByFamily: {},
    lastOrderByFamily: {},
  };
}

/** Dati accettati in creazione/aggiornamento di un contatto. */
export interface ContactUpsertInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;
  language?: string | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  postcode?: string | null;
  customerGroup?: string | null;
  segment?: 'b2c' | 'b2b';
  tags?: string[];
  clusterIds?: DocId[];
  status?: SubscriptionStatus;
  optInAt?: IsoDate | null;
  optOutAt?: IsoDate | null;
  consentSource?: string | null;
  /** Id del cliente sulla piattaforma di provenienza. */
  externalId?: string | null;
  customAttributes?: Record<string, string | number | boolean | null> | null;
  printers?: OwnedPrinter[];
  notes?: string | null;
  brevoContactId?: number | null;
  brevoListIds?: number[];
}

export interface ContactUpsertOptions {
  /** Se false i contatti già esistenti vengono lasciati intatti. */
  updateExisting?: boolean;
  /** Consente di riportare a `subscribed` un contatto disiscritto (solo opt-in esplicito). */
  allowResubscribe?: boolean;
  /** Aggiorna `lastSyncAt`: da usare nelle sincronizzazioni dal sito. */
  markSynced?: boolean;
}

export interface ContactUpsertResult {
  id: DocId;
  created: boolean;
  updated: boolean;
  contact: Contact;
}

// -----------------------------------------------------------------------------
// Letture
// -----------------------------------------------------------------------------

/** Contatto corrispondente all'email, o `null`. */
export async function getContactByEmail(email: string): Promise<Contact | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const snapshot = await col
    .contacts()
    .where('emailNormalized', '==', normalized)
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  return doc ? withId<Contact>(doc) : null;
}

export async function getContactById(contactId: string): Promise<Contact | null> {
  const snapshot = await col.contacts().doc(contactId).get();
  return snapshot.exists ? withId<Contact>(snapshot) : null;
}

/** Carica più contatti per id, saltando quelli inesistenti. */
export async function getContactsByIds(ids: readonly string[]): Promise<Contact[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const blocks = chunk(unique, 300);
  const pages = await mapWithConcurrency(blocks, 4, async (block) => {
    const snapshots = await db.getAll(...block.map((id) => col.contacts().doc(id)));
    return snapshots.filter((snap) => snap.exists).map((snap) => withId<Contact>(snap));
  });
  return pages.flat();
}

/**
 * Cerca i contatti corrispondenti alle email indicate.
 * Usata dall'import massivo per evitare una query per riga.
 */
export async function findContactsByEmails(
  emails: readonly string[],
): Promise<Map<string, Contact>> {
  const normalized = Array.from(
    new Set(emails.map((email) => normalizeEmail(email)).filter((email) => email.length > 0)),
  );
  const found = new Map<string, Contact>();
  if (normalized.length === 0) return found;

  // `in` accetta al massimo 30 valori per query.
  const blocks = chunk(normalized, 30);
  const pages = await mapWithConcurrency(blocks, 5, async (block) => {
    const snapshot = await col.contacts().where('emailNormalized', 'in', block).get();
    return snapshot.docs.map((doc) => withId<Contact>(doc));
  });

  for (const contact of pages.flat()) {
    const key = contact.emailNormalized || normalizeEmail(contact.email ?? '');
    if (key && !found.has(key)) found.set(key, contact);
  }
  return found;
}

// -----------------------------------------------------------------------------
// Costruzione dei documenti
// -----------------------------------------------------------------------------

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Il valore in arrivo vince solo se è valorizzato. */
function preferIncoming(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  return cleanText(incoming) ?? cleanText(existing) ?? null;
}

function mergeStringArrays(existing: string[] | undefined, incoming: string[] | undefined): string[] {
  return Array.from(new Set([...(existing ?? []), ...(incoming ?? [])].filter(Boolean)));
}

/** Documento di un contatto nuovo. */
export function buildNewContactData(
  input: ContactUpsertInput,
  source: SiteSource,
  uid?: string | null,
): Omit<Contact, 'id'> {
  const email = normalizeEmail(input.email);
  const status = input.status ?? 'subscribed';
  const now = nowIso();

  return {
    email,
    emailNormalized: email,
    firstName: cleanText(input.firstName),
    lastName: cleanText(input.lastName),
    displayName: displayNameFor({
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      email,
    }),
    phone: cleanText(input.phone),
    company: cleanText(input.company),
    vatNumber: cleanText(input.vatNumber),
    source,
    sources: [source],
    externalIds: input.externalId ? ({ [source]: input.externalId } as Contact['externalIds']) : {},
    status,
    optInAt: input.optInAt ?? (status === 'subscribed' ? now : null),
    optOutAt: input.optOutAt ?? (status === 'unsubscribed' ? now : null),
    consentSource: cleanText(input.consentSource),
    language: cleanText(input.language) ?? 'it',
    country: cleanText(input.country),
    province: cleanText(input.province),
    city: cleanText(input.city),
    postcode: cleanText(input.postcode),
    customerGroup: cleanText(input.customerGroup),
    segment: input.segment ?? 'b2c',
    tags: Array.from(new Set(input.tags ?? [])),
    clusterIds: Array.from(new Set(input.clusterIds ?? [])),
    dynamicClusterIds: [],
    stats: emptyContactStats(),
    engagement: { ...EMPTY_ENGAGEMENT },
    printers: input.printers ?? [],
    brevoContactId: input.brevoContactId ?? null,
    brevoSyncedAt: null,
    brevoListIds: input.brevoListIds ?? [],
    lastSyncAt: now,
    customAttributes: input.customAttributes ?? {},
    notes: cleanText(input.notes),
    ...auditCreate(uid),
  };
}

/**
 * Patch di aggiornamento di un contatto esistente.
 * Restituisce solo i campi realmente modificati: meno scritture, meno rumore
 * nei trigger e nel log attività.
 */
export function buildContactPatch(
  existing: Contact,
  input: ContactUpsertInput,
  source: SiteSource,
  uid?: string | null,
  options: ContactUpsertOptions = {},
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown, current: unknown): void => {
    if (value === undefined || value === null) return;
    if (JSON.stringify(value) === JSON.stringify(current ?? null)) return;
    patch[key] = value;
  };

  set('firstName', preferIncoming(input.firstName, existing.firstName), existing.firstName);
  set('lastName', preferIncoming(input.lastName, existing.lastName), existing.lastName);
  set('phone', preferIncoming(input.phone, existing.phone), existing.phone);
  set('company', preferIncoming(input.company, existing.company), existing.company);
  set('vatNumber', preferIncoming(input.vatNumber, existing.vatNumber), existing.vatNumber);
  set('language', preferIncoming(input.language, existing.language), existing.language);
  set('country', preferIncoming(input.country, existing.country), existing.country);
  set('province', preferIncoming(input.province, existing.province), existing.province);
  set('city', preferIncoming(input.city, existing.city), existing.city);
  set('postcode', preferIncoming(input.postcode, existing.postcode), existing.postcode);
  set('customerGroup', preferIncoming(input.customerGroup, existing.customerGroup), existing.customerGroup);
  set('notes', preferIncoming(input.notes, existing.notes), existing.notes);
  set('consentSource', preferIncoming(input.consentSource, existing.consentSource), existing.consentSource);

  const displayName = displayNameFor({
    firstName: (patch.firstName as string | undefined) ?? existing.firstName,
    lastName: (patch.lastName as string | undefined) ?? existing.lastName,
    company: (patch.company as string | undefined) ?? existing.company,
    email: existing.email,
  });
  set('displayName', displayName, existing.displayName);

  // Il segmento B2B non torna indietro da solo: chi compra come azienda resta B2B.
  if (input.segment && input.segment !== existing.segment && !(existing.segment === 'b2b' && input.segment === 'b2c')) {
    patch.segment = input.segment;
  }

  const sources = mergeStringArrays(existing.sources as string[], [source]);
  if (sources.length !== (existing.sources ?? []).length) patch.sources = sources;

  if (input.externalId) {
    const current = existing.externalIds?.[source];
    if (current !== input.externalId) {
      patch.externalIds = { ...(existing.externalIds ?? {}), [source]: input.externalId };
    }
  }

  const tags = mergeStringArrays(existing.tags, input.tags);
  if (tags.length !== (existing.tags ?? []).length) patch.tags = tags;

  const clusterIds = mergeStringArrays(existing.clusterIds, input.clusterIds);
  if (clusterIds.length !== (existing.clusterIds ?? []).length) patch.clusterIds = clusterIds;

  if (input.printers && input.printers.length > 0) {
    const known = new Set(
      (existing.printers ?? []).map((printer) => `${printer.brand}|${printer.model}`.toLowerCase()),
    );
    const added = input.printers.filter(
      (printer) => !known.has(`${printer.brand}|${printer.model}`.toLowerCase()),
    );
    if (added.length > 0) patch.printers = [...(existing.printers ?? []), ...added];
  }

  if (input.customAttributes && Object.keys(input.customAttributes).length > 0) {
    const merged = { ...(existing.customAttributes ?? {}), ...input.customAttributes };
    if (JSON.stringify(merged) !== JSON.stringify(existing.customAttributes ?? {})) {
      patch.customAttributes = merged;
    }
  }

  if (typeof input.brevoContactId === 'number' && input.brevoContactId !== existing.brevoContactId) {
    patch.brevoContactId = input.brevoContactId;
  }
  if (input.brevoListIds && input.brevoListIds.length > 0) {
    const merged = Array.from(new Set([...(existing.brevoListIds ?? []), ...input.brevoListIds]));
    if (merged.length !== (existing.brevoListIds ?? []).length) patch.brevoListIds = merged;
  }

  // --- stato di iscrizione ---------------------------------------------------
  const requested = input.status;
  if (requested && requested !== existing.status) {
    const locked = PROTECTED_STATUSES.includes(existing.status) && !options.allowResubscribe;
    const isDowngrade = PROTECTED_STATUSES.includes(requested);
    if (isDowngrade || !locked) {
      patch.status = requested;
      if (requested === 'subscribed') patch.optInAt = input.optInAt ?? nowIso();
      if (requested === 'unsubscribed') patch.optOutAt = input.optOutAt ?? nowIso();
    } else {
      log.debug('Stato di iscrizione protetto: aggiornamento ignorato', {
        contactId: existing.id,
        existing: existing.status,
        requested,
      });
    }
  }

  if (options.markSynced) patch.lastSyncAt = nowIso();
  if (Object.keys(patch).length === 0) return {};
  return { ...patch, ...auditUpdate(uid) };
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

/**
 * Crea o aggiorna un contatto deduplicando sull'email normalizzata.
 * La lettura e la scrittura avvengono nella stessa transazione: due
 * sincronizzazioni concorrenti non possono creare due documenti gemelli.
 */
export async function upsertContact(
  input: ContactUpsertInput,
  source: SiteSource,
  uid?: string | null,
  options: ContactUpsertOptions = {},
): Promise<ContactUpsertResult> {
  const email = normalizeEmail(input.email);
  if (!email || !isValidEmail(email)) {
    throw invalidArgument(`Indirizzo email non valido: "${input.email}".`);
  }

  const query = col.contacts().where('emailNormalized', '==', email).limit(1);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(query);
    const doc = snapshot.docs[0];

    if (!doc) {
      const ref = col.contacts().doc();
      const data = buildNewContactData({ ...input, email }, source, uid);
      transaction.set(ref, data);
      return { id: ref.id, created: true, updated: false, contact: { ...data, id: ref.id } as Contact };
    }

    const existing = withId<Contact>(doc);
    if (options.updateExisting === false) {
      return { id: existing.id, created: false, updated: false, contact: existing };
    }

    const patch = buildContactPatch(existing, { ...input, email }, source, uid, options);
    if (Object.keys(patch).length === 0) {
      return { id: existing.id, created: false, updated: false, contact: existing };
    }

    transaction.update(doc.ref, patch);
    return {
      id: existing.id,
      created: false,
      updated: true,
      contact: { ...existing, ...(patch as Partial<Contact>) },
    };
  });
}

/**
 * Cambia lo stato di iscrizione di un contatto individuato per email.
 * Restituisce `null` se l'indirizzo non è in rubrica (es. disiscrizione di un
 * destinatario di prova).
 */
export async function setSubscriptionStatus(
  email: string,
  status: SubscriptionStatus,
  reason?: string | null,
): Promise<Contact | null> {
  const contact = await getContactByEmail(email);
  if (!contact) {
    log.warn('Cambio stato richiesto per un contatto inesistente', { email: normalizeEmail(email) });
    return null;
  }
  if (contact.status === status) return contact;

  const timestamp = nowIso();
  const patch: Record<string, unknown> = {
    status,
    statusReason: reason ?? null,
    statusChangedAt: timestamp,
    updatedAt: timestamp,
  };
  if (status === 'subscribed') patch.optInAt = timestamp;
  if (status === 'unsubscribed' || status === 'blocked') patch.optOutAt = timestamp;

  await col.contacts().doc(contact.id).update(patch);
  log.info('Stato di iscrizione aggiornato', {
    contactId: contact.id,
    from: contact.status,
    to: status,
    reason: reason ?? null,
  });

  return { ...contact, ...(patch as Partial<Contact>) };
}

/**
 * Ricalcola punteggio e fascia di engagement del contatto.
 * Scrive solo se qualcosa è davvero cambiato: il trigger sui contatti fa
 * ripartire la sincronizzazione Brevo ad ogni scrittura.
 */
export async function recomputeEngagement(
  contactId: string,
  nowMs: number = Date.now(),
): Promise<ContactEngagement | null> {
  const ref = col.contacts().doc(contactId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;

  const contact = withId<Contact>(snapshot);
  const engagement: ContactEngagement = { ...EMPTY_ENGAGEMENT, ...(contact.engagement ?? {}) };
  const score = computeEngagementScore(engagement, nowMs);
  const tier = engagementTierFromScore(score, engagement.delivered);

  if (score === engagement.engagementScore && tier === engagement.engagementTier) {
    return engagement;
  }

  const updated: ContactEngagement = { ...engagement, engagementScore: score, engagementTier: tier };
  await ref.update({
    'engagement.engagementScore': score,
    'engagement.engagementTier': tier,
    updatedAt: nowIso(),
  });
  return updated;
}

/** Elimina un contatto e lo stacca dai cluster statici che lo elencano. */
export async function deleteContactRecord(contactId: string): Promise<Contact | null> {
  const contact = await getContactById(contactId);
  if (!contact) return null;

  const snapshot = await col.clusters().where('contactIds', 'array-contains', contactId).get();
  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.update(doc.ref, {
      contactIds: (doc.get('contactIds') as string[] | undefined)?.filter((id) => id !== contactId) ?? [],
      updatedAt: nowIso(),
    });
  }
  batch.delete(col.contacts().doc(contactId));
  await batch.commit();

  return contact;
}
