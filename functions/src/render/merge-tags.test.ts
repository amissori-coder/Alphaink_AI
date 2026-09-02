/**
 * Documentazione eseguibile della risoluzione dei merge tag.
 *
 * I test sono esclusi dal build (`tsconfig.json` → `exclude`) e girano sul
 * codice compilato: Node non risolve gli import senza estensione dei sorgenti
 * TypeScript, quindi va eseguito prima `npm run build:functions`.
 *
 *   npm run build:functions
 *   cd functions && node --test --experimental-strip-types "src/render/*.test.ts"
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import render from '../../lib/render/index.js';

const { buildMergeContext, listUnknownTags, resolveMergeTags } = render;

const contact = {
  email: 'mario.rossi@example.it',
  firstName: 'Mario',
  lastName: 'Rossi',
  city: 'Milano',
  stats: {
    ordersCount: 7,
    totalSpent: 412.5,
    averageOrderValue: 58.9,
    lastOrderAt: '2026-07-14T10:00:00.000Z',
  },
  printers: [
    { brand: 'Brother', model: 'HL-L2350DW', detectedFrom: 'order', detectedAt: '2026-01-01T00:00:00.000Z' },
  ],
};

test('sostituisce i valori del contatto e formatta importi e date in italiano', () => {
  const context = buildMergeContext({ contact });
  const html = resolveMergeTags(
    '<p>Ciao {{contact.firstName}}, hai fatto {{contact.ordersCount}} ordini per {{contact.totalSpent}}. Ultimo: {{contact.lastOrderDate}}.</p>',
    context,
  );
  assert.match(html, /Ciao Mario/);
  assert.match(html, /7 ordini/);
  assert.match(html, /412,50/);
  assert.match(html, /14\/07\/2026/);
});

test('usa il fallback del catalogo quando il valore manca', () => {
  // Nessun contatto: `contact.firstName` ripiega sul fallback "Cliente".
  assert.equal(resolveMergeTags('Ciao {{contact.firstName}}!', buildMergeContext()), 'Ciao Cliente!');
});

test('un token sconosciuto diventa stringa vuota e viene segnalato', () => {
  assert.equal(resolveMergeTags('Ciao {{contact.nickname}}!', buildMergeContext({ contact })), 'Ciao !');
  assert.deepEqual(listUnknownTags('Ciao {{contact.nickname}} {{contact.firstName}}'), ['{{contact.nickname}}']);
});

test('gli attributi personalizzati del sito sono esposti come tag del contatto', () => {
  const context = buildMergeContext({ contact: { ...contact, customAttributes: { nickname: 'Ing. Rossi' } } });
  assert.equal(resolveMergeTags('{{contact.nickname}}', context), 'Ing. Rossi');
});

test('i valori sono escapati: un nome ostile non può iniettare markup', () => {
  const context = buildMergeContext({ contact: { ...contact, firstName: '<script>alert(1)</script>' } });
  const html = resolveMergeTags('<p>Ciao {{contact.firstName}}</p>', context);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test("l'elenco prodotti dell'ordine è HTML già pronto", () => {
  const context = buildMergeContext({
    order: {
      orderNumber: 'AI-1042',
      total: 89.9,
      currency: 'EUR',
      placedAt: '2026-08-30T08:00:00.000Z',
      items: [{ sku: 'TN2420', name: 'Toner Brother TN-2420', quantity: 2, unitPrice: 24.9, total: 49.8 }],
    },
  });
  const html = resolveMergeTags('{{order.number}} {{order.itemsList}}', context);
  assert.match(html, /AI-1042/);
  assert.match(html, /<ul[^>]*><li>2 × Toner Brother TN-2420 — 49,80/);
});

test('lo stesso testo può essere risolto più volte senza effetti di stato', () => {
  // `MERGE_TAG_PATTERN` è una regex globale condivisa: la risoluzione deve
  // ripartire ogni volta da `lastIndex` = 0.
  const context = buildMergeContext({ contact });
  const template = '{{contact.firstName}} {{contact.city}}';
  assert.equal(resolveMergeTags(template, context), 'Mario Milano');
  assert.equal(resolveMergeTags(template, context), 'Mario Milano');
});
