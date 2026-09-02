/**
 * Invio delle newsletter: preparazione dei destinatari, coda scaglionata e
 * spedizione dei singoli batch.
 *
 * ## Percorso di una spedizione
 *
 *   dispatchNewsletter
 *     ├─ risolve il pubblico (`resolveAudience`)
 *     ├─ scrive un documento per destinatario in `newsletters/{id}/recipients`
 *     │   (id = contactId: il modulo di tracciamento lo cerca proprio così)
 *     └─ spezza il pubblico in batch e li accoda in `sendQueue`
 *
 *   processSendBatch (dispatcher, ogni 5 minuti)
 *     ├─ prende in carico il batch in transazione
 *     ├─ compone un'email personalizzata per destinatario
 *     ├─ la spedisce a blocchi con `sendTransactionalBatch`
 *     └─ salva `messageId` e stato di ogni destinatario
 *
 * ## Idempotenza
 * Tre livelli, perché una Cloud Function può essere ritentata in qualsiasi
 * momento:
 *  1. la preparazione avviene una sola volta (marcatore `queue.preparedAt`);
 *  2. i documenti dei batch hanno id deterministico (`<newsletterId>_<indice>`),
 *     quindi ri-accodare non crea duplicati;
 *  3. un destinatario già in stato diverso da `pending` non viene mai
 *     ri-spedito, nemmeno se il batch viene rielaborato.
 *
 * ## Perché non usiamo le campagne Brevo
 * Le campagne inviano lo stesso HTML a una lista. A noi serve un HTML diverso
 * per destinatario (merge tag risolti da noi, link di disiscrizione firmati,
 * redirector con l'id del contatto): è il canale transazionale a permetterlo.
 */

import { createHash } from 'node:crypto';
import { LIMITS, SENDABLE_STATUSES, displayNameFor, normalizeEmail, shiftOutOfQuietHours } from '@alphaink/shared';
import type {
  Contact,
  DocId,
  IsoDate,
  Newsletter,
  NewsletterRecipient,
  RecipientStatus,
} from '@alphaink/shared';

import { chunk, mapWithConcurrency } from '../lib/async';
import { TIMEZONE } from '../lib/config';
import { AppError, failedPrecondition, notFound } from '../lib/errors';
import {
  auditUpdate,
  col,
  commitInBatches,
  db,
  logActivity,
  nowIso,
  paginateQuery,
  serializeDoc,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { readApiKeyFromSecret, readBrevoSettings, resolveReplyTo, resolveSender } from '../brevo/settings';
import { sendTransactionalBatch } from '../brevo/transactional';
import type { SendTransactionalInput } from '../brevo/transactional';
import { resolveAudience } from '../clusters';
import { getContactsByIds } from '../contacts/repository';
import { composeNewsletterEmail, customHeaderFor, loadNewsletterEnvironment, toComposeContact } from './compose';
import type { NewsletterEnvironment } from './compose';
import {
  bumpNewsletterStats,
  recipientsRef,
  requireNewsletter,
  transitionNewsletter,
} from './repository';

const log = createLogger('newsletters.sender');

// -----------------------------------------------------------------------------
// Costanti operative
// -----------------------------------------------------------------------------

/**
 * Destinatari per documento di coda. Il tetto tiene il documento ben sotto il
 * limite di 1 MB di Firestore e mantiene ogni batch lavorabile in meno di un
 * paio di minuti al ritmo consentito da Brevo (10 richieste/secondo).
 */
export const QUEUE_MAX_CONTACTS = 500;

/** Dimensione della finestra di invio quando non è configurato lo scaglionamento. */
export const DEFAULT_WINDOW_SIZE = 5_000;

/** Blocchi inviati in parallelo dentro un batch (il rate limiter fa da freno). */
export const SEND_CONCURRENCY = 6;

/** Un batch preso in carico da più di così appartiene a un'istanza morta. */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/** Tentativi massimi su un batch prima di dichiararlo fallito. */
export const MAX_BATCH_ATTEMPTS = 3;

/** Attesa prima di riprovare un batch rimandato (chiave API assente, errori). */
export const RETRY_DELAY_MINUTES = 15;

// -----------------------------------------------------------------------------
// Tipi della coda
// -----------------------------------------------------------------------------

export type SendBatchStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'paused' | 'cancelled';

export interface SendBatch {
  id: DocId;
  newsletterId: DocId;
  /** Indice progressivo del batch nella spedizione. */
  index: number;
  total: number;
  status: SendBatchStatus;
  /** Istante a partire dal quale il batch può essere elaborato. */
  runAt: IsoDate;
  contactIds: DocId[];
  size: number;
  sent: number;
  failed: number;
  skipped: number;
  attempts: number;
  claimedAt?: IsoDate | null;
  completedAt?: IsoDate | null;
  error?: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

/** Informazioni di coda salvate sulla newsletter (fuori dal tipo condiviso). */
export interface NewsletterQueueInfo {
  preparedAt: IsoDate;
  batches: number;
  recipients: number;
  windowSize: number;
  intervalMinutes: number;
  lastRunAt: IsoDate;
}

interface NewsletterWithQueue extends Newsletter {
  queue?: NewsletterQueueInfo | null;
}

function queueRef(): FirebaseFirestore.CollectionReference {
  return col.sendQueue();
}

/** Id deterministico: ri-accodare lo stesso batch non crea duplicati. */
export function batchDocId(newsletterId: DocId, index: number): string {
  return `${newsletterId}_${String(index).padStart(5, '0')}`;
}

// -----------------------------------------------------------------------------
// Varianti A/B
// -----------------------------------------------------------------------------

/** Intero stabile derivato da una stringa: stessa assegnazione ad ogni ricalcolo. */
function stableHash(value: string): number {
  return createHash('sha1').update(value).digest().readUInt32BE(0);
}

/**
 * Assegna la variante A/B al destinatario.
 *
 * La ripartizione è deterministica (dipende solo dall'id del contatto): un
 * ricalcolo della coda assegna a ciascuno la stessa variante di prima. Se è già
 * stato proclamato un vincitore, tutti ricevono quello.
 */
export function assignVariantId(newsletter: Newsletter, contactId: DocId): string | null {
  const variants = newsletter.variants ?? [];
  if (!newsletter.abTest?.enabled || variants.length < 2) return null;
  if (newsletter.abTest.winnerVariantId) return newsletter.abTest.winnerVariantId;

  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.splitPercent), 0);
  if (total <= 0) return variants[0]?.id ?? null;

  const bucket = ((stableHash(contactId) % 10_000) / 10_000) * total;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += Math.max(0, variant.splitPercent);
    if (bucket < cumulative) return variant.id;
  }
  return variants[variants.length - 1]?.id ?? null;
}

// -----------------------------------------------------------------------------
// Destinatari
// -----------------------------------------------------------------------------

function newRecipientData(contact: Contact, variantId: string | null): Omit<NewsletterRecipient, 'id'> & {
  createdAt: IsoDate;
} {
  return {
    contactId: contact.id,
    email: contact.emailNormalized || normalizeEmail(contact.email ?? ''),
    variantId,
    status: 'pending',
    messageId: null,
    sentAt: null,
    deliveredAt: null,
    firstOpenedAt: null,
    lastOpenedAt: null,
    openCount: 0,
    firstClickedAt: null,
    lastClickedAt: null,
    clickCount: 0,
    clickedUrls: [],
    unsubscribedAt: null,
    bouncedAt: null,
    bounceReason: null,
    convertedOrderId: null,
    convertedAt: null,
    revenue: null,
    error: null,
    createdAt: nowIso(),
  };
}

/** Stato del destinatario quando il contatto non è più contattabile. */
function statusForUnsendable(contact: Contact): RecipientStatus {
  if (contact.status === 'unsubscribed') return 'unsubscribed';
  if (contact.status === 'blocked') return 'blocked';
  if (contact.status === 'bounced') return 'hard_bounced';
  return 'failed';
}

// -----------------------------------------------------------------------------
// Preparazione della coda
// -----------------------------------------------------------------------------

export interface DispatchOptions {
  userId?: string | null;
  /** Ricostruisce la coda anche se è già stata preparata (uso diagnostico). */
  force?: boolean;
}

export interface DispatchResult {
  newsletterId: DocId;
  recipients: number;
  batches: number;
  /** true se la coda esisteva già: nulla è stato riscritto. */
  alreadyPrepared: boolean;
  warnings: string[];
}

/**
 * Calcola l'istante di partenza di ogni finestra di invio.
 * Le fasce di silenzio spostano in avanti l'orario, mai indietro.
 */
function windowRunAt(
  startIso: IsoDate,
  windowIndex: number,
  intervalMinutes: number,
  newsletter: Newsletter,
): IsoDate {
  const base = Date.parse(startIso) + windowIndex * intervalMinutes * 60_000;
  const iso = new Date(Math.max(base, Date.now())).toISOString();
  const quietHours = newsletter.schedule?.quietHours ?? null;
  if (!quietHours) return iso;
  return shiftOutOfQuietHours(iso, quietHours, newsletter.schedule?.timezone || TIMEZONE);
}

/**
 * Prepara la spedizione: risolve il pubblico, crea i destinatari e la coda.
 *
 * La newsletter passa in `sending` **prima** di scrivere i destinatari: se la
 * funzione viene interrotta a metà, la ripresa trova lo stato coerente e la
 * preparazione riparte (i documenti dei destinatari sono scritti con id
 * deterministico, quindi la riscrittura è innocua).
 */
export async function dispatchNewsletter(
  newsletterId: DocId,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const newsletter = (await requireNewsletter(newsletterId)) as NewsletterWithQueue;

  if (newsletter.queue?.preparedAt && !options.force) {
    // Coda già costruita: non si riscrive nulla, ma la spedizione va comunque
    // rimessa in moto. È il caso del "riprova" dopo un errore: i batch falliti
    // tornano in coda e i destinatari già serviti restano fuori (il loro stato
    // non è più `pending`).
    await transitionNewsletter(newsletterId, 'sending', {
      expected: ['scheduled', 'queued', 'sending'],
      userId: options.userId ?? null,
      strict: false,
      patch: { failureReason: null },
    });
    const retried = await requeueFailedBatches(newsletterId);
    log.info('Coda già preparata: spedizione ripresa', {
      newsletterId,
      batches: newsletter.queue.batches,
      retried,
    });
    return {
      newsletterId,
      recipients: newsletter.queue.recipients,
      batches: newsletter.queue.batches,
      alreadyPrepared: true,
      warnings: retried ? [`${retried} batch in errore sono stati rimessi in coda.`] : [],
    };
  }

  // Solo da `scheduled` o `queued` si entra in spedizione. `sending` è ammesso
  // per riprendere una preparazione interrotta.
  const claimed = await transitionNewsletter(newsletterId, 'sending', {
    expected: ['scheduled', 'queued', 'sending'],
    userId: options.userId ?? null,
    patch: { startedSendingAt: newsletter.startedSendingAt ?? nowIso(), failureReason: null },
  });
  if (!claimed) {
    throw failedPrecondition('La newsletter non è in uno stato che consente l\'invio.');
  }

  // Ricostruzione forzata: la coda precedente va rimossa, altrimenti i batch
  // in eccesso resterebbero orfani (gli id sono deterministici per indice).
  if (options.force) await clearNewsletterQueue(newsletterId);

  const audience = await resolveAudience(newsletter.audience);
  const warnings = [...audience.warnings];

  if (!audience.contacts.length) {
    await transitionNewsletter(newsletterId, 'failed', {
      userId: options.userId ?? null,
      patch: {
        failureReason: 'Nessun destinatario contattabile con i criteri di pubblico impostati.',
        completedAt: nowIso(),
      },
      strict: false,
    });
    throw failedPrecondition(
      'Nessun destinatario contattabile con i criteri di pubblico impostati.',
      { reasons: audience.reasons },
    );
  }

  // --- Destinatari ----------------------------------------------------------
  const assignments = audience.contacts.map((contact) => ({
    contact,
    variantId: assignVariantId(newsletter, contact.id),
  }));

  const recipients = recipientsRef(newsletterId);

  // Destinatari già scritti da una preparazione interrotta: si leggono i soli
  // id (`select()` non scarica alcun campo) e NON si riscrivono. Sovrascriverli
  // riporterebbe a `pending` chi ha già ricevuto l'email, con il rischio di un
  // secondo invio allo stesso indirizzo.
  const alreadyWritten = new Set<string>();
  await paginateQuery(recipients.orderBy('__name__').select(), 1_000, async (docs) => {
    for (const doc of docs) alreadyWritten.add(doc.id);
  });

  const toWrite = assignments.filter(({ contact }) => !alreadyWritten.has(contact.id));
  await commitInBatches(
    toWrite.map(({ contact, variantId }) => (batch: FirebaseFirestore.WriteBatch) => {
      batch.set(recipients.doc(contact.id), newRecipientData(contact, variantId));
    }),
  );
  if (alreadyWritten.size) {
    log.info('Preparazione ripresa: destinatari già presenti conservati', {
      newsletterId,
      esistenti: alreadyWritten.size,
      nuovi: toWrite.length,
    });
  }

  // --- Coda -----------------------------------------------------------------
  const throttle = newsletter.schedule?.throttle ?? null;
  const windowSize = Math.max(1, throttle?.batchSize ?? DEFAULT_WINDOW_SIZE);
  const intervalMinutes = Math.max(0, throttle?.intervalMinutes ?? 0);
  const startIso = newsletter.schedule?.sendAt ?? nowIso();

  const windows = chunk(assignments.map(({ contact }) => contact.id), windowSize);
  const batches: Array<{ runAt: IsoDate; contactIds: DocId[] }> = [];
  windows.forEach((windowIds, windowIndex) => {
    const runAt = windowRunAt(startIso, windowIndex, intervalMinutes, newsletter);
    for (const block of chunk(windowIds, QUEUE_MAX_CONTACTS)) {
      batches.push({ runAt, contactIds: block });
    }
  });

  const now = nowIso();
  await commitInBatches(
    batches.map((entry, index) => (batch: FirebaseFirestore.WriteBatch) => {
      const data: Omit<SendBatch, 'id'> = {
        newsletterId,
        index,
        total: batches.length,
        status: 'pending',
        runAt: entry.runAt,
        contactIds: entry.contactIds,
        size: entry.contactIds.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        attempts: 0,
        claimedAt: null,
        completedAt: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      batch.set(queueRef().doc(batchDocId(newsletterId, index)), data);
    }),
  );

  const queue: NewsletterQueueInfo = {
    preparedAt: now,
    batches: batches.length,
    recipients: assignments.length,
    windowSize,
    intervalMinutes,
    lastRunAt: batches[batches.length - 1]?.runAt ?? now,
  };

  // `update`: le chiavi con il punto sono percorsi di campo solo qui, con
  // `set({merge:true})` diventerebbero nomi di campo letterali.
  await col.newsletters().doc(newsletterId).update({
    queue,
    'stats.recipients': assignments.length,
    'stats.updatedAt': now,
    sendAttempts: (newsletter.sendAttempts ?? 0) + 1,
    ...auditUpdate(options.userId ?? null),
  });

  log.info('Coda di invio preparata', {
    newsletterId,
    recipients: assignments.length,
    batches: batches.length,
    excluded: audience.excludedCount,
  });

  await logActivity({
    action: 'newsletter.dispatch',
    entityType: 'newsletter',
    entityId: newsletterId,
    userId: options.userId ?? null,
    summary: `Spedizione avviata: ${assignments.length} destinatari in ${batches.length} batch`,
    metadata: { recipients: assignments.length, batches: batches.length, reasons: audience.reasons },
  });

  return {
    newsletterId,
    recipients: assignments.length,
    batches: batches.length,
    alreadyPrepared: false,
    warnings,
  };
}

// -----------------------------------------------------------------------------
// Lettura della coda
// -----------------------------------------------------------------------------

/** Batch pronti per essere elaborati (indice composto `status + runAt`). */
export async function dueSendBatches(limit = 10, now: IsoDate = nowIso()): Promise<SendBatch[]> {
  const snapshot = await queueRef()
    .where('status', '==', 'pending')
    .where('runAt', '<=', now)
    .orderBy('runAt', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => withId<SendBatch>(doc));
}

/** Proiezione leggera di un batch: evita di scaricare gli elenchi di contatti. */
export interface SendBatchRef {
  id: DocId;
  status: SendBatchStatus;
  runAt: IsoDate;
}

/**
 * Batch di una newsletter negli stati indicati.
 *
 * La query legge solo `status` e `runAt` (`select`): i `contactIds` pesano
 * decine di KB per documento e qui non servono. Lo stato si filtra in memoria
 * per restare su una sola condizione di uguaglianza, servita dall'indice
 * automatico su `newsletterId`.
 */
export async function batchesOf(
  newsletterId: DocId,
  statuses: SendBatchStatus[],
  limit = 5_000,
): Promise<SendBatchRef[]> {
  const snapshot = await queueRef()
    .where('newsletterId', '==', newsletterId)
    .select('status', 'runAt')
    .limit(limit)
    .get();
  return snapshot.docs
    .map((doc) => ({
      id: doc.id,
      status: (doc.get('status') as SendBatchStatus) ?? 'pending',
      runAt: (doc.get('runAt') as IsoDate) ?? nowIso(),
    }))
    .filter((batch) => statuses.includes(batch.status));
}

/**
 * Prende in carico un batch. Restituisce `null` se qualcun altro se n'è già
 * occupato o se il batch non è più elaborabile.
 */
export async function claimBatch(batchId: DocId): Promise<SendBatch | null> {
  const ref = queueRef().doc(batchId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const batch = { ...serializeDoc<SendBatch>(snapshot.data() ?? {}), id: batchId };

    if (batch.status === 'processing') {
      const claimedAt = batch.claimedAt ? Date.parse(batch.claimedAt) : 0;
      if (claimedAt && Date.now() - claimedAt < STALE_CLAIM_MS) return null;
    } else if (batch.status !== 'pending') {
      return null;
    }

    const patch = {
      status: 'processing' as const,
      claimedAt: nowIso(),
      attempts: (batch.attempts ?? 0) + 1,
      updatedAt: nowIso(),
    };
    tx.set(ref, patch, { merge: true });
    return { ...batch, ...patch };
  });
}

/** Rimanda il batch nel futuro senza consumarne un tentativo utile. */
async function requeueBatch(batchId: DocId, reason: string, delayMinutes = RETRY_DELAY_MINUTES): Promise<void> {
  await queueRef().doc(batchId).set(
    {
      status: 'pending',
      claimedAt: null,
      runAt: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      error: reason,
      updatedAt: nowIso(),
    },
    { merge: true },
  );
}

// -----------------------------------------------------------------------------
// Invio di un batch
// -----------------------------------------------------------------------------

export interface ProcessBatchResult {
  batchId: DocId;
  newsletterId: DocId | null;
  status: SendBatchStatus | 'saltato';
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
}

/** Messaggio pronto per Brevo più i riferimenti per aggiornare il destinatario. */
interface PreparedMessage {
  contactId: DocId;
  email: string;
  message: SendTransactionalInput;
}

/**
 * Elabora un batch della coda: compone, invia e aggiorna i destinatari.
 *
 * Un fallimento su un singolo destinatario non ferma gli altri: viene scritto
 * sul suo documento (`status: 'failed'`, `error`) e il batch prosegue. Solo un
 * errore che impedisce di inviare qualsiasi cosa (chiave API assente, contenuto
 * non valido) mette il batch in errore.
 */
export async function processSendBatch(
  batchId: DocId,
  options: { env?: NewsletterEnvironment } = {},
): Promise<ProcessBatchResult> {
  const claimed = await claimBatch(batchId);
  if (!claimed) {
    return { batchId, newsletterId: null, status: 'saltato', sent: 0, failed: 0, skipped: 0 };
  }

  const base: ProcessBatchResult = {
    batchId,
    newsletterId: claimed.newsletterId,
    status: 'sent',
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    const newsletter = await requireNewsletter(claimed.newsletterId);

    // Pausa e annullamento: il batch si ferma senza consumare tentativi.
    if (newsletter.status === 'paused') {
      await queueRef().doc(batchId).set({ status: 'paused', claimedAt: null, updatedAt: nowIso() }, { merge: true });
      return { ...base, status: 'paused' };
    }
    if (newsletter.status === 'cancelled') {
      await queueRef().doc(batchId).set({ status: 'cancelled', claimedAt: null, updatedAt: nowIso() }, { merge: true });
      return { ...base, status: 'cancelled' };
    }

    const apiKey = readApiKeyFromSecret();
    if (!apiKey) {
      await requeueBatch(batchId, 'Chiave API Brevo non configurata: invio rimandato.');
      log.warn('Batch rimandato: chiave API Brevo assente', { batchId, newsletterId: claimed.newsletterId });
      return { ...base, status: 'pending', error: 'Chiave API Brevo non configurata.' };
    }

    const env = options.env ?? (await loadNewsletterEnvironment());
    const brevo = await readBrevoSettings();
    const sender = resolveSender(brevo, { email: newsletter.fromEmail, name: newsletter.fromName });
    const replyTo = resolveReplyTo(brevo, newsletter.replyTo ?? null);

    // --- Destinatari ancora da servire --------------------------------------
    const recipientRefs = claimed.contactIds.map((contactId) => recipientsRef(claimed.newsletterId).doc(contactId));
    const recipientSnapshots = (
      await mapWithConcurrency(chunk(recipientRefs, 300), 3, async (block) => db.getAll(...block))
    ).flat();

    const pending = recipientSnapshots.filter(
      (snapshot) => snapshot.exists && (snapshot.get('status') as RecipientStatus) === 'pending',
    );
    base.skipped = claimed.contactIds.length - pending.length;

    if (!pending.length) {
      await queueRef().doc(batchId).set(
        {
          status: 'sent',
          sent: 0,
          failed: 0,
          skipped: base.skipped,
          claimedAt: null,
          completedAt: nowIso(),
          error: null,
          updatedAt: nowIso(),
        },
        { merge: true },
      );
      await finalizeNewsletterIfComplete(claimed.newsletterId);
      return { ...base, status: 'sent' };
    }

    const contacts = await getContactsByIds(pending.map((snapshot) => snapshot.id));
    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

    // --- Composizione --------------------------------------------------------
    const updates: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
    const prepared: PreparedMessage[] = [];

    for (const snapshot of pending) {
      const contact = contactsById.get(snapshot.id);
      if (!contact) {
        base.failed += 1;
        updates.push((batch) =>
          batch.set(
            snapshot.ref,
            { status: 'failed', error: 'Contatto non più presente in rubrica.', updatedAt: nowIso() },
            { merge: true },
          ),
        );
        continue;
      }

      if (!SENDABLE_STATUSES.includes(contact.status)) {
        base.skipped += 1;
        updates.push((batch) =>
          batch.set(
            snapshot.ref,
            {
              status: statusForUnsendable(contact),
              error: 'Il contatto non è più iscritto al momento dell\'invio.',
              updatedAt: nowIso(),
            },
            { merge: true },
          ),
        );
        continue;
      }

      const variantId = (snapshot.get('variantId') as string | null) ?? null;
      let composed;
      try {
        composed = composeNewsletterEmail(newsletter, toComposeContact(contact), { env, variantId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Errore di composizione';
        base.failed += 1;
        updates.push((batch) =>
          batch.set(snapshot.ref, { status: 'failed', error: message, updatedAt: nowIso() }, { merge: true }),
        );
        continue;
      }

      if (composed.blocking) {
        // Contenuto non spedibile: è un problema della newsletter, non del
        // destinatario. Si interrompe tutto il batch.
        const problems = composed.warnings
          .filter((warning) => warning.severity === 'errore')
          .map((warning) => warning.message)
          .join(' ');
        throw new AppError('failed_precondition', problems || 'Il contenuto della newsletter non è valido.');
      }

      const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
      prepared.push({
        contactId: contact.id,
        email,
        message: {
          to: [
            {
              email,
              name: displayNameFor({
                firstName: contact.firstName,
                lastName: contact.lastName,
                company: contact.company,
                email,
              }),
            },
          ],
          sender,
          replyTo,
          subject: composed.subject,
          htmlContent: composed.html,
          textContent: composed.text,
          source: 'newsletter',
          ref: composed.ref,
          tags: [`newsletter-${newsletter.id}`, ...(composed.variantId ? [composed.variantId] : [])],
          headers: {
            'X-Mailin-custom': customHeaderFor({
              ref: composed.ref,
              newsletterId: newsletter.id,
              variantId: composed.variantId,
              contactId: contact.id,
            }),
            // RFC 8058: la disiscrizione in un click dal client di posta.
            'List-Unsubscribe': `<${composed.urls.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          // Protegge da un doppio invio se la funzione viene ritentata.
          idempotencyKey: `${newsletter.id}:${contact.id}`,
        },
      });
    }

    // --- Spedizione ----------------------------------------------------------
    const blocks = chunk(prepared, LIMITS.brevoBatchSize);
    const outcomes = await mapWithConcurrency(blocks, SEND_CONCURRENCY, async (block) => {
      try {
        const messageIds = await sendTransactionalBatch(apiKey, block.map((item) => item.message));
        return { block, messageIds, error: null as string | null };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Errore di invio';
        log.error('Blocco di invio non riuscito', error, { batchId, size: block.length });
        return { block, messageIds: {} as Record<string, string>, error: message };
      }
    });

    const sentAt = nowIso();
    for (const outcome of outcomes) {
      for (const item of outcome.block) {
        const ref = recipientsRef(claimed.newsletterId).doc(item.contactId);
        if (outcome.error) {
          // Il destinatario esce da `pending` e non verrà ritentato: se la
          // chiamata fosse fallita dopo la consegna, un secondo tentativo
          // manderebbe due volte la stessa email. Meglio un mancato invio
          // tracciato che un doppione nella casella del cliente.
          base.failed += 1;
          updates.push((batch) =>
            batch.set(ref, { status: 'failed', error: outcome.error, updatedAt: sentAt }, { merge: true }),
          );
          continue;
        }
        base.sent += 1;
        updates.push((batch) =>
          batch.set(
            ref,
            {
              status: 'sent',
              sentAt,
              messageId: outcome.messageIds[item.email] ?? null,
              error: null,
              updatedAt: sentAt,
            },
            { merge: true },
          ),
        );
      }
    }

    await commitInBatches(updates);

    // --- Contatori e chiusura del batch --------------------------------------
    if (base.sent > 0) {
      await bumpNewsletterStats(claimed.newsletterId, { requested: base.sent });
    }

    await queueRef().doc(batchId).set(
      {
        status: 'sent',
        sent: base.sent,
        failed: base.failed,
        skipped: base.skipped,
        claimedAt: null,
        completedAt: nowIso(),
        error: null,
        updatedAt: nowIso(),
      },
      { merge: true },
    );

    await finalizeNewsletterIfComplete(claimed.newsletterId);

    log.info('Batch di invio completato', {
      batchId,
      newsletterId: claimed.newsletterId,
      sent: base.sent,
      failed: base.failed,
      skipped: base.skipped,
    });
    return base;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore sconosciuto';
    const exhausted = (claimed.attempts ?? 1) >= MAX_BATCH_ATTEMPTS;
    log.error('Elaborazione del batch non riuscita', error, { batchId, exhausted });

    if (exhausted) {
      await queueRef().doc(batchId).set(
        { status: 'failed', claimedAt: null, error: message, completedAt: nowIso(), updatedAt: nowIso() },
        { merge: true },
      );
      await markNewsletterFailed(claimed.newsletterId, message);
      return { ...base, status: 'failed', error: message };
    }

    await requeueBatch(batchId, message);
    return { ...base, status: 'pending', error: message };
  }
}

// -----------------------------------------------------------------------------
// Chiusura della spedizione
// -----------------------------------------------------------------------------

/** Vero se non restano batch da lavorare per la newsletter. */
async function hasOpenBatches(newsletterId: DocId): Promise<boolean> {
  const open = await batchesOf(newsletterId, ['pending', 'processing', 'paused']);
  return open.length > 0;
}

/**
 * Chiude la spedizione quando l'ultimo batch è stato lavorato.
 * Idempotente: se la newsletter non è più in `sending` non fa nulla.
 */
export async function finalizeNewsletterIfComplete(newsletterId: DocId): Promise<boolean> {
  if (await hasOpenBatches(newsletterId)) return false;

  const completedAt = nowIso();
  const updated = await transitionNewsletter(newsletterId, 'sent', {
    expected: ['sending'],
    strict: false,
    patch: { sentAt: completedAt, completedAt },
  });
  if (!updated) return false;

  const failedBatches = await batchesOf(newsletterId, ['failed']);
  await logActivity({
    action: 'newsletter.completed',
    entityType: 'newsletter',
    entityId: newsletterId,
    userId: null,
    summary: failedBatches.length
      ? `Spedizione completata con ${failedBatches.length} batch in errore`
      : 'Spedizione completata',
    metadata: { failedBatches: failedBatches.length },
    severity: failedBatches.length ? 'warning' : 'info',
  });
  return true;
}

/** Porta la newsletter in errore conservando il motivo per la UI. */
export async function markNewsletterFailed(newsletterId: DocId, reason: string): Promise<void> {
  await transitionNewsletter(newsletterId, 'failed', {
    strict: false,
    patch: { failureReason: reason, completedAt: nowIso() },
  });
}

// -----------------------------------------------------------------------------
// Pausa, ripresa, annullamento
// -----------------------------------------------------------------------------

async function setBatchStatus(
  newsletterId: DocId,
  from: SendBatchStatus[],
  to: SendBatchStatus,
  patch: Record<string, unknown> = {},
): Promise<number> {
  const batches = await batchesOf(newsletterId, from);
  if (!batches.length) return 0;
  await commitInBatches(
    batches.map((batch) => (writeBatch: FirebaseFirestore.WriteBatch) => {
      writeBatch.set(queueRef().doc(batch.id), { status: to, updatedAt: nowIso(), ...patch }, { merge: true });
    }),
  );
  return batches.length;
}

/** Mette in pausa i batch non ancora lavorati. */
export async function pauseNewsletterQueue(newsletterId: DocId): Promise<number> {
  return setBatchStatus(newsletterId, ['pending'], 'paused', { claimedAt: null });
}

/**
 * Rimette in coda i batch in pausa.
 * I batch la cui finestra è già passata ripartono subito; quelli programmati
 * nel futuro conservano il proprio orario.
 */
export async function resumeNewsletterQueue(newsletterId: DocId): Promise<number> {
  const batches = await batchesOf(newsletterId, ['paused']);
  if (!batches.length) return 0;
  const now = Date.now();
  await commitInBatches(
    batches.map((batch) => (writeBatch: FirebaseFirestore.WriteBatch) => {
      const runAt = Date.parse(batch.runAt) < now ? new Date(now).toISOString() : batch.runAt;
      writeBatch.set(
        queueRef().doc(batch.id),
        { status: 'pending', runAt, claimedAt: null, error: null, updatedAt: nowIso() },
        { merge: true },
      );
    }),
  );
  return batches.length;
}

/**
 * Rimette in coda i batch finiti in errore, azzerandone i tentativi.
 * I destinatari già serviti non vengono toccati: il loro stato non è più
 * `pending` e `processSendBatch` li salta.
 */
export async function requeueFailedBatches(newsletterId: DocId): Promise<number> {
  const batches = await batchesOf(newsletterId, ['failed']);
  if (!batches.length) return 0;
  const now = nowIso();
  await commitInBatches(
    batches.map((batch) => (writeBatch: FirebaseFirestore.WriteBatch) => {
      writeBatch.set(
        queueRef().doc(batch.id),
        { status: 'pending', attempts: 0, claimedAt: null, error: null, runAt: now, updatedAt: now },
        { merge: true },
      );
    }),
  );
  return batches.length;
}

/** Annulla i batch residui: la spedizione non riprenderà. */
export async function cancelNewsletterQueue(newsletterId: DocId): Promise<number> {
  return setBatchStatus(newsletterId, ['pending', 'paused'], 'cancelled', { claimedAt: null });
}

/**
 * Elimina la coda di una newsletter (usata dalla cancellazione definitiva).
 * Restituisce il numero di documenti rimossi.
 */
export async function clearNewsletterQueue(newsletterId: DocId): Promise<number> {
  const snapshot = await queueRef().where('newsletterId', '==', newsletterId).get();
  if (snapshot.empty) return 0;
  await commitInBatches(
    snapshot.docs.map((doc) => (batch: FirebaseFirestore.WriteBatch) => batch.delete(doc.ref)),
  );
  return snapshot.size;
}

/** Newsletter senza coda: usata dai controlli di coerenza delle callable. */
export async function assertNoActiveQueue(newsletterId: DocId): Promise<void> {
  const open = await batchesOf(newsletterId, ['pending', 'processing'], 1);
  if (open.length) {
    throw failedPrecondition('La newsletter ha ancora batch in coda: mettila in pausa prima di procedere.');
  }
}

/** Recupera un batch per id (usato dai test e dalla diagnostica). */
export async function getSendBatch(batchId: DocId): Promise<SendBatch> {
  const snapshot = await queueRef().doc(batchId).get();
  if (!snapshot.exists) throw notFound('Batch di invio', batchId);
  return withId<SendBatch>(snapshot);
}
