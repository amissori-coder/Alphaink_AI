/**
 * Pianificatore di query per il motore dei cluster.
 *
 * L'obiettivo è ridurre il numero di documenti letti da Firestore spingendo nel
 * `where` le condizioni che il database sa valutare, lasciando in memoria tutto
 * il resto (il "residuo").
 *
 * Limiti di Firestore che il piano rispetta:
 *  - **un solo campo di range** per query (`<`, `<=`, `>`, `>=`): il secondo
 *    range va valutato in memoria;
 *  - **un solo `array-contains`** per query e un solo `array-contains-any`;
 *  - `in` / `not-in` accettano al massimo 30 valori;
 *  - se c'è un range, il primo `orderBy` deve essere sul campo del range;
 *  - `!=` e `not-in` **escludono** i documenti privi del campo, mentre il
 *    valutatore in memoria li considera "diversi": non vengono mai spinti;
 *  - i confronti sono case-sensitive, quindi si spingono solo i campi con
 *    valori canonici (enum, id, email normalizzata, numeri, date ISO).
 *
 * Invariante di correttezza: **una condizione può essere spinta solo se il
 * vincolo generato è una rilassatura (o l'equivalente) della condizione**, cioè
 * non può scartare documenti che la valutazione in memoria accetterebbe. Quando
 * l'equivalenza non è esatta il vincolo resta comunque nel `residual`.
 */

import { normalizeEmail } from '@alphaink/shared';
import type { RuleCondition, RuleGroup } from './evaluator';

const DAY_MS = 86_400_000;

/** Operatori Firestore usati dal piano (sottoinsieme di `WhereFilterOp`). */
export type PlannedOperator =
  | '=='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'array-contains'
  | 'array-contains-any';

export interface PlannedConstraint {
  /** Percorso del campo sul documento `contacts`. */
  field: string;
  operator: PlannedOperator;
  value: unknown;
  /** Condizione da cui nasce il vincolo. */
  conditionId: string;
  /**
   * `true` se il vincolo è **esattamente** equivalente alla condizione: solo in
   * questo caso la condizione può sparire dal residuo.
   */
  exact: boolean;
}

export interface QueryPlan {
  constraints: PlannedConstraint[];
  /** Regole ancora da valutare in memoria; `null` se il piano copre tutto. */
  residual: RuleGroup | null;
  /**
   * Campo su cui ordinare la scansione. Firestore impone che il primo
   * `orderBy` coincida con il campo del range, quando presente.
   */
  orderByField: string | null;
  /** Spiegazioni leggibili di cosa non è stato spinto e perché. */
  notes: string[];
}

/** Massimo numero di valori accettati da `in` (limite Firestore). */
export const MAX_IN_VALUES = 30;

/** Tetto prudenziale al numero di vincoli spinti in una singola query. */
export const MAX_CONSTRAINTS = 8;

/** Campi con valori canonici: il confronto case-sensitive è sicuro. */
const CANONICAL_EQUALITY_FIELDS: Record<string, string> = {
  email: 'emailNormalized',
  status: 'status',
  segment: 'segment',
  source: 'source',
  'engagement.engagementTier': 'engagement.engagementTier',
};

/** Campi numerici indicizzati su cui è sicuro spingere confronti d'ordine. */
const NUMERIC_FIELDS = new Set<string>([
  'stats.ordersCount',
  'stats.totalSpent',
  'stats.averageOrderValue',
  'stats.averageDaysBetweenOrders',
  'engagement.engagementScore',
  'engagement.sent',
  'engagement.delivered',
  'engagement.opened',
  'engagement.clicked',
]);

/** Campi data (stringhe ISO-8601 UTC: l'ordine lessicografico è cronologico). */
const DATE_FIELDS = new Set<string>([
  'createdAt',
  'stats.firstOrderAt',
  'stats.lastOrderAt',
  'engagement.lastOpenedAt',
  'engagement.lastClickedAt',
]);

const RANGE_OPERATORS: PlannedOperator[] = ['<', '<=', '>', '>='];

function isRange(operator: PlannedOperator): boolean {
  return RANGE_OPERATORS.includes(operator);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry)))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * Traduce una condizione in un vincolo Firestore, se possibile.
 * `now` serve agli operatori temporali relativi.
 */
export function constraintFor(
  condition: RuleCondition,
  now: number,
): PlannedConstraint | null {
  const { field, operator } = condition;
  const base = { conditionId: condition.id };

  // --- uguaglianze su campi canonici -----------------------------------------
  const canonical = CANONICAL_EQUALITY_FIELDS[field];
  if (canonical) {
    const single = typeof condition.value === 'string' ? condition.value.trim() : condition.value;
    if (operator === 'eq' && typeof single === 'string' && single.length > 0) {
      const value = field === 'email' ? normalizeEmail(single) : single;
      return { ...base, field: canonical, operator: '==', value, exact: true };
    }
    if (operator === 'in') {
      const values = asStringList(condition.value).map((entry) =>
        field === 'email' ? normalizeEmail(entry) : entry,
      );
      if (values.length > 0 && values.length <= MAX_IN_VALUES) {
        return { ...base, field: canonical, operator: 'in', value: values, exact: true };
      }
    }
    return null;
  }

  // --- confronti numerici -----------------------------------------------------
  if (NUMERIC_FIELDS.has(field)) {
    const value = asNumber(condition.value);
    if (value === null) return null;
    switch (operator) {
      case 'eq':
        return { ...base, field, operator: '==', value, exact: true };
      case 'gt':
        return { ...base, field, operator: '>', value, exact: true };
      case 'gte':
        return { ...base, field, operator: '>=', value, exact: true };
      // Su `<` e `<=` i documenti con campo `null` rientrano nell'ordinamento
      // Firestore (null precede i numeri) ma il valutatore li scarta: il
      // vincolo è una rilassatura, la condizione resta nel residuo.
      case 'lt':
        return { ...base, field, operator: '<', value, exact: false };
      case 'lte':
        return { ...base, field, operator: '<=', value, exact: false };
      case 'between': {
        const upper = asNumber(condition.value2);
        if (upper === null) return null;
        return { ...base, field, operator: '>=', value, exact: false };
      }
      default:
        return null;
    }
  }

  // --- confronti temporali ----------------------------------------------------
  if (DATE_FIELDS.has(field)) {
    switch (operator) {
      case 'within_last_days': {
        const days = asNumber(condition.value);
        if (days === null) return null;
        const threshold = new Date(now - days * DAY_MS).toISOString();
        return { ...base, field, operator: '>=', value: threshold, exact: true };
      }
      case 'before_last_days': {
        const days = asNumber(condition.value);
        if (days === null) return null;
        const threshold = new Date(now - days * DAY_MS).toISOString();
        // I documenti senza data verrebbero inclusi dall'ordinamento Firestore:
        // il residuo li elimina.
        return { ...base, field, operator: '<', value: threshold, exact: false };
      }
      case 'gt':
      case 'gte': {
        const iso = asIsoDate(condition.value);
        if (iso === null) return null;
        return { ...base, field, operator: operator === 'gt' ? '>' : '>=', value: iso, exact: true };
      }
      case 'lt':
      case 'lte': {
        const iso = asIsoDate(condition.value);
        if (iso === null) return null;
        return { ...base, field, operator: operator === 'lt' ? '<' : '<=', value: iso, exact: false };
      }
      case 'between': {
        const lower = asIsoDate(condition.value);
        const upper = asIsoDate(condition.value2);
        if (lower === null || upper === null) return null;
        return { ...base, field, operator: '>=', value: lower, exact: false };
      }
      case 'is_not_empty':
        // Qualsiasi data è "maggiore" della stringa vuota: filtra i null.
        return { ...base, field, operator: '>=', value: '', exact: true };
      default:
        return null;
    }
  }

  return null;
}

/**
 * Raccoglie le condizioni collegate in AND alla radice.
 * Un sottogruppo in AND non negato è equivalente a spianare le sue condizioni
 * (l'AND è associativo); gruppi in OR o negati restano solo nel residuo.
 */
function collectAndConditions(group: RuleGroup): RuleCondition[] {
  if (group.negate || group.combinator === 'or') return [];
  const out: RuleCondition[] = [...(group.conditions ?? [])];
  for (const child of group.groups ?? []) out.push(...collectAndConditions(child));
  return out;
}

/** Rimuove dall'albero le condizioni già coperte in modo esatto dalla query. */
function pruneGroup(group: RuleGroup, removed: ReadonlySet<string>): RuleGroup | null {
  const conditions = (group.conditions ?? []).filter((condition) => !removed.has(condition.id));
  const groups = (group.groups ?? [])
    .map((child) => pruneGroup(child, removed))
    .filter((child): child is RuleGroup => child !== null);

  if (conditions.length === 0 && groups.length === 0) {
    // Un gruppo negato e ormai vuoto cambierebbe il risultato: si conserva.
    return group.negate ? { ...group, conditions: [], groups: [] } : null;
  }
  return { ...group, conditions, groups };
}

/**
 * Costruisce il piano di esecuzione per un albero di regole.
 * Restituisce i vincoli da applicare alla query Firestore e il residuo da
 * valutare in memoria con `evaluateGroup`.
 */
export function planQuery(
  group: RuleGroup | null | undefined,
  now: number = Date.now(),
): QueryPlan {
  if (!group) {
    return { constraints: [], residual: null, orderByField: null, notes: [] };
  }

  const notes: string[] = [];
  const candidates = collectAndConditions(group);
  if (candidates.length === 0) {
    notes.push('Nessuna condizione in AND alla radice: la scansione non può essere ristretta.');
    return { constraints: [], residual: group, orderByField: null, notes };
  }

  const constraints: PlannedConstraint[] = [];
  const exactlyPushed = new Set<string>();
  let rangeField: string | null = null;
  let arrayContainsUsed = false;
  const usedFields = new Set<string>();

  for (const condition of candidates) {
    if (constraints.length >= MAX_CONSTRAINTS) {
      notes.push(`Limite di ${MAX_CONSTRAINTS} vincoli raggiunto: le regole restanti sono valutate in memoria.`);
      break;
    }

    const constraint = constraintFor(condition, now);
    if (!constraint) continue;

    if (isRange(constraint.operator)) {
      if (rangeField !== null && rangeField !== constraint.field) {
        notes.push(
          `Firestore ammette un solo campo di range per query: "${constraint.field}" è valutato in memoria (range già usato da "${rangeField}").`,
        );
        continue;
      }
      rangeField = constraint.field;
    }

    if (constraint.operator === 'array-contains' || constraint.operator === 'array-contains-any') {
      if (arrayContainsUsed) {
        notes.push(`Un solo "array-contains" per query: "${constraint.field}" resta in memoria.`);
        continue;
      }
      arrayContainsUsed = true;
    }

    // Due uguaglianze sullo stesso campo si escludono a vicenda: la seconda
    // renderebbe la query sempre vuota, meglio valutarla in memoria.
    const equalityKey = `${constraint.field}:${constraint.operator}`;
    if (!isRange(constraint.operator) && usedFields.has(equalityKey)) {
      notes.push(`Condizione duplicata su "${constraint.field}": valutata in memoria.`);
      continue;
    }
    usedFields.add(equalityKey);

    constraints.push(constraint);
    if (constraint.exact) exactlyPushed.add(constraint.conditionId);
  }

  const residual = exactlyPushed.size > 0 ? pruneGroup(group, exactlyPushed) : group;

  return {
    constraints,
    residual,
    orderByField: rangeField,
    notes,
  };
}

/** Descrizione leggibile del piano, utile nei log e nella UI di anteprima. */
export function describePlan(plan: QueryPlan): string {
  if (plan.constraints.length === 0) return 'Scansione completa dei contatti';
  return plan.constraints
    .map((constraint) => `${constraint.field} ${constraint.operator} ${JSON.stringify(constraint.value)}`)
    .join(' AND ');
}
