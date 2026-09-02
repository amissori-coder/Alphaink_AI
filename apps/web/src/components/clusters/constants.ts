import {
  ALPHAINK_PALETTE,
  CLUSTER_TYPE_LABELS,
  ENGAGEMENT_TIER_LABELS,
  OPERATOR_LABELS,
  PRODUCT_FAMILIES,
  PRODUCT_FAMILY_LABELS,
  SITE_SOURCES,
  SITE_SOURCE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  randomId,
} from '@alphaink/shared';
import type {
  ClusterType,
  EngagementTier,
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  SubscriptionStatus,
} from '@alphaink/shared';

import type { FieldDefinition, FieldGroupId, FieldKind, SuggestedCluster } from './types';

/** Rotte dell'area cluster: unica fonte di verità per i link interni. */
export const ROUTES = {
  list: '/cluster',
  create: '/cluster/nuovo',
  detail: (id: string): string => `/cluster/${id}`,
  contacts: '/contatti',
  newsletterCreate: '/newsletter/nuova',
} as const;

/** Tetto della sottoscrizione in tempo reale all'elenco dei cluster. */
export const CLUSTER_FETCH_LIMIT = 300;

/** Millisecondi di attesa prima di rilanciare l'anteprima mentre si digita. */
export const PREVIEW_DEBOUNCE_MS = 700;

/** Contatti mostrati nel campione dell'anteprima. */
export const PREVIEW_SAMPLE_SIZE = 25;

/** Profondità massima dei gruppi annidati, allineata allo schema condiviso. */
export const MAX_GROUP_DEPTH = 4;

/** Condizioni massime per gruppo, allineate allo schema condiviso. */
export const MAX_CONDITIONS_PER_GROUP = 50;

export const CLUSTER_TYPE_OPTIONS = (
  ['dynamic', 'static', 'site_group', 'brevo_list'] as ClusterType[]
).map((type) => ({ value: type, label: CLUSTER_TYPE_LABELS[type] }));

/** Descrizione di ciascun tipo, mostrata sotto il selettore. */
export const CLUSTER_TYPE_HINTS: Record<ClusterType, string> = {
  dynamic:
    'I contatti entrano ed escono da soli in base alle regole: il cluster resta sempre aggiornato.',
  static:
    'Elenco fisso di contatti scelti a mano o aggiunti da un import: cambia solo se lo modifichi tu.',
  site_group:
    'Rispecchia un gruppo cliente di PrestaShop (es. "Rivenditori"): l’appartenenza arriva dal sito.',
  brevo_list: 'Rispecchia una lista già esistente su Brevo, identificata dal suo id numerico.',
};

/** Colori proposti per i nuovi cluster. */
export const CLUSTER_COLORS: string[] = [
  ALPHAINK_PALETTE.cyan,
  ALPHAINK_PALETTE.cyanDark,
  ALPHAINK_PALETTE.magenta,
  ALPHAINK_PALETTE.yellow,
  ALPHAINK_PALETTE.success,
  ALPHAINK_PALETTE.danger,
  ALPHAINK_PALETTE.slate,
  ALPHAINK_PALETTE.key,
];

// -----------------------------------------------------------------------------
// Catalogo dei campi filtrabili
// -----------------------------------------------------------------------------

export const FIELD_GROUP_LABELS: Record<FieldGroupId, string> = {
  anagrafica: 'Anagrafica',
  commerciale: 'Commerciale',
  engagement: 'Engagement',
  sistema: 'Sistema',
};

export const FIELD_GROUP_ORDER: FieldGroupId[] = [
  'anagrafica',
  'commerciale',
  'engagement',
  'sistema',
];

const STATUS_VALUES: SubscriptionStatus[] = [
  'subscribed',
  'unsubscribed',
  'pending',
  'bounced',
  'blocked',
  'never_subscribed',
];

const TIER_VALUES: EngagementTier[] = ['hot', 'warm', 'cold', 'dormant', 'unknown'];

/**
 * Descrizione di ogni campo filtrabile: etichetta, gruppo, tipo di valore e
 * valori ammessi. È il contratto fra il costruttore visuale e il motore di
 * valutazione lato Functions (`functions/src/clusters/evaluator.ts`), che
 * risolve i campi con gli stessi identici percorsi.
 */
export const FIELD_DEFINITIONS: FieldDefinition[] = [
  // --- Anagrafica ---
  {
    field: 'email',
    label: 'Email',
    group: 'anagrafica',
    kind: 'text',
    placeholder: 'es. @alphaink.net',
    hint: 'Il confronto avviene sull’indirizzo normalizzato in minuscolo.',
  },
  { field: 'firstName', label: 'Nome', group: 'anagrafica', kind: 'text' },
  { field: 'lastName', label: 'Cognome', group: 'anagrafica', kind: 'text' },
  {
    field: 'company',
    label: 'Azienda',
    group: 'anagrafica',
    kind: 'text',
    placeholder: 'Ragione sociale',
  },
  { field: 'vatNumber', label: 'Partita IVA', group: 'anagrafica', kind: 'text' },
  {
    field: 'segment',
    label: 'Segmento',
    group: 'anagrafica',
    kind: 'enum',
    options: [
      { value: 'b2c', label: 'B2C — privati' },
      { value: 'b2b', label: 'B2B — rivenditori' },
    ],
  },
  {
    field: 'status',
    label: 'Stato di iscrizione',
    group: 'anagrafica',
    kind: 'enum',
    options: STATUS_VALUES.map((status) => ({
      value: status,
      label: SUBSCRIPTION_STATUS_LABELS[status],
    })),
  },
  {
    field: 'source',
    label: 'Sorgente',
    group: 'anagrafica',
    kind: 'enum',
    options: SITE_SOURCES.map((source) => ({ value: source, label: SITE_SOURCE_LABELS[source] })),
  },
  {
    field: 'customerGroup',
    label: 'Gruppo cliente del sito',
    group: 'anagrafica',
    kind: 'text',
    placeholder: 'es. Rivenditori',
  },
  {
    field: 'tags',
    label: 'Etichette',
    group: 'anagrafica',
    kind: 'list',
    hint: '“uguale a” significa “contiene l’etichetta”.',
    placeholder: 'Aggiungi un’etichetta e premi Invio',
  },
  { field: 'country', label: 'Paese', group: 'anagrafica', kind: 'text', placeholder: 'es. IT' },
  { field: 'province', label: 'Provincia', group: 'anagrafica', kind: 'text', placeholder: 'es. MI' },
  { field: 'city', label: 'Città', group: 'anagrafica', kind: 'text' },
  { field: 'postcode', label: 'CAP', group: 'anagrafica', kind: 'text' },
  {
    field: 'language',
    label: 'Lingua',
    group: 'anagrafica',
    kind: 'enum',
    options: [
      { value: 'it', label: 'Italiano' },
      { value: 'en', label: 'Inglese' },
    ],
  },

  // --- Commerciale ---
  {
    field: 'stats.ordersCount',
    label: 'Numero di ordini',
    group: 'commerciale',
    kind: 'number',
    unit: 'ordini',
  },
  {
    field: 'stats.totalSpent',
    label: 'Spesa totale',
    group: 'commerciale',
    kind: 'currency',
    unit: '€',
  },
  {
    field: 'stats.averageOrderValue',
    label: 'Scontrino medio',
    group: 'commerciale',
    kind: 'currency',
    unit: '€',
  },
  { field: 'stats.firstOrderAt', label: 'Primo ordine', group: 'commerciale', kind: 'date' },
  { field: 'stats.lastOrderAt', label: 'Ultimo ordine', group: 'commerciale', kind: 'date' },
  {
    field: 'stats.averageDaysBetweenOrders',
    label: 'Giorni medi fra un ordine e l’altro',
    group: 'commerciale',
    kind: 'number',
    unit: 'giorni',
  },
  {
    field: 'purchasedFamily',
    label: 'Famiglia acquistata',
    group: 'commerciale',
    kind: 'list',
    options: PRODUCT_FAMILIES.map((family) => ({
      value: family,
      label: PRODUCT_FAMILY_LABELS[family],
    })),
    hint: 'Considera tutte le famiglie presenti negli ordini del contatto.',
  },
  {
    field: 'purchasedSku',
    label: 'Codice prodotto acquistato',
    group: 'commerciale',
    kind: 'list',
    placeholder: 'Aggiungi uno SKU e premi Invio',
  },
  {
    field: 'purchasedBrand',
    label: 'Marca acquistata',
    group: 'commerciale',
    kind: 'list',
    placeholder: 'es. HP, Brother, Canon',
  },
  {
    field: 'printerBrand',
    label: 'Marca della stampante posseduta',
    group: 'commerciale',
    kind: 'list',
    placeholder: 'es. HP',
  },
  {
    field: 'printerModel',
    label: 'Modello della stampante posseduta',
    group: 'commerciale',
    kind: 'list',
    placeholder: 'es. LaserJet 1102',
  },

  // --- Engagement ---
  {
    field: 'engagement.engagementScore',
    label: 'Punteggio di engagement',
    group: 'engagement',
    kind: 'number',
    unit: '/100',
  },
  {
    field: 'engagement.engagementTier',
    label: 'Livello di engagement',
    group: 'engagement',
    kind: 'enum',
    options: TIER_VALUES.map((tier) => ({ value: tier, label: ENGAGEMENT_TIER_LABELS[tier] })),
  },
  { field: 'engagement.sent', label: 'Email inviate', group: 'engagement', kind: 'number' },
  { field: 'engagement.delivered', label: 'Email consegnate', group: 'engagement', kind: 'number' },
  { field: 'engagement.opened', label: 'Aperture', group: 'engagement', kind: 'number' },
  { field: 'engagement.clicked', label: 'Click', group: 'engagement', kind: 'number' },
  {
    field: 'engagement.lastOpenedAt',
    label: 'Ultima apertura',
    group: 'engagement',
    kind: 'date',
  },
  {
    field: 'engagement.lastClickedAt',
    label: 'Ultimo click',
    group: 'engagement',
    kind: 'date',
  },

  // --- Sistema ---
  { field: 'createdAt', label: 'Data di creazione', group: 'sistema', kind: 'date' },
  {
    field: 'clusterIds',
    label: 'Appartiene al cluster',
    group: 'sistema',
    kind: 'cluster',
    hint: 'Considera sia le assegnazioni manuali sia quelle calcolate dalle regole.',
  },
  {
    field: 'customAttribute',
    label: 'Attributo personalizzato',
    group: 'sistema',
    kind: 'custom',
    hint: 'Campo libero proveniente dal sito: indica il nome dell’attributo e il valore atteso.',
  },
];

export const FIELD_BY_NAME = new Map<string, FieldDefinition>(
  FIELD_DEFINITIONS.map((definition) => [definition.field, definition]),
);

/** Campo di riserva per condizioni che puntano a percorsi non catalogati. */
export function fieldDefinitionFor(field: string): FieldDefinition {
  return (
    FIELD_BY_NAME.get(field) ?? {
      field: field as FilterField,
      label: field,
      group: 'sistema',
      kind: 'text',
      hint: 'Campo non catalogato: il valore viene letto come percorso sul documento contatto.',
    }
  );
}

// -----------------------------------------------------------------------------
// Operatori ammessi per tipo di campo
// -----------------------------------------------------------------------------

const TEXT_OPERATORS: FilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
];

const ENUM_OPERATORS: FilterOperator[] = ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'];

const NUMBER_OPERATORS: FilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_empty',
  'is_not_empty',
];

const DATE_OPERATORS: FilterOperator[] = [
  'within_last_days',
  'before_last_days',
  'gt',
  'lt',
  'between',
  'is_empty',
  'is_not_empty',
];

const LIST_OPERATORS: FilterOperator[] = [
  'eq',
  'neq',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
];

const CLUSTER_OPERATORS: FilterOperator[] = ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'];

const CUSTOM_OPERATORS: FilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_empty',
  'is_not_empty',
];

export const OPERATORS_BY_KIND: Record<FieldKind, FilterOperator[]> = {
  text: TEXT_OPERATORS,
  enum: ENUM_OPERATORS,
  number: NUMBER_OPERATORS,
  currency: NUMBER_OPERATORS,
  date: DATE_OPERATORS,
  list: LIST_OPERATORS,
  cluster: CLUSTER_OPERATORS,
  custom: CUSTOM_OPERATORS,
};

/**
 * Etichette specializzate: "maggiore di" su una data si legge male, e su un
 * elenco "uguale a" significa in realtà "contiene".
 */
const OPERATOR_LABEL_OVERRIDES: Partial<Record<FieldKind, Partial<Record<FilterOperator, string>>>> =
  {
    date: {
      gt: 'dopo il',
      lt: 'prima del',
      between: 'compreso fra le date',
      is_empty: 'mai avvenuto',
      is_not_empty: 'avvenuto almeno una volta',
    },
    list: {
      eq: 'contiene esattamente',
      neq: 'non contiene',
      in: 'contiene almeno uno fra',
      not_in: 'non contiene nessuno fra',
      contains: 'contiene il testo',
      not_contains: 'non contiene il testo',
      is_empty: 'è vuoto',
      is_not_empty: 'ha almeno un valore',
    },
    cluster: {
      eq: 'è',
      neq: 'non è',
      in: 'è uno fra',
      not_in: 'non è fra',
      is_empty: 'non appartiene a nessun cluster',
      is_not_empty: 'appartiene ad almeno un cluster',
    },
    number: { is_empty: 'non valorizzato', is_not_empty: 'valorizzato' },
    currency: { is_empty: 'non valorizzato', is_not_empty: 'valorizzato' },
  };

export function operatorLabel(operator: FilterOperator, kind: FieldKind): string {
  return OPERATOR_LABEL_OVERRIDES[kind]?.[operator] ?? OPERATOR_LABELS[operator];
}

/** Operatori che non richiedono alcun valore. */
export const VALUELESS_OPERATORS: FilterOperator[] = ['is_empty', 'is_not_empty'];

/** Operatori che accettano un elenco di valori. */
export const MULTI_VALUE_OPERATORS: FilterOperator[] = ['in', 'not_in'];

/** Operatori che richiedono un secondo valore (estremo superiore). */
export const RANGE_OPERATORS: FilterOperator[] = ['between'];

/** Operatori il cui valore è un numero di giorni. */
export const DAY_OPERATORS: FilterOperator[] = ['within_last_days', 'before_last_days'];

// -----------------------------------------------------------------------------
// Fabbriche di regole
// -----------------------------------------------------------------------------

/** Valore iniziale coerente con il tipo del campo e l'operatore scelto. */
export function defaultValueFor(kind: FieldKind, operator: FilterOperator): FilterCondition['value'] {
  if (VALUELESS_OPERATORS.includes(operator)) return null;
  if (MULTI_VALUE_OPERATORS.includes(operator)) return [];
  if (DAY_OPERATORS.includes(operator)) return 30;
  if (kind === 'number' || kind === 'currency') return 0;
  if (kind === 'date') return null;
  return '';
}

export function newCondition(field: FilterField = 'stats.totalSpent'): FilterCondition {
  const definition = fieldDefinitionFor(field);
  const operator = OPERATORS_BY_KIND[definition.kind][0] ?? 'eq';
  return {
    id: `cond_${randomId(8)}`,
    field,
    operator,
    value: defaultValueFor(definition.kind, operator),
  };
}

export function newGroup(combinator: 'and' | 'or' = 'and'): FilterGroup {
  return {
    id: `grp_${randomId(8)}`,
    combinator,
    conditions: [],
    groups: [],
  };
}

/** Albero iniziale di un cluster dinamico: un gruppo AND con una condizione. */
export function newRuleTree(): FilterGroup {
  return { ...newGroup('and'), conditions: [newCondition()] };
}

// -----------------------------------------------------------------------------
// Cluster suggeriti
// -----------------------------------------------------------------------------

function group(combinator: 'and' | 'or', conditions: Array<Omit<FilterCondition, 'id'>>): FilterGroup {
  return {
    ...newGroup(combinator),
    conditions: conditions.map((condition) => ({ ...condition, id: `cond_${randomId(8)}` })),
  };
}

/**
 * Segmenti che AlphaInk usa quasi sempre: si creano con un click e restano
 * modificabili come qualsiasi altro cluster dinamico.
 */
export function suggestedClusters(): SuggestedCluster[] {
  return [
    {
      key: 'toner-60-giorni',
      name: 'Clienti toner ultimi 60 giorni',
      description:
        'Chi ha comprato toner negli ultimi due mesi: pubblico ideale per accessori e offerte sui consumabili compatibili.',
      color: ALPHAINK_PALETTE.cyan,
      rules: group('and', [
        { field: 'purchasedFamily', operator: 'eq', value: 'toner' },
        { field: 'stats.lastOrderAt', operator: 'within_last_days', value: 60 },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
    {
      key: 'mai-acquistato',
      name: 'Mai acquistato',
      description:
        'Iscritti alla newsletter che non hanno ancora fatto un ordine: buon bacino per un primo coupon di benvenuto.',
      color: ALPHAINK_PALETTE.yellow,
      rules: group('and', [
        { field: 'stats.ordersCount', operator: 'lte', value: 0 },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
    {
      key: 'alto-valore-b2b',
      name: 'Alto valore B2B',
      description:
        'Rivenditori con più di 1.000 € di spesa complessiva: da trattare con listini dedicati e comunicazioni riservate.',
      color: ALPHAINK_PALETTE.magenta,
      rules: group('and', [
        { field: 'segment', operator: 'eq', value: 'b2b' },
        { field: 'stats.totalSpent', operator: 'gte', value: 1000 },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
    {
      key: 'da-riattivare',
      name: 'Da riattivare',
      description:
        'Hanno acquistato in passato ma non ordinano da oltre sei mesi e non aprono più le email: candidati a una campagna di recupero.',
      color: ALPHAINK_PALETTE.danger,
      rules: group('and', [
        { field: 'stats.ordersCount', operator: 'gte', value: 1 },
        { field: 'stats.lastOrderAt', operator: 'before_last_days', value: 180 },
        { field: 'engagement.engagementTier', operator: 'in', value: ['cold', 'dormant'] },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
    {
      key: 'molto-attivi',
      name: 'Lettori più attivi',
      description:
        'Aprono e cliccano con costanza: il pubblico giusto per testare nuovi contenuti e chiedere recensioni.',
      color: ALPHAINK_PALETTE.success,
      rules: group('and', [
        { field: 'engagement.engagementTier', operator: 'eq', value: 'hot' },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
    {
      key: 'possessori-stampante',
      name: 'Possessori di stampante',
      description:
        'Contatti per cui conosciamo il modello di stampante: base di partenza per i coupon sui consumabili compatibili.',
      color: ALPHAINK_PALETTE.cyanDark,
      rules: group('and', [
        { field: 'printerModel', operator: 'is_not_empty', value: null },
        { field: 'status', operator: 'eq', value: 'subscribed' },
      ]),
    },
  ];
}
