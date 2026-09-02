/**
 * Sincronizzazione dai negozi AlphaInk (entrambi PrestaShop) verso Firestore.
 *
 * Struttura del modulo:
 *  - `types.ts`                  contratto `SiteAdapter` e righe grezze comuni
 *  - `normalize.ts`              funzioni pure di normalizzazione
 *  - `prestashop-webservice.ts`  backend API ufficiale
 *  - `prestashop-mysql.ts`       backend lettura diretta dal database
 *  - `prestashop.ts`             adapter che sceglie il backend e normalizza
 *  - `repository.ts`             scritture idempotenti su Firestore
 *  - `orchestrator.ts`           esecuzione dei job e gestione dei cursori
 *  - `settings.ts`               documento `settings/site` e credenziali
 *  - `callables.ts`              runSiteSync, cancelSiteSync, saveSiteSettings
 *  - `scheduled.ts`              scheduledSiteSync (oraria)
 *  - `webhook.ts`                siteWebhook (eventi push dal sito)
 *
 * L'entry point delle Functions ri-esporta da qui le funzioni pubbliche:
 * `runSiteSync`, `cancelSiteSync`, `saveSiteSettings`, `scheduledSiteSync`,
 * `siteWebhook`.
 */

export * from './types';
export * from './normalize';
export * from './prestashop-webservice';
export * from './prestashop-mysql';
export * from './prestashop';
export * from './repository';
export * from './orchestrator';
export * from './settings';
export * from './callables';
export * from './scheduled';
export * from './webhook';

/**
 * Alias non ambiguo: anche il modulo `contacts` espone un `buildContactPatch`,
 * con firma diversa (parte da un input di UI, non da un cliente del negozio).
 * Chi importa dall'entry point delle Functions usi questo nome.
 */
export { buildContactPatch as buildContactPatchFromCustomer } from './normalize';
