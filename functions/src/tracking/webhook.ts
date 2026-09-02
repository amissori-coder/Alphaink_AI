/**
 * Webhook Brevo: ingresso di tutti gli eventi di recapito, apertura, click,
 * bounce e disiscrizione.
 *
 * =============================================================================
 * COME CONFIGURARLO
 * =============================================================================
 * URL da registrare su Brevo (lo fa da solo `registerBrevoWebhooks`):
 *
 *   https://europe-west1-<progetto>.cloudfunctions.net/brevoWebhook?token=<BREVO_WEBHOOK_SECRET>
 *
 * Sono accettate due forme di autenticazione, entrambe basate sullo stesso
 * segreto `BREVO_WEBHOOK_SECRET`:
 *
 *  1. **token in query string** — `?token=<segreto>`. È la modalità da usare
 *     con Brevo, che non permette di aggiungere header personalizzati al
 *     webhook. Il confronto è a tempo costante.
 *  2. **header `X-Alphaink-Signature`** — HMAC-SHA256 del corpo grezzo in
 *     base64url (accettato anche con prefisso `sha256=`). Da usare quando gli
 *     eventi passano da un proxy nostro o dai test automatici, perché lega la
 *     firma al contenuto e non solo alla conoscenza del segreto.
 *
 * =============================================================================
 * PAYLOAD
 * =============================================================================
 * Brevo invia un singolo oggetto JSON; alcuni piani inviano un array di eventi
 * o un involucro `{ "events": [...] }`. Sono gestite tutte e tre le forme.
 *
 * Campi letti (transazionali e marketing):
 *   event, email, id, message-id, date, ts, ts_event, ts_epoch, subject,
 *   tag, tags, link, url, reason, camp_id, "campaign name", sending_ip, ip,
 *   user_agent, X-Mailin-custom
 *
 * `X-Mailin-custom` è l'header che scriviamo noi al momento dell'invio: è la
 * via più affidabile per risalire alla newsletter o all'automazione. Formato
 * accettato: JSON (`{"newsletterId":"…","contactId":"…"}`), coppie
 * `chiave=valore` separate da `;`, oppure un `ref` (`n:<id>:<variante>`).
 *
 * =============================================================================
 * GARANZIE
 * =============================================================================
 * - **Idempotenza**: l'id del documento in `events` è l'hash di deduplica, così
 *   una consegna ripetuta non conta due volte apertura o click.
 * - **Risposta rapida**: gli eventi vengono prima persistiti e la risposta 200
 *   parte subito; l'elaborazione pesante prosegue con un budget di tempo e
 *   quanto resta indietro viene ripreso da `scheduledStatsReconcile`.
 * - **Aperture proxy**: Apple MPP e gli altri proxy immagini sono riconosciuti
 *   e riclassificati come `proxy_open`, quindi esclusi dall'open rate se
 *   `settings/tracking.excludeProxyOpens` è attivo.
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { BREVO_EVENT_TYPES, normalizeEmail } from '@alphaink/shared';
import type { BrevoEventType, SendSource, TrackingEvent } from '@alphaink/shared';

import { mapWithConcurrency } from '../lib/async';
import { BREVO_WEBHOOK_SECRET, WEBHOOK_RUNTIME } from '../lib/config';
import { clientIp, detectDevice, handlePreflight, sendError, sendJson } from '../lib/http';
import { createLogger } from '../lib/logger';
import { verifySignature } from '../lib/signing';
import { WEBHOOK_EVENT_FROM_API } from '../brevo/webhooks';
import {
  buildTrackingEvent,
  detectEmailClient,
  detectOs,
  detectProxyOpen,
  markEventProcessed,
  normalizeInstant,
  parseSendRef,
  saveTrackingEvent,
} from './events';
import type { TrackingEventInput } from './events';
import { processEvent } from './processor';

const log = createLogger('tracking.webhook');

/** Eventi elaborati in parallelo dopo la risposta. */
const PROCESS_CONCURRENCY = 3;

/** Budget di elaborazione post-risposta; il resto passa alla riconciliazione. */
export const WEBHOOK_PROCESS_BUDGET_MS = 45_000;

/** Numero massimo di eventi accettati in un solo POST. */
export const MAX_EVENTS_PER_REQUEST = 500;

// -----------------------------------------------------------------------------
// Normalizzazione del payload
// -----------------------------------------------------------------------------

/** Alias con cui Brevo nomina gli eventi nei diversi piani/endpoint. */
const EVENT_ALIASES: Record<string, BrevoEventType> = {
  unsubscribe: 'unsubscribed',
  unsub: 'unsubscribed',
  complaint: 'spam',
  invalid: 'invalid_email',
  invalid_email_address: 'invalid_email',
  open: 'opened',
  uniqueopened: 'unique_opened',
  proxyopen: 'proxy_open',
  clicks: 'click',
  bounce: 'hard_bounce',
};

/** Traduce il campo `event` di Brevo nel tipo applicativo. */
export function toBrevoEventType(value: unknown): BrevoEventType | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (BREVO_EVENT_TYPES.includes(raw as BrevoEventType)) return raw as BrevoEventType;

  const fromApi = WEBHOOK_EVENT_FROM_API[raw];
  if (fromApi) return fromApi;

  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (BREVO_EVENT_TYPES.includes(normalized as BrevoEventType)) return normalized as BrevoEventType;
  return EVENT_ALIASES[normalized] ?? EVENT_ALIASES[normalized.replace(/_/g, '')] ?? null;
}

/** Riferimenti applicativi estratti da `X-Mailin-custom` o dai tag. */
export interface CustomHeaderData {
  newsletterId: string | null;
  variantId: string | null;
  automationId: string | null;
  automationRunId: string | null;
  contactId: string | null;
  recipientId: string | null;
  source: SendSource | null;
}

const EMPTY_CUSTOM: CustomHeaderData = {
  newsletterId: null,
  variantId: null,
  automationId: null,
  automationRunId: null,
  contactId: null,
  recipientId: null,
  source: null,
};

function pickString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Legge `X-Mailin-custom` nelle tre forme che possiamo aver scritto:
 * JSON, coppie `chiave=valore;` e `ref` compatto.
 */
export function parseCustomHeader(value: unknown): CustomHeaderData {
  if (!value) return { ...EMPTY_CUSTOM };

  if (typeof value === 'object' && !Array.isArray(value)) {
    return fromRecord(value as Record<string, unknown>);
  }

  const text = String(value).trim();
  if (!text) return { ...EMPTY_CUSTOM };

  if (text.startsWith('{')) {
    try {
      return fromRecord(JSON.parse(text) as Record<string, unknown>);
    } catch {
      // Cade sulle euristiche seguenti.
    }
  }

  if (/^[nat]:/.test(text)) {
    const ref = parseSendRef(text);
    if (ref) {
      return {
        ...EMPTY_CUSTOM,
        newsletterId: ref.newsletterId,
        variantId: ref.variantId,
        automationId: ref.automationId,
        automationRunId: ref.automationRunId,
        source: ref.source,
      };
    }
  }

  if (text.includes('=')) {
    const record: Record<string, unknown> = {};
    for (const pair of text.split(/[;|,]/)) {
      const [key, ...rest] = pair.split('=');
      if (!key || rest.length === 0) continue;
      record[key.trim()] = rest.join('=').trim();
    }
    return fromRecord(record);
  }

  return { ...EMPTY_CUSTOM };
}

function fromRecord(record: Record<string, unknown>): CustomHeaderData {
  const refValue = pickString(record, 'ref', 'r');
  const ref = refValue ? parseSendRef(refValue) : null;

  const source = pickString(record, 'source', 's');
  const validSource: SendSource | null =
    source === 'newsletter' || source === 'automation' || source === 'test' || source === 'transactional'
      ? source
      : (ref?.source ?? null);

  return {
    newsletterId: pickString(record, 'newsletterId', 'nl', 'n') ?? ref?.newsletterId ?? null,
    variantId: pickString(record, 'variantId', 'variant', 'v') ?? ref?.variantId ?? null,
    automationId: pickString(record, 'automationId', 'automation', 'a') ?? ref?.automationId ?? null,
    automationRunId:
      pickString(record, 'automationRunId', 'runId', 'run') ?? ref?.automationRunId ?? null,
    contactId: pickString(record, 'contactId', 'contact', 'c') ?? null,
    recipientId: pickString(record, 'recipientId', 'recipient') ?? null,
    source: validSource,
  };
}

/** Istante dell'evento: Brevo lo manda in più campi, con precisione diversa. */
function eventInstant(payload: Record<string, unknown>): string {
  const epoch = payload.ts_epoch;
  if (typeof epoch === 'number' && Number.isFinite(epoch)) return new Date(epoch).toISOString();
  return normalizeInstant(payload.ts_event ?? payload.ts ?? payload.date ?? payload.event_date);
}

/** Converte un evento Brevo nel nostro formato. Restituisce `null` se ignoto. */
export function normalizeBrevoEvent(
  payload: Record<string, unknown>,
  context: { ip: string | null } = { ip: null },
): TrackingEventInput | null {
  const type = toBrevoEventType(payload.event ?? payload.type);
  if (!type) return null;

  const email = normalizeEmail(String(payload.email ?? payload.contact_email ?? ''));
  if (!email) return null;

  const custom = parseCustomHeader(payload['X-Mailin-custom'] ?? payload['x-mailin-custom']);
  const tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [];
  const tag = pickString(payload, 'tag') ?? tags[0] ?? null;

  // Anche il tag può contenere il `ref`: alcuni invii lo usano come etichetta.
  const tagRef = tag ? parseSendRef(tag) : null;

  const ip =
    pickString(payload, 'ip', 'sending_ip', 'client_ip') ?? context.ip ?? null;
  const userAgent = pickString(payload, 'user_agent', 'ua', 'useragent');

  const proxy = detectProxyOpen(userAgent, ip);
  const isOpen = type === 'opened' || type === 'unique_opened' || type === 'proxy_open';
  // Un'apertura che arriva da un proxy immagini non è un'apertura umana:
  // viene riclassificata prima ancora di toccare le statistiche.
  const finalType: BrevoEventType = isOpen && proxy.isProxy ? 'proxy_open' : type;

  const campaignId = payload.camp_id ?? payload.campaign_id;
  const brevoCampaignId =
    typeof campaignId === 'number'
      ? campaignId
      : typeof campaignId === 'string' && /^\d+$/.test(campaignId)
        ? Number.parseInt(campaignId, 10)
        : null;

  const source: SendSource =
    custom.source ?? tagRef?.source ?? (brevoCampaignId ? 'newsletter' : 'transactional');

  return {
    type: finalType,
    email,
    source,
    occurredAt: eventInstant(payload),
    contactId: custom.contactId,
    messageId: pickString(payload, 'message-id', 'message_id', 'messageId'),
    newsletterId: custom.newsletterId ?? tagRef?.newsletterId ?? null,
    variantId: custom.variantId ?? tagRef?.variantId ?? null,
    automationId: custom.automationId ?? tagRef?.automationId ?? null,
    automationRunId: custom.automationRunId ?? tagRef?.automationRunId ?? null,
    brevoCampaignId,
    url: pickString(payload, 'link', 'url'),
    reason: pickString(payload, 'reason', 'error', 'description'),
    tag,
    ip,
    userAgent,
    device: detectDevice(userAgent ?? undefined),
    os: detectOs(userAgent),
    emailClient: proxy.client ?? detectEmailClient(userAgent),
    raw: payload,
  };
}

/** Estrae l'elenco di eventi dal corpo, qualunque forma abbia. */
export function extractEvents(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.events)) return extractEvents(record.events);
    if (Array.isArray(record.items)) return extractEvents(record.items);
    return [record];
  }
  return [];
}

// -----------------------------------------------------------------------------
// Autenticazione
// -----------------------------------------------------------------------------

function readSecret(): string {
  try {
    return (BREVO_WEBHOOK_SECRET.value() ?? '').trim();
  } catch {
    return '';
  }
}

function rawBodyOf(req: Request): string {
  if (req.rawBody) return req.rawBody.toString('utf8');
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
}

function headerValue(req: Request, name: string): string | null {
  const header = req.headers[name];
  const value = Array.isArray(header) ? header[0] : header;
  return value ? String(value) : null;
}

/** Confronto a tempo costante fra due stringhe di lunghezza qualsiasi. */
function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type AuthOutcome = 'token' | 'signature' | 'rejected';

/** Verifica il token in query oppure la firma HMAC del corpo. */
export function authenticateWebhook(req: Request, secret: string, rawBody: string): AuthOutcome {
  const token = req.query.token ?? req.query.t;
  const tokenValue = Array.isArray(token) ? token[0] : token;
  if (typeof tokenValue === 'string' && tokenValue && safeEquals(tokenValue, secret)) {
    return 'token';
  }

  const rawSignature = headerValue(req, 'x-alphaink-signature');
  if (rawSignature) {
    const signature = rawSignature.startsWith('sha256=') ? rawSignature.slice(7) : rawSignature;
    if (verifySignature(rawBody, signature, secret)) return 'signature';
  }

  return 'rejected';
}

// -----------------------------------------------------------------------------
// Endpoint
// -----------------------------------------------------------------------------

export const brevoWebhook = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [BREVO_WEBHOOK_SECRET] },
  async (req: Request, res: Response): Promise<void> => {
    if (handlePreflight(req, res)) return;
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed', 'Usa POST.');
      return;
    }

    const secret = readSecret();
    if (!secret) {
      sendError(
        res,
        503,
        'webhook_not_configured',
        'Segreto del webhook non configurato: imposta BREVO_WEBHOOK_SECRET.',
      );
      return;
    }

    const rawBody = rawBodyOf(req);
    const auth = authenticateWebhook(req, secret, rawBody);
    if (auth === 'rejected') {
      log.warn('Webhook Brevo rifiutato: credenziali non valide', {
        hasToken: Boolean(req.query.token),
        hasSignature: Boolean(headerValue(req, 'x-alphaink-signature')),
      });
      sendError(res, 401, 'invalid_signature', 'Token o firma non validi.');
      return;
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : req.body;
    } catch {
      sendError(res, 400, 'invalid_json', 'Corpo della richiesta non è JSON valido.');
      return;
    }

    const items = extractEvents(payload);
    if (items.length === 0) {
      sendJson(res, 200, { ok: true, received: 0, stored: 0, ignored: 0 });
      return;
    }
    if (items.length > MAX_EVENTS_PER_REQUEST) {
      log.warn('Payload con troppi eventi: elaborati solo i primi', {
        received: items.length,
        limit: MAX_EVENTS_PER_REQUEST,
      });
    }

    const ip = clientIp(req);
    const stored: TrackingEvent[] = [];
    let ignored = 0;
    let duplicates = 0;

    // 1. Persistenza: veloce e idempotente. Va fatta PRIMA della risposta,
    //    altrimenti un'istanza terminata perderebbe gli eventi.
    for (const item of items.slice(0, MAX_EVENTS_PER_REQUEST)) {
      const input = normalizeBrevoEvent(item, { ip });
      if (!input) {
        ignored += 1;
        continue;
      }
      try {
        const result = await saveTrackingEvent(buildTrackingEvent(input));
        if (result.stored) stored.push(result.event);
        else duplicates += 1;
      } catch (error) {
        log.error('Salvataggio evento fallito', error, { type: input.type, email: input.email });
      }
    }

    // 2. Risposta immediata: Brevo considera il webhook consegnato e non ritenta.
    sendJson(res, 200, {
      ok: true,
      received: items.length,
      stored: stored.length,
      duplicates,
      ignored,
    });

    // 3. Elaborazione: prosegue dopo la risposta con un budget di tempo.
    //    Gli eventi non elaborati restano `processed: false` e li riprende
    //    `scheduledStatsReconcile`.
    await processStoredEvents(stored);
  },
);

/** Elabora gli eventi appena salvati entro il budget di tempo. */
export async function processStoredEvents(events: TrackingEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const deadline = Date.now() + WEBHOOK_PROCESS_BUDGET_MS;
  let processed = 0;

  await mapWithConcurrency(events, PROCESS_CONCURRENCY, async (event) => {
    if (Date.now() > deadline) return;
    try {
      await processEvent(event);
      processed += 1;
    } catch (error) {
      log.error('Elaborazione evento fallita', error, { eventId: event.id, type: event.type });
      await markEventProcessed(event.id, error).catch(() => undefined);
    }
  });

  if (processed < events.length) {
    log.warn('Elaborazione parziale: gli eventi restanti passano alla riconciliazione', {
      processed,
      total: events.length,
    });
  }
  return processed;
}
