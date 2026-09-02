/**
 * `POST /api/export/contacts` — proxy autenticato verso la callable
 * `exportContacts`.
 *
 * Perché una route e non la callable diretta dal browser: così l'esportazione
 * può essere avviata anche da un link o da uno script (con il token di
 * sessione) e, con `?download=1`, il browser viene reindirizzato direttamente
 * al CSV firmato senza passaggi intermedi.
 *
 * Il proxy non aggiunge privilegi: inoltra il token dell'utente e il permesso
 * `contacts:export` resta verificato dalla Cloud Function.
 *
 * I webhook di Brevo e del sito non passano da queste route ma dalle Cloud
 * Functions `brevoWebhook` e `siteWebhook`.
 */

import {
  CallableProxyError,
  authenticate,
  callCallable,
  json,
  jsonError,
  resolveRole,
} from '../../_lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = [
  'subscribed',
  'unsubscribed',
  'pending',
  'bounced',
  'blocked',
  'never_subscribed',
] as const;

const SOURCES = ['prestashop_b2c', 'prestashop_b2b', 'csv', 'manual', 'brevo'] as const;

interface ExportContactsInput {
  clusterId?: string | null;
  status?: string[];
  segment?: 'b2c' | 'b2b' | null;
  source?: string | null;
  onlySendable?: boolean;
  limit?: number;
  fileName?: string;
}

interface ExportContactsResult {
  url: string;
  fileName: string;
  path: string;
  rows: number;
  expiresAt: string;
}

/** Normalizza il corpo della richiesta scartando i valori non riconosciuti. */
function normalizeInput(raw: Record<string, unknown>): ExportContactsInput {
  const input: ExportContactsInput = {};

  if (typeof raw.clusterId === 'string' && raw.clusterId.trim()) input.clusterId = raw.clusterId.trim();

  if (Array.isArray(raw.status)) {
    const statuses = raw.status.filter(
      (value): value is (typeof STATUSES)[number] =>
        typeof value === 'string' && STATUSES.includes(value as (typeof STATUSES)[number]),
    );
    if (statuses.length > 0) input.status = statuses;
  }

  if (raw.segment === 'b2c' || raw.segment === 'b2b') input.segment = raw.segment;

  if (typeof raw.source === 'string' && SOURCES.includes(raw.source as (typeof SOURCES)[number])) {
    input.source = raw.source;
  }

  if (typeof raw.onlySendable === 'boolean') input.onlySendable = raw.onlySendable;
  else if (raw.onlySendable === 'true') input.onlySendable = true;

  const limit = Number(raw.limit);
  if (Number.isFinite(limit) && limit > 0) input.limit = Math.min(Math.trunc(limit), 200_000);

  if (typeof raw.fileName === 'string' && raw.fileName.trim()) {
    input.fileName = raw.fileName.trim().slice(0, 80);
  }

  return input;
}

/** Esegue l'esportazione e risponde con il JSON o con il reindirizzamento al CSV. */
async function runExport(
  request: Request,
  raw: Record<string, unknown>,
  download: boolean,
): Promise<Response> {
  const caller = await authenticate(request);
  if (!caller) {
    return jsonError(401, 'unauthenticated', 'Sessione non valida: effettua di nuovo l’accesso.');
  }
  // Il controllo puntuale su `contacts:export` è della Function; qui si scarta
  // subito chi non ha nemmeno il ruolo minimo che lo possiede.
  if (!(await resolveRole(caller, 'analyst'))) {
    return jsonError(403, 'permission-denied', 'Non hai i permessi per esportare i contatti.');
  }

  try {
    const result = await callCallable<ExportContactsInput, ExportContactsResult>(
      'exportContacts',
      normalizeInput(raw),
      caller.token,
      540_000,
    );

    if (download && result?.url) {
      // La signed URL è temporanea: il reindirizzamento non va mai memorizzato.
      return new Response(null, {
        status: 302,
        headers: { Location: result.url, 'Cache-Control': 'no-store' },
      });
    }

    return json(result);
  } catch (error) {
    const proxyError =
      error instanceof CallableProxyError
        ? error
        : new CallableProxyError(500, 'internal', 'Esportazione non riuscita.');
    return jsonError(proxyError.status, proxyError.code, proxyError.message);
  }
}

export async function POST(request: Request): Promise<Response> {
  let raw: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === 'object') raw = body as Record<string, unknown>;
  } catch {
    // Corpo assente o non JSON: si esporta con i filtri predefiniti.
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  return runExport(request, raw, download);
}

/**
 * Variante `GET` comoda per i collegamenti diretti:
 * `/api/export/contacts?cluster=abc&onlySendable=true&download=1`.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, unknown> = {
    clusterId: params.get('cluster') ?? params.get('clusterId') ?? undefined,
    status: params.getAll('status'),
    segment: params.get('segment') ?? undefined,
    source: params.get('source') ?? undefined,
    onlySendable: params.get('onlySendable') ?? undefined,
    limit: params.get('limit') ?? undefined,
    fileName: params.get('fileName') ?? undefined,
  };

  return runExport(request, raw, params.get('download') === '1');
}
