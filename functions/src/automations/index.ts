/**
 * Motore delle automazioni AlphaInk.
 *
 * Struttura del modulo:
 *  - `defaults.ts`    contenuti e parametri predefiniti delle sei automazioni
 *  - `repository.ts`  accesso a `automations` e alle `runs`
 *  - `enrollment.ts`  arruolamento idempotente di un contatto in uno step
 *  - `triggers.ts`    `onOrderWritten`: annullamenti e arruolamenti sugli ordini
 *  - `scanners.ts`    scansioni periodiche (pagamenti abbandonati, riacquisti)
 *  - `coupons.ts`     emissione e riscatto dei buoni sconto
 *  - `dispatcher.ts`  invio delle run scadute
 *  - `callables.ts`   API per la web app
 *
 * L'entry point delle Functions ri-esporta da qui le funzioni pubbliche:
 * `saveAutomation`, `toggleAutomation`, `sendAutomationTest`,
 * `previewAutomationStep`, `resetAutomationToDefaults`, `getAutomationReport`,
 * `scheduledAutomationDispatcher`, `scheduledAbandonedScanner`,
 * `scheduledRepurchaseScanner`, `onOrderWritten`.
 *
 * Gli export sono espliciti (niente `export *`) perché nomi generici come
 * `readBrandingSettings` esistono anche in altri moduli: tenerli interni evita
 * ambiguità quando `index.ts` ri-esporta tutto.
 */

// --- Funzioni pubblicate come Cloud Functions --------------------------------

export {
  getAutomationReport,
  previewAutomationStep,
  resetAutomationToDefaults,
  saveAutomation,
  sendAutomationTest,
  toggleAutomation,
} from './callables';
export type {
  AutomationRecentSend,
  AutomationReport,
  AutomationReportPoint,
  AutomationStepReport,
  RenderedStep,
} from './callables';

export { scheduledAutomationDispatcher } from './dispatcher';
export { scheduledAbandonedScanner, scheduledRepurchaseScanner } from './scanners';
export { onOrderWritten } from './triggers';

// --- Default -----------------------------------------------------------------

export {
  DEFAULT_AUTOMATION_KEYS,
  buildDefaultAutomation,
  buildDefaultAutomations,
} from './defaults';
export type { BrandingInput, DefaultAutomation } from './defaults';

// --- Repository (usato da `seedDefaults` e dagli altri moduli) ---------------

export {
  applyAutomationStats,
  cancelPendingRuns,
  cancelRun,
  createAutomation,
  deleteAutomation,
  dueRuns,
  ensureCoreAutomations,
  findPendingRunsForContact,
  findRunsForContact,
  findStep,
  getAutomation,
  getAutomationByKey,
  getEnabledAutomationsByTrigger,
  listAutomations,
  listRuns,
  requireAutomation,
  updateAutomation,
} from './repository';
export type { EnsureCoreResult, ListRunsOptions, RunHistoryQuery } from './repository';

// --- Arruolamento ------------------------------------------------------------

export {
  computeScheduledFor,
  enroll,
  enrollAllSteps,
  enrollByTrigger,
  isContactSendable,
  readOrderContext,
} from './enrollment';
export type { EnrollInput, EnrollResult, EnrollSkipReason, RunOrderContext } from './enrollment';

// --- Coupon ------------------------------------------------------------------

export { discountLabelOf, findCouponByCode, issueCoupon, redeemCoupon } from './coupons';
export type { IssueCouponInput, IssuedCouponResult, RedeemCouponResult } from './coupons';

// --- Motore (utile a test, shell e job manuali) ------------------------------

export { runAutomationDispatch } from './dispatcher';
export type { DispatchSummary } from './dispatcher';
export { runAbandonedScan, runRepurchaseScan } from './scanners';
export type { AbandonedScanSummary, RepurchaseScanSummary } from './scanners';
export { enrollOnOrder, matchesOrderTrigger } from './triggers';
