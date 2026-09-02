/**
 * Installazione predefinita: impostazioni, template di sistema e automazioni
 * core. Tutto idempotente: `seedDefaults` si può rilanciare senza danni.
 */

export { seedDefaults } from './callables';
export { ensureSettingsDoc, seedSystemTemplates } from './callables';
export type { SeedOutcome, SeedResult, TemplateSeedResult } from './callables';

export { SYSTEM_TEMPLATE_IDS, buildSystemTemplates } from './templates';
export type { SystemTemplate } from './templates';
