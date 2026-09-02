/**
 * Client HTTP per l'API Brevo v3.
 *
 * ---------------------------------------------------------------------------
 * LIMITI NOTI DELL'API BREVO (verificati sulla documentazione ufficiale)
 * ---------------------------------------------------------------------------
 * Autenticazione
 *  - Header `api-key` (non `Authorization`). La chiave è legata all'account,
 *    non all'utente: va tenuta esclusivamente in Secret Manager.
 *
 * Rate limit
 *  - I limiti sono per endpoint e per account. Gli endpoint transazionali
 *    (`/smtp/email`) sono i più generosi (nell'ordine delle centinaia di
 *    richieste al minuto), quelli su contatti e campagne molto meno.
 *  - Superato il limite Brevo risponde `429` con header `Retry-After`
 *    (secondi). Qui rispettiamo l'header e ritentiamo con backoff.
 *  - Il `RateLimiter` condiviso di questo modulo è tarato a 10 req/s con
 *    burst 20: è un limite PER ISTANZA, quindi il tetto reale è
 *    `maxInstances × 10 req/s`. Le funzioni che spingono volumi alti devono
 *    tenere `maxInstances` basso.
 *
 * Dimensioni dei batch
 *  - `POST /smtp/email` con `messageVersions`: massimo 1000 versioni per
 *    chiamata (vedi `transactional.ts`).
 *  - Destinatari `to`/`cc`/`bcc` di un singolo messaggio: massimo 99.
 *  - `POST /contacts/import` con `jsonBody`: il corpo JSON non può superare
 *    ~10 MB; qui spezziamo a blocchi di 500 contatti (vedi `contacts.ts`).
 *  - `POST /contacts/lists/{id}/contacts/add|remove`: massimo 150 email per
 *    chiamata.
 *  - Le liste (`GET /contacts/lists`) si leggono a pagine da 50.
 *
 * Campi obbligatori ricorrenti
 *  - `/smtp/email`: `sender` (email verificata sull'account) + almeno uno fra
 *    `htmlContent`, `textContent` e `templateId`; `to` non vuoto.
 *  - `/contacts`: `email` oppure `ext_id`. Gli attributi devono ESISTERE già
 *    sull'account, altrimenti Brevo risponde 400 `invalid_parameter`
 *    (`ensureBrevoAttributes` in `contacts.ts` li crea).
 *  - `/emailCampaigns`: `name`, `subject`, `sender`, `recipients.listIds`.
 *
 * Risposte
 *  - Molte `PUT`/`DELETE` rispondono `204 No Content`: il corpo è vuoto e
 *    questo client restituisce `undefined`.
 *  - `POST /contacts` restituisce `201 {id}` alla creazione ma `204` senza
 *    corpo quando aggiorna un contatto esistente.
 *  - Gli errori hanno forma `{ "code": "...", "message": "..." }`.
 *
 * Idempotenza
 *  - Brevo NON documenta un header di idempotenza generale. L'header
 *    `Idempotency-Key`, quando passato, viene inviato lo stesso (è ignorato
 *    dagli endpoint che non lo supportano): la deduplica effettiva è nostra,
 *    tramite `dedupeKey` e gli header applicativi `X-Alphaink-*`.
 */

import { RateLimiter, sleep, withRetry } from '../lib/async';
import { BREVO_API_BASE } from '../lib/config';
import { AppError, invalidArgument, isRetryable, upstream } from '../lib/errors';
import { createLogger } from '../lib/logger';

const log = createLogger('brevo.client');

/** Timeout di una singola richiesta verso Brevo. */
export const BREVO_TIMEOUT_MS = 30_000;

/** Tentativi di default (1 iniziale + 2 ritentativi). */
export const BREVO_DEFAULT_ATTEMPTS = 3;

/**
 * Limitatore condiviso da tutte le chiamate Brevo di questa istanza.
 * Vive a livello di modulo perché il bucket dev'essere unico per processo.
 */
const rateLimiter = new RateLimiter(10, 20);

export type BrevoHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Valori ammessi in query string: gli array vengono ripetuti (`?ids=1&ids=2`). */
export type BrevoQuery = Record<
  string,
  string | number | boolean | ReadonlyArray<string | number> | null | undefined
>;

export interface BrevoRequestOptions {
  /** Metodo HTTP; default `GET`. */
  method?: BrevoHttpMethod;
  /** Corpo JSON. I campi `undefined` vengono rimossi prima dell'invio. */
  body?: unknown;
  query?: BrevoQuery;
  /** Chiave API Brevo (mai loggata). */
  apiKey: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  attempts?: number;
  /**
   * Stati HTTP da trattare come "successo vuoto" invece che come errore
   * (tipicamente `404` su una cancellazione già avvenuta).
   */
  ignoreStatuses?: readonly number[];
}

/** Corpo d'errore standard di Brevo. */
interface BrevoErrorBody {
  code?: string;
  message?: string;
}

// -----------------------------------------------------------------------------
// Costruzione della richiesta
// -----------------------------------------------------------------------------

function buildUrl(path: string, query?: BrevoQuery): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${BREVO_API_BASE}${suffix}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Rimuove ricorsivamente le proprietà `undefined`.
 * Brevo rifiuta con 400 diversi campi valorizzati a `null` che invece
 * potrebbero essere semplicemente omessi.
 */
export function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefined(item)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = pruneUndefined(item);
    }
    return out as T;
  }
  return value;
}

function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetails(payload: unknown): BrevoErrorBody {
  if (payload && typeof payload === 'object') {
    const body = payload as BrevoErrorBody;
    return { code: body.code, message: body.message };
  }
  if (typeof payload === 'string' && payload.trim()) return { message: payload.trim() };
  return {};
}

/** Traduce una risposta HTTP fallita nell'`AppError` corrispondente. */
function toAppError(status: number, payload: unknown, method: string, path: string): AppError {
  const { code, message } = errorDetails(payload);
  const text = message ?? `richiesta ${method} ${path} fallita (HTTP ${status})`;
  const details = { status, brevoCode: code ?? null, endpoint: `${method} ${path}` };

  if (status === 400 || status === 422) {
    return invalidArgument(`Brevo: ${text}`, details);
  }
  if (status === 401) {
    return new AppError('unauthenticated', 'Brevo: chiave API non valida o revocata.', { details });
  }
  if (status === 403) {
    return new AppError('permission_denied', `Brevo: accesso negato. ${text}`, { details });
  }
  if (status === 404) {
    return new AppError('not_found', `Brevo: risorsa non trovata. ${text}`, { details });
  }
  if (status === 409) {
    return new AppError('already_exists', `Brevo: ${text}`, { details });
  }
  if (status === 429) {
    return new AppError('rate_limited', `Brevo: limite di frequenza raggiunto. ${text}`, {
      details,
      retryable: true,
    });
  }
  if (status >= 500) {
    return upstream('Brevo', text, details);
  }
  return new AppError('upstream_error', `Brevo: ${text}`, { details });
}

/** Legge `Retry-After` (secondi o data HTTP) e lo converte in millisecondi. */
function retryAfterMs(headerValue: string | null): number {
  if (!headerValue) return 0;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds, 30) * 1000);
  const date = Date.parse(headerValue);
  if (Number.isNaN(date)) return 0;
  return Math.max(0, Math.min(date - Date.now(), 30_000));
}

// -----------------------------------------------------------------------------
// Esecuzione
// -----------------------------------------------------------------------------

async function executeOnce<T>(
  path: string,
  options: BrevoRequestOptions,
): Promise<T | undefined> {
  const method = options.method ?? 'GET';
  const url = buildUrl(path, options.query);
  const hasBody = options.body !== undefined && method !== 'GET' && method !== 'DELETE';

  const headers: Record<string, string> = {
    'api-key': options.apiKey,
    accept: 'application/json',
  };
  if (hasBody) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  await rateLimiter.acquire();

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? BREVO_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(pruneUndefined(options.body)) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw upstream(
      'Brevo',
      aborted
        ? `timeout dopo ${timeoutMs} ms su ${method} ${path}`
        : `errore di rete su ${method} ${path}: ${(error as Error)?.message ?? 'sconosciuto'}`,
      { endpoint: `${method} ${path}` },
    );
  } finally {
    clearTimeout(timer);
  }

  if (options.ignoreStatuses?.includes(response.status)) {
    // Il corpo va comunque consumato per liberare la connessione.
    await response.text();
    return undefined;
  }

  const text = await response.text();
  const payload = parseBody(text);

  if (!response.ok) {
    if (response.status === 429) {
      // Attesa "gentile" indicata da Brevo, prima del backoff di `withRetry`.
      const wait = retryAfterMs(response.headers.get('retry-after'));
      if (wait > 0) await sleep(wait);
    }
    throw toAppError(response.status, payload, method, path);
  }

  return payload as T | undefined;
}

/**
 * Esegue una chiamata all'API Brevo con rate limit, timeout e ritentativi.
 * Gli errori transitori (429, 5xx, rete) vengono ritentati con backoff.
 */
export async function brevoRequest<T = unknown>(
  path: string,
  options: BrevoRequestOptions,
): Promise<T> {
  if (!options.apiKey) {
    throw new AppError('failed_precondition', 'Chiave API Brevo non configurata.');
  }
  const method = options.method ?? 'GET';
  const result = await withRetry(() => executeOnce<T>(path, options), {
    attempts: options.attempts ?? BREVO_DEFAULT_ATTEMPTS,
    baseDelayMs: 800,
    maxDelayMs: 20_000,
    shouldRetry: (error) => isRetryable(error),
    onRetry: (error, attempt, delayMs) => {
      log.warn('Ritento la chiamata a Brevo', {
        endpoint: `${method} ${path}`,
        attempt,
        delayMs,
        message: (error as Error)?.message,
      });
    },
  });
  return result as T;
}

/** Variante che tollera la risposta vuota (`204 No Content`). */
export async function brevoRequestVoid(
  path: string,
  options: BrevoRequestOptions,
): Promise<void> {
  await brevoRequest<unknown>(path, options);
}

// -----------------------------------------------------------------------------
// Account
// -----------------------------------------------------------------------------

export interface BrevoAccountPlan {
  /** `free`, `subscription`, `payAsYouGo`, `sms`, `reseller`... */
  type: string;
  /** `sendLimit` per i crediti email, `credits` per gli SMS. */
  creditsType?: string;
  credits?: number;
  startDate?: string;
  endDate?: string;
  userLimit?: number;
}

export interface BrevoAccount {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  address?: {
    street?: string;
    city?: string;
    zipCode?: string;
    country?: string;
  };
  plan?: BrevoAccountPlan[];
  relay?: {
    enabled?: boolean;
    data?: { userName?: string; relay?: string; port?: number };
  };
  marketingAutomation?: { key?: string; enabled?: boolean };
}

/** Legge il profilo dell'account: usato per validare la chiave API. */
export async function getBrevoAccount(apiKey: string): Promise<BrevoAccount> {
  return brevoRequest<BrevoAccount>('/account', { apiKey, method: 'GET' });
}

/** Estrae i crediti residui (email e SMS) dal piano dell'account. */
export function accountCredits(account: BrevoAccount): { email: number | null; sms: number | null } {
  const plans = account.plan ?? [];
  const emailPlan = plans.find((plan) => plan.creditsType === 'sendLimit');
  const smsPlan = plans.find((plan) => plan.type === 'sms');
  return {
    email: typeof emailPlan?.credits === 'number' ? emailPlan.credits : null,
    sms: typeof smsPlan?.credits === 'number' ? smsPlan.credits : null,
  };
}

/**
 * Id del progetto Google Cloud corrente.
 * Vive qui perché serve sia a comporre l'URL dei webhook sia a parlare con
 * Secret Manager, e `client.ts` è l'unico modulo Brevo senza dipendenze da
 * firebase-admin.
 */
export function gcpProjectId(): string | null {
  const direct = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.PROJECT_ID;
  if (direct) return direct;
  try {
    const config = process.env.FIREBASE_CONFIG;
    if (!config) return null;
    return (JSON.parse(config) as { projectId?: string }).projectId ?? null;
  } catch {
    return null;
  }
}

/** Ultime 4 cifre della chiave: unico frammento che possiamo mostrare in UI. */
export function apiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length <= 4 ? '••••' : `••••${trimmed.slice(-4)}`;
}
