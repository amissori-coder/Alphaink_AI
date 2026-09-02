/**
 * Modulo newsletter: creazione, pianificazione, invio scaglionato e calendario.
 *
 * Struttura:
 *  - `repository.ts` accesso a `newsletters` e transizioni di stato
 *  - `compose.ts`    composizione dell'email per singolo destinatario
 *  - `sender.ts`     coda di invio (`sendQueue`) e spedizione dei batch
 *  - `dispatcher.ts` funzione programmata che avvia e fa avanzare le spedizioni
 *  - `triggers.ts`   rigenerazione di HTML, avvisi e stima del pubblico
 *  - `callables.ts`  API per la web app
 *
 * Gli export sono espliciti (niente `export *`): costanti dal nome generico
 * come `STALE_CLAIM_MS` o `BATCH_LIMIT` esistono anche in altri moduli e
 * l'entry point delle Functions ri-esporta tutto da qui.
 */

// --- Funzioni pubblicate come Cloud Functions --------------------------------

export {
  archiveNewsletter,
  cancelNewsletterSchedule,
  createNewsletter,
  deleteNewsletter,
  duplicateNewsletter,
  estimateAudience,
  getCalendarEntries,
  pauseNewsletter,
  renderNewsletterPreview,
  resumeNewsletter,
  scheduleNewsletter,
  sendNewsletterNow,
  sendTestEmail,
  updateNewsletter,
} from './callables';
export type { AudienceEstimate, CalendarEntry, NewsletterPreview } from './callables';

export { scheduledNewsletterDispatcher } from './dispatcher';
export { onNewsletterWritten } from './triggers';

// --- Motore (usato da test, shell e job manuali) -----------------------------

export { runNewsletterDispatch, startDueNewsletters } from './dispatcher';
export type { NewsletterDispatchSummary } from './dispatcher';

export {
  assignVariantId,
  cancelNewsletterQueue,
  clearNewsletterQueue,
  dispatchNewsletter,
  dueSendBatches,
  finalizeNewsletterIfComplete,
  markNewsletterFailed,
  pauseNewsletterQueue,
  processSendBatch,
  requeueFailedBatches,
  resumeNewsletterQueue,
} from './sender';
export type {
  DispatchResult,
  NewsletterQueueInfo,
  ProcessBatchResult,
  SendBatch,
  SendBatchRef,
  SendBatchStatus,
} from './sender';

// --- Composizione ------------------------------------------------------------

export {
  composeNewsletterEmail,
  customHeaderFor,
  loadNewsletterEnvironment,
  newsletterSendRef,
  newsletterTestRef,
  newsletterUtm,
  renderNewsletterMaster,
  resolveCampaignName,
  resolveNewsletterContent,
  sampleComposeContact,
  toComposeContact,
} from './compose';
export type {
  ComposeContact,
  ComposedEmail,
  MasterRender,
  NewsletterContent,
  NewsletterEnvironment,
  NewsletterUrls,
} from './compose';

// --- Repository --------------------------------------------------------------

export {
  ALLOWED_TRANSITIONS,
  assertEditable,
  assertTransition,
  audienceSignature,
  buildNewsletterData,
  buildNewsletterPatch,
  canTransition,
  contentSignature,
  createNewsletterRecord,
  deleteNewsletterRecord,
  dueScheduledNewsletters,
  emptyAudience,
  getNewsletter,
  listNewslettersByStatus,
  recipientsRef,
  requireNewsletter,
  transitionNewsletter,
  updateNewsletterRecord,
} from './repository';
