/**
 * Entry point delle Cloud Functions AlphaInk.
 *
 * Questo file è **solo wiring**: non contiene logica. Ogni funzione è scritta
 * nel modulo di competenza e qui viene ri-esportata con il nome esatto previsto
 * dal contratto pubblico, perché è quel nome che la web app usa in
 * `httpsCallable(...)` e che i servizi esterni (Brevo, PrestaShop) chiamano via
 * HTTP. Rinominare un export qui significa rompere il frontend.
 *
 * Tutte le funzioni girano in `europe-west1` (`REGION` in `lib/config`) con
 * fuso `Europe/Rome`: la regione è imposta dai preset `LIGHT_RUNTIME`,
 * `HEAVY_RUNTIME` e `WEBHOOK_RUNTIME`, non va ripetuta qui.
 *
 * Nota sui costi di avvio: gli export sotto caricano tutti i moduli a ogni
 * cold start. È il comportamento standard di Firebase Functions e resta
 * accettabile perché i moduli sono di sola definizione (nessun lavoro al
 * caricamento: i segreti vengono letti dentro gli handler, non a import time).
 */

// -----------------------------------------------------------------------------
// Newsletter — creazione, pianificazione, invio, anteprima, calendario
// -----------------------------------------------------------------------------

export {
  // Callable
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
  // Programmata: avvia le newsletter in scadenza e fa avanzare i batch in coda
  scheduledNewsletterDispatcher,
  // Trigger Firestore: rigenera l'HTML e ristima il pubblico a ogni modifica
  onNewsletterWritten,
} from './newsletters';

// -----------------------------------------------------------------------------
// Cluster — segmentazione dei contatti
// -----------------------------------------------------------------------------

export {
  // Callable
  deleteCluster,
  previewCluster,
  recomputeCluster,
  saveCluster,
  // Programmata: ricalcola le appartenenze dei cluster dinamici
  scheduledClusterRefresh,
} from './clusters';

// -----------------------------------------------------------------------------
// Contatti — anagrafica, import/export, disiscrizione
// -----------------------------------------------------------------------------

export {
  // Callable
  deleteContact,
  exportContacts,
  importContacts,
  unsubscribeContact,
  upsertContact,
  // Trigger Firestore: allinea Brevo e l'indice dei cluster
  onContactWritten,
} from './contacts';

// -----------------------------------------------------------------------------
// Sincronizzazione dai negozi PrestaShop (B2C e B2B)
// -----------------------------------------------------------------------------

export {
  // Callable
  cancelSiteSync,
  runSiteSync,
  saveSiteSettings,
  // Programmata: sincronizzazione oraria dei negozi abilitati
  scheduledSiteSync,
  // HTTP: eventi push inviati dai negozi (firma HMAC con SITE_WEBHOOK_SECRET)
  siteWebhook,
} from './sync';

// -----------------------------------------------------------------------------
// Automazioni comportamentali
// -----------------------------------------------------------------------------

export {
  // Callable
  getAutomationReport,
  previewAutomationStep,
  resetAutomationToDefaults,
  saveAutomation,
  sendAutomationTest,
  toggleAutomation,
  // Programmate
  scheduledAbandonedScanner,
  scheduledAutomationDispatcher,
  scheduledRepurchaseScanner,
  /**
   * Trigger Firestore sugli ordini. Oltre alle automazioni esegue anche
   * l'attribuzione degli acquisti (`handleOrderAttribution` del modulo
   * tracking): un solo trigger su `orders/{orderId}` invece di due.
   */
  onOrderWritten,
} from './automations';

// -----------------------------------------------------------------------------
// Brevo — configurazione dell'account di invio
// -----------------------------------------------------------------------------

export { registerBrevoWebhooks, saveBrevoSettings, testBrevoConnection } from './brevo';

// -----------------------------------------------------------------------------
// Tracciamento, attribuzione e pagine pubbliche
// -----------------------------------------------------------------------------

export {
  // Callable
  getDashboardMetrics,
  getNewsletterReport,
  saveBrandingSettings,
  saveTrackingSettings,
  // HTTP: ingresso degli eventi Brevo (consegne, aperture, click, bounce)
  brevoWebhook,
  // HTTP: tracciamento proprietario dei link e delle aperture
  trackClick,
  trackOpen,
  // HTTP: pagine pubbliche raggiunte dai link dell'email
  preferencesPage,
  unsubscribePage,
  webviewPage,
  // Programmate: consolidamento giornaliero e riconciliazione delle statistiche
  scheduledDailyMetrics,
  scheduledStatsReconcile,
} from './tracking';

// -----------------------------------------------------------------------------
// Utenti e permessi
// -----------------------------------------------------------------------------

export {
  // Callable
  listUsers,
  setUserRole,
  /** Chiamata dalla web app al primo accesso: crea `users/{uid}` e i claim. */
  bootstrapUser,
  /** Trigger Auth (gen. 1): stessa logica per chi viene creato dalla console. */
  onUserCreated,
} from './users';

// -----------------------------------------------------------------------------
// Libreria immagini
// -----------------------------------------------------------------------------

export { deleteMediaAsset, requestMediaUpload } from './media';

// -----------------------------------------------------------------------------
// Installazione predefinita
// -----------------------------------------------------------------------------

export { seedDefaults } from './seed';
