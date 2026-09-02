/**
 * Valutazione in memoria dell'albero di regole di un cluster.
 *
 * Il modulo è volutamente **puro**: nessun accesso a Firestore, nessuna data
 * implicita (l'istante di riferimento arriva da `ctx.now`). Questo lo rende
 * testabile e riutilizzabile sia dal motore dei cluster sia dal filtro di
 * pubblico delle automazioni.
 *
 * Regole semantiche adottate (documentate perché non deducibili dai tipi):
 *  - un gruppo senza condizioni e senza sottogruppi vale `true` (nessun filtro);
 *    con `negate` diventa quindi `false`;
 *  - i confronti fra stringhe sono case-insensitive e ignorano gli spazi
 *    esterni: l'operatore in UI è pensato per testo scritto a mano;
 *  - un valore assente (`null`/`undefined`) non soddisfa nessun confronto
 *    tranne `is_empty` e `not_*`;
 *  - i campi multivalore (tag, cluster, famiglie acquistate, stampanti) usano
 *    `eq` con il significato di "contiene".
 */

import { extractPrinterBrand, normalizeEmail } from '@alphaink/shared';
import type {
  Contact,
  FilterCombinator,
  FilterCondition,
  FilterOperator,
  FilterValue,
} from '@alphaink/shared';

/**
 * Versione "larga" delle regole: il campo è una stringa qualsiasi.
 *
 * Serve perché lo schema zod condiviso (`filterGroupSchema`) valida `field`
 * come stringa libera — la UI può filtrare anche su attributi non ancora
 * previsti da `FilterField`. `FilterGroup` resta assegnabile a `RuleGroup`.
 */
export interface RuleCondition extends Omit<FilterCondition, 'field'> {
  field: string;
}

export interface RuleGroup {
  id: string;
  combinator: FilterCombinator;
  conditions: RuleCondition[];
  groups: RuleGroup[];
  negate?: boolean;
}

const DAY_MS = 86_400_000;

// -----------------------------------------------------------------------------
// Contesto di valutazione
// -----------------------------------------------------------------------------

/** Ordine ridotto ai soli campi che interessano ai filtri d'acquisto. */
export interface EvaluationOrder {
  contactId?: string | null;
  emailNormalized?: string | null;
  email?: string | null;
  skus?: string[] | null;
  families?: string[] | null;
  items?: Array<{ sku?: string | null; name?: string | null; brand?: string | null }> | null;
  placedAt?: string | null;
}

/** Fatti d'acquisto aggregati di un contatto. */
export interface PurchaseFacts {
  skus: string[];
  brands: string[];
  families: string[];
}

export const EMPTY_PURCHASE_FACTS: PurchaseFacts = { skus: [], brands: [], families: [] };

/**
 * Contesto passato ad ogni valutazione.
 *
 * `purchasesByContact` / `purchasesByEmail` sono popolate dal motore solo
 * quando le regole usano davvero `purchasedSku` o `purchasedBrand`: caricare
 * gli ordini di ogni contatto ha un costo e va evitato quando è inutile.
 */
export interface EvaluationContext {
  /** Istante di riferimento (epoch ms) per gli operatori temporali. */
  now: number;
  purchasesByContact?: ReadonlyMap<string, PurchaseFacts>;
  purchasesByEmail?: ReadonlyMap<string, PurchaseFacts>;
}

export function createEvaluationContext(now: number = Date.now()): EvaluationContext {
  return { now };
}

/** Aggrega gli ordini di un contatto nei fatti usati dai filtri. */
export function buildPurchaseFacts(orders: readonly EvaluationOrder[]): PurchaseFacts {
  const skus = new Set<string>();
  const brands = new Set<string>();
  const families = new Set<string>();

  for (const order of orders) {
    for (const sku of order.skus ?? []) {
      if (sku) skus.add(sku.trim());
    }
    for (const family of order.families ?? []) {
      if (family) families.add(family.trim());
    }
    for (const item of order.items ?? []) {
      if (item.sku) skus.add(item.sku.trim());
      // La marca esplicita vince; altrimenti la si deduce dal nome prodotto.
      const brand = item.brand?.trim() || (item.name ? extractPrinterBrand(item.name) : null);
      if (brand) brands.add(brand);
    }
  }

  return {
    skus: Array.from(skus),
    brands: Array.from(brands),
    families: Array.from(families),
  };
}

/** Indicizza gli ordini per contatto ed email, pronti per la valutazione. */
export function buildEvaluationContext(
  orders: readonly EvaluationOrder[],
  now: number = Date.now(),
): EvaluationContext {
  const byContact = new Map<string, EvaluationOrder[]>();
  const byEmail = new Map<string, EvaluationOrder[]>();

  for (const order of orders) {
    if (order.contactId) {
      const list = byContact.get(order.contactId) ?? [];
      list.push(order);
      byContact.set(order.contactId, list);
    }
    const email = order.emailNormalized ?? (order.email ? normalizeEmail(order.email) : null);
    if (email) {
      const list = byEmail.get(email) ?? [];
      list.push(order);
      byEmail.set(email, list);
    }
  }

  const factsByContact = new Map<string, PurchaseFacts>();
  for (const [id, list] of byContact) factsByContact.set(id, buildPurchaseFacts(list));
  const factsByEmail = new Map<string, PurchaseFacts>();
  for (const [email, list] of byEmail) factsByEmail.set(email, buildPurchaseFacts(list));

  return { now, purchasesByContact: factsByContact, purchasesByEmail: factsByEmail };
}

/** Fatti d'acquisto del contatto, o l'oggetto vuoto se non caricati. */
export function purchaseFactsFor(contact: Contact, ctx: EvaluationContext): PurchaseFacts {
  const byId = contact.id ? ctx.purchasesByContact?.get(contact.id) : undefined;
  if (byId) return byId;
  const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
  return (email ? ctx.purchasesByEmail?.get(email) : undefined) ?? EMPTY_PURCHASE_FACTS;
}

// -----------------------------------------------------------------------------
// Risoluzione dei campi
// -----------------------------------------------------------------------------

type FieldKind = 'string' | 'number' | 'date' | 'boolean' | 'array' | 'unknown';

interface ResolvedField {
  kind: FieldKind;
  value: unknown;
}

/** Campi il cui valore è una data ISO. */
const DATE_FIELDS = new Set<string>([
  'createdAt',
  'updatedAt',
  'optInAt',
  'optOutAt',
  'lastSyncAt',
  'stats.firstOrderAt',
  'stats.lastOrderAt',
  'engagement.lastOpenedAt',
  'engagement.lastClickedAt',
  'engagement.lastSentAt',
]);

/** Campi numerici. */
const NUMBER_FIELDS = new Set<string>([
  'stats.ordersCount',
  'stats.totalSpent',
  'stats.averageOrderValue',
  'stats.averageDaysBetweenOrders',
  'engagement.engagementScore',
  'engagement.sent',
  'engagement.delivered',
  'engagement.opened',
  'engagement.clicked',
  'engagement.bounced',
  'engagement.complaints',
]);

/** Campi multivalore. */
const ARRAY_FIELDS = new Set<string>([
  'tags',
  'clusterIds',
  'purchasedFamily',
  'purchasedSku',
  'purchasedBrand',
  'printerBrand',
  'printerModel',
  'sources',
]);

/** Legge un percorso puntato dentro un oggetto. */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Famiglie effettivamente acquistate secondo le statistiche del contatto. */
function familiesFromStats(contact: Contact): string[] {
  const byFamily = contact.stats?.ordersByFamily ?? {};
  return Object.entries(byFamily)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([family]) => family);
}

/**
 * Risolve il valore di un campo sul contatto.
 * I campi non previsti dal contratto vengono cercati come percorso puntato sul
 * documento: permette di filtrare su attributi aggiunti in futuro senza
 * modificare il motore.
 */
export function resolveField(
  field: string,
  contact: Contact,
  ctx: EvaluationContext,
  condition?: Pick<RuleCondition, 'attributeKey'>,
): ResolvedField {
  switch (field) {
    case 'email':
      return { kind: 'string', value: contact.emailNormalized || normalizeEmail(contact.email ?? '') };
    case 'purchasedFamily': {
      const facts = purchaseFactsFor(contact, ctx);
      const merged = new Set<string>([...familiesFromStats(contact), ...facts.families]);
      return { kind: 'array', value: Array.from(merged) };
    }
    case 'purchasedSku':
      return { kind: 'array', value: purchaseFactsFor(contact, ctx).skus };
    case 'purchasedBrand':
      return { kind: 'array', value: purchaseFactsFor(contact, ctx).brands };
    case 'printerBrand':
      return { kind: 'array', value: (contact.printers ?? []).map((printer) => printer.brand) };
    case 'printerModel':
      return { kind: 'array', value: (contact.printers ?? []).map((printer) => printer.model) };
    case 'clusterIds':
      // Un cluster "contiene" il contatto sia per assegnazione manuale sia per regola.
      return {
        kind: 'array',
        value: [...(contact.clusterIds ?? []), ...(contact.dynamicClusterIds ?? [])],
      };
    case 'customAttribute': {
      const key = condition?.attributeKey?.trim();
      if (!key) return { kind: 'unknown', value: null };
      const value = contact.customAttributes?.[key];
      return { kind: inferKind(value), value: value ?? null };
    }
    default:
      break;
  }

  const raw = readPath(contact, field);
  if (DATE_FIELDS.has(field)) return { kind: 'date', value: raw ?? null };
  if (NUMBER_FIELDS.has(field)) return { kind: 'number', value: raw ?? null };
  if (ARRAY_FIELDS.has(field)) return { kind: 'array', value: Array.isArray(raw) ? raw : [] };
  if (Array.isArray(raw)) return { kind: 'array', value: raw };
  return { kind: inferKind(raw), value: raw ?? null };
}

function inferKind(value: unknown): FieldKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  return 'unknown';
}

// -----------------------------------------------------------------------------
// Conversioni e confronti
// -----------------------------------------------------------------------------

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function normText(value: unknown): string | null {
  const text = asText(value);
  return text === null ? null : text.trim().toLowerCase();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asTimestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = normText(value);
  if (text === 'true' || text === 'si' || text === 'sì' || text === '1') return true;
  if (text === 'false' || text === 'no' || text === '0') return false;
  return null;
}

/** Normalizza il valore atteso in un elenco (accetta anche stringhe separate da virgola). */
function asList(value: FilterValue | undefined): Array<string | number> {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === 'number') return [value];
  if (typeof value === 'boolean') return [String(value)];
  return [];
}

function isEmptyValue(resolved: ResolvedField): boolean {
  const { value } = resolved;
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

/** Confronto ordinato: restituisce `null` se i valori non sono confrontabili. */
function compareScalar(resolved: ResolvedField, expected: FilterValue | undefined): number | null {
  if (resolved.kind === 'date') {
    const actual = asTimestamp(resolved.value);
    const target = asTimestamp(expected);
    if (actual === null || target === null) return null;
    return actual - target;
  }
  if (resolved.kind === 'number') {
    const actual = asNumber(resolved.value);
    const target = asNumber(expected);
    if (actual === null || target === null) return null;
    return actual - target;
  }
  // Fallback: prima si tenta il confronto numerico, poi quello testuale.
  const actualNumber = asNumber(resolved.value);
  const targetNumber = asNumber(expected);
  if (actualNumber !== null && targetNumber !== null) return actualNumber - targetNumber;
  const actualText = normText(resolved.value);
  const targetText = normText(expected);
  if (actualText === null || targetText === null) return null;
  return actualText.localeCompare(targetText);
}

/** Valori dell'elenco normalizzati per il confronto testuale. */
function normalizedList(value: FilterValue | undefined): string[] {
  return asList(value)
    .map((entry) => normText(entry))
    .filter((entry): entry is string => entry !== null);
}

function arrayValues(resolved: ResolvedField): string[] {
  if (!Array.isArray(resolved.value)) return [];
  return resolved.value
    .map((entry) => normText(entry))
    .filter((entry): entry is string => entry !== null);
}

// -----------------------------------------------------------------------------
// Operatori
// -----------------------------------------------------------------------------

function evaluateArrayOperator(
  operator: FilterOperator,
  resolved: ResolvedField,
  condition: RuleCondition,
): boolean {
  const values = arrayValues(resolved);
  const expected = normText(condition.value);
  const expectedList = normalizedList(condition.value);

  switch (operator) {
    case 'eq':
      return expected !== null && values.includes(expected);
    case 'neq':
      return expected === null || !values.includes(expected);
    case 'contains':
      return expected !== null && values.some((entry) => entry.includes(expected));
    case 'not_contains':
      return expected === null || !values.some((entry) => entry.includes(expected));
    case 'starts_with':
      return expected !== null && values.some((entry) => entry.startsWith(expected));
    case 'ends_with':
      return expected !== null && values.some((entry) => entry.endsWith(expected));
    case 'in':
      return expectedList.some((entry) => values.includes(entry));
    case 'not_in':
      return !expectedList.some((entry) => values.includes(entry));
    case 'is_empty':
      return values.length === 0;
    case 'is_not_empty':
      return values.length > 0;
    default:
      // gt/lt/between/temporali non hanno senso su un elenco.
      return false;
  }
}

function evaluateScalarOperator(
  operator: FilterOperator,
  resolved: ResolvedField,
  condition: RuleCondition,
  ctx: EvaluationContext,
): boolean {
  switch (operator) {
    case 'eq': {
      if (resolved.kind === 'boolean') {
        const target = asBoolean(condition.value);
        return target !== null && asBoolean(resolved.value) === target;
      }
      const comparison = compareScalar(resolved, condition.value);
      return comparison === 0;
    }
    case 'neq': {
      if (resolved.kind === 'boolean') {
        const target = asBoolean(condition.value);
        return target === null || asBoolean(resolved.value) !== target;
      }
      const comparison = compareScalar(resolved, condition.value);
      // Un valore assente è "diverso" da qualsiasi valore richiesto.
      if (comparison === null) return isEmptyValue(resolved);
      return comparison !== 0;
    }
    case 'gt': {
      const comparison = compareScalar(resolved, condition.value);
      return comparison !== null && comparison > 0;
    }
    case 'gte': {
      const comparison = compareScalar(resolved, condition.value);
      return comparison !== null && comparison >= 0;
    }
    case 'lt': {
      const comparison = compareScalar(resolved, condition.value);
      return comparison !== null && comparison < 0;
    }
    case 'lte': {
      const comparison = compareScalar(resolved, condition.value);
      return comparison !== null && comparison <= 0;
    }
    case 'contains': {
      const actual = normText(resolved.value);
      const expected = normText(condition.value);
      return actual !== null && expected !== null && actual.includes(expected);
    }
    case 'not_contains': {
      const actual = normText(resolved.value);
      const expected = normText(condition.value);
      if (expected === null) return true;
      return actual === null || !actual.includes(expected);
    }
    case 'starts_with': {
      const actual = normText(resolved.value);
      const expected = normText(condition.value);
      return actual !== null && expected !== null && actual.startsWith(expected);
    }
    case 'ends_with': {
      const actual = normText(resolved.value);
      const expected = normText(condition.value);
      return actual !== null && expected !== null && actual.endsWith(expected);
    }
    case 'in': {
      const actual = normText(resolved.value);
      return actual !== null && normalizedList(condition.value).includes(actual);
    }
    case 'not_in': {
      const actual = normText(resolved.value);
      if (actual === null) return true;
      return !normalizedList(condition.value).includes(actual);
    }
    case 'is_empty':
      return isEmptyValue(resolved);
    case 'is_not_empty':
      return !isEmptyValue(resolved);
    case 'within_last_days': {
      const timestamp = asTimestamp(resolved.value);
      const days = asNumber(condition.value);
      if (timestamp === null || days === null) return false;
      return timestamp >= ctx.now - days * DAY_MS;
    }
    case 'before_last_days': {
      const timestamp = asTimestamp(resolved.value);
      const days = asNumber(condition.value);
      // Un contatto senza data (mai acquistato, mai aperto) NON soddisfa la
      // condizione: "da più di N giorni" presuppone che l'evento sia avvenuto.
      if (timestamp === null || days === null) return false;
      return timestamp < ctx.now - days * DAY_MS;
    }
    case 'between': {
      const lower = compareScalar(resolved, condition.value);
      const upper = compareScalar(resolved, condition.value2);
      if (lower === null || upper === null) return false;
      return lower >= 0 && upper <= 0;
    }
    default:
      return false;
  }
}

/** Valuta una singola condizione su un contatto. */
export function evaluateCondition(
  condition: RuleCondition,
  contact: Contact,
  ctx: EvaluationContext,
): boolean {
  const resolved = resolveField(condition.field, contact, ctx, condition);
  if (resolved.kind === 'array') {
    return evaluateArrayOperator(condition.operator, resolved, condition);
  }
  return evaluateScalarOperator(condition.operator, resolved, condition, ctx);
}

/**
 * Valuta un gruppo di regole.
 * Un gruppo vuoto vale `true`: senza filtri il cluster comprende tutti.
 */
export function evaluateGroup(
  group: RuleGroup,
  contact: Contact,
  ctx: EvaluationContext,
): boolean {
  const conditions = group.conditions ?? [];
  const groups = group.groups ?? [];
  if (conditions.length === 0 && groups.length === 0) {
    return group.negate ? false : true;
  }

  const isAnd = group.combinator !== 'or';
  let result: boolean;

  if (isAnd) {
    result =
      conditions.every((condition) => evaluateCondition(condition, contact, ctx)) &&
      groups.every((child) => evaluateGroup(child, contact, ctx));
  } else {
    result =
      conditions.some((condition) => evaluateCondition(condition, contact, ctx)) ||
      groups.some((child) => evaluateGroup(child, contact, ctx));
  }

  return group.negate ? !result : result;
}

/** Scorciatoia: regole assenti significano "tutti i contatti". */
export function matchesRules(
  rules: RuleGroup | null | undefined,
  contact: Contact,
  ctx: EvaluationContext,
): boolean {
  if (!rules) return true;
  return evaluateGroup(rules, contact, ctx);
}

// -----------------------------------------------------------------------------
// Introspezione dell'albero
// -----------------------------------------------------------------------------

/** Tutte le condizioni dell'albero, in ordine di visita. */
export function collectConditions(group: RuleGroup | null | undefined): RuleCondition[] {
  if (!group) return [];
  const out: RuleCondition[] = [...(group.conditions ?? [])];
  for (const child of group.groups ?? []) out.push(...collectConditions(child));
  return out;
}

/** Campi citati dalle regole: usato dal pianificatore e dalla UI. */
export function collectFields(group: RuleGroup | null | undefined): string[] {
  return Array.from(new Set(collectConditions(group).map((condition) => condition.field)));
}

/**
 * Vero se la valutazione richiede gli ordini del contatto.
 * `purchasedFamily` non compare: è già coperto da `stats.ordersByFamily`.
 */
export function groupNeedsPurchaseFacts(group: RuleGroup | null | undefined): boolean {
  return collectConditions(group).some(
    (condition) => condition.field === 'purchasedSku' || condition.field === 'purchasedBrand',
  );
}

/** Numero totale di condizioni: usato per i warning di "regola troppo generica". */
export function countConditions(group: RuleGroup | null | undefined): number {
  return collectConditions(group).length;
}
