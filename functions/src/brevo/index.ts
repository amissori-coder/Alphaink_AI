/**
 * Integrazione Brevo: client HTTP, contatti, invii, campagne, webhook e
 * impostazioni. L'entry point delle Functions ri-esporta da qui le tre
 * callable `saveBrevoSettings`, `testBrevoConnection`, `registerBrevoWebhooks`.
 */

export * from './client';
export * from './senders';
export * from './contacts';
export * from './transactional';
export * from './campaigns';
export * from './webhooks';
export * from './settings';
export * from './callables';
