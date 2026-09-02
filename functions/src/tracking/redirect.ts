/**
 * Tracciamento proprietario di click e aperture.
 *
 * Perché non affidarsi solo a Brevo: i suoi eventi di click arrivano con
 * ritardo variabile, non coprono le campagne inviate come transazionali e non
 * portano l'id del nostro contatto. Il redirector firmato invece registra il
 * click nell'istante in cui avviene e sa già a chi appartiene.
 *
 *   GET /t/c?u=<url in base64url>&r=<ref>&c=<contactId>&s=<firma>
 *   GET /t/o?r=<ref>&c=<contactId>&s=<firma>
 *
 * La firma è HMAC-SHA256 (`LINK_SIGNING_KEY`) sul payload `u|r|c` per i click e
 * `r|c` per le aperture: senza di essa chiunque potrebbe fabbricare click e
 * gonfiare le statistiche.
 *
 * DOVE PUÒ PORTARE UN REDIRECT: la firma dice se il click è nostro, non dove è
 * lecito mandare il visitatore. La destinazione viene quindi confrontata con
 * l'elenco dei domini aziendali (`allowedDestination`) **sempre**, firmata o
 * no: senza quel controllo un `?u=<base64>` fabbricato userebbe un dominio
 * AlphaInk come trampolino verso una pagina di phishing (open redirect).
 *
 * REGOLA DI ESPERIENZA UTENTE: una firma non valida **non blocca** il
 * reindirizzamento verso un dominio ammesso. Un link rotto (chiave ruotata,
 * mail inoltrata con la query troncata) non deve trasformarsi in una pagina
 * d'errore: si reindirizza comunque, senza registrare nulla, e si logga
 * l'anomalia. Cade solo la registrazione dell'evento, non la navigazione.
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { normalizeEmail } from '@alphaink/shared';
import type { BrevoEventType, SendSource } from '@alphaink/shared';

import {
  LINK_SIGNING_KEY,
  PRESTASHOP_B2B_BASE_URL,
  PRESTASHOP_B2C_BASE_URL,
  WEBHOOK_RUNTIME,
} from '../lib/config';
import { col, nowIso } from '../lib/firestore';
import { clientIp, detectDevice, sendPixel } from '../lib/http';
import { createLogger } from '../lib/logger';
import { verifySignature } from '../lib/signing';
import { safeUrl } from '../render/html-utils';
import { clickSignaturePayload, openSignaturePayload } from '../render/links';
import { readSiteSettings } from '../sync/settings';
import {
  buildTrackingEvent,
  detectEmailClient,
  detectOs,
  detectProxyOpen,
  parseSendRef,
  saveTrackingEvent,
} from './events';
import type { SendRef, TrackingEventInput } from './events';
import { processEvent } from './processor';
import { publicAppUrl, readBrandingSettings, readTrackingSettings, signingSecret } from './settings';

const log = createLogger('tracking.redirect');

/** URL di ripiego quando il link è illeggibile: la home della web app. */
const FALLBACK_URL = 'https://alphaink.net';

// -----------------------------------------------------------------------------
// Domini di destinazione ammessi
// -----------------------------------------------------------------------------

/**
 * Quanto vive in memoria l'elenco dei domini ammessi. È la strada calda di ogni
 * click: si legge dalle impostazioni una volta ogni tanto, non a ogni richiesta.
 */
const ALLOWLIST_TTL_MS = 300_000;
/** TTL ridotto quando la lettura delle impostazioni è fallita: si riprova prima. */
const ALLOWLIST_RETRY_TTL_MS = 30_000;

let allowlistCache: { hosts: string[]; expiresAt: number } | null = null;

/**
 * Sostituisce l'elenco dei domini ammessi tenuto in cache.
 *
 * Serve ai test per esercitare il redirector senza Firestore: `allowedHosts()`
 * legge tre documenti di impostazioni e senza emulatore ogni click aspetterebbe
 * i ritentativi di gRPC. Con `null` la cache si svuota e la prima richiesta
 * successiva la ricostruisce dalle impostazioni.
 */
export function primeRedirectAllowlist(hosts: string[] | null): void {
  allowlistCache = hosts ? { hosts: [...hosts], expiresAt: Date.now() + ALLOWLIST_TTL_MS } : null;
}

/** Svuota la cache dei domini ammessi (usata dai test). */
export function clearRedirectAllowlistCache(): void {
  primeRedirectAllowlist(null);
}

/** Aggiunge l'host di un URL (o di un dominio nudo) all'elenco. */
function addHost(hosts: Set<string>, value: string | null | undefined): void {
  const raw = String(value ?? '').trim();
  if (!raw) return;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host) hosts.add(host);
  } catch {
    // Valore non interpretabile come dominio: semplicemente non allarga l'elenco.
    log.debug('Dominio ignorato nell\'elenco dei redirect ammessi', { value: raw });
  }
}

/**
 * Domini su cui il redirector accetta di mandare il visitatore: la web app, i
 * negozi (parametri di deploy e `settings/site`), il dominio di tracciamento e
 * i siti del brand configurati in `settings/branding` — compresi i social del
 * footer, che sono a tutti gli effetti destinazioni di un link tracciato.
 */
async function allowedHosts(): Promise<string[]> {
  if (allowlistCache && allowlistCache.expiresAt > Date.now()) return allowlistCache.hosts;

  const hosts = new Set<string>();
  addHost(hosts, FALLBACK_URL);
  addHost(hosts, publicAppUrl());
  // I parametri di deploy valgono anche con Firestore irraggiungibile.
  try {
    addHost(hosts, PRESTASHOP_B2C_BASE_URL.value());
    addHost(hosts, PRESTASHOP_B2B_BASE_URL.value());
  } catch {
    // Parametri non disponibili in questo contesto: restano le altre fonti.
  }

  let complete = true;
  try {
    const site = await readSiteSettings();
    for (const store of Object.values(site.stores)) addHost(hosts, store.baseUrl);
  } catch (error) {
    complete = false;
    log.error('Lettura di settings/site fallita: elenco domini parziale', error);
  }

  const tracking = await readTrackingSettings();
  addHost(hosts, tracking.clickTrackingDomain);

  const branding = await readBrandingSettings();
  addHost(hosts, branding.websiteUrl);
  for (const link of branding.socialLinks ?? []) addHost(hosts, link.url);

  const list = Array.from(hosts);
  allowlistCache = {
    hosts: list,
    expiresAt: Date.now() + (complete ? ALLOWLIST_TTL_MS : ALLOWLIST_RETRY_TTL_MS),
  };
  return list;
}

/**
 * Destinazione utilizzabile, oppure `null`.
 *
 * Deve essere un URL **assoluto** http(s) su un dominio ammesso: `new URL`
 * senza base rifiuta da sé i relativi e i protocol-relative (`//evil.tld`), che
 * il browser risolverebbe invece come assoluti. Si restituisce la forma
 * normalizzata, così nell'header `Location` non finiscono caratteri di
 * controllo presi dalla query.
 */
export async function allowedDestination(destination: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const hosts = await allowedHosts();
  const allowed = hosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
  return allowed ? parsed.toString() : null;
}

function queryValue(req: Request, ...names: string[]): string | null {
  for (const name of names) {
    const value = req.query[name];
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
  }
  return null;
}

/** Contatto associato al click/apertura, per email e engagement. */
async function contactEmail(contactId: string): Promise<string> {
  try {
    const snapshot = await col.contacts().doc(contactId).get();
    return normalizeEmail((snapshot.get('email') as string | undefined) ?? '');
  } catch (error) {
    log.error('Lettura contatto fallita', error, { contactId });
    return '';
  }
}

/** Parte comune dell'evento generato dal nostro tracciamento. */
function baseInput(
  ref: SendRef,
  contactId: string,
  email: string,
  req: Request,
): Omit<TrackingEventInput, 'type'> {
  const userAgent = req.get('user-agent') ?? null;
  const ip = clientIp(req);
  const proxy = detectProxyOpen(userAgent, ip);

  return {
    email,
    source: ref.source,
    occurredAt: nowIso(),
    contactId,
    messageId: null,
    newsletterId: ref.newsletterId,
    variantId: ref.variantId,
    automationId: ref.automationId,
    automationRunId: ref.automationRunId,
    ip,
    userAgent,
    device: detectDevice(userAgent ?? undefined),
    os: detectOs(userAgent),
    emailClient: proxy.client ?? detectEmailClient(userAgent),
    raw: {
      via: 'redirector',
      stepId: ref.stepId,
      referer: req.get('referer') ?? null,
    },
  };
}

/** Registra l'evento e ne avvia l'elaborazione. Non lancia mai. */
async function record(input: TrackingEventInput, source: SendSource): Promise<void> {
  // Gli invii di prova non devono inquinare le statistiche della newsletter.
  if (source === 'test') {
    log.debug('Evento da invio di prova: non registrato', { type: input.type });
    return;
  }
  try {
    const result = await saveTrackingEvent(buildTrackingEvent(input));
    if (result.stored) await processEvent(result.event);
  } catch (error) {
    log.error('Registrazione evento di tracciamento fallita', error, { type: input.type });
  }
}

// -----------------------------------------------------------------------------
// Click
// -----------------------------------------------------------------------------

export const trackClick = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (req: Request, res: Response): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Metodo non consentito.');
      return;
    }

    const encoded = queryValue(req, 'u');
    const refValue = queryValue(req, 'r');
    const contactId = queryValue(req, 'c');
    const signature = queryValue(req, 's');

    let destination: string | null = null;
    if (encoded) {
      try {
        destination = safeUrl(Buffer.from(encoded, 'base64url').toString('utf8'));
      } catch {
        destination = null;
      }
    }

    // Il controllo sull'elenco dei domini vale per tutti i redirect, firmati e
    // non: è quello che impedisce di usare il dominio come open redirect.
    const target = destination ? await allowedDestination(destination) : null;

    if (!target) {
      log.warn('Link tracciato non utilizzabile', {
        hasUrl: Boolean(encoded),
        decoded: Boolean(destination),
        ref: refValue,
      });
      res
        .status(400)
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
            '<title>Link non valido</title></head><body style="font-family:sans-serif;padding:32px">' +
            '<h1>Link non valido</h1><p>Questo collegamento non è leggibile o non porta a un sito AlphaInk. ' +
            `<a href="${FALLBACK_URL}">Vai al sito AlphaInk</a>.</p></body></html>`,
        );
      return;
    }

    const secret = signingSecret();
    const ref = parseSendRef(refValue);
    const valid =
      Boolean(secret) &&
      Boolean(signature) &&
      Boolean(contactId) &&
      Boolean(refValue) &&
      verifySignature(clickSignaturePayload(encoded!, refValue!, contactId!), signature!, secret);

    // Oltre alla firma serve un riferimento **interpretabile**: una firma valida
    // su un `r` che `parseSendRef` non riconosce (formato di una versione
    // precedente, `kind` non più supportato) farebbe cadere il ramo firmato su
    // un `null` e il cliente vedrebbe un 500 al posto della pagina che ha
    // chiesto. È la stessa guardia che usa già `trackOpen`.
    if (!valid || !ref) {
      // Si reindirizza comunque, ma solo perché la destinazione appartiene ai
      // domini aziendali: rompere il link di un cliente peggiora l'esperienza
      // senza proteggere nulla in più. Cade la registrazione, non la navigazione.
      log.warn('Click non registrabile: reindirizzo senza registrare', {
        ref: refValue,
        contactId,
        hasSecret: Boolean(secret),
        hasSignature: Boolean(signature),
        refLeggibile: Boolean(ref),
      });
      res.redirect(302, target);
      return;
    }

    // Gli invii di prova non devono inquinare le statistiche della campagna.
    if (ref.source === 'test') {
      res.redirect(302, target);
      return;
    }

    const email = await contactEmail(contactId!);
    const input: TrackingEventInput = {
      ...baseInput(ref, contactId!, email, req),
      type: 'click',
      url: target,
    };

    // L'evento viene persistito prima del redirect: è una scrittura sola e
    // garantisce che il click non si perda se l'istanza viene terminata.
    try {
      const result = await saveTrackingEvent(buildTrackingEvent(input));
      res.redirect(302, target);
      if (result.stored) await processEvent(result.event);
    } catch (error) {
      log.error('Registrazione click fallita: reindirizzo comunque', error, { ref: refValue });
      if (!res.headersSent) res.redirect(302, target);
    }
  },
);

// -----------------------------------------------------------------------------
// Aperture
// -----------------------------------------------------------------------------

export const trackOpen = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (req: Request, res: Response): Promise<void> => {
    const refValue = queryValue(req, 'r');
    const contactId = queryValue(req, 'c');
    const signature = queryValue(req, 's');
    const secret = signingSecret();

    const valid =
      Boolean(secret) &&
      Boolean(signature) &&
      Boolean(contactId) &&
      Boolean(refValue) &&
      verifySignature(openSignaturePayload(refValue!, contactId!), signature!, secret);

    if (!valid) {
      log.warn('Pixel di apertura con firma non valida: nessuna registrazione', {
        ref: refValue,
        contactId,
      });
      sendPixel(res);
      return;
    }

    const ref = parseSendRef(refValue);
    if (!ref) {
      sendPixel(res);
      return;
    }

    const userAgent = req.get('user-agent') ?? null;
    const ip = clientIp(req);
    const proxy = detectProxyOpen(userAgent, ip);
    const type: BrevoEventType = proxy.isProxy ? 'proxy_open' : 'opened';

    // Il pixel parte subito: l'immagine non deve aspettare Firestore.
    sendPixel(res);

    if (proxy.isProxy) {
      // Il pixel è stato precaricato da un proxy immagini: l'evento viene
      // registrato come `proxy_open` e sarà `processEvent` a decidere se
      // conteggiarlo, in base a `settings/tracking.excludeProxyOpens`.
      log.debug('Apertura via proxy immagini', { client: proxy.client, ref: refValue });
    }

    const email = await contactEmail(contactId!);
    await record({ ...baseInput(ref, contactId!, email, req), type }, ref.source);
  },
);
