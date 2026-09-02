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
 * `r|c` per le aperture: senza di essa chiunque potrebbe fabbricare click,
 * gonfiare le statistiche o usare il dominio come open redirect.
 *
 * REGOLA DI ESPERIENZA UTENTE: una firma non valida **non blocca** il
 * reindirizzamento. Un link rotto (chiave ruotata, mail inoltrata con la query
 * troncata) non deve trasformarsi in una pagina d'errore per il cliente: si
 * reindirizza comunque, senza registrare nulla, e si logga l'anomalia.
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { normalizeEmail } from '@alphaink/shared';
import type { BrevoEventType, SendSource } from '@alphaink/shared';

import { LINK_SIGNING_KEY, WEBHOOK_RUNTIME } from '../lib/config';
import { col, nowIso } from '../lib/firestore';
import { clientIp, detectDevice, sendPixel } from '../lib/http';
import { createLogger } from '../lib/logger';
import { verifySignature } from '../lib/signing';
import { safeUrl } from '../render/html-utils';
import { clickSignaturePayload, openSignaturePayload } from '../render/links';
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
import { signingSecret } from './settings';

const log = createLogger('tracking.redirect');

/** URL di ripiego quando il link è illeggibile: la home della web app. */
const FALLBACK_URL = 'https://alphaink.net';

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

    if (!destination) {
      log.warn('Link tracciato illeggibile', { hasUrl: Boolean(encoded), ref: refValue });
      res
        .status(400)
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(
          '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
            '<title>Link non valido</title></head><body style="font-family:sans-serif;padding:32px">' +
            '<h1>Link non valido</h1><p>Questo collegamento non è leggibile. ' +
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

    if (!valid) {
      // Si reindirizza comunque: rompere il link peggiora l'esperienza senza
      // proteggere nulla in più (la destinazione è già stata validata).
      log.warn('Click con firma non valida: reindirizzo senza registrare', {
        ref: refValue,
        contactId,
        hasSecret: Boolean(secret),
        hasSignature: Boolean(signature),
      });
      res.redirect(302, destination);
      return;
    }

    // Gli invii di prova non devono inquinare le statistiche della campagna.
    if (ref!.source === 'test') {
      res.redirect(302, destination);
      return;
    }

    const email = await contactEmail(contactId!);
    const input: TrackingEventInput = {
      ...baseInput(ref!, contactId!, email, req),
      type: 'click',
      url: destination,
    };

    // L'evento viene persistito prima del redirect: è una scrittura sola e
    // garantisce che il click non si perda se l'istanza viene terminata.
    try {
      const result = await saveTrackingEvent(buildTrackingEvent(input));
      res.redirect(302, destination);
      if (result.stored) await processEvent(result.event);
    } catch (error) {
      log.error('Registrazione click fallita: reindirizzo comunque', error, { ref: refValue });
      if (!res.headersSent) res.redirect(302, destination);
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
