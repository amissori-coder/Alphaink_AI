import type { AuditFields, DocId, IsoDate } from './common';
import type { FilterGroup } from './cluster';
import type { EmailDocument } from './email';
import type { ProductFamily } from './site';

/**
 * Automazioni richieste da AlphaInk.
 *
 * Ogni automazione è un flusso trigger → attesa → (verifica condizione) → invio,
 * con eventuali step successivi (follow-up). I parametri sono modificabili dalla
 * UI: qui vivono solo i default.
 */
export type AutomationKey =
  | 'coupon_stampante'
  | 'pagamento_abbandonato'
  | 'riacquisto_carta'
  | 'riacquisto_toner_cartucce'
  | 'benvenuto'
  | 'compleanno_cliente'
  | 'win_back';

export const AUTOMATION_KEYS: AutomationKey[] = [
  'coupon_stampante',
  'pagamento_abbandonato',
  'riacquisto_carta',
  'riacquisto_toner_cartucce',
  'benvenuto',
  'compleanno_cliente',
  'win_back',
];

/** Le quattro automazioni obbligatorie richieste dal cliente. */
export const CORE_AUTOMATION_KEYS: AutomationKey[] = [
  'coupon_stampante',
  'pagamento_abbandonato',
  'riacquisto_carta',
  'riacquisto_toner_cartucce',
];

export const AUTOMATION_LABELS: Record<AutomationKey, string> = {
  coupon_stampante: 'Coupon Stampante',
  pagamento_abbandonato: 'Pagamento Abbandonato',
  riacquisto_carta: 'Riacquisto Carta',
  riacquisto_toner_cartucce: 'Riacquisto Toner e Cartucce',
  benvenuto: 'Benvenuto',
  compleanno_cliente: 'Anniversario Cliente',
  win_back: 'Riattivazione (Win-back)',
};

export const AUTOMATION_DESCRIPTIONS: Record<AutomationKey, string> = {
  coupon_stampante:
    'Chi acquista una stampante riceve un coupon dedicato sui consumabili compatibili con il modello acquistato.',
  pagamento_abbandonato:
    'Chi arriva al checkout o crea un ordine senza completare il pagamento riceve un promemoria per concludere l\'acquisto.',
  riacquisto_carta:
    'Chi ha acquistato carta viene ricontattato quando è statisticamente prossimo a esaurirla.',
  riacquisto_toner_cartucce:
    'Chi ha acquistato toner o cartucce viene ricontattato al termine del ciclo di consumo stimato.',
  benvenuto: 'Primo contatto per i nuovi iscritti alla newsletter.',
  compleanno_cliente: 'Email nell\'anniversario del primo ordine.',
  win_back: 'Riattivazione dei clienti inattivi da lungo tempo.',
};

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export type TriggerType =
  /** Un ordine è stato creato/pagato e contiene almeno un prodotto della famiglia indicata. */
  | 'order_placed'
  /** Un ordine è rimasto in stato non pagato oltre la soglia. */
  | 'payment_abandoned'
  /** Un carrello è stato creato e non convertito. */
  | 'cart_abandoned'
  /** È trascorso il tempo di riacquisto stimato dall'ultimo ordine di una famiglia. */
  | 'repurchase_due'
  /** Nuovo contatto iscritto. */
  | 'contact_subscribed'
  /** Anniversario del primo ordine. */
  | 'order_anniversary'
  /** Nessuna attività da N giorni. */
  | 'inactivity';

export interface TriggerConfig {
  type: TriggerType;
  /** Famiglie prodotto che attivano il trigger (per `order_placed` / `repurchase_due`). */
  productFamilies?: ProductFamily[];
  /** SKU o pattern che attivano il trigger (supporta `*`). */
  skuPatterns?: string[];
  /** Percorsi di categoria che attivano il trigger. */
  categoryPaths?: string[];
  /** Valore minimo dell'ordine per attivare il trigger. */
  minOrderTotal?: number | null;
  /** Solo per `inactivity`: giorni senza ordini. */
  inactivityDays?: number | null;
}

/** Unità di ritardo. `1440 ore` = 60 giorni: default per il riacquisto toner/cartucce. */
export type DelayUnit = 'minutes' | 'hours' | 'days';

export const DELAY_UNIT_LABELS: Record<DelayUnit, string> = {
  minutes: 'minuti',
  hours: 'ore',
  days: 'giorni',
};

export interface Delay {
  value: number;
  unit: DelayUnit;
}

export function delayToMinutes(delay: Delay): number {
  switch (delay.unit) {
    case 'minutes': return delay.value;
    case 'hours': return delay.value * 60;
    case 'days': return delay.value * 60 * 24;
  }
}

export function delayToMs(delay: Delay): number {
  return delayToMinutes(delay) * 60_000;
}

/**
 * Condizione di annullamento: se diventa vera fra la programmazione e l'invio,
 * lo step viene cancellato (es. il cliente ha completato il pagamento).
 */
export type CancelCondition =
  | 'order_completed'
  | 'cart_recovered'
  | 'repurchased'
  | 'contact_unsubscribed'
  | 'contact_purchased_any';

export const CANCEL_CONDITION_LABELS: Record<CancelCondition, string> = {
  order_completed: 'Il cliente ha completato l\'ordine',
  cart_recovered: 'Il carrello è stato recuperato',
  repurchased: 'Il cliente ha già riacquistato',
  contact_unsubscribed: 'Il contatto si è disiscritto',
  contact_purchased_any: 'Il contatto ha effettuato un qualsiasi acquisto',
};

/** Coupon generato dall'automazione. */
export interface CouponPolicy {
  enabled: boolean;
  /** Codice unico per destinatario oppure codice condiviso. */
  mode: 'unique_per_contact' | 'shared';
  sharedCode?: string | null;
  prefix: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderTotal?: number | null;
  validForDays: number;
  /** Limita il coupon alle famiglie indicate. */
  restrictToFamilies?: ProductFamily[];
  /** Limita il coupon agli SKU compatibili con la stampante del cliente. */
  restrictToCompatibleSkus?: boolean;
  /** Se true il coupon viene creato anche sul sito tramite adapter. */
  createOnSite: boolean;
}

/** Uno step del flusso: un'email inviata dopo un ritardo. */
export interface AutomationStep {
  id: string;
  name: string;
  enabled: boolean;
  /** Ritardo calcolato dal momento del trigger (non dallo step precedente). */
  delay: Delay;
  subject: string;
  preheader?: string | null;
  /** Documento email dedicato allo step. */
  document?: EmailDocument | null;
  templateId?: DocId | null;
  /** Condizioni che annullano lo step se soddisfatte prima dell'invio. */
  cancelIf: CancelCondition[];
  coupon?: CouponPolicy | null;
  /** Statistiche aggregate dello step. */
  stats: AutomationStepStats;
}

export interface AutomationStepStats {
  scheduled: number;
  sent: number;
  cancelled: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
  orders: number;
  revenue: number;
}

export const EMPTY_STEP_STATS: AutomationStepStats = {
  scheduled: 0, sent: 0, cancelled: 0, delivered: 0, opened: 0,
  clicked: 0, unsubscribed: 0, bounced: 0, orders: 0, revenue: 0,
};

export interface Automation extends AuditFields {
  id: DocId;
  key: AutomationKey;
  name: string;
  description?: string | null;
  enabled: boolean;
  /** Modalità test: gli invii vanno solo agli indirizzi in `testRecipients`. */
  testMode: boolean;
  testRecipients: string[];

  trigger: TriggerConfig;
  steps: AutomationStep[];

  /** Filtro aggiuntivo sul destinatario, valutato al momento dell'invio. */
  audienceFilter?: FilterGroup | null;
  /** Cluster da escludere sempre. */
  excludeClusterIds: DocId[];

  /** Anti-spam: giorni minimi fra due esecuzioni della stessa automazione per contatto. */
  cooldownDays: number;
  /** Massimo di email di questa automazione per contatto in un anno. */
  maxPerContactPerYear?: number | null;
  /** Non inviare fuori da questa fascia oraria locale. */
  quietHours?: { start: string; end: string } | null;
  /** Giorni della settimana consentiti (0 = domenica). */
  allowedWeekdays?: number[];
  /** Limite di invii all'ora per non saturare la reputazione del dominio. */
  maxSendsPerHour?: number | null;

  timezone: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;

  stats: AutomationStats;
  lastRunAt?: IsoDate | null;
  lastErrorAt?: IsoDate | null;
  lastError?: string | null;

  /** Le automazioni core non possono essere eliminate, solo disattivate. */
  isCore: boolean;
}

export interface AutomationStats {
  enrolled: number;
  scheduled: number;
  sent: number;
  cancelled: number;
  delivered: number;
  opened: number;
  clicked: number;
  orders: number;
  revenue: number;
  currency: string;
  updatedAt?: IsoDate | null;
}

export const EMPTY_AUTOMATION_STATS: AutomationStats = {
  enrolled: 0, scheduled: 0, sent: 0, cancelled: 0, delivered: 0,
  opened: 0, clicked: 0, orders: 0, revenue: 0, currency: 'EUR', updatedAt: null,
};

/** Esecuzione programmata: sotto-collezione `automations/{id}/runs`. */
export type AutomationRunStatus =
  | 'scheduled'
  | 'sent'
  | 'cancelled'
  | 'skipped'
  | 'failed';

export interface AutomationRun {
  id: DocId;
  automationId: DocId;
  automationKey: AutomationKey;
  stepId: string;
  contactId: DocId;
  email: string;
  /**
   * Chiave di deduplica: garantisce che lo stesso trigger non generi due invii.
   * Formato: `{automationKey}:{stepId}:{contactId}:{sourceEntityId}`.
   */
  dedupeKey: string;
  /** Entità che ha generato il trigger (ordine, carrello...). */
  sourceType: 'order' | 'cart' | 'contact' | 'schedule';
  sourceId: string;
  status: AutomationRunStatus;
  scheduledFor: IsoDate;
  processedAt?: IsoDate | null;
  sentAt?: IsoDate | null;
  messageId?: string | null;
  cancelledReason?: CancelCondition | 'manual' | 'quiet_hours' | 'cooldown' | 'not_sendable' | null;
  skipReason?: string | null;
  error?: string | null;
  /** Coupon generato per questo invio. */
  couponCode?: string | null;
  couponExpiresAt?: IsoDate | null;
  /** Attribuzione. */
  convertedOrderId?: DocId | null;
  revenue?: number | null;
  /** Snapshot dei dati usati per il merge (prodotti, stampante, totale carrello). */
  context?: Record<string, unknown>;
  createdAt: IsoDate;
}
