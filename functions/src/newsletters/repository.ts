/**
 * Accesso alla collezione `newsletters` e governo delle transizioni di stato.
 *
 * ## Ciclo di vita
 *
 *   draft ──schedule──▶ scheduled ──dispatcher──▶ queued ──▶ sending ──▶ sent
 *     ▲                    │                        │          │
 *     └──cancelSchedule────┘                        │          ├──▶ paused ──resume──▶ sending
 *                                                   │          └──▶ failed
 *                                                   └──▶ cancelled
 *
 * Le transizioni legali sono dichiarate in `ALLOWED_TRANSITIONS` e verificate
 * da `assertTransition`. `transitionNewsletter` le applica **dentro una
 * transazione Firestore**: due dispatcher concorrenti non possono portare la
 * stessa newsletter in `sending` due volte.
 *
 * Le statistiche (`stats`) non si scrivono mai per intero da qui: il modulo di
 * tracciamento le aggiorna con `FieldValue.increment` a partire dagli eventi
 * Brevo. `bumpNewsletterStats` esiste per i soli contatori che conosce chi
 * invia (destinatari e richieste effettivamente accodate).
 */

import { createHash } from 'node:crypto';
import { EMPTY_STATS, NEWSLETTER_STATUS_LABELS } from '@alphaink/shared';
import type {
  DocId,
  EmailDocument,
  IsoDate,
  Newsletter,
  NewsletterAudience,
  NewsletterInput,
  NewsletterSchedule,
  NewsletterStats,
  NewsletterStatus,
} from '@alphaink/shared';

import { AppError, notFound } from '../lib/errors';
import {
  FieldValue,
  auditCreate,
  auditUpdate,
  col,
  commitInBatches,
  db,
  nowIso,
  paginateQuery,
  serializeDoc,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('newsletters.repository');

/** Documenti letti per pagina nelle cancellazioni a cascata. */
const CASCADE_PAGE_SIZE = 400;

// -----------------------------------------------------------------------------
// Riferimenti
// -----------------------------------------------------------------------------

export function newslettersRef(): FirebaseFirestore.CollectionReference {
  return col.newsletters();
}

export function recipientsRef(newsletterId: DocId): FirebaseFirestore.CollectionReference {
  return col.recipients(newsletterId);
}

// -----------------------------------------------------------------------------
// Lettura
// -----------------------------------------------------------------------------

export async function getNewsletter(newsletterId: DocId): Promise<Newsletter | null> {
  const snapshot = await newslettersRef().doc(newsletterId).get();
  return snapshot.exists ? withId<Newsletter>(snapshot) : null;
}

export async function requireNewsletter(newsletterId: DocId): Promise<Newsletter> {
  const newsletter = await getNewsletter(newsletterId);
  if (!newsletter) throw notFound('Newsletter', newsletterId);
  return newsletter;
}

/**
 * Newsletter pianificate la cui ora di invio è passata.
 * Usa l'indice composto `status + schedule.sendAt`.
 */
export async function dueScheduledNewsletters(limit = 20, now: IsoDate = nowIso()): Promise<Newsletter[]> {
  const snapshot = await newslettersRef()
    .where('status', '==', 'scheduled')
    .where('schedule.sendAt', '<=', now)
    .orderBy('schedule.sendAt', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => withId<Newsletter>(doc));
}

/** Newsletter negli stati indicati, ordinate per ultima modifica. */
export async function listNewslettersByStatus(
  statuses: NewsletterStatus[],
  options: { limit?: number; includeArchived?: boolean } = {},
): Promise<Newsletter[]> {
  if (!statuses.length) return [];
  const snapshot = await newslettersRef()
    .where('status', 'in', statuses.slice(0, 10))
    .limit(options.limit ?? 100)
    .get();
  const items = snapshot.docs.map((doc) => withId<Newsletter>(doc));
  return options.includeArchived ? items : items.filter((item) => !item.archived);
}

// -----------------------------------------------------------------------------
// Transizioni di stato
// -----------------------------------------------------------------------------

/**
 * Stati raggiungibili da ogni stato.
 *
 * `sent` è terminale: una newsletter inviata non torna indietro (si duplica).
 * Da `failed` si rientra in bozza per correggere e ripianificare.
 */
export const ALLOWED_TRANSITIONS: Record<NewsletterStatus, NewsletterStatus[]> = {
  draft: ['scheduled', 'queued', 'cancelled'],
  scheduled: ['queued', 'sending', 'draft', 'paused', 'cancelled', 'failed'],
  queued: ['sending', 'draft', 'paused', 'cancelled', 'failed'],
  sending: ['sent', 'paused', 'failed', 'cancelled'],
  paused: ['sending', 'queued', 'scheduled', 'draft', 'cancelled'],
  sent: [],
  failed: ['draft', 'scheduled', 'queued', 'cancelled'],
  cancelled: ['draft'],
};

/** true se il passaggio di stato è consentito (lo stato invariato lo è sempre). */
export function canTransition(from: NewsletterStatus, to: NewsletterStatus): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Verifica la transizione e solleva un errore parlante in italiano. */
export function assertTransition(from: NewsletterStatus, to: NewsletterStatus): void {
  if (canTransition(from, to)) return;
  throw new AppError(
    'failed_precondition',
    `Non è possibile passare da "${NEWSLETTER_STATUS_LABELS[from]}" a "${NEWSLETTER_STATUS_LABELS[to]}".`,
    { details: { from, to, allowed: ALLOWED_TRANSITIONS[from] } },
  );
}

/**
 * Applica un cambio di stato in transazione.
 *
 * `expected` permette al chiamante di pretendere uno stato di partenza preciso
 * (per esempio il dispatcher che vuole prendere in carico solo le newsletter
 * ancora `scheduled`): se lo stato è diverso la transazione non scrive nulla e
 * la funzione restituisce `null`.
 */
export async function transitionNewsletter(
  newsletterId: DocId,
  to: NewsletterStatus,
  options: {
    patch?: Record<string, unknown>;
    userId?: string | null;
    expected?: NewsletterStatus[];
    /** Se false una transizione illegale restituisce `null` invece di sollevare. */
    strict?: boolean;
  } = {},
): Promise<Newsletter | null> {
  const ref = newslettersRef().doc(newsletterId);
  const strict = options.strict !== false;

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      if (strict) throw notFound('Newsletter', newsletterId);
      return null;
    }

    const current = withId<Newsletter>(snapshot);
    if (options.expected && !options.expected.includes(current.status)) {
      if (strict) {
        throw new AppError(
          'failed_precondition',
          `La newsletter è nello stato "${NEWSLETTER_STATUS_LABELS[current.status]}" e non può essere elaborata ora.`,
          { details: { status: current.status, expected: options.expected } },
        );
      }
      return null;
    }

    if (current.status !== to) {
      if (strict) assertTransition(current.status, to);
      else if (!canTransition(current.status, to)) return null;
    }

    const patch = {
      ...(options.patch ?? {}),
      status: to,
      ...auditUpdate(options.userId ?? null),
    };
    tx.set(ref, patch, { merge: true });

    return { ...current, ...(patch as Partial<Newsletter>), status: to } as Newsletter;
  });
}

// -----------------------------------------------------------------------------
// Costruzione dei documenti
// -----------------------------------------------------------------------------

export function emptyAudience(): NewsletterAudience {
  return {
    clusterIds: [],
    excludeClusterIds: [],
    includeContactIds: [],
    excludeContactIds: [],
    suppressIfContactedWithinDays: null,
    suppressIfPurchasedWithinDays: null,
    estimatedRecipients: 0,
    estimatedAt: null,
  };
}

function normalizeAudience(
  input: NewsletterInput['audience'],
  previous?: NewsletterAudience,
): NewsletterAudience {
  return {
    clusterIds: input.clusterIds ?? [],
    excludeClusterIds: input.excludeClusterIds ?? [],
    includeContactIds: input.includeContactIds ?? [],
    excludeContactIds: input.excludeContactIds ?? [],
    suppressIfContactedWithinDays: input.suppressIfContactedWithinDays ?? null,
    suppressIfPurchasedWithinDays: input.suppressIfPurchasedWithinDays ?? null,
    // La stima resta quella già calcolata: la ricalcola `estimateAudience`.
    estimatedRecipients: previous?.estimatedRecipients ?? 0,
    estimatedAt: previous?.estimatedAt ?? null,
  };
}

function normalizeSchedule(input: NewsletterInput['schedule']): NewsletterSchedule | null {
  if (!input) return null;
  return {
    sendAt: input.sendAt,
    timezone: input.timezone,
    throttle: input.throttle ?? null,
    optimizeSendTime: input.optimizeSendTime ?? false,
    quietHours: input.quietHours ?? null,
  };
}

/** Documento di una newsletter nuova, pronto per `set()`. */
export function buildNewsletterData(
  input: NewsletterInput,
  userId?: string | null,
): Omit<Newsletter, 'id'> {
  return {
    name: input.name,
    subject: input.subject,
    preheader: input.preheader ?? null,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo ?? null,
    document: input.document as unknown as EmailDocument,
    html: null,
    plainText: null,
    thumbnailUrl: null,
    status: 'draft',
    audience: normalizeAudience(input.audience),
    schedule: normalizeSchedule(input.schedule),
    abTest: null,
    variants: [],
    brevoCampaignId: null,
    brevoListIds: [],
    stats: { ...EMPTY_STATS },
    tags: input.tags ?? [],
    color: input.color ?? null,
    category: input.category ?? null,
    sentAt: null,
    startedSendingAt: null,
    completedAt: null,
    cancelledAt: null,
    failureReason: null,
    sendAttempts: 0,
    automationKey: null,
    templateId: null,
    duplicatedFromId: null,
    testSends: [],
    archived: false,
    ...auditCreate(userId ?? null),
  };
}

/** Patch di aggiornamento a partire dall'input validato. */
export function buildNewsletterPatch(
  existing: Newsletter,
  input: NewsletterInput,
  userId?: string | null,
): Record<string, unknown> {
  return {
    name: input.name,
    subject: input.subject,
    preheader: input.preheader ?? null,
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    replyTo: input.replyTo ?? null,
    document: input.document as unknown as EmailDocument,
    audience: normalizeAudience(input.audience, existing.audience),
    schedule: normalizeSchedule(input.schedule),
    tags: input.tags ?? [],
    color: input.color ?? null,
    category: input.category ?? null,
    ...auditUpdate(userId ?? null),
  };
}

// -----------------------------------------------------------------------------
// Scrittura
// -----------------------------------------------------------------------------

export async function createNewsletterRecord(
  input: NewsletterInput,
  userId?: string | null,
  extra: Partial<Newsletter> = {},
): Promise<Newsletter> {
  const ref = newslettersRef().doc();
  const data = { ...buildNewsletterData(input, userId), ...extra };
  await ref.set(data);
  log.info('Newsletter creata', { newsletterId: ref.id, name: data.name });
  return { ...(data as Omit<Newsletter, 'id'>), id: ref.id };
}

/**
 * Aggiornamento parziale. Gli stati oltre la bozza accettano solo le modifiche
 * che non alterano il contenuto già in partenza: chi invia non deve trovarsi il
 * documento cambiato sotto i piedi.
 */
export async function updateNewsletterRecord(
  newsletterId: DocId,
  patch: Record<string, unknown>,
  userId?: string | null,
): Promise<Newsletter> {
  const ref = newslettersRef().doc(newsletterId);
  await ref.set({ ...patch, ...auditUpdate(userId ?? null) }, { merge: true });
  return requireNewsletter(newsletterId);
}

/** Stati in cui il contenuto della newsletter è ancora modificabile. */
export const EDITABLE_STATUSES: NewsletterStatus[] = ['draft', 'scheduled', 'paused', 'failed', 'cancelled'];

export function assertEditable(newsletter: Newsletter): void {
  if (EDITABLE_STATUSES.includes(newsletter.status)) return;
  throw new AppError(
    'failed_precondition',
    `La newsletter è nello stato "${NEWSLETTER_STATUS_LABELS[newsletter.status]}" e non può più essere modificata.`,
  );
}

/** Contatori noti a chi invia (destinatari accodati, richieste inviate). */
export async function bumpNewsletterStats(
  newsletterId: DocId,
  delta: Partial<Record<keyof NewsletterStats, number>>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value !== 'number' || value === 0) continue;
    patch[`stats.${key}`] = FieldValue.increment(value);
  }
  if (!Object.keys(patch).length) return;
  patch['stats.updatedAt'] = nowIso();
  // `update` e non `set`: solo `update` interpreta le chiavi con il punto come
  // percorsi di campo (`stats.requested`), invece che come nomi letterali.
  await newslettersRef().doc(newsletterId).update(patch);
}

// -----------------------------------------------------------------------------
// Cancellazione a cascata
// -----------------------------------------------------------------------------

/** Elimina i documenti di una query a pagine, senza caricarli tutti in RAM. */
async function deleteQuery(query: FirebaseFirestore.Query): Promise<number> {
  return paginateQuery(query.orderBy('__name__'), CASCADE_PAGE_SIZE, async (docs) => {
    await commitInBatches(docs.map((doc) => (batch: FirebaseFirestore.WriteBatch) => batch.delete(doc.ref)));
  });
}

/**
 * Elimina la newsletter, i suoi destinatari e i batch rimasti in coda.
 * L'ordine conta: prima le sotto-collezioni, poi il documento padre, così una
 * cancellazione interrotta lascia una newsletter ancora visibile invece di
 * destinatari orfani.
 */
export async function deleteNewsletterRecord(newsletterId: DocId): Promise<{ recipients: number; batches: number }> {
  const recipients = await deleteQuery(recipientsRef(newsletterId));
  const batches = await deleteQuery(col.sendQueue().where('newsletterId', '==', newsletterId));
  await newslettersRef().doc(newsletterId).delete();
  log.info('Newsletter eliminata', { newsletterId, recipients, batches });
  return { recipients, batches };
}

// -----------------------------------------------------------------------------
// Firma del contenuto
// -----------------------------------------------------------------------------

/**
 * Impronta dei campi che determinano l'HTML compilato.
 *
 * Serve al trigger `onNewsletterWritten` per capire se deve rigenerare
 * `html`/`plainText`: senza questo confronto la riscrittura dell'HTML
 * rilancerebbe il trigger all'infinito.
 */
export function contentSignature(
  newsletter: Pick<Newsletter, 'subject' | 'preheader' | 'document'> & {
    variants?: Newsletter['variants'];
  },
): string {
  const payload = JSON.stringify({
    subject: newsletter.subject ?? '',
    preheader: newsletter.preheader ?? '',
    document: newsletter.document ?? null,
    variants: (newsletter.variants ?? []).map((variant) => ({
      id: variant.id,
      subject: variant.subject,
      preheader: variant.preheader ?? '',
      document: variant.document ?? null,
    })),
  });
  return createHash('sha1').update(payload).digest('hex');
}

/** Impronta dei criteri di pubblico: cambia solo quando va rifatta la stima. */
export function audienceSignature(audience: NewsletterAudience | null | undefined): string {
  const payload = JSON.stringify({
    clusterIds: [...(audience?.clusterIds ?? [])].sort(),
    excludeClusterIds: [...(audience?.excludeClusterIds ?? [])].sort(),
    includeContactIds: [...(audience?.includeContactIds ?? [])].sort(),
    excludeContactIds: [...(audience?.excludeContactIds ?? [])].sort(),
    contacted: audience?.suppressIfContactedWithinDays ?? null,
    purchased: audience?.suppressIfPurchasedWithinDays ?? null,
  });
  return createHash('sha1').update(payload).digest('hex');
}

/** Campi tecnici scritti dal trigger di render, non presenti in `Newsletter`. */
export interface RenderMarkers {
  contentHash?: string | null;
  audienceHash?: string | null;
  renderedAt?: IsoDate | null;
  warnings?: Array<{ code: string; message: string; severity: string; blockId?: string; sectionId?: string }>;
}

/** Legge i marcatori tecnici salvati sul documento. */
export function readRenderMarkers(data: unknown): RenderMarkers {
  const record = serializeDoc<Record<string, unknown>>(data ?? {});
  return {
    contentHash: typeof record.contentHash === 'string' ? record.contentHash : null,
    audienceHash: typeof record.audienceHash === 'string' ? record.audienceHash : null,
    renderedAt: typeof record.renderedAt === 'string' ? record.renderedAt : null,
  };
}
