/**
 * Documentazione eseguibile della ripartizione lineare del fatturato.
 *
 * Il difetto che questi test presidiano: nel modello `linear` ogni tocco
 * produceva la propria conversione e i contatori venivano incrementati una volta
 * per tocco. Tre click sulla stessa newsletter le facevano contare **tre
 * ordini** invece di uno, e la riconciliazione oraria — che conta i destinatari
 * — diceva il contrario dei contatori.
 *
 * La regola verificata qui: un ordine è un ordine. I pesi lo **ripartiscono**
 * fra gli invii coinvolti, non lo moltiplicano, e la somma delle quote di
 * fatturato è esattamente il valore attribuibile.
 *
 *   npm run build:functions
 *   cd functions && node --test --experimental-strip-types "src/tracking/*.test.ts"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AttributionTouch, OrderAttribution } from '@alphaink/shared';

// `lib/firestore` inizializza l'SDK Admin al primo import: senza
// `FIREBASE_CONFIG` fallisce sul bucket di Storage. Qui si esercitano solo
// funzioni pure, Firestore non viene mai interrogato.
process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-alphaink-test';
process.env.FIREBASE_CONFIG ??= JSON.stringify({
  projectId: 'demo-alphaink-test',
  storageBucket: 'demo-alphaink-test.appspot.com',
});

const { distributeAmount, groupByTarget, selectTouches } = await import(
  '../../lib/tracking/attribution.js'
);

function touch(id: string, newsletterId: string | null, occurredAt: string): AttributionTouch {
  return {
    id,
    contactId: 'ct_1',
    email: 'cliente@example.com',
    source: 'newsletter',
    newsletterId,
    automationId: null,
    automationRunId: null,
    variantId: null,
    touchType: 'click',
    url: 'https://alphaink.net/toner',
    occurredAt,
  };
}

function attribution(
  newsletterId: string | null,
  weight: number,
  attributedRevenue: number,
  extra: Partial<OrderAttribution> = {},
): OrderAttribution {
  return {
    model: 'linear',
    weight,
    newsletterId,
    automationId: null,
    automationRunId: null,
    variantId: null,
    touchId: null,
    touchAt: '2026-02-01T10:00:00.000Z',
    hoursToConversion: 1,
    couponCode: null,
    utm: null,
    attributedRevenue,
    attributedAt: '2026-02-01T11:00:00.000Z',
    ...extra,
  };
}

/** Somma dei pesi e degli ordini prodotti da un gruppo di attribuzioni. */
function totals(attributions: OrderAttribution[]): { orders: number; revenue: number } {
  const targets = groupByTarget(attributions);
  return {
    orders: Math.round(targets.reduce((sum, t) => sum + t.weight, 0) * 10_000) / 10_000,
    revenue: Math.round(targets.reduce((sum, t) => sum + t.revenue, 0) * 100) / 100,
  };
}

test('tre click sulla stessa newsletter valgono un ordine, non tre', () => {
  const selection = selectTouches(
    'linear',
    [
      touch('tc_1', 'nl_A', '2026-02-01T09:00:00.000Z'),
      touch('tc_2', 'nl_A', '2026-02-01T10:00:00.000Z'),
      touch('tc_3', 'nl_A', '2026-02-01T11:00:00.000Z'),
    ],
    [],
  );
  const shares = distributeAmount(120, selection.weights);
  const attributions = selection.touches.map((t, i) =>
    attribution(t.newsletterId ?? null, selection.weights[i] ?? 1, shares[i] ?? 0),
  );

  // Tre attribuzioni sull'ordine (una per tocco: serve a sapere quali tocchi
  // sono stati consumati), ma una sola destinazione da incrementare.
  assert.equal(attributions.length, 3);
  const targets = groupByTarget(attributions);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.newsletterId, 'nl_A');

  // Il punto del difetto: prima qui arrivavano 3 ordini e 3 × il fatturato.
  assert.equal(targets[0]?.weight, 1);
  assert.equal(targets[0]?.revenue, 120);
});

test('due newsletter coinvolte si dividono lo stesso ordine a metà', () => {
  const selection = selectTouches(
    'linear',
    [
      touch('tc_1', 'nl_A', '2026-02-01T09:00:00.000Z'),
      touch('tc_2', 'nl_B', '2026-02-01T10:00:00.000Z'),
    ],
    [],
  );
  const shares = distributeAmount(100, selection.weights);
  const attributions = selection.touches.map((t, i) =>
    attribution(t.newsletterId ?? null, selection.weights[i] ?? 1, shares[i] ?? 0),
  );

  const targets = groupByTarget(attributions);
  assert.equal(targets.length, 2);
  for (const target of targets) {
    assert.equal(target.weight, 0.5);
    assert.equal(target.revenue, 50);
  }
  assert.deepEqual(totals(attributions), { orders: 1, revenue: 100 });
});

test('quote miste: due click su una newsletter e uno su un altra', () => {
  const selection = selectTouches(
    'linear',
    [
      touch('tc_1', 'nl_A', '2026-02-01T09:00:00.000Z'),
      touch('tc_2', 'nl_A', '2026-02-01T10:00:00.000Z'),
      touch('tc_3', 'nl_B', '2026-02-01T11:00:00.000Z'),
    ],
    [],
  );
  const shares = distributeAmount(90, selection.weights);
  const attributions = selection.touches.map((t, i) =>
    attribution(t.newsletterId ?? null, selection.weights[i] ?? 1, shares[i] ?? 0),
  );

  const byId = new Map(groupByTarget(attributions).map((t) => [t.newsletterId, t]));
  // `nl_A` ha due tocchi su tre: due terzi dell'ordine, non due ordini.
  // Il resto dell'arrotondamento va all'ultima quota, cioè al tocco più vecchio
  // (gli elenchi sono ordinati dal più recente), che qui è di `nl_A`.
  assert.equal(byId.get('nl_A')?.weight, 0.6667);
  assert.equal(byId.get('nl_B')?.weight, 0.3333);
  // E la somma resta un ordine intero e il valore intero dell'ordine.
  assert.deepEqual(totals(attributions), { orders: 1, revenue: 90 });
});

test('la somma delle quote è esattamente il valore dell ordine, anche con sette tocchi', () => {
  // Sette tocchi: 0,1429 × 7 = 1,0003. Arrotondando ogni quota per conto suo la
  // newsletter incasserebbe più del valore dell'ordine.
  const clicks = Array.from({ length: 7 }, (_, i) =>
    touch(`tc_${i}`, `nl_${i}`, `2026-02-01T0${i}:00:00.000Z`),
  );
  const selection = selectTouches('linear', clicks, []);
  const shares = distributeAmount(100, selection.weights);

  assert.equal(shares.length, 7);
  assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100, 100);
  assert.equal(selection.weights.reduce((a, b) => a + b, 0), 1);
});

test('le automazioni si raggruppano per esecuzione, non per tocco', () => {
  const attributions = [
    attribution(null, 0.5, 20, { automationId: 'au_1', automationRunId: 'run_9' }),
    attribution(null, 0.5, 20, { automationId: 'au_1', automationRunId: 'run_9' }),
  ];

  const targets = groupByTarget(attributions);
  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.automationId, 'au_1');
  assert.equal(targets[0]?.weight, 1);
  assert.equal(targets[0]?.revenue, 40);
});

test('due esecuzioni diverse della stessa automazione restano distinte', () => {
  const targets = groupByTarget([
    attribution(null, 0.5, 20, { automationId: 'au_1', automationRunId: 'run_1' }),
    attribution(null, 0.5, 20, { automationId: 'au_1', automationRunId: 'run_2' }),
  ]);

  assert.equal(targets.length, 2);
});

test('un attribuzione senza destinazione non tocca nessun contatore', () => {
  // Tocco arrivato da un invio che non porta né newsletter né automazione:
  // non c'è niente da incrementare, e inventare una chiave `-` accumulerebbe
  // ordini su una destinazione inesistente.
  assert.deepEqual(groupByTarget([attribution(null, 1, 50)]), []);
});

test('i click hanno la precedenza sulle aperture nel modello lineare', () => {
  const selection = selectTouches(
    'linear',
    [touch('tc_1', 'nl_A', '2026-02-01T09:00:00.000Z')],
    [{ ...touch('to_1', 'nl_B', '2026-02-01T10:00:00.000Z'), touchType: 'open' }],
  );

  assert.equal(selection.touches.length, 1);
  assert.equal(selection.touches[0]?.id, 'tc_1');
  assert.deepEqual(selection.weights, [1]);
});
