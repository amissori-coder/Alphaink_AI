import type { AuditFields, IsoDate } from './common';
import type { AttributionSettings } from './tracking';
import type { OpenCartMode, SiteSource } from './site';

/** Documento `settings/brevo`. La API key vive nei Secret Manager, non qui. */
export interface BrevoSettings extends AuditFields {
  /** Indica se una API key è configurata (il valore non è mai esposto al client). */
  apiKeyConfigured: boolean;
  /** Ultime 4 cifre per riconoscere la chiave in uso. */
  apiKeyHint?: string | null;
  accountEmail?: string | null;
  accountCompany?: string | null;
  /** Crediti residui letti da `/account`. */
  credits?: { email?: number | null; sms?: number | null } | null;

  senders: BrevoSender[];
  defaultSenderEmail: string;
  defaultReplyTo?: string | null;

  /** Webhook registrati su Brevo. */
  webhooks: Array<{
    id: number;
    url: string;
    type: 'transactional' | 'marketing';
    events: string[];
    createdAt?: IsoDate | null;
  }>;
  webhookSecretConfigured: boolean;

  /** Sincronizzazione contatti verso Brevo. */
  syncContacts: boolean;
  /** Lista Brevo di default per i contatti sincronizzati. */
  defaultListId?: number | null;
  /** Mappatura attributi Firestore → attributi Brevo. */
  attributeMapping: Record<string, string>;

  /** Limiti di invio. */
  maxSendsPerHour?: number | null;
  lastCheckedAt?: IsoDate | null;
  lastError?: string | null;
}

export interface BrevoSender {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

/** Documento `settings/site`. Credenziali sensibili nei Secret Manager. */
export interface SiteSettings extends AuditFields {
  opencart: {
    enabled: boolean;
    baseUrl: string;
    mode: OpenCartMode;
    /** Solo indicatori: le credenziali non transitano dal client. */
    credentialsConfigured: boolean;
    tablePrefix: string;
    /** Mappa gruppo cliente → segmento. */
    customerGroupMapping: Record<string, 'b2c' | 'b2b'>;
    lastSyncAt?: IsoDate | null;
    lastSyncError?: string | null;
  };
  prestashop: {
    enabled: boolean;
    baseUrl: string;
    credentialsConfigured: boolean;
    customerGroupMapping: Record<string, 'b2c' | 'b2b'>;
    lastSyncAt?: IsoDate | null;
    lastSyncError?: string | null;
  };
  /** Frequenza della sincronizzazione automatica. */
  syncSchedule: {
    enabled: boolean;
    /** Espressione cron (fuso `timezone`). */
    cron: string;
    timezone: string;
    entities: string[];
  };
  /** Regole di classificazione dei prodotti nelle famiglie AlphaInk. */
  familyRules: FamilyRule[];
  /** Cicli di riacquisto stimati per famiglia (giorni). */
  repurchaseCycleDays: Record<string, number>;
  webhookSecretConfigured: boolean;
  defaultSource: SiteSource;
}

/** Regola di classificazione di un prodotto in una famiglia. */
export interface FamilyRule {
  id: string;
  family: string;
  /** Match su percorso categoria (case-insensitive, supporta `*`). */
  categoryPatterns: string[];
  /** Match su SKU. */
  skuPatterns: string[];
  /** Match su nome prodotto. */
  namePatterns: string[];
  priority: number;
}

/** Documento `settings/branding`: identità visiva usata dall'editor. */
export interface BrandingSettings extends AuditFields {
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
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    success: string;
    danger: string;
  };
  fonts: { heading: string; body: string };
  socialLinks: Array<{ network: string; url: string }>;
  /** Footer legale allegato a ogni invio. */
  legalFooterHtml: string;
  unsubscribeText: string;
}

/** Documento `settings/tracking`. */
export interface TrackingSettings extends AuditFields {
  attribution: AttributionSettings;
  /** Aggiunge automaticamente i parametri UTM ai link. */
  autoUtm: boolean;
  utmSource: string;
  utmMedium: string;
  /** Template del campaign name, supporta `{{newsletter.slug}}`. */
  utmCampaignTemplate: string;
  /** Riscrive i link nel redirector per tracciare i click lato nostro. */
  useOwnClickTracking: boolean;
  clickTrackingDomain: string;
  /** Ignora le aperture da proxy Apple MPP nel calcolo dell'open rate. */
  excludeProxyOpens: boolean;
}

export type SettingsDocId = 'brevo' | 'site' | 'branding' | 'tracking';
