/**
 * Utilità comuni alle route handler di Next.js.
 *
 * ⚠️ Nota architetturale
 * ----------------------
 * Le route sotto `/api` servono **solo** questa interfaccia web:
 *  - `/api/health`            stato del servizio;
 *  - `/api/preview/[id]`      HTML della newsletter per l'iframe di anteprima;
 *  - `/api/export/contacts`   proxy autenticato verso la callable `exportContacts`.
 *
 * I webhook in ingresso **non** passano da qui: Brevo e il sito PrestaShop
 * chiamano direttamente le Cloud Functions HTTP `brevoWebhook` e `siteWebhook`
 * nella regione europe-west1, che verificano la firma con i segreti
 * `BREVO_WEBHOOK_SECRET` e `SITE_WEBHOOK_SECRET`. Aggiungere qui un endpoint
 * webhook significherebbe duplicare quella verifica in un punto che non ha
 * accesso ai segreti: non farlo.
 */

import { COLLECTIONS } from '@alphaink/shared';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { adminDb, verifyIdToken } from '@/lib/firebase/admin';

export const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION || 'europe-west1';

export function projectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ''
  );
}

// -----------------------------------------------------------------------------
// Risposte
// -----------------------------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Risposta JSON con intestazioni coerenti (mai in cache). */
export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Errore JSON con messaggio in italiano. */
export function jsonError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } } satisfies ApiErrorBody, status);
}

// -----------------------------------------------------------------------------
// Autenticazione
// -----------------------------------------------------------------------------

/** Estrae il token dall'intestazione `Authorization: Bearer …`. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export interface AuthenticatedCaller {
  uid: string;
  email: string | null;
  role: string | null;
  disabled: boolean;
  token: string;
  decoded: DecodedIdToken;
}

/**
 * Verifica il token di sessione Firebase inviato dal client.
 * Restituisce `null` quando manca o non è valido: il chiamante risponde 401.
 */
export async function authenticate(request: Request): Promise<AuthenticatedCaller | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const decoded = await verifyIdToken(token);
  if (!decoded) return null;

  const claims = decoded as DecodedIdToken & { role?: unknown; disabled?: unknown };
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    role: typeof claims.role === 'string' ? claims.role : null,
    disabled: claims.disabled === true,
    token,
    decoded,
  };
}

/** Ordine gerarchico dei ruoli, allineato a `ROLE_RANK` del pacchetto condiviso. */
const ROLE_RANK: Record<string, number> = {
  owner: 50,
  admin: 40,
  editor: 30,
  analyst: 20,
  viewer: 10,
};

/** True se il ruolo del chiamante raggiunge il minimo richiesto. */
export function hasRole(caller: AuthenticatedCaller, minimum: string): boolean {
  if (caller.disabled) return false;
  const rank = caller.role ? (ROLE_RANK[caller.role] ?? 0) : 0;
  return rank >= (ROLE_RANK[minimum] ?? 0);
}

/**
 * Come `hasRole`, ma con un ripiego sul profilo `users/{uid}`.
 *
 * Il ruolo viaggia nei custom claim, che però entrano nel token solo al
 * rinnovo successivo all'assegnazione: senza questo ripiego un utente appena
 * abilitato vedrebbe un 403 fino al prossimo accesso.
 */
export async function resolveRole(
  caller: AuthenticatedCaller,
  minimum: string,
): Promise<boolean> {
  if (caller.disabled) return false;
  if (caller.role) return hasRole(caller, minimum);

  try {
    const snapshot = await adminDb.collection(COLLECTIONS.users).doc(caller.uid).get();
    if (!snapshot.exists) return false;
    const profile = snapshot.data() as { role?: unknown; disabled?: unknown } | undefined;
    if (profile?.disabled === true) return false;
    const role = typeof profile?.role === 'string' ? profile.role : null;
    const rank = role ? (ROLE_RANK[role] ?? 0) : 0;
    return rank >= (ROLE_RANK[minimum] ?? 0);
  } catch {
    // Profilo non leggibile: si resta prudenti e si nega l'accesso.
    return false;
  }
}

// -----------------------------------------------------------------------------
// Chiamata alle Cloud Functions callable
// -----------------------------------------------------------------------------

/** Endpoint di una callable, con supporto per gli emulatori in sviluppo. */
export function callableUrl(name: string): string {
  const project = projectId();
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
    const host = process.env.NEXT_PUBLIC_EMULATOR_HOST || '127.0.0.1';
    return `http://${host}:5001/${project}/${FUNCTIONS_REGION}/${name}`;
  }
  return `https://${FUNCTIONS_REGION}-${project}.cloudfunctions.net/${name}`;
}

export class CallableProxyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CallableProxyError';
    this.status = status;
    this.code = code;
  }
}

/** Codici di stato HTTP corrispondenti ai codici d'errore delle callable. */
const STATUS_BY_CODE: Record<string, number> = {
  'invalid-argument': 400,
  'failed-precondition': 400,
  'out-of-range': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  aborted: 409,
  'resource-exhausted': 429,
  cancelled: 499,
  internal: 500,
  unknown: 500,
  unimplemented: 501,
  unavailable: 503,
  'deadline-exceeded': 504,
};

interface CallableEnvelope<T> {
  result?: T;
  error?: { status?: string; message?: string; details?: unknown };
}

/**
 * Inoltra una chiamata a una Cloud Function callable usando il token
 * dell'utente: i controlli di permesso restano quelli del server, qui non si
 * aggiunge nessun privilegio.
 */
export async function callCallable<TIn, TOut>(
  name: string,
  data: TIn,
  idToken: string,
  timeoutMs = 120_000,
): Promise<TOut> {
  if (!projectId()) {
    throw new CallableProxyError(
      500,
      'failed-precondition',
      'Progetto Firebase non configurato sul server.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(callableUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ data }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const payload = (await response.json().catch(() => ({}))) as CallableEnvelope<TOut>;

    if (!response.ok || payload.error) {
      const code = payload.error?.status?.toLowerCase().replace(/_/g, '-') ?? 'internal';
      const status = STATUS_BY_CODE[code] ?? (response.ok ? 500 : response.status);
      throw new CallableProxyError(
        status,
        code,
        payload.error?.message || 'Operazione non riuscita sul server.',
      );
    }

    return payload.result as TOut;
  } catch (error) {
    if (error instanceof CallableProxyError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new CallableProxyError(504, 'deadline-exceeded', 'Il server non ha risposto in tempo.');
    }
    throw new CallableProxyError(
      502,
      'unavailable',
      `Servizio non raggiungibile: ${(error as Error)?.message ?? 'errore di rete'}.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
