/**
 * Documentazione eseguibile della riscrittura dei link e del tracciamento.
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
import { createHmac } from 'node:crypto';

import render from '../../lib/render/index.js';

const { appendUtm, clickSignaturePayload, injectOpenPixel, isTrackableUrl, rewriteLinks, wrapTrackedLink } = render;

const utm = { source: 'newsletter', medium: 'email', campaign: 'toner-settembre' };
const tracking = {
  ref: 'n:nl_123:A',
  contactId: 'ct_789',
  secret: 'segreto-di-test',
  appUrl: 'https://newsletter.alphaink.net',
};

/** Ricalcola la firma come farà l'endpoint `/t/c` che riceve il click. */
function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

test('appendUtm aggiunge i parametri mancanti senza toccare quelli già presenti', () => {
  assert.equal(
    appendUtm('https://alphaink.net/toner', utm),
    'https://alphaink.net/toner?utm_source=newsletter&utm_medium=email&utm_campaign=toner-settembre',
  );
  // `utm_source` c'è già: resta quello scritto dall'utente.
  assert.equal(
    appendUtm('https://alphaink.net/toner?utm_source=volantino&id=3', utm),
    'https://alphaink.net/toner?utm_source=volantino&id=3&utm_medium=email&utm_campaign=toner-settembre',
  );
  // Il frammento resta in coda alla query.
  assert.equal(
    appendUtm('https://alphaink.net/p#recensioni', { source: 'newsletter' }),
    'https://alphaink.net/p?utm_source=newsletter#recensioni',
  );
});

test('non sono tracciabili mailto, tel, ancore, URL relativi e merge tag non risolti', () => {
  assert.equal(isTrackableUrl('https://alphaink.net'), true);
  assert.equal(isTrackableUrl('mailto:info@alphaink.net'), false);
  assert.equal(isTrackableUrl('tel:+390212345678'), false);
  assert.equal(isTrackableUrl('#top'), false);
  assert.equal(isTrackableUrl('/carrello'), false);
  assert.equal(isTrackableUrl('{{order.recoveryUrl}}'), false);
  assert.equal(isTrackableUrl('javascript:alert(1)'), false);
});

test('il link tracciato è firmato e verificabile', () => {
  const url = 'https://alphaink.net/carrello?id=9&x=1';
  const tracked = wrapTrackedLink(url, tracking);
  assert.ok(tracked.startsWith('https://newsletter.alphaink.net/t/c?u='));

  const query = new URL(tracked).searchParams;
  const encoded = query.get('u');
  assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), url);
  assert.equal(query.get('r'), tracking.ref);
  assert.equal(query.get('c'), tracking.contactId);
  assert.equal(query.get('s'), hmac(clickSignaturePayload(encoded, tracking.ref, tracking.contactId), tracking.secret));

  // Sostituire la destinazione invalida la firma: il redirector rifiuterà il click.
  const ostile = Buffer.from('https://sito-ostile.example', 'utf8').toString('base64url');
  assert.notEqual(
    query.get('s'),
    hmac(clickSignaturePayload(ostile, tracking.ref, tracking.contactId), tracking.secret),
  );
});

test('rewriteLinks riscrive solo i link cliccabili', () => {
  const html =
    '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" /></head>' +
    '<body><a href="https://alphaink.net/toner?id=1&amp;q=2">Toner</a>' +
    '<a href="mailto:info@alphaink.net">Scrivici</a>' +
    '<a href="#top">Su</a>' +
    '<a href="{{system.unsubscribeUrl}}">Disiscriviti</a></body>';

  const { html: out, links } = rewriteLinks(html, { utm, tracking });

  // Il foglio di stile dei font non va toccato: si romperebbe e conterebbe come click.
  assert.match(out, /href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter"/);
  // mailto, ancore e merge tag non risolti restano identici.
  assert.match(out, /href="mailto:info@alphaink\.net"/);
  assert.match(out, /href="#top"/);
  assert.match(out, /href="\{\{system\.unsubscribeUrl\}\}"/);
  // Il solo link vero passa dal redirector.
  assert.match(out, /href="https:\/\/newsletter\.alphaink\.net\/t\/c\?u=/);
  assert.deepEqual(links, [
    'https://alphaink.net/toner?id=1&q=2&utm_source=newsletter&utm_medium=email&utm_campaign=toner-settembre',
  ]);
});

test('gli URL della web app già firmati non passano dal redirector', () => {
  const html = '<a href="https://newsletter.alphaink.net/u/abc123">Disiscriviti</a>';
  const { html: out, links } = rewriteLinks(html, { utm, tracking });
  assert.equal(out, html);
  assert.deepEqual(links, []);
});

test("l'entità &amp; è decodificata prima della firma e ricodificata dopo", () => {
  const { html: out } = rewriteLinks('<a href="https://alphaink.net/p?a=1&amp;b=2">X</a>', { tracking });
  const href = /href="([^"]+)"/.exec(out)[1];
  const encoded = new URL(href.replace(/&amp;/g, '&')).searchParams.get('u');
  assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), 'https://alphaink.net/p?a=1&b=2');
});

test('il pixel di apertura è inserito prima di </body>', () => {
  const out = injectOpenPixel('<html><body><p>Ciao</p></body></html>', tracking);
  assert.match(out, /<img src="https:\/\/newsletter\.alphaink\.net\/t\/o\?r=[^"]*" alt="" width="1" height="1"/);
  assert.ok(out.indexOf('/t/o?r=') < out.indexOf('</body>'));
});
