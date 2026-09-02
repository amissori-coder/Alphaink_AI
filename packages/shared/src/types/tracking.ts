import type { DocId, IsoDate } from './common';
import type { UtmParams } from './site';

/**
 * Eventi Brevo. I nomi rispecchiano il campo `event` dei webhook Brevo
 * (transazionali e campagne marketing).
 * @see https://developers.brevo.com/docs/transactional-webhooks
 */
export type BrevoEventType =
  | 'request'          // email accettata da Brevo
  | 'delivered'
  | 'opened'
  | 'unique_opened'
  | 'click'
  | 'soft_bounce'
  | 'hard_bounce'
  | 'blocked'
  | 'spam'
  | 'invalid_email'
  | 'deferred'
  | 'error'
  | 'unsubscribed'
  | 'list_addition'
  | 'contact_updated'
  | 'contact_deleted'
  | 'proxy_open';       // apertura via proxy immagini (Apple MPP)

export const BREVO_EVENT_TYPES: BrevoEventType[] = [
  'request', 'delivered', 'opened', 'unique_opened', 'click', 'soft_bounce',
  'hard_bounce', 'blocked', 'spam', 'invalid_email', 'deferred', 'error',
  'unsubscribed', 'list_addition', 'contact_updated', 'contact_deleted', 'proxy_open',
];

export const BREVO_EVENT_LABELS: Record<BrevoEventType, string> = {
  request: 'Richiesta accettata',
  delivered: 'Consegnata',
  opened: 'Aperta',
  unique_opened: 'Aperta (unica)',
  click: 'Click',
  soft_bounce: 'Soft bounce',
  hard_bounce: 'Hard bounce',
  blocked: 'Bloccata',
  spam: 'Segnalata come spam',
  invalid_email: 'Email non valida',
  deferred: 'Rimandata',
  error: 'Errore',
  unsubscribed: 'Disiscrizione',
  list_addition: 'Aggiunta a lista',
  contact_updated: 'Contatto aggiornato',
  contact_deleted: 'Contatto eliminato',
  proxy_open: 'Apertura via proxy',
};

/** Eventi che indicano un problema di recapito. */
export const DELIVERY_FAILURE_EVENTS: BrevoEventType[] = [
  'soft_bounce', 'hard_bounce', 'blocked', 'invalid_email', 'error',
];

/** Origine dell'invio a cui l'evento si riferisce. */
export type SendSource = 'newsletter' | 'automation' | 'test' | 'transactional';

export interface TrackingEvent {
  id: DocId;
  type: BrevoEventType;
  email: string;
  contactId?: DocId | null;
  /** `message-id` Brevo: chiave primaria di correlazione. */
  messageId?: string | null;
  /** Correlazione con l'entità applicativa. */
  source: SendSource;
  newsletterId?: DocId | null;
  variantId?: string | null;
  automationId?: DocId | null;
  automationRunId?: DocId | null;
  /** Id campagna Brevo, presente sugli eventi marketing. */
  brevoCampaignId?: number | null;
  /** Solo per `click`. */
  url?: string | null;
  /** Motivo di bounce/blocco. */
  reason?: string | null;
  tag?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  device?: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  os?: string | null;
  emailClient?: string | null;
  /** Timestamp dell'evento dichiarato da Brevo. */
  occurredAt: IsoDate;
  /** Timestamp di ricezione del webhook. */
  receivedAt: IsoDate;
  /** Payload originale, conservato per debug e riprocessamento. */
  raw: Record<string, unknown>;
  /** Hash del payload: evita il doppio conteggio in caso di ritentativi. */
  dedupeHash: string;
  processed: boolean;
  processingError?: string | null;
}

// ---------------------------------------------------------------------------
// Attribuzione degli acquisti
// ---------------------------------------------------------------------------

export type AttributionModel = 'last_click' | 'last_open' | 'first_click' | 'linear' | 'coupon';

export const ATTRIBUTION_MODEL_LABELS: Record<AttributionModel, string> = {
  last_click: 'Ultimo click',
  last_open: 'Ultima apertura',
  first_click: 'Primo click',
  linear: 'Lineare (multi-touch)',
  coupon: 'Codice coupon',
};

/** Un "tocco" attribuibile: click o apertura entro la finestra di attribuzione. */
export interface AttributionTouch {
  id: DocId;
  contactId: DocId;
  email: string;
  source: SendSource;
  newsletterId?: DocId | null;
  automationId?: DocId | null;
  automationRunId?: DocId | null;
  variantId?: string | null;
  touchType: 'open' | 'click';
  url?: string | null;
  occurredAt: IsoDate;
  /** Ordine a cui il tocco è stato attribuito, se già consumato. */
  attributedOrderId?: DocId | null;
}

export interface OrderAttribution {
  model: AttributionModel;
  /** Peso 0-1 assegnato alla newsletter/automazione. */
  weight: number;
  newsletterId?: DocId | null;
  automationId?: DocId | null;
  automationRunId?: DocId | null;
  variantId?: string | null;
  touchId?: DocId | null;
  touchAt?: IsoDate | null;
  /** Ore trascorse fra il tocco e l'ordine. */
  hoursToConversion?: number | null;
  couponCode?: string | null;
  utm?: UtmParams | null;
  attributedRevenue: number;
  attributedAt: IsoDate;
}

/** Configurazione dell'attribuzione. */
export interface AttributionSettings {
  model: AttributionModel;
  /** Giorni entro cui un click può essere attribuito. */
  clickWindowDays: number;
  /** Giorni entro cui un'apertura può essere attribuita (di norma più corta). */
  openWindowDays: number;
  /** Il codice coupon batte sempre gli altri segnali. */
  couponOverridesModel: boolean;
  /** Considera solo gli ordini in questi stati. */
  countStatuses: string[];
  /** Sottrai i resi dal fatturato attribuito. */
  subtractRefunds: boolean;
}

export const DEFAULT_ATTRIBUTION_SETTINGS: AttributionSettings = {
  model: 'last_click',
  clickWindowDays: 7,
  openWindowDays: 2,
  couponOverridesModel: true,
  countStatuses: ['paid', 'processing', 'shipped', 'completed'],
  subtractRefunds: true,
};
