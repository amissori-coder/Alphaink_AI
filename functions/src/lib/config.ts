import { defineSecret, defineString } from 'firebase-functions/params';

/**
 * Configurazione runtime delle Cloud Functions.
 *
 * I valori sensibili sono gestiti da Secret Manager (`defineSecret`) e vanno
 * dichiarati nelle opzioni della singola funzione tramite `secrets: [...]`.
 * I parametri non sensibili usano `defineString` con default.
 */

// --- Regione e runtime -------------------------------------------------------

/** Tutte le risorse vivono in `europe-west1` per prossimità e GDPR. */
export const REGION = 'europe-west1';

/** Fuso orario aziendale: usato dagli scheduler e dalle fasce di silenzio. */
export const TIMEZONE = 'Europe/Rome';

// --- Segreti -----------------------------------------------------------------

export const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
/** Token condiviso verificato sui webhook Brevo in ingresso. */
export const BREVO_WEBHOOK_SECRET = defineSecret('BREVO_WEBHOOK_SECRET');
/** Token condiviso verificato sui webhook provenienti dai siti AlphaInk. */
export const SITE_WEBHOOK_SECRET = defineSecret('SITE_WEBHOOK_SECRET');

/** Chiave Webservice PrestaShop del negozio B2C (alphaink.net). */
export const PRESTASHOP_B2C_WS_KEY = defineSecret('PRESTASHOP_B2C_WS_KEY');
/** Chiave Webservice PrestaShop del negozio B2B (b2b.alphaink.net). */
export const PRESTASHOP_B2B_WS_KEY = defineSecret('PRESTASHOP_B2B_WS_KEY');
/** Password dell'utente MySQL in sola lettura, negozio B2C. */
export const PRESTASHOP_B2C_DB_PASSWORD = defineSecret('PRESTASHOP_B2C_DB_PASSWORD');
/** Password dell'utente MySQL in sola lettura, negozio B2B. */
export const PRESTASHOP_B2B_DB_PASSWORD = defineSecret('PRESTASHOP_B2B_DB_PASSWORD');

/** Tutti i segreti dei negozi: comodo da passare a `secrets: [...]`. */
export const STORE_SECRETS = [
  PRESTASHOP_B2C_WS_KEY,
  PRESTASHOP_B2B_WS_KEY,
  PRESTASHOP_B2C_DB_PASSWORD,
  PRESTASHOP_B2B_DB_PASSWORD,
];

/** Chiave usata per firmare i link tracciati e i token di disiscrizione. */
export const LINK_SIGNING_KEY = defineSecret('LINK_SIGNING_KEY');

// --- Parametri non sensibili -------------------------------------------------

export const APP_URL = defineString('APP_URL', {
  default: 'https://newsletter.alphaink.net',
  description: 'URL pubblico della web app, usato nei link tracciati e nel footer.',
});

// Negozio B2C — https://alphaink.net
export const PRESTASHOP_B2C_BASE_URL = defineString('PRESTASHOP_B2C_BASE_URL', {
  default: 'https://alphaink.net',
});
export const PRESTASHOP_B2C_DB_HOST = defineString('PRESTASHOP_B2C_DB_HOST', { default: '' });
export const PRESTASHOP_B2C_DB_PORT = defineString('PRESTASHOP_B2C_DB_PORT', { default: '3306' });
export const PRESTASHOP_B2C_DB_USER = defineString('PRESTASHOP_B2C_DB_USER', { default: '' });
export const PRESTASHOP_B2C_DB_NAME = defineString('PRESTASHOP_B2C_DB_NAME', { default: '' });

// Negozio B2B — https://b2b.alphaink.net
export const PRESTASHOP_B2B_BASE_URL = defineString('PRESTASHOP_B2B_BASE_URL', {
  default: 'https://b2b.alphaink.net',
});
export const PRESTASHOP_B2B_DB_HOST = defineString('PRESTASHOP_B2B_DB_HOST', { default: '' });
export const PRESTASHOP_B2B_DB_PORT = defineString('PRESTASHOP_B2B_DB_PORT', { default: '3306' });
export const PRESTASHOP_B2B_DB_USER = defineString('PRESTASHOP_B2B_DB_USER', { default: '' });
export const PRESTASHOP_B2B_DB_NAME = defineString('PRESTASHOP_B2B_DB_NAME', { default: '' });

/**
 * Risolve i parametri di connessione del negozio richiesto.
 * Centralizzare qui evita che ogni modulo ricostruisca la mappa sorgente→parametri.
 */
export function storeParams(source: 'prestashop_b2c' | 'prestashop_b2b') {
  return source === 'prestashop_b2b'
    ? {
        baseUrl: PRESTASHOP_B2B_BASE_URL,
        wsKey: PRESTASHOP_B2B_WS_KEY,
        dbHost: PRESTASHOP_B2B_DB_HOST,
        dbPort: PRESTASHOP_B2B_DB_PORT,
        dbUser: PRESTASHOP_B2B_DB_USER,
        dbName: PRESTASHOP_B2B_DB_NAME,
        dbPassword: PRESTASHOP_B2B_DB_PASSWORD,
      }
    : {
        baseUrl: PRESTASHOP_B2C_BASE_URL,
        wsKey: PRESTASHOP_B2C_WS_KEY,
        dbHost: PRESTASHOP_B2C_DB_HOST,
        dbPort: PRESTASHOP_B2C_DB_PORT,
        dbUser: PRESTASHOP_B2C_DB_USER,
        dbName: PRESTASHOP_B2C_DB_NAME,
        dbPassword: PRESTASHOP_B2C_DB_PASSWORD,
      };
}

/** Endpoint Brevo. */
export const BREVO_API_BASE = 'https://api.brevo.com/v3';

/** Opzioni di runtime riusate dalle funzioni pesanti. */
export const HEAVY_RUNTIME = {
  region: REGION,
  memory: '1GiB' as const,
  timeoutSeconds: 540,
  maxInstances: 10,
};

export const LIGHT_RUNTIME = {
  region: REGION,
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  maxInstances: 20,
};

export const WEBHOOK_RUNTIME = {
  region: REGION,
  memory: '512MiB' as const,
  timeoutSeconds: 120,
  maxInstances: 50,
  /** I webhook devono restare raggiungibili senza autenticazione IAM. */
  invoker: 'public' as const,
};
