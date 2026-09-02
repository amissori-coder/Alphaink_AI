/**
 * Documentazione eseguibile della pipeline completa.
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

import shared from '@alphaink/shared';
import render from '../../lib/render/index.js';

const { DEFAULT_GLOBAL_STYLES, DEFAULT_TYPOGRAPHY, spacing } = shared;
const { buildEmail, validateDocument } = render;

function documentWith(blocks) {
  return {
    version: 1,
    globalStyles: { ...DEFAULT_GLOBAL_STYLES },
    sections: [
      {
        id: 'sec1',
        columns: [
          { id: 'col1', span: 12, blocks, verticalAlign: 'top', backgroundColor: null, padding: spacing(0) },
        ],
        fullWidthBackgroundColor: null,
        backgroundColor: null,
        backgroundImage: null,
        padding: spacing(24),
        stackOnMobile: true,
        border: null,
      },
    ],
  };
}

function block(id, content) {
  return {
    id,
    type: content.type,
    content,
    style: { padding: spacing(16), backgroundColor: null, border: null, align: 'left' },
  };
}

const unsubscribeBlock = block('u1', {
  type: 'unsubscribe',
  text: 'Non vuoi più ricevere le nostre email?',
  linkLabel: 'Disiscriviti',
  showPreferencesLink: false,
  typography: { ...DEFAULT_TYPOGRAPHY, fontSize: 12 },
});

test("senza blocco di disiscrizione l'invio è bloccato", () => {
  const warnings = validateDocument(
    documentWith([block('t1', { type: 'text', html: '<p>Ciao</p>', typography: DEFAULT_TYPOGRAPHY })]),
    { subject: 'Novità' },
  );
  const codes = warnings.map((w) => w.code);
  assert.ok(codes.includes('manca_disiscrizione'));
  assert.equal(warnings.find((w) => w.code === 'manca_disiscrizione').severity, 'errore');
});

test("l'oggetto vuoto e un pulsante senza link sono bloccanti", () => {
  const warnings = validateDocument(
    documentWith([
      unsubscribeBlock,
      block('b1', { type: 'button', label: 'Acquista', href: 'javascript:alert(1)', backgroundColor: '#000', textColor: '#fff', fontSize: 16, fontWeight: 700, paddingX: 20, paddingY: 12, borderRadius: 6, fullWidth: false }),
    ]),
    { subject: '   ' },
  );
  const blocking = warnings.filter((w) => w.severity === 'errore').map((w) => w.code);
  assert.ok(blocking.includes('oggetto_vuoto'));
  assert.ok(blocking.includes('link_non_valido'));
});

test('buildEmail produce HTML, testo e link di destinazione', () => {
  const result = buildEmail({
    document: documentWith([
      block('h1', { type: 'heading', text: 'Ciao {{contact.firstName}}', level: 1, typography: DEFAULT_TYPOGRAPHY }),
      block('b1', {
        type: 'button',
        label: 'Vai al negozio',
        href: 'https://alphaink.net/toner',
        backgroundColor: '#00AEEF',
        textColor: '#FFFFFF',
        fontSize: 16,
        fontWeight: 700,
        paddingX: 24,
        paddingY: 14,
        borderRadius: 8,
        fullWidth: false,
      }),
      unsubscribeBlock,
    ]),
    context: {
      subject: 'Offerta toner',
      preheader: 'Sconti fino al 30%',
      contact: { email: 'mario@example.it', firstName: 'Mario' },
      urls: { unsubscribeUrl: 'https://newsletter.alphaink.net/u/abc' },
    },
    tracking: {
      clickTracking: true,
      openTracking: true,
      ref: 'n:nl_1:A',
      contactId: 'ct_1',
      secret: 'segreto',
      appUrl: 'https://newsletter.alphaink.net',
      utm: { source: 'newsletter', medium: 'email', campaign: 'offerta-toner' },
    },
  });

  assert.equal(result.blocking, false);
  // Merge tag risolti e nessun segnaposto residuo.
  assert.match(result.html, /Ciao Mario/);
  assert.ok(!result.html.includes('{{'));
  // Pulsante bulletproof: VML per Outlook + tabella per tutti gli altri.
  assert.match(result.html, /<v:roundrect/);
  assert.match(result.html, /<!--\[if !mso\]><!-->/);
  // Struttura del documento.
  assert.match(result.html, /max-width:600px/);
  assert.match(result.html, /@media only screen and \(max-width:600px\)/);
  assert.match(result.html, /prefers-color-scheme: dark/);
  assert.match(result.html, /\[data-ogsc\]/);
  // Tracciamento.
  assert.deepEqual(result.links, [
    'https://alphaink.net/toner?utm_source=newsletter&utm_medium=email&utm_campaign=offerta-toner',
  ]);
  assert.match(result.html, /\/t\/o\?r=/);
  // Versione testuale.
  assert.match(result.text, /Ciao Mario/);
  assert.match(result.text, /Vai al negozio/);
});

test('il documento vuoto è bloccante e non produce testo', () => {
  const result = buildEmail({ document: documentWith([]), context: { subject: 'Vuota' } });
  assert.equal(result.blocking, true);
  assert.ok(result.warnings.some((w) => w.code === 'documento_vuoto'));
});
