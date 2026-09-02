/**
 * Documentazione eseguibile del motore di segmentazione.
 *
 * I test sono esclusi dal build (`tsconfig.json` → `exclude`) e girano sul
 * codice compilato:
 *
 *   npm run build:functions
 *   cd functions && node --test --experimental-strip-types "src/clusters/*.test.ts"
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import evaluator from '../../lib/clusters/evaluator.js';
import planner from '../../lib/clusters/query-planner.js';

const {
  buildEvaluationContext,
  collectFields,
  evaluateCondition,
  evaluateGroup,
  groupNeedsPurchaseFacts,
} = evaluator;
const { planQuery, describePlan } = planner;

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const DAY = 86_400_000;

/** Contatto di prova: un rivenditore B2B con due ordini di toner. */
function contact(overrides = {}) {
  return {
    id: 'ct_1',
    email: 'Mario.Rossi@Example.com',
    emailNormalized: 'mario.rossi@example.com',
    firstName: 'Mario',
    lastName: 'Rossi',
    company: 'Rossi Ufficio',
    source: 'prestashop_b2b',
    sources: ['prestashop_b2b'],
    externalIds: { prestashop_b2b: '42' },
    status: 'subscribed',
    language: 'it',
    country: 'IT',
    province: 'MI',
    city: 'Milano',
    segment: 'b2b',
    customerGroup: 'Rivenditori',
    tags: ['Fedele', 'ufficio'],
    clusterIds: ['cl_manuale'],
    dynamicClusterIds: ['cl_dinamico'],
    stats: {
      ordersCount: 4,
      totalSpent: 780.5,
      averageOrderValue: 195.13,
      firstOrderAt: new Date(NOW - 300 * DAY).toISOString(),
      lastOrderAt: new Date(NOW - 20 * DAY).toISOString(),
      ordersByFamily: { toner: 3, carta: 1, cartucce: 0 },
    },
    engagement: {
      sent: 10,
      delivered: 10,
      opened: 6,
      clicked: 2,
      bounced: 0,
      complaints: 0,
      lastSentAt: new Date(NOW - 5 * DAY).toISOString(),
      lastOpenedAt: new Date(NOW - 6 * DAY).toISOString(),
      lastClickedAt: null,
      engagementScore: 58,
      engagementTier: 'warm',
    },
    printers: [{ brand: 'HP', model: 'LaserJet M404', detectedFrom: 'order', detectedAt: '2026-01-01T00:00:00.000Z' }],
    customAttributes: { agente: 'Bianchi', fido: 2000 },
    createdAt: new Date(NOW - 400 * DAY).toISOString(),
    updatedAt: new Date(NOW - 10 * DAY).toISOString(),
    ...overrides,
  };
}

function cond(field, operator, value, extra = {}) {
  return { id: `c_${field}_${operator}`, field, operator, value, ...extra };
}

function group(conditions, extra = {}) {
  return { id: 'g_root', combinator: 'and', conditions, groups: [], ...extra };
}

const ctx = { now: NOW };

test('confronti testuali: case-insensitive e con trim', () => {
  assert.equal(evaluateCondition(cond('email', 'eq', 'MARIO.ROSSI@example.com '), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('city', 'contains', 'MILA'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('company', 'starts_with', 'rossi'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('customerGroup', 'in', 'Rivenditori, Grossisti'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('province', 'not_in', ['RM', 'TO']), contact(), ctx), true);
});

test('campi numerici e annidati', () => {
  assert.equal(evaluateCondition(cond('stats.ordersCount', 'gte', 4), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('stats.totalSpent', 'gt', 1000), contact(), ctx), false);
  assert.equal(evaluateCondition(cond('stats.totalSpent', 'between', 500, { value2: 900 }), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('engagement.engagementTier', 'eq', 'warm'), contact(), ctx), true);
});

test('operatori temporali relativi', () => {
  assert.equal(evaluateCondition(cond('stats.lastOrderAt', 'within_last_days', 30), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('stats.lastOrderAt', 'within_last_days', 10), contact(), ctx), false);
  assert.equal(evaluateCondition(cond('stats.lastOrderAt', 'before_last_days', 10), contact(), ctx), true);
  // Un contatto senza data non soddisfa "da più di N giorni".
  const mai = contact({ stats: { ordersCount: 0, totalSpent: 0, averageOrderValue: 0, lastOrderAt: null } });
  assert.equal(evaluateCondition(cond('stats.lastOrderAt', 'before_last_days', 10), mai, ctx), false);
  assert.equal(evaluateCondition(cond('stats.lastOrderAt', 'is_empty', null), mai, ctx), true);
});

test('campi multivalore: famiglie, tag, cluster e stampanti', () => {
  assert.equal(evaluateCondition(cond('purchasedFamily', 'eq', 'toner'), contact(), ctx), true);
  // `cartucce` ha zero ordini: non conta come acquistata.
  assert.equal(evaluateCondition(cond('purchasedFamily', 'eq', 'cartucce'), contact(), ctx), false);
  assert.equal(evaluateCondition(cond('tags', 'eq', 'fedele'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('clusterIds', 'eq', 'cl_dinamico'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('printerBrand', 'eq', 'hp'), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('printerModel', 'contains', 'laserjet'), contact(), ctx), true);
});

test('sku e marche acquistate arrivano dagli ordini nel contesto', () => {
  const withOrders = buildEvaluationContext(
    [
      {
        contactId: 'ct_1',
        emailNormalized: 'mario.rossi@example.com',
        skus: ['CE505A'],
        families: ['toner'],
        items: [{ sku: 'CE505A', name: 'Toner HP CE505A per LaserJet P2035' }],
      },
    ],
    NOW,
  );
  assert.equal(evaluateCondition(cond('purchasedSku', 'eq', 'CE505A'), contact(), withOrders), true);
  assert.equal(evaluateCondition(cond('purchasedBrand', 'eq', 'HP'), contact(), withOrders), true);
  // Senza ordini nel contesto il filtro non trova nulla.
  assert.equal(evaluateCondition(cond('purchasedSku', 'eq', 'CE505A'), contact(), ctx), false);
  assert.equal(groupNeedsPurchaseFacts(group([cond('purchasedSku', 'eq', 'CE505A')])), true);
  assert.equal(groupNeedsPurchaseFacts(group([cond('purchasedFamily', 'eq', 'toner')])), false);
});

test('attributi custom', () => {
  assert.equal(evaluateCondition(cond('customAttribute', 'eq', 'Bianchi', { attributeKey: 'agente' }), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('customAttribute', 'gt', 1000, { attributeKey: 'fido' }), contact(), ctx), true);
  assert.equal(evaluateCondition(cond('customAttribute', 'eq', 'x', { attributeKey: 'assente' }), contact(), ctx), false);
});

test('combinatori, gruppi annidati e negazione', () => {
  const and = group([cond('segment', 'eq', 'b2b'), cond('stats.ordersCount', 'gte', 3)]);
  assert.equal(evaluateGroup(and, contact(), ctx), true);

  const or = { ...and, combinator: 'or', conditions: [cond('segment', 'eq', 'b2c'), cond('stats.ordersCount', 'gte', 3)] };
  assert.equal(evaluateGroup(or, contact(), ctx), true);

  const negato = { ...and, negate: true };
  assert.equal(evaluateGroup(negato, contact(), ctx), false);

  const annidato = {
    id: 'g1',
    combinator: 'and',
    conditions: [cond('status', 'eq', 'subscribed')],
    groups: [
      {
        id: 'g2',
        combinator: 'or',
        conditions: [cond('purchasedFamily', 'eq', 'toner'), cond('purchasedFamily', 'eq', 'nastri')],
        groups: [],
      },
    ],
  };
  assert.equal(evaluateGroup(annidato, contact(), ctx), true);

  // Gruppo vuoto: nessun filtro.
  assert.equal(evaluateGroup({ id: 'g0', combinator: 'and', conditions: [], groups: [] }, contact(), ctx), true);
  assert.equal(evaluateGroup({ id: 'g0', combinator: 'and', conditions: [], groups: [], negate: true }, contact(), ctx), false);

  assert.deepEqual(collectFields(annidato), ['status', 'purchasedFamily']);
});

test('il pianificatore spinge le uguaglianze canoniche e un solo range', () => {
  const rules = group([
    cond('status', 'eq', 'subscribed'),
    cond('segment', 'eq', 'b2b'),
    cond('stats.lastOrderAt', 'within_last_days', 90),
    cond('stats.totalSpent', 'gt', 500),
    cond('city', 'contains', 'Milano'),
  ]);
  const plan = planQuery(rules, NOW);

  const fields = plan.constraints.map((c) => `${c.field}${c.operator}`);
  assert.deepEqual(fields, ['status==', 'segment==', 'stats.lastOrderAt>=']);
  assert.equal(plan.orderByField, 'stats.lastOrderAt');
  // Il secondo range e il `contains` restano in memoria.
  const residualFields = plan.residual.conditions.map((c) => c.field);
  assert.deepEqual(residualFields, ['stats.totalSpent', 'city']);
  assert.match(describePlan(plan), /status ==/);
});

test('il pianificatore non spinge nulla da gruppi in OR o negati', () => {
  const rules = { id: 'g', combinator: 'or', conditions: [cond('status', 'eq', 'subscribed')], groups: [] };
  const plan = planQuery(rules, NOW);
  assert.equal(plan.constraints.length, 0);
  assert.equal(plan.residual, rules);
  assert.equal(plan.notes.length, 1);
});

test('i confronti "minore di" restano nel residuo perché includono i valori nulli', () => {
  const rules = group([cond('stats.lastOrderAt', 'before_last_days', 180)]);
  const plan = planQuery(rules, NOW);
  assert.equal(plan.constraints[0].operator, '<');
  assert.equal(plan.constraints[0].exact, false);
  assert.equal(plan.residual.conditions.length, 1);
});
