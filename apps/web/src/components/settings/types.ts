/**
 * Tipi dei payload scambiati con le Cloud Functions dell'area Impostazioni.
 *
 * Rispecchiano esattamente le interfacce esposte da:
 *  - `functions/src/brevo/callables.ts`  (saveBrevoSettings, testBrevoConnection, registerBrevoWebhooks)
 *  - `functions/src/sync/callables.ts`   (runSiteSync, cancelSiteSync, saveSiteSettings)
 *  - `functions/src/users/callables.ts`  (setUserRole, listUsers)
 *  - `functions/src/seed/callables.ts`   (seedDefaults)
 *  - `functions/src/tracking/settings.ts` (saveTrackingSettings, saveBrandingSettings)
 *
 * Le credenziali (chiave API Brevo, chiave Webservice, password MySQL) viaggiano
 * solo in salita: non tornano mai indietro dal server.
 */

import type {
  AppUser,
  AttributionModel,
  BrandingSettings,
  BrevoSender,
  BrevoSettings,
  FamilyRule,
  IsoDate,
  OrderStatus,
  PrestaShopMode,
  SettingsDocId,
  SiteSettings,
  StoreSource,
  SyncCounts,
  SyncEntity,
  SyncJobStatus,
  TrackingSettings,
  UserRole,
} from '@alphaink/shared';

// -----------------------------------------------------------------------------
// Brevo
// -----------------------------------------------------------------------------

/** Input di `saveBrevoSettings` (schema condiviso `brevoSettingsInputSchema`). */
export interface SaveBrevoSettingsInput {
  /** Presente solo quando l'operatore inserisce una nuova chiave. */
  apiKey?: string;
  defaultSenderEmail: string;
  defaultReplyTo?: string | null;
  syncContacts: boolean;
  defaultListId?: number | null;
  maxSendsPerHour?: number | null;
}

export interface SaveBrevoSettingsResult {
  settings: BrevoSettings;
  /** `true` se la nuova chiave è stata scritta in Secret Manager. */
  apiKeyStored: boolean;
  warning: string | null;
}

export interface TestBrevoConnectionInput {
  /** Chiave da provare prima di salvarla; se assente si usa quella configurata. */
  apiKey?: string;
}

export interface BrevoAccountInfo {
  email: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface BrevoCredits {
  email: number | null;
  sms: number | null;
}

export interface TestBrevoConnectionResult {
  account: BrevoAccountInfo;
  senders: BrevoSender[];
  credits: BrevoCredits;
}

export interface RegisteredWebhook {
  id: number;
  url: string;
  type: 'transactional' | 'marketing';
  events: string[];
  createdAt?: IsoDate | null;
}

export interface RegisterBrevoWebhooksResult {
  /** URL che Brevo deve chiamare: coincide con la Function `brevoWebhook`. */
  url: string;
  webhooks: RegisteredWebhook[];
  created: number;
  updated: number;
  webhookSecretConfigured: boolean;
}

// -----------------------------------------------------------------------------
// Sito AlphaInk (PrestaShop B2C e B2B)
// -----------------------------------------------------------------------------

/** Patch di un singolo negozio accettata da `saveSiteSettings`. */
export interface StoreSettingsInput {
  enabled?: boolean;
  label?: string;
  baseUrl?: string;
  mode?: PrestaShopMode;
  multistoreShopId?: number | null;
  tablePrefix?: string;
  defaultSegment?: 'b2c' | 'b2b';
  customerGroupMapping?: Record<string, 'b2c' | 'b2b'>;
  orderStateMapping?: Record<string, OrderStatus>;
  languageId?: number;
  /** Credenziali: validate, salvate in Secret Manager, mai su Firestore. */
  wsKey?: string;
  dbPassword?: string;
}

export interface SaveSiteSettingsInput {
  stores?: Partial<Record<StoreSource, StoreSettingsInput>>;
  syncSchedule?: {
    enabled?: boolean;
    cron?: string;
    timezone?: string;
    entities?: SyncEntity[];
  };
  familyRules?: FamilyRule[];
  repurchaseCycleDays?: Record<string, number>;
  abandonedPaymentAfterMinutes?: number;
  abandonedCartAfterMinutes?: number;
  defaultSource?: StoreSource;
  /** Verifica la connessione dei negozi toccati prima di rispondere. */
  testConnection?: boolean;
}

export interface ConnectionCheck {
  ok: boolean;
  mode: PrestaShopMode;
  /** Messaggio già in italiano, pronto da mostrare. */
  message: string;
  details?: Record<string, unknown>;
}

export interface SaveSiteSettingsResult {
  settings: SiteSettings;
  checks: Partial<Record<StoreSource, ConnectionCheck>>;
  secretsStored: string[];
  warnings: string[];
}

export interface RunSiteSyncInput {
  source: StoreSource;
  entities: SyncEntity[];
  since?: string | null;
  fullResync?: boolean;
}

export interface RunSiteSyncResult {
  jobId: string;
  source: StoreSource;
  status: SyncJobStatus;
  counts: Record<string, SyncCounts>;
  warnings: string[];
  error: string | null;
  durationMs: number;
  /** Cursore per entità: presente quando il job va ripreso. */
  cursors: Record<string, string | null>;
  resumeRequired: boolean;
}

export interface CancelSiteSyncResult {
  jobId: string;
  cancelRequested: true;
}

// -----------------------------------------------------------------------------
// Tracciamento e brand
// -----------------------------------------------------------------------------

/** Input di `saveTrackingSettings` (schema condiviso `trackingSettingsInputSchema`). */
export interface SaveTrackingSettingsInput {
  attribution: {
    model: AttributionModel;
    clickWindowDays: number;
    openWindowDays: number;
    couponOverridesModel: boolean;
    countStatuses: string[];
    subtractRefunds: boolean;
  };
  autoUtm: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaignTemplate: string;
  useOwnClickTracking: boolean;
  clickTrackingDomain: string;
  excludeProxyOpens: boolean;
}

export interface SaveTrackingSettingsResult {
  settings: TrackingSettings;
}

/** Input di `saveBrandingSettings`: identità visiva usata da editor e invii. */
export interface SaveBrandingSettingsInput {
  companyName: string;
  legalName: string;
  address: string;
  vatNumber: string;
  supportEmail: string;
  supportPhone?: string | null;
  websiteUrl: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  palette: BrandingSettings['palette'];
  fonts: BrandingSettings['fonts'];
  socialLinks: Array<{ network: string; url: string }>;
  legalFooterHtml: string;
  unsubscribeText: string;
}

export interface SaveBrandingSettingsResult {
  settings: BrandingSettings;
}

// -----------------------------------------------------------------------------
// Utenti
// -----------------------------------------------------------------------------

export interface SetUserRoleInput {
  userId: string;
  role: UserRole;
  /** Blocca l'accesso all'applicazione senza cancellare l'account. */
  disabled?: boolean;
}

export interface SetUserRoleResult {
  user: AppUser;
  permissions: string[];
}

export interface ListUsersInput {
  limit?: number;
  includeDisabled?: boolean;
}

/** Utente con i dati di accesso letti da Firebase Auth. */
export interface UserListEntry extends AppUser {
  /** `false` se il documento sopravvive a un account cancellato. */
  authExists: boolean;
  emailVerified: boolean;
  lastSignInAt: IsoDate | null;
  providers: string[];
}

export interface ListUsersResult {
  users: UserListEntry[];
  total: number;
}

// -----------------------------------------------------------------------------
// Sistema
// -----------------------------------------------------------------------------

export type SeedOutcome = 'creato' | 'completato' | 'invariato';

export interface SeedDefaultsInput {
  /** Ripristina il contenuto originale dei template di sistema. */
  overwriteTemplates?: boolean;
  includeAutomations?: boolean;
}

export interface SeedDefaultsResult {
  settings: Record<SettingsDocId, SeedOutcome>;
  templates: { created: string[]; updated: string[]; unchanged: string[] };
  automations: { created: string[]; existing: string[] };
}

// -----------------------------------------------------------------------------
// Stato locale dei moduli
// -----------------------------------------------------------------------------

/** Identificatore delle sezioni della pagina Impostazioni. */
export type SettingsTab = 'brevo' | 'sito' | 'tracciamento' | 'brand' | 'utenti' | 'sistema';

/** Esito della validazione zod di un modulo: messaggio per campo. */
export type FieldErrors = Record<string, string>;
