/**
 * Dispatcher delle newsletter: ogni 5 minuti fa due cose, in quest'ordine.
 *
 *  1. **Avvio**: prende le newsletter `scheduled` la cui ora è passata e ne
 *     prepara la coda di invio (`dispatchNewsletter`).
 *  2. **Spedizione**: lavora i batch di `sendQueue` già dovuti.
 *
 * L'ordine conta: preparare prima significa che una newsletter programmata per
 * "adesso" parte nello stesso giro, senza aspettare la corsa successiva.
 *
 * La corsa ha un budget di tempo inferiore al timeout della funzione: i batch
 * non lavorati restano `pending` e li prende il giro dopo. Nessun batch viene
 * perso, al massimo viene rimandato di cinque minuti.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { DocId } from '@alphaink/shared';

import { mapWithConcurrency } from '../lib/async';
import { BREVO_API_KEY, HEAVY_RUNTIME, LINK_SIGNING_KEY, TIMEZONE } from '../lib/config';
import { logActivity, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { loadNewsletterEnvironment } from './compose';
import { dueScheduledNewsletters } from './repository';
import {
  batchesOf,
  dispatchNewsletter,
  dueSendBatches,
  markNewsletterFailed,
  processSendBatch,
} from './sender';

const log = createLogger('newsletters.dispatcher');

/** Newsletter avviate al massimo in una corsa. */
export const START_LIMIT = 5;

/** Batch prelevati al massimo in una corsa. */
export const BATCH_LIMIT = 8;

/**
 * Batch elaborati in parallelo. Ogni batch spedisce già i propri blocchi in
 * parallelo e il rate limiter del client Brevo è condiviso per istanza: alzare
 * questo numero non aumenta la velocità, aumenta solo la memoria usata.
 */
export const BATCH_CONCURRENCY = 2;

/** Budget di lavoro: lascia margine sul timeout di 540 secondi. */
export const DISPATCH_TIME_BUDGET_MS = 6 * 60 * 1000;

export interface NewsletterDispatchSummary {
  /** Newsletter passate da `scheduled` a `sending` in questa corsa. */
  started: number;
  /** Newsletter che non sono partite per un errore. */
  startFailures: number;
  batchesProcessed: number;
  sent: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

function emptySummary(): NewsletterDispatchSummary {
  return {
    started: 0,
    startFailures: 0,
    batchesProcessed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
  };
}

/**
 * Avvia le newsletter pianificate ormai dovute.
 * Un errore su una newsletter non ferma le altre: viene registrato come
 * fallimento sulla singola spedizione.
 */
export async function startDueNewsletters(limit = START_LIMIT): Promise<{ started: DocId[]; failed: DocId[] }> {
  const due = await dueScheduledNewsletters(limit);
  const started: DocId[] = [];
  const failed: DocId[] = [];

  for (const newsletter of due) {
    try {
      const result = await dispatchNewsletter(newsletter.id, { userId: newsletter.updatedBy ?? null });
      started.push(newsletter.id);
      log.info('Newsletter avviata dal dispatcher', {
        newsletterId: newsletter.id,
        recipients: result.recipients,
        batches: result.batches,
      });
    } catch (error) {
      failed.push(newsletter.id);
      const message = error instanceof Error ? error.message : 'Errore sconosciuto';
      log.error('Avvio della newsletter non riuscito', error, { newsletterId: newsletter.id });
      await markNewsletterFailed(newsletter.id, message);
      await logActivity({
        action: 'newsletter.start_failed',
        entityType: 'newsletter',
        entityId: newsletter.id,
        userId: null,
        summary: `Avvio non riuscito: ${message}`,
        severity: 'error',
      });
    }
  }

  return { started, failed };
}

/** Corpo del dispatcher, isolato per test, shell e invii immediati. */
export async function runNewsletterDispatch(
  options: {
    startLimit?: number;
    batchLimit?: number;
    concurrency?: number;
    budgetMs?: number;
    /** Salta l'avvio delle newsletter pianificate (usato da `sendNewsletterNow`). */
    skipStart?: boolean;
    /** Lavora solo i batch di questa newsletter. */
    onlyNewsletterId?: DocId;
  } = {},
): Promise<NewsletterDispatchSummary> {
  const startedAt = Date.now();
  const summary = emptySummary();

  if (!options.skipStart) {
    const outcome = await startDueNewsletters(options.startLimit ?? START_LIMIT);
    summary.started = outcome.started.length;
    summary.startFailures = outcome.failed.length;
  }

  const budget = options.budgetMs ?? DISPATCH_TIME_BUDGET_MS;
  const limit = options.batchLimit ?? BATCH_LIMIT;
  const now = Date.now();

  // Con `onlyNewsletterId` si interroga direttamente la coda di quella
  // spedizione: la query globale restituisce i batch più vecchi del sistema e
  // potrebbe non contenerne nemmeno uno di questa newsletter.
  const batches = options.onlyNewsletterId
    ? (await batchesOf(options.onlyNewsletterId, ['pending']))
        .filter((batch) => Date.parse(batch.runAt) <= now)
        .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt))
        .slice(0, limit)
    : await dueSendBatches(limit, nowIso());

  if (!batches.length) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  // L'ambiente (impostazioni, identità visiva, chiavi) è lo stesso per tutti i
  // batch della corsa: si legge una volta sola.
  const env = await loadNewsletterEnvironment();

  const results = await mapWithConcurrency(
    batches,
    options.concurrency ?? BATCH_CONCURRENCY,
    async (batch) => {
      if (Date.now() - startedAt > budget) return null;
      return processSendBatch(batch.id, { env });
    },
  );

  for (const result of results) {
    if (!result) continue;
    if (result.status === 'saltato') continue;
    summary.batchesProcessed += 1;
    summary.sent += result.sent;
    summary.failed += result.failed;
    summary.skipped += result.skipped;
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

export const scheduledNewsletterDispatcher = onSchedule(
  {
    ...HEAVY_RUNTIME,
    schedule: 'every 5 minutes',
    timeZone: TIMEZONE,
    // Nessun ritentativo automatico: i batch non completati restano in coda e
    // vengono ripresi dalla corsa successiva, senza rischio di doppio invio.
    retryCount: 0,
    secrets: [BREVO_API_KEY, LINK_SIGNING_KEY],
  },
  async () => {
    const summary = await runNewsletterDispatch();
    if (summary.started > 0 || summary.batchesProcessed > 0 || summary.startFailures > 0) {
      log.info('Corsa del dispatcher newsletter completata', { ...summary });
      await logActivity({
        action: 'newsletter.dispatch_run',
        entityType: 'newsletter',
        userId: null,
        summary:
          `Newsletter: ${summary.started} avviate, ${summary.batchesProcessed} batch elaborati, ` +
          `${summary.sent} email inviate, ${summary.failed} in errore`,
        metadata: { ...summary },
        severity: summary.failed > 0 || summary.startFailures > 0 ? 'warning' : 'info',
      });
    }
  },
);
