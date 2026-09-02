/**
 * Documentazione eseguibile dell'esito di un batch di invio.
 *
 * Il difetto che questi test presidiano: un batch veniva chiuso come `sent`
 * qualunque cosa fosse successo ai suoi destinatari. Con tutti gli invii in
 * errore la coda risultava esaurita senza batch aperti,
 * `finalizeNewsletterIfComplete` portava la newsletter in `sent` — che è uno
 * stato terminale (`ALLOWED_TRANSITIONS.sent = []`) — e l'operatore si ritrovava
 * una spedizione "inviata" che nessuno aveva ricevuto e nessun modo di
 * riprovare.
 *
 *   npm run build:functions
 *   cd functions && node --test --experimental-strip-types "src/newsletters/*.test.ts"
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// `lib/firestore` inizializza l'SDK Admin al primo import: senza
// `FIREBASE_CONFIG` fallisce sul bucket di Storage. Qui si esercitano solo
// funzioni pure, Firestore non viene mai interrogato.
process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-alphaink-test';
process.env.FIREBASE_CONFIG ??= JSON.stringify({
  projectId: 'demo-alphaink-test',
  storageBucket: 'demo-alphaink-test.appspot.com',
});

const { batchOutcome, deliveredSomething } = await import('../../lib/newsletters/sender.js');

test('un batch interamente fallito non si chiude come riuscito', () => {
  // Il caso del difetto: 500 destinatari, nessuna email partita.
  assert.equal(batchOutcome({ sent: 0, failed: 500 }), 'failed');
  assert.equal(batchOutcome({ sent: 0, failed: 1 }), 'failed');
});

test('un batch che ha spedito qualcosa resta riuscito, anche con errori parziali', () => {
  // Il fallimento del singolo destinatario è scritto sul suo documento e non
  // deve bloccare la spedizione: il batch ha fatto il suo lavoro.
  assert.equal(batchOutcome({ sent: 1, failed: 499 }), 'sent');
  assert.equal(batchOutcome({ sent: 500, failed: 0 }), 'sent');
});

test('un batch di soli destinatari saltati è riuscito, non fallito', () => {
  // Contatti disiscritti fra la preparazione e l'invio: non è un guasto di
  // spedizione, e marcare `failed` rimetterebbe il batch in coda all'infinito.
  assert.equal(batchOutcome({ sent: 0, failed: 0 }), 'sent');
});

test('una coda esaurita senza un solo invio riuscito è una spedizione fallita', () => {
  // Nessun batch ha spedito e `stats.requested` è a zero: la newsletter deve
  // finire in `failed`, non nel terminale `sent`.
  assert.equal(deliveredSomething({ sent: 0 }, 0), false);
});

test('basta una delle due fonti a dire che qualcosa è partito', () => {
  // I contatori dei batch possono essere riscritti da una rilavorazione;
  // `stats.requested` è cumulativo e non torna indietro. Ne basta una.
  assert.equal(deliveredSomething({ sent: 3, failed: 0 } as { sent: number }, 0), true);
  assert.equal(deliveredSomething({ sent: 0 }, 3), true);
  assert.equal(deliveredSomething({ sent: 3 }, 3), true);
});
