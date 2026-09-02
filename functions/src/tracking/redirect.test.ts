/**
 * Documentazione eseguibile del redirector di click `/t/c`.
 *
 * Il difetto che questi test presidiano: la destinazione veniva presa dalla
 * query (`?u=<base64>`) e servita così com'era. Chiunque poteva quindi
 * fabbricare un link su un dominio AlphaInk che rimbalzava su una pagina di
 * phishing — un open redirect — perché la firma copriva solo la registrazione
 * dell'evento, non la navigazione.
 *
 * La regola verificata qui è duplice e va tenuta insieme:
 *  1. la destinazione è confrontata con l'elenco dei domini aziendali SEMPRE,
 *     firmata o no;
 *  2. una firma mancante o sbagliata non trasforma un link legittimo in una
 *     pagina d'errore: si reindirizza lo stesso, senza registrare nulla.
 *
 * I test sono esclusi dal build (`tsconfig.json` → `exclude`) e girano sul
 * codice compilato:
 *
 *   npm run build:functions
 *   cd functions && node --test --experimental-strip-types "src/tracking/*.test.ts"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

// L'SDK Admin va configurato prima di caricare il modulo: `lib/firestore`
// inizializza l'app al primo import e senza `FIREBASE_CONFIG` fallisce sul
// bucket di Storage. Nessuno di questi test tocca davvero Firestore.
process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-alphaink-test';
process.env.FIREBASE_CONFIG ??= JSON.stringify({
  projectId: 'demo-alphaink-test',
  storageBucket: 'demo-alphaink-test.appspot.com',
});
process.env.LINK_SIGNING_KEY ??= 'segreto-di-test';

const redirect = await import('../../lib/tracking/redirect.js');
const { allowedDestination, primeRedirectAllowlist, trackClick } = redirect;

const SECRET = process.env.LINK_SIGNING_KEY as string;

/**
 * Elenco dei domini ammessi iniettato a mano.
 *
 * `allowedHosts()` lo ricava da tre documenti di impostazioni: senza emulatore
 * ogni chiamata aspetterebbe i ritentativi di gRPC (oltre due minuti) prima di
 * ripiegare sui default. Prefissando la cache i test restano istantanei e
 * l'elenco è esplicito, quindi leggibile.
 */
function withAllowlist(): void {
  // Chiamata in modo tollerante di proposito: se un domani il seam sparisse, a
  // fallire dovrebbe essere l'asserzione sul comportamento del redirector (dove
  // manda il visitatore), non l'assenza di una funzione di supporto.
  primeRedirectAllowlist?.(['alphaink.net', 'newsletter.alphaink.net']);
}

/** Firma come la calcola chi costruisce il link (`clickSignaturePayload`). */
function signClick(encoded: string, ref: string, contactId: string): string {
  return createHmac('sha256', SECRET).update(`${encoded}|${ref}|${contactId}`).digest('base64url');
}

function encode(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url');
}

/** Risposta Express ridotta all'osso: registra solo ciò che i test guardano. */
interface FakeResponse {
  statusCode: number;
  redirectedTo: string | null;
  body: string | null;
  headersSent: boolean;
  status(code: number): FakeResponse;
  set(name: string, value: string): FakeResponse;
  send(body: string): FakeResponse;
  redirect(code: number, url: string): FakeResponse;
  end(): FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res = {
    statusCode: 200,
    redirectedTo: null as string | null,
    body: null as string | null,
    headersSent: false,
  } as FakeResponse;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.set = () => res;
  res.send = (body: string) => {
    res.body = body;
    res.headersSent = true;
    return res;
  };
  res.redirect = (code: number, url: string) => {
    res.statusCode = code;
    res.redirectedTo = url;
    res.headersSent = true;
    return res;
  };
  res.end = () => {
    res.headersSent = true;
    return res;
  };
  return res;
}

function fakeRequest(query: Record<string, string>): unknown {
  return {
    method: 'GET',
    query,
    headers: {},
    ip: '203.0.113.5',
    socket: {},
    get: () => undefined,
  };
}

type Handler = (req: unknown, res: unknown) => Promise<void>;

/**
 * Esegue il redirector zittendo i log.
 *
 * Ogni click rifiutato produce un `log.warn` strutturato su stdout: legittimo in
 * produzione, illeggibile in mezzo all'output dei test.
 */
async function click(query: Record<string, string>): Promise<FakeResponse> {
  const res = fakeResponse();
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    await (trackClick as unknown as Handler)(fakeRequest(query), res);
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
  return res;
}

test('un link senza firma non porta su un dominio arbitrario', async () => {
  withAllowlist();
  const res = await click({ u: encode('https://evil.tld/phishing') });

  // Il punto del difetto: prima si rispondeva 302 verso evil.tld.
  assert.equal(res.redirectedTo, null);
  assert.equal(res.statusCode, 400);
  assert.match(res.body ?? '', /Link non valido/);
});

test('una firma sbagliata non basta a portare su un dominio arbitrario', async () => {
  withAllowlist();
  const encoded = encode('https://evil.tld/phishing');
  const res = await click({ u: encoded, r: 'n:nl_1', c: 'ct_1', s: signClick(encoded, 'n:nl_1', 'ALTRO') });

  assert.equal(res.redirectedTo, null);
  assert.equal(res.statusCode, 400);
});

test('un link senza firma verso un dominio aziendale reindirizza comunque', async () => {
  withAllowlist();
  // La regola di esperienza utente: chiave ruotata o query troncata non devono
  // trasformare un link legittimo in una pagina d'errore. Cade la
  // registrazione dell'evento, non la navigazione.
  const res = await click({ u: encode('https://alphaink.net/toner?id=9') });

  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, 'https://alphaink.net/toner?id=9');
});

test('un click firmato correttamente reindirizza', async () => {
  withAllowlist();
  const url = 'https://newsletter.alphaink.net/promo';
  const encoded = encode(url);
  // Ref di invio di prova (`t:`): il redirector esce prima di scrivere su
  // Firestore, così il test resta un test unitario.
  const ref = 't:nl_9';
  const res = await click({ u: encoded, r: ref, c: 'ct_7', s: signClick(encoded, ref, 'ct_7') });

  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, url);
});

test('una firma valida su un riferimento illeggibile non fa cadere il redirect', async () => {
  withAllowlist();
  const url = 'https://alphaink.net/toner';
  const encoded = encode(url);
  // `parseSendRef` non riconosce il prefisso `z`: la firma è valida ma il
  // riferimento no. Il click non è registrabile, la navigazione sì.
  const ref = 'z:qualcosa';
  const res = await click({ u: encoded, r: ref, c: 'ct_7', s: signClick(encoded, ref, 'ct_7') });

  assert.equal(res.statusCode, 302);
  assert.equal(res.redirectedTo, url);
});

test('sottodomini ammessi sì, domini che ci somigliano no', async () => {
  withAllowlist();

  assert.equal(await allowedDestination('https://shop.alphaink.net/p'), 'https://shop.alphaink.net/p');
  assert.equal(await allowedDestination('https://www.alphaink.net/p'), 'https://www.alphaink.net/p');
  // Il confronto per suffisso deve cadere su un punto: `alphaink.net.evil.tld`
  // e `notalphaink.net` sono domini di terzi.
  assert.equal(await allowedDestination('https://alphaink.net.evil.tld/p'), null);
  assert.equal(await allowedDestination('https://notalphaink.net/p'), null);
});

test('solo http(s) assoluti: niente javascript, dati o protocol-relative', async () => {
  withAllowlist();

  assert.equal(await allowedDestination('javascript:alert(1)'), null);
  assert.equal(await allowedDestination('data:text/html,<script>0</script>'), null);
  // `//evil.tld/x` non è un URL assoluto per `new URL`, ma il browser lo
  // risolverebbe come tale: deve essere rifiutato qui.
  assert.equal(await allowedDestination('//evil.tld/x'), null);
  assert.equal(await allowedDestination('/carrello'), null);
});

test('una destinazione illeggibile non porta da nessuna parte', async () => {
  withAllowlist();

  // `u` che non è base64url di un URL valido.
  const res = await click({ u: 'non-e-base64-di-un-url' });
  assert.equal(res.redirectedTo, null);
  assert.equal(res.statusCode, 400);

  // Nessun `u` affatto.
  const senzaUrl = await click({ r: 'n:nl_1', c: 'ct_1' });
  assert.equal(senzaUrl.redirectedTo, null);
  assert.equal(senzaUrl.statusCode, 400);
});
