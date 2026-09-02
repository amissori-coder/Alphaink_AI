/**
 * `GET /api/health` — stato dell'applicazione web.
 *
 * Serve alla scheda «Sistema» delle Impostazioni e a un eventuale controllo
 * esterno di disponibilità. Non espone segreti: l'id progetto e la regione sono
 * già variabili pubbliche del client.
 *
 * I webhook di Brevo e del sito NON sono gestiti qui: arrivano alle Cloud
 * Functions `brevoWebhook` e `siteWebhook`.
 */

import { FUNCTIONS_REGION, json, projectId } from '../_lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Versione dell'applicazione, allineata a `apps/web/package.json`. */
const APP_VERSION = '1.0.0';

export function GET(): Response {
  const project = projectId();

  return json({
    status: 'ok',
    service: 'alphaink-newsletter-web',
    version: APP_VERSION,
    environment: process.env.NODE_ENV ?? 'production',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    firebase: {
      projectId: project || null,
      configured: Boolean(project && process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
      emulators: process.env.NEXT_PUBLIC_USE_EMULATORS === 'true',
    },
    functions: {
      region: FUNCTIONS_REGION,
    },
    routes: [
      { path: '/api/health', method: 'GET', description: 'Stato del servizio.' },
      {
        path: '/api/preview/[id]',
        method: 'GET',
        description: 'HTML della newsletter per l’anteprima (richiede token di sessione).',
      },
      {
        path: '/api/export/contacts',
        method: 'POST',
        description: 'Proxy autenticato verso la callable exportContacts.',
      },
    ],
    webhooks: {
      handledBy: 'cloud-functions',
      note:
        'Le notifiche di Brevo e del sito PrestaShop sono ricevute dalle Cloud Functions brevoWebhook e siteWebhook, non da questa applicazione.',
    },
  });
}
