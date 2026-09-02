import type { AuditFields, DocId, IsoDate } from './common';
import type { EmailDocument } from './email';

export type NewsletterStatus =
  | 'draft'
  | 'scheduled'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'failed'
  | 'cancelled';

export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = {
  draft: 'Bozza',
  scheduled: 'Pianificata',
  queued: 'In coda',
  sending: 'Invio in corso',
  sent: 'Inviata',
  paused: 'In pausa',
  failed: 'Fallita',
  cancelled: 'Annullata',
};

export const NEWSLETTER_STATUS_COLORS: Record<NewsletterStatus, string> = {
  draft: '#94a3b8',
  scheduled: '#6366f1',
  queued: '#8b5cf6',
  sending: '#f59e0b',
  sent: '#10b981',
  paused: '#f97316',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

/** Stati che occupano uno slot nel calendario. */
export const CALENDAR_STATUSES: NewsletterStatus[] = [
  'scheduled', 'queued', 'sending', 'sent', 'paused', 'failed',
];

export interface NewsletterAudience {
  /** Cluster inclusi (unione). */
  clusterIds: DocId[];
  /** Cluster esclusi (sottrazione, applicata dopo l'unione). */
  excludeClusterIds: DocId[];
  /** Contatti aggiunti singolarmente. */
  includeContactIds: DocId[];
  /** Contatti esclusi singolarmente. */
  excludeContactIds: DocId[];
  /** Esclude chi ha già ricevuto una qualsiasi email negli ultimi N giorni. */
  suppressIfContactedWithinDays?: number | null;
  /** Esclude chi ha già acquistato negli ultimi N giorni. */
  suppressIfPurchasedWithinDays?: number | null;
  /** Stima calcolata al salvataggio. */
  estimatedRecipients: number;
  estimatedAt?: IsoDate | null;
}

export interface NewsletterSchedule {
  /** Momento dell'invio in UTC. */
  sendAt: IsoDate;
  timezone: string;
  /** Invio scaglionato: quanti destinatari per batch e ogni quanti minuti. */
  throttle?: { batchSize: number; intervalMinutes: number } | null;
  /** Ottimizzazione oraria: invia nell'ora in cui il contatto apre di più. */
  optimizeSendTime?: boolean;
  /** Non inviare fuori da questa fascia oraria locale. */
  quietHours?: { start: string; end: string } | null;
}

/** Statistiche aggregate, aggiornate dai webhook Brevo. */
export interface NewsletterStats {
  recipients: number;
  requested: number;
  delivered: number;
  softBounces: number;
  hardBounces: number;
  blocked: number;
  opened: number;
  uniqueOpened: number;
  clicked: number;
  uniqueClicked: number;
  unsubscribed: number;
  complaints: number;
  /** Attribuzione commerciale. */
  orders: number;
  revenue: number;
  currency: string;
  /** Tassi calcolati (0-1). */
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
  conversionRate: number;
  revenuePerRecipient: number;
  updatedAt?: IsoDate | null;
}

export const EMPTY_STATS: NewsletterStats = {
  recipients: 0, requested: 0, delivered: 0, softBounces: 0, hardBounces: 0, blocked: 0,
  opened: 0, uniqueOpened: 0, clicked: 0, uniqueClicked: 0, unsubscribed: 0, complaints: 0,
  orders: 0, revenue: 0, currency: 'EUR',
  deliveryRate: 0, openRate: 0, clickRate: 0, clickToOpenRate: 0,
  bounceRate: 0, unsubscribeRate: 0, conversionRate: 0, revenuePerRecipient: 0,
  updatedAt: null,
};

/** Variante per A/B test. */
export interface NewsletterVariant {
  id: string;
  name: string;
  subject: string;
  preheader?: string;
  document?: EmailDocument | null;
  /** Percentuale di pubblico assegnata (0-100). */
  splitPercent: number;
  brevoCampaignId?: number | null;
  stats: NewsletterStats;
}

export interface AbTestConfig {
  enabled: boolean;
  /** Cosa si sta testando. */
  dimension: 'subject' | 'content' | 'sender' | 'send_time';
  /** Percentuale di pubblico usata per il test prima di scegliere il vincitore. */
  testAudiencePercent: number;
  /** Metrica che decide il vincitore. */
  winnerMetric: 'open_rate' | 'click_rate' | 'conversion_rate' | 'revenue';
  /** Ore di attesa prima di proclamare il vincitore. */
  decideAfterHours: number;
  winnerVariantId?: string | null;
  decidedAt?: IsoDate | null;
}

export interface Newsletter extends AuditFields {
  id: DocId;
  name: string;
  subject: string;
  preheader?: string | null;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;

  /** Documento dell'editor a blocchi (fonte di verità). */
  document: EmailDocument;
  /** HTML compilato: rigenerato ad ogni salvataggio e prima dell'invio. */
  html?: string | null;
  plainText?: string | null;
  /** Anteprima PNG generata per calendario e liste. */
  thumbnailUrl?: string | null;

  status: NewsletterStatus;
  audience: NewsletterAudience;
  schedule?: NewsletterSchedule | null;

  abTest?: AbTestConfig | null;
  variants?: NewsletterVariant[];

  /** Id campagna su Brevo. */
  brevoCampaignId?: number | null;
  brevoListIds?: number[];

  stats: NewsletterStats;

  /** Etichette libere e colore nel calendario. */
  tags: string[];
  color?: string | null;
  /** Categoria editoriale, utile per filtrare il calendario. */
  category?: NewsletterCategory | null;

  sentAt?: IsoDate | null;
  startedSendingAt?: IsoDate | null;
  completedAt?: IsoDate | null;
  cancelledAt?: IsoDate | null;
  failureReason?: string | null;
  /** Numero di tentativi di invio già effettuati. */
  sendAttempts: number;

  /** Se generata da un'automazione, la chiave di riferimento. */
  automationKey?: string | null;
  /** Template da cui è stata creata. */
  templateId?: DocId | null;
  /** Newsletter da cui è stata duplicata. */
  duplicatedFromId?: DocId | null;

  /** Test di invio già eseguiti. */
  testSends?: Array<{ email: string; sentAt: IsoDate; by: string }>;

  archived: boolean;
}

export type NewsletterCategory =
  | 'promozione'
  | 'novita'
  | 'saldi'
  | 'informativa'
  | 'stagionale'
  | 'b2b'
  | 'automazione'
  | 'altro';

export const NEWSLETTER_CATEGORY_LABELS: Record<NewsletterCategory, string> = {
  promozione: 'Promozione',
  novita: 'Novità',
  saldi: 'Saldi',
  informativa: 'Informativa',
  stagionale: 'Stagionale',
  b2b: 'B2B',
  automazione: 'Automazione',
  altro: 'Altro',
};

/** Stato per singolo destinatario: sotto-collezione `newsletters/{id}/recipients`. */
export type RecipientStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'converted'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'blocked'
  | 'unsubscribed'
  | 'spam'
  | 'failed';

export interface NewsletterRecipient {
  id: DocId;
  contactId: DocId;
  email: string;
  variantId?: string | null;
  status: RecipientStatus;
  /** `messageId` restituito da Brevo: chiave di correlazione con i webhook. */
  messageId?: string | null;
  sentAt?: IsoDate | null;
  deliveredAt?: IsoDate | null;
  firstOpenedAt?: IsoDate | null;
  lastOpenedAt?: IsoDate | null;
  openCount: number;
  firstClickedAt?: IsoDate | null;
  lastClickedAt?: IsoDate | null;
  clickCount: number;
  clickedUrls: Array<{ url: string; count: number; lastAt: IsoDate }>;
  unsubscribedAt?: IsoDate | null;
  bouncedAt?: IsoDate | null;
  bounceReason?: string | null;
  /** Attribuzione: ordine generato da questa email. */
  convertedOrderId?: DocId | null;
  convertedAt?: IsoDate | null;
  revenue?: number | null;
  error?: string | null;
}

/** Template riutilizzabile. */
export interface NewsletterTemplate extends AuditFields {
  id: DocId;
  name: string;
  description?: string | null;
  category: NewsletterCategory | 'sistema';
  document: EmailDocument;
  thumbnailUrl?: string | null;
  /** I template di sistema non sono eliminabili. */
  isSystem: boolean;
  usageCount: number;
  tags: string[];
}
