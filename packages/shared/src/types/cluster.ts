import type { AuditFields, DocId, IsoDate } from './common';

/**
 * Motore di segmentazione.
 *
 * Un cluster è o **dinamico** (definito da un albero di regole valutato ad ogni
 * ricalcolo) o **statico** (elenco esplicito di contatti) o **importato** dal
 * sito (rispecchia un customer group di PrestaShop).
 */
export type ClusterType = 'dynamic' | 'static' | 'site_group' | 'brevo_list';

export const CLUSTER_TYPE_LABELS: Record<ClusterType, string> = {
  dynamic: 'Dinamico (regole)',
  static: 'Statico (elenco fisso)',
  site_group: 'Gruppo cliente del sito',
  brevo_list: 'Lista Brevo',
};

/** Campi filtrabili. Il percorso corrisponde al documento `Contact`. */
export type FilterField =
  // anagrafica
  | 'email' | 'firstName' | 'lastName' | 'company' | 'vatNumber'
  | 'country' | 'province' | 'city' | 'postcode' | 'language'
  | 'segment' | 'customerGroup' | 'source' | 'status' | 'tags'
  // commerciale
  | 'stats.ordersCount' | 'stats.totalSpent' | 'stats.averageOrderValue'
  | 'stats.firstOrderAt' | 'stats.lastOrderAt' | 'stats.averageDaysBetweenOrders'
  | 'purchasedFamily' | 'purchasedSku' | 'purchasedBrand' | 'printerBrand' | 'printerModel'
  // engagement
  | 'engagement.engagementScore' | 'engagement.engagementTier'
  | 'engagement.opened' | 'engagement.clicked' | 'engagement.lastOpenedAt' | 'engagement.lastClickedAt'
  | 'engagement.sent' | 'engagement.delivered'
  // sistema
  | 'createdAt' | 'clusterIds' | 'customAttribute';

export type FilterOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'in' | 'not_in'
  | 'is_empty' | 'is_not_empty'
  // operatori temporali relativi: il valore è un numero di giorni
  | 'within_last_days' | 'before_last_days' | 'between';

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: 'uguale a',
  neq: 'diverso da',
  gt: 'maggiore di',
  gte: 'maggiore o uguale a',
  lt: 'minore di',
  lte: 'minore o uguale a',
  contains: 'contiene',
  not_contains: 'non contiene',
  starts_with: 'inizia con',
  ends_with: 'finisce con',
  in: 'è uno di',
  not_in: 'non è fra',
  is_empty: 'è vuoto',
  is_not_empty: 'non è vuoto',
  within_last_days: 'negli ultimi (giorni)',
  before_last_days: 'da più di (giorni)',
  between: 'compreso fra',
};

export type FilterValue = string | number | boolean | null | Array<string | number>;

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: FilterValue;
  /** Secondo valore, usato solo da `between`. */
  value2?: FilterValue;
  /** Nome dell'attributo custom quando `field === 'customAttribute'`. */
  attributeKey?: string;
}

export type FilterCombinator = 'and' | 'or';

/** Albero di regole ricorsivo: gruppi annidati con AND/OR. */
export interface FilterGroup {
  id: string;
  combinator: FilterCombinator;
  conditions: FilterCondition[];
  groups: FilterGroup[];
  /** Nega l'intero gruppo. */
  negate?: boolean;
}

export interface Cluster extends AuditFields {
  id: DocId;
  name: string;
  description?: string | null;
  type: ClusterType;
  /** Colore usato nel calendario e nei badge. */
  color: string;
  icon?: string | null;

  /** Solo per `type === 'dynamic'`. */
  rules?: FilterGroup | null;
  /** Solo per `type === 'static'`. */
  contactIds?: DocId[];
  /** Solo per `type === 'site_group'`: nome del gruppo cliente su PrestaShop. */
  siteGroupName?: string | null;
  /** Solo per `type === 'brevo_list'`. */
  brevoListId?: number | null;

  /** Numero di contatti al termine dell'ultimo ricalcolo. */
  contactCount: number;
  /** Contatti effettivamente contattabili (status = subscribed). */
  sendableCount: number;
  lastComputedAt?: IsoDate | null;
  computeDurationMs?: number | null;
  computeError?: string | null;

  /** Se true il cluster viene ricalcolato dal job schedulato. */
  autoRefresh: boolean;
  /** Se true viene creata/aggiornata la lista corrispondente su Brevo. */
  syncToBrevo: boolean;
  brevoSyncedAt?: IsoDate | null;

  archived: boolean;
}

/** Risultato dell'anteprima di un cluster prima del salvataggio. */
export interface ClusterPreview {
  matchedCount: number;
  sendableCount: number;
  sample: Array<{ id: DocId; email: string; displayName: string }>;
  /** Warning es. "regola troppo generica", "nessun contatto contattabile". */
  warnings: string[];
}
