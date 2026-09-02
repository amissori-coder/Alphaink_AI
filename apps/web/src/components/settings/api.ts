'use client';

/**
 * Callable dell'area Impostazioni.
 *
 * I nomi corrispondono esattamente alle funzioni esportate dalle Cloud
 * Functions in `europe-west1`; il client Firebase converte già gli errori in
 * messaggi italiani (vedi `@/lib/firebase/client`).
 *
 * I webhook (Brevo e sito) NON passano da qui: sono endpoint HTTP delle
 * Functions (`brevoWebhook`, `siteWebhook`) chiamati dai servizi esterni.
 */

import { callable } from '@/lib/firebase/client';

import type {
  CancelSiteSyncResult,
  ListUsersInput,
  ListUsersResult,
  RegisterBrevoWebhooksResult,
  RunSiteSyncInput,
  RunSiteSyncResult,
  SaveBrandingSettingsInput,
  SaveBrandingSettingsResult,
  SaveBrevoSettingsInput,
  SaveBrevoSettingsResult,
  SaveSiteSettingsInput,
  SaveSiteSettingsResult,
  SaveTrackingSettingsInput,
  SaveTrackingSettingsResult,
  SeedDefaultsInput,
  SeedDefaultsResult,
  SetUserRoleInput,
  SetUserRoleResult,
  TestBrevoConnectionInput,
  TestBrevoConnectionResult,
} from './types';

// --- Brevo -------------------------------------------------------------------

/** Salva la configurazione Brevo; la chiave API finisce in Secret Manager. */
export const saveBrevoSettings = callable<SaveBrevoSettingsInput, SaveBrevoSettingsResult>(
  'saveBrevoSettings',
  { timeoutMs: 120_000 },
);

/** Verifica account, mittenti e crediti residui. */
export const testBrevoConnection = callable<TestBrevoConnectionInput, TestBrevoConnectionResult>(
  'testBrevoConnection',
  { timeoutMs: 120_000 },
);

/** Crea o allinea i webhook Brevo verso la Function `brevoWebhook`. */
export const registerBrevoWebhooks = callable<Record<string, never>, RegisterBrevoWebhooksResult>(
  'registerBrevoWebhooks',
  { timeoutMs: 120_000 },
);

// --- Sito --------------------------------------------------------------------

/** Salva `settings/site`; le credenziali dei negozi vanno in Secret Manager. */
export const saveSiteSettings = callable<SaveSiteSettingsInput, SaveSiteSettingsResult>(
  'saveSiteSettings',
  { timeoutMs: 300_000 },
);

/** Avvia una sincronizzazione manuale di un negozio. */
export const runSiteSync = callable<RunSiteSyncInput, RunSiteSyncResult>('runSiteSync', {
  timeoutMs: 540_000,
});

/** Chiede l'interruzione di un job di sincronizzazione in corso. */
export const cancelSiteSync = callable<{ jobId: string }, CancelSiteSyncResult>('cancelSiteSync', {
  timeoutMs: 60_000,
});

// --- Tracciamento e brand ----------------------------------------------------

export const saveTrackingSettings = callable<SaveTrackingSettingsInput, SaveTrackingSettingsResult>(
  'saveTrackingSettings',
  { timeoutMs: 120_000 },
);

export const saveBrandingSettings = callable<SaveBrandingSettingsInput, SaveBrandingSettingsResult>(
  'saveBrandingSettings',
  { timeoutMs: 120_000 },
);

// --- Utenti ------------------------------------------------------------------

export const setUserRole = callable<SetUserRoleInput, SetUserRoleResult>('setUserRole', {
  timeoutMs: 60_000,
});

export const listUsers = callable<ListUsersInput, ListUsersResult>('listUsers', {
  timeoutMs: 120_000,
});

// --- Sistema -----------------------------------------------------------------

/** Crea impostazioni, template e automazioni predefinite se mancanti. */
export const seedDefaults = callable<SeedDefaultsInput, SeedDefaultsResult>('seedDefaults', {
  timeoutMs: 540_000,
});
