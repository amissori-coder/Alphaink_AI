/**
 * Tracciamento e attribuzione.
 *
 * Struttura del modulo:
 *  - `settings.ts`     lettura di `settings/tracking` e `settings/branding`
 *  - `events.ts`       costruzione, deduplica e persistenza degli eventi
 *  - `webhook.ts`      `brevoWebhook`: ingresso degli eventi Brevo
 *  - `redirect.ts`     `trackClick` e `trackOpen`: tracciamento proprietario
 *  - `processor.ts`    correlazione evento → invio e aggiornamento statistiche
 *  - `attribution.ts`  attribuzione degli acquisti e `onOrderAttributionWritten`
 *  - `unsubscribe.ts`  `unsubscribePage` e `preferencesPage`
 *  - `webview.ts`      `webviewPage` ("Vedi nel browser")
 *  - `metrics.ts`      `scheduledDailyMetrics` e `scheduledStatsReconcile`
 *  - `callables.ts`    `getDashboardMetrics` e `getNewsletterReport`
 *  - `layout.ts`       impaginazione delle pagine pubbliche
 *
 * L'entry point delle Functions ri-esporta da qui: `brevoWebhook`, `trackClick`,
 * `trackOpen`, `unsubscribePage`, `preferencesPage`, `webviewPage`,
 * `scheduledDailyMetrics`, `scheduledStatsReconcile`, `getDashboardMetrics`,
 * `getNewsletterReport`, `onOrderAttributionWritten`.
 *
 * Il modulo automazioni, che possiede `onOrderWritten`, può richiamare
 * `handleOrderAttribution(before, after)` per attribuire un ordine senza
 * duplicare la logica: la doppia esecuzione è innocua.
 */

export * from './settings';
export * from './layout';
export * from './events';
export * from './processor';
export * from './webhook';
export * from './redirect';
export * from './attribution';
export * from './unsubscribe';
export * from './webview';
export * from './metrics';
export * from './callables';
