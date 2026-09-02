import {
  AUTOMATION_LABELS,
  CANCEL_CONDITION_LABELS,
  CORE_AUTOMATION_KEYS,
  PRODUCT_FAMILIES,
  PRODUCT_FAMILY_LABELS,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationKey,
  CancelCondition,
  CouponPolicy,
  ProductFamily,
  TriggerType,
} from '@alphaink/shared';
import {
  BadgePercent,
  CalendarHeart,
  CreditCard,
  HandHeart,
  Printer,
  RefreshCcw,
  ScrollText,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

/** Icona di ogni automazione: la stessa in elenco, dettaglio e diagramma. */
export const AUTOMATION_ICONS: Record<AutomationKey, LucideIcon> = {
  coupon_stampante: Printer,
  pagamento_abbandonato: CreditCard,
  riacquisto_carta: ScrollText,
  riacquisto_toner_cartucce: RefreshCcw,
  benvenuto: HandHeart,
  compleanno_cliente: CalendarHeart,
  win_back: Sparkles,
};

/** Icona di riserva per chiavi non previste (automazioni create a mano). */
export const FALLBACK_AUTOMATION_ICON: LucideIcon = BadgePercent;

export function automationIcon(key: AutomationKey | string): LucideIcon {
  return AUTOMATION_ICONS[key as AutomationKey] ?? FALLBACK_AUTOMATION_ICON;
}

export function automationLabel(automation: Pick<Automation, 'name' | 'key'>): string {
  return automation.name || AUTOMATION_LABELS[automation.key] || automation.key;
}

// -----------------------------------------------------------------------------
// Trigger
// -----------------------------------------------------------------------------

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  order_placed: 'Ordine effettuato',
  payment_abandoned: 'Pagamento abbandonato',
  cart_abandoned: 'Carrello abbandonato',
  repurchase_due: 'Riacquisto previsto',
  contact_subscribed: 'Nuova iscrizione',
  order_anniversary: 'Anniversario del primo ordine',
  inactivity: 'Inattività prolungata',
};

export const TRIGGER_DESCRIPTIONS: Record<TriggerType, string> = {
  order_placed:
    'Scatta quando un ordine viene registrato e contiene almeno un prodotto delle famiglie indicate.',
  payment_abandoned:
    'Scatta quando un ordine resta senza pagamento oltre la soglia impostata nelle impostazioni del sito.',
  cart_abandoned: 'Scatta quando un carrello viene creato e non si trasforma in ordine.',
  repurchase_due:
    'Scatta quando è trascorso il ciclo di consumo stimato dall’ultimo acquisto della famiglia.',
  contact_subscribed: 'Scatta all’iscrizione di un nuovo contatto alla newsletter.',
  order_anniversary: 'Scatta nell’anniversario del primo ordine del cliente.',
  inactivity: 'Scatta quando il cliente non ordina da più giorni di quelli indicati.',
};

// -----------------------------------------------------------------------------
// Giorni della settimana (0 = domenica, come in `Automation.allowedWeekdays`)
// -----------------------------------------------------------------------------

export interface WeekdayOption {
  value: number;
  label: string;
  short: string;
}

/** Ordinati all'italiana: la settimana comincia di lunedì. */
export const WEEKDAY_OPTIONS: WeekdayOption[] = [
  { value: 1, label: 'Lunedì', short: 'Lun' },
  { value: 2, label: 'Martedì', short: 'Mar' },
  { value: 3, label: 'Mercoledì', short: 'Mer' },
  { value: 4, label: 'Giovedì', short: 'Gio' },
  { value: 5, label: 'Venerdì', short: 'Ven' },
  { value: 6, label: 'Sabato', short: 'Sab' },
  { value: 0, label: 'Domenica', short: 'Dom' },
];

export const ALL_WEEKDAYS: number[] = [0, 1, 2, 3, 4, 5, 6];

/** Fusi orari proposti: l'operatività di AlphaInk è italiana. */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Europe/Rome', label: 'Europa/Roma (Italia)' },
  { value: 'Europe/Lisbon', label: 'Europa/Lisbona' },
  { value: 'Europe/London', label: 'Europa/Londra' },
  { value: 'Europe/Athens', label: 'Europa/Atene' },
  { value: 'UTC', label: 'UTC' },
];

// -----------------------------------------------------------------------------
// Condizioni di annullamento e coupon
// -----------------------------------------------------------------------------

export const CANCEL_CONDITIONS: CancelCondition[] = [
  'order_completed',
  'cart_recovered',
  'repurchased',
  'contact_unsubscribed',
  'contact_purchased_any',
];

export const CANCEL_CONDITION_OPTIONS = CANCEL_CONDITIONS.map((condition) => ({
  value: condition,
  label: CANCEL_CONDITION_LABELS[condition],
}));

export const PRODUCT_FAMILY_OPTIONS = PRODUCT_FAMILIES.map((family: ProductFamily) => ({
  value: family,
  label: PRODUCT_FAMILY_LABELS[family],
}));

export const COUPON_MODE_LABELS: Record<CouponPolicy['mode'], string> = {
  unique_per_contact: 'Codice unico per destinatario',
  shared: 'Codice condiviso',
};

export const DISCOUNT_TYPE_LABELS: Record<CouponPolicy['discountType'], string> = {
  percent: 'Percentuale',
  fixed: 'Importo fisso',
};

/** Politica coupon proposta quando si attiva il coupon su uno step. */
export function defaultCouponPolicy(): CouponPolicy {
  return {
    enabled: true,
    mode: 'unique_per_contact',
    sharedCode: null,
    prefix: 'ALPHA',
    discountType: 'percent',
    discountValue: 10,
    minOrderTotal: null,
    validForDays: 30,
    restrictToFamilies: [],
    restrictToCompatibleSkus: false,
    createOnSite: true,
  };
}

/** Etichetta leggibile dello sconto, usata nei riepiloghi. */
export function discountLabel(coupon: CouponPolicy): string {
  return coupon.discountType === 'percent'
    ? `${coupon.discountValue}%`
    : new Intl.NumberFormat('it-IT', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 2,
      }).format(coupon.discountValue);
}

// -----------------------------------------------------------------------------
// Percorsi, limiti e chiavi di cache
// -----------------------------------------------------------------------------

export const ROUTES = {
  list: '/automazioni',
  detail: (key: string) => `/automazioni/${encodeURIComponent(key)}`,
} as const;

/** Giorni osservati dalle statistiche di elenco e dettaglio. */
export const REPORT_RANGE_DAYS = 30;

/** Invii recenti richiesti nella scheda statistiche. */
export const RECENT_SENDS_LIMIT = 50;

/** Invii recenti richiesti in elenco: servono solo i totali. */
export const LIST_RECENT_LIMIT = 1;

export const MAX_STEPS = 10;
export const MAX_TEST_RECIPIENTS = 10;

export function automationReportKey(automationId: string, days: number, recentLimit: number) {
  return ['automations', 'report', automationId, days, recentLimit] as const;
}

// -----------------------------------------------------------------------------
// Ordinamento
// -----------------------------------------------------------------------------

/** Le quattro automazioni obbligatorie restano in cima, nell'ordine previsto. */
export function sortAutomations<T extends Pick<Automation, 'key' | 'name'>>(rows: T[]): T[] {
  const rank = (key: AutomationKey) => {
    const index = CORE_AUTOMATION_KEYS.indexOf(key);
    return index === -1 ? CORE_AUTOMATION_KEYS.length : index;
  };
  return [...rows].sort(
    (a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name, 'it'),
  );
}

/** True quando l'automazione fa parte delle quattro richieste dal cliente. */
export function isCoreKey(key: AutomationKey): boolean {
  return CORE_AUTOMATION_KEYS.includes(key);
}
