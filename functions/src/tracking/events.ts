/**
 * Persistenza degli eventi di tracciamento.
 *
 * Ogni evento (webhook Brevo, click sul nostro redirector, apertura del pixel)
 * diventa un documento della collezione `events` il cui **id è l'hash di
 * deduplica**: se Brevo ritenta la consegna o l'utente ricarica il redirector
 * nello stesso secondo, la seconda scrittura sovrascrive la prima invece di
 * creare un doppione. È questa la difesa contro il doppio conteggio delle
 * statistiche.
 *
 * L'elaborazione vera e propria (aggiornamento di destinatari, statistiche,
 * engagement, tocchi di attribuzione) avviene in `processor.ts`: qui l'evento
 * viene solo registrato con `processed: false`. Se l'istanza muore prima di
 * elaborarlo ci pensa `scheduledStatsReconcile`.
 */

import { createHash } from 'node:crypto';

import { normalizeEmail } from '@alphaink/shared';
import type { BrevoEventType, SendSource, TrackingEvent } from '@alphaink/shared';

import { col, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('tracking.events');

/** Dati minimi per costruire un evento; il resto viene completato qui. */
export interface TrackingEventInput {
  type: BrevoEventType;
  email: string;
  source: SendSource;
  occurredAt?: string | null;
  contactId?: string | null;
  messageId?: string | null;
  newsletterId?: string | null;
  variantId?: string | null;
  automationId?: string | null;
  automationRunId?: string | null;
  brevoCampaignId?: number | null;
  url?: string | null;
  reason?: string | null;
  tag?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  device?: TrackingEvent['device'];
  os?: string | null;
  emailClient?: string | null;
  raw?: Record<string, unknown>;
}

/**
 * Hash stabile dell'evento: `sha256(tipo + messageId + email + istante + url)`.
 *
 * L'URL entra nel calcolo perché due click su link diversi possono arrivare
 * con lo stesso timestamp al secondo: senza di esso il secondo click sparirebbe.
 */
export function dedupeHashFor(input: {
  type: string;
  messageId?: string | null;
  email?: string | null;
  occurredAt?: string | null;
  url?: string | null;
  /** Discriminante extra (es. id destinatario) quando manca il messageId. */
  salt?: string | null;
}): string {
  const seconds = input.occurredAt ? Math.floor(Date.parse(input.occurredAt) / 1000) : 0;
  const payload = [
    input.type,
    input.messageId ?? '',
    normalizeEmail(input.email ?? ''),
    Number.isFinite(seconds) ? String(seconds) : '0',
    input.url ?? '',
    input.salt ?? '',
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

/** Completa l'evento con i campi calcolati. L'id coincide con il `dedupeHash`. */
export function buildTrackingEvent(input: TrackingEventInput): TrackingEvent {
  const email = normalizeEmail(input.email ?? '');
  const occurredAt = normalizeInstant(input.occurredAt);
  const dedupeHash = dedupeHashFor({
    type: input.type,
    messageId: input.messageId,
    email,
    occurredAt,
    url: input.url,
    // Senza `messageId` (eventi generati dal nostro redirector) la coppia
    // invio+contatto è ciò che distingue due eventi altrimenti identici.
    salt: [input.newsletterId, input.automationRunId, input.automationId, input.variantId, input.contactId]
      .filter((part) => Boolean(part))
      .join('~'),
  });

  return {
    id: dedupeHash,
    type: input.type,
    email,
    contactId: input.contactId ?? null,
    messageId: input.messageId ?? null,
    source: input.source,
    newsletterId: input.newsletterId ?? null,
    variantId: input.variantId ?? null,
    automationId: input.automationId ?? null,
    automationRunId: input.automationRunId ?? null,
    brevoCampaignId: input.brevoCampaignId ?? null,
    url: input.url ?? null,
    reason: input.reason ?? null,
    tag: input.tag ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    device: input.device ?? 'unknown',
    os: input.os ?? null,
    emailClient: input.emailClient ?? null,
    occurredAt,
    receivedAt: nowIso(),
    raw: input.raw ?? {},
    dedupeHash,
    processed: false,
    processingError: null,
  };
}

/** Data valida in ISO; qualsiasi valore non interpretabile diventa "adesso". */
export function normalizeInstant(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Brevo manda `ts` in secondi e `ts_event` in secondi: sotto il 1e12 sono secondi.
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim());
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return nowIso();
}

export interface SaveEventResult {
  event: TrackingEvent;
  /** `false` quando l'evento era già stato registrato (consegna ripetuta). */
  stored: boolean;
}

/**
 * Scrive l'evento se non esiste già.
 *
 * `create()` fallisce con `ALREADY_EXISTS` sul duplicato: è il modo più
 * economico di ottenere l'idempotenza (una sola scrittura, nessuna lettura).
 */
export async function saveTrackingEvent(event: TrackingEvent): Promise<SaveEventResult> {
  const { id, ...data } = event;
  try {
    await col.events().doc(id).create(data);
    return { event, stored: true };
  } catch (error) {
    if ((error as { code?: number | string }).code === 6 || isAlreadyExists(error)) {
      log.debug('Evento già registrato: ignorato', { id, type: event.type });
      return { event, stored: false };
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

/** Marca l'evento come elaborato (o come fallito, conservando il motivo). */
export async function markEventProcessed(
  eventId: string,
  error?: unknown,
): Promise<void> {
  const processingError =
    error === undefined || error === null
      ? null
      : error instanceof Error
        ? error.message
        : String(error);

  await col
    .events()
    .doc(eventId)
    .set(
      {
        processed: processingError === null,
        processingError,
        processedAt: nowIso(),
      },
      { merge: true },
    );
}

// -----------------------------------------------------------------------------
// Aperture via proxy (Apple MPP, Gmail Image Proxy, gateway aziendali)
// -----------------------------------------------------------------------------

/**
 * Firme degli user agent che scaricano le immagini per conto dell'utente.
 *
 * Apple Mail Privacy Protection precarica il pixel appena il messaggio arriva,
 * anche se nessuno apre l'email: contarla come apertura gonfia l'open rate del
 * 30-60%. Il proxy Apple si presenta con lo user agent di Safari su macOS
 * 10.15.7 **senza** il suffisso `Version/… Safari/…` e con un IP della rete
 * Apple (17.0.0.0/8).
 */
const PROXY_USER_AGENTS: Array<{ pattern: RegExp; client: string }> = [
  { pattern: /GoogleImageProxy/i, client: 'Gmail Image Proxy' },
  { pattern: /YahooMailProxy/i, client: 'Yahoo Mail Proxy' },
  { pattern: /Barracuda/i, client: 'Barracuda' },
  { pattern: /Mimecast/i, client: 'Mimecast' },
  { pattern: /ProofPoint/i, client: 'Proofpoint' },
  { pattern: /Symantec/i, client: 'Symantec' },
  { pattern: /MessageLabs/i, client: 'MessageLabs' },
  { pattern: /Cloudmark/i, client: 'Cloudmark' },
  { pattern: /Bitdefender/i, client: 'Bitdefender' },
  { pattern: /Superhuman/i, client: 'Superhuman' },
];

/** Firma tipica del precaricamento Apple MPP. */
const APPLE_MPP_UA =
  /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10_15_7\) AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\)\s*$/;

/** Blocco 17.0.0.0/8: rete pubblica di Apple, usata dal proxy MPP. */
function isAppleNetwork(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const first = Number.parseInt(ip.split('.')[0] ?? '', 10);
  return first === 17;
}

export interface ProxyDetection {
  isProxy: boolean;
  /** Nome del proxy riconosciuto, se identificabile. */
  client: string | null;
}

/** Riconosce le aperture generate da un proxy immagini invece che da un umano. */
export function detectProxyOpen(
  userAgent: string | null | undefined,
  ip: string | null | undefined,
): ProxyDetection {
  const ua = (userAgent ?? '').trim();

  for (const { pattern, client } of PROXY_USER_AGENTS) {
    if (pattern.test(ua)) return { isProxy: true, client };
  }
  if (APPLE_MPP_UA.test(ua)) return { isProxy: true, client: 'Apple Mail Privacy Protection' };
  if (isAppleNetwork(ip)) return { isProxy: true, client: 'Apple Mail Privacy Protection' };

  return { isProxy: false, client: null };
}

/** Sistema operativo dedotto dallo user agent, per i report. */
export function detectOs(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return null;
  if (/iphone|ipad|ipod/.test(ua)) return 'iOS';
  if (/android/.test(ua)) return 'Android';
  if (/mac os x|macintosh/.test(ua)) return 'macOS';
  if (/windows/.test(ua)) return 'Windows';
  if (/linux/.test(ua)) return 'Linux';
  return null;
}

/** Client di posta o browser dedotto dallo user agent. */
export function detectEmailClient(userAgent: string | null | undefined): string | null {
  const ua = (userAgent ?? '').trim();
  if (!ua) return null;
  const proxy = detectProxyOpen(ua, null);
  if (proxy.isProxy) return proxy.client;
  if (/Outlook|MSOffice|Microsoft Office/i.test(ua)) return 'Outlook';
  if (/Thunderbird/i.test(ua)) return 'Thunderbird';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return null;
}

// -----------------------------------------------------------------------------
// Riferimento all'invio (`ref`)
// -----------------------------------------------------------------------------

/**
 * Il `ref` viaggia nei link tracciati e negli header dell'invio e dice a quale
 * spedizione appartiene un click o un'apertura.
 *
 *   `n:<newsletterId>` · `n:<newsletterId>:<variantId>`
 *   `a:<automationId>:<stepId>` · `a:<automationId>:<stepId>:<runId>`
 *   `t:<newsletterId>` per gli invii di prova (non conteggiati)
 */
export interface SendRef {
  source: SendSource;
  newsletterId: string | null;
  variantId: string | null;
  automationId: string | null;
  stepId: string | null;
  automationRunId: string | null;
}

export function parseSendRef(ref: string | null | undefined): SendRef | null {
  const value = (ref ?? '').trim();
  if (!value) return null;
  const parts = value.split(':').map((part) => part.trim());
  const [kind, first, second, third] = parts;
  if (!kind || !first) return null;

  if (kind === 'n' || kind === 'newsletter') {
    return {
      source: 'newsletter',
      newsletterId: first,
      variantId: second || null,
      automationId: null,
      stepId: null,
      automationRunId: null,
    };
  }
  if (kind === 'a' || kind === 'automation') {
    return {
      source: 'automation',
      newsletterId: null,
      variantId: null,
      automationId: first,
      stepId: second || null,
      automationRunId: third || null,
    };
  }
  if (kind === 't' || kind === 'test') {
    return {
      source: 'test',
      newsletterId: first,
      variantId: second || null,
      automationId: null,
      stepId: null,
      automationRunId: null,
    };
  }
  return null;
}

/** Inverso di `parseSendRef`, usato dagli invii e dalle anteprime. */
export function buildSendRef(ref: Partial<SendRef> & { source: SendSource }): string {
  if (ref.source === 'automation') {
    return ['a', ref.automationId ?? '', ref.stepId ?? '', ref.automationRunId ?? '']
      .filter((part, index) => index < 3 || part)
      .join(':');
  }
  const prefix = ref.source === 'test' ? 't' : 'n';
  return [prefix, ref.newsletterId ?? '', ref.variantId ?? ''].filter((part, index) => index < 2 || part).join(':');
}
