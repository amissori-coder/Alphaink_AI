import type { AuditFields, DocId, IsoDate } from './common';
import type { ProductFamily, SiteSource } from './site';

/** Stato di iscrizione: rispecchia e sincronizza lo stato Brevo. */
export type SubscriptionStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'pending'      // double opt-in in attesa di conferma
  | 'bounced'
  | 'blocked'      // hard bounce / spam complaint
  | 'never_subscribed';

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  subscribed: 'Iscritto',
  unsubscribed: 'Disiscritto',
  pending: 'In attesa di conferma',
  bounced: 'Bounce',
  blocked: 'Bloccato',
  never_subscribed: 'Mai iscritto',
};

/** Stati che permettono l'invio. */
export const SENDABLE_STATUSES: SubscriptionStatus[] = ['subscribed'];

/** Metriche commerciali del contatto, ricalcolate ad ogni sync ordini. */
export interface ContactStats {
  ordersCount: number;
  totalSpent: number;
  averageOrderValue: number;
  firstOrderAt?: IsoDate | null;
  lastOrderAt?: IsoDate | null;
  /** Giorni medi fra un ordine e il successivo: base per le automazioni di riacquisto. */
  averageDaysBetweenOrders?: number | null;
  /** Data prevista del prossimo riacquisto per famiglia prodotto. */
  nextPurchaseDueAt?: Partial<Record<ProductFamily, IsoDate>>;
  /** Spesa e conteggio per famiglia prodotto. */
  spentByFamily?: Partial<Record<ProductFamily, number>>;
  ordersByFamily?: Partial<Record<ProductFamily, number>>;
  lastOrderByFamily?: Partial<Record<ProductFamily, IsoDate>>;
}

/** Metriche di engagement email, aggiornate dai webhook Brevo. */
export interface ContactEngagement {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complaints: number;
  lastSentAt?: IsoDate | null;
  lastOpenedAt?: IsoDate | null;
  lastClickedAt?: IsoDate | null;
  /** Punteggio 0-100 calcolato da recency + frequenza aperture/click. */
  engagementScore: number;
  /** Etichetta derivata dal punteggio, usata dai cluster automatici. */
  engagementTier: EngagementTier;
}

export type EngagementTier = 'hot' | 'warm' | 'cold' | 'dormant' | 'unknown';

export const ENGAGEMENT_TIER_LABELS: Record<EngagementTier, string> = {
  hot: 'Molto attivo',
  warm: 'Attivo',
  cold: 'Poco attivo',
  dormant: 'Dormiente',
  unknown: 'Sconosciuto',
};

/** Stampante posseduta dal cliente, dedotta dagli acquisti. */
export interface OwnedPrinter {
  brand: string;
  model: string;
  /** Da dove arriva l'informazione. */
  detectedFrom: 'order' | 'manual' | 'compatibility';
  detectedAt: IsoDate;
  /** SKU dei consumabili compatibili, per i coupon mirati. */
  compatibleSkus?: string[];
}

export interface Contact extends AuditFields {
  id: DocId;
  email: string;
  /** Email normalizzata (lowercase, trim): usata come chiave di deduplica. */
  emailNormalized: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;

  /** Provenienza principale del contatto. */
  source: SiteSource;
  /** Tutte le sorgenti in cui il contatto compare (B2C + B2B). */
  sources: SiteSource[];
  /** Id del cliente sulle piattaforme esterne, per sorgente. */
  externalIds: Partial<Record<SiteSource, string>>;

  status: SubscriptionStatus;
  optInAt?: IsoDate | null;
  optOutAt?: IsoDate | null;
  /** Testo/origine del consenso, per GDPR. */
  consentSource?: string | null;

  language: string;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  postcode?: string | null;

  /** Gruppo cliente della piattaforma (es. "Rivenditori"). */
  customerGroup?: string | null;
  /** Segmento B2B/B2C. */
  segment: 'b2c' | 'b2b';

  tags: string[];
  /** Cluster statici a cui il contatto è stato assegnato manualmente. */
  clusterIds: DocId[];
  /** Cluster dinamici che il contatto soddisfa (ricalcolati dal motore). */
  dynamicClusterIds: DocId[];

  stats: ContactStats;
  engagement: ContactEngagement;
  printers: OwnedPrinter[];

  /** Id contatto su Brevo, per il push bidirezionale. */
  brevoContactId?: number | null;
  brevoSyncedAt?: IsoDate | null;
  brevoListIds?: number[];

  lastSyncAt?: IsoDate | null;
  /** Attributi liberi provenienti dal sito, esposti come merge tag nell'editor. */
  customAttributes?: Record<string, string | number | boolean | null>;
  notes?: string | null;
}

/** Proiezione leggera usata nelle liste e nell'anteprima destinatari. */
export interface ContactSummary {
  id: DocId;
  email: string;
  displayName: string;
  status: SubscriptionStatus;
  segment: 'b2c' | 'b2b';
  ordersCount: number;
  totalSpent: number;
  engagementTier: EngagementTier;
  lastOrderAt?: IsoDate | null;
}
