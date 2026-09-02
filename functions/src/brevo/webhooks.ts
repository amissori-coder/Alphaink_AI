/**
 * Registrazione dei webhook Brevo.
 *
 * Attenzione a un'asimmetria di Brevo che è fonte di errori 400:
 * i nomi degli eventi accettati dall'API di CREAZIONE sono in camelCase
 * (`hardBounce`, `uniqueOpened`, `listAddition`), mentre il campo `event` del
 * payload recapitato al nostro endpoint è in snake_case (`hard_bounce`,
 * `unique_opened`, `list_addition`). Qui teniamo le due tabelle di conversione
 * in un posto solo: il resto dell'app ragiona sempre in `BrevoEventType`.
 */

import { BREVO_EVENT_TYPES } from '@alphaink/shared';
import type { BrevoEventType, IsoDate } from '@alphaink/shared';
import { REGION } from '../lib/config';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { brevoRequest, gcpProjectId } from './client';

const log = createLogger('brevo.webhooks');

export type BrevoWebhookType = 'transactional' | 'marketing';

export interface BrevoWebhook {
  id: number;
  url: string;
  description?: string;
  events: string[];
  type?: BrevoWebhookType;
  createdAt?: string;
  modifiedAt?: string;
}

/** `BrevoEventType` (payload) → nome evento accettato dall'API. */
export const WEBHOOK_EVENT_API_NAME: Record<BrevoEventType, string> = {
  request: 'request',
  delivered: 'delivered',
  opened: 'opened',
  unique_opened: 'uniqueOpened',
  click: 'click',
  soft_bounce: 'softBounce',
  hard_bounce: 'hardBounce',
  blocked: 'blocked',
  spam: 'spam',
  invalid_email: 'invalid',
  deferred: 'deferred',
  error: 'error',
  unsubscribed: 'unsubscribed',
  list_addition: 'listAddition',
  contact_updated: 'contactUpdated',
  contact_deleted: 'contactDeleted',
  proxy_open: 'proxyOpen',
};

/** Inverso di `WEBHOOK_EVENT_API_NAME`, per rileggere i webhook registrati. */
export const WEBHOOK_EVENT_FROM_API: Record<string, BrevoEventType> = Object.fromEntries(
  (Object.entries(WEBHOOK_EVENT_API_NAME) as Array<[BrevoEventType, string]>).map(
    ([type, apiName]) => [apiName, type],
  ),
);

/** Converte in nomi API, accettando indifferentemente le due notazioni. */
export function toBrevoWebhookEvents(events: ReadonlyArray<BrevoEventType | string>): string[] {
  const mapped = events.map((event) => WEBHOOK_EVENT_API_NAME[event as BrevoEventType] ?? event);
  return Array.from(new Set(mapped));
}

/** Converte i nomi restituiti da Brevo negli eventi applicativi. */
export function fromBrevoWebhookEvents(events: ReadonlyArray<string>): BrevoEventType[] {
  const mapped = events
    .map((event) => WEBHOOK_EVENT_FROM_API[event] ?? (event as BrevoEventType))
    .filter((event): event is BrevoEventType => BREVO_EVENT_TYPES.includes(event));
  return Array.from(new Set(mapped));
}

/** Eventi transazionali che l'app sa gestire (invii da automazioni e newsletter). */
export const TRANSACTIONAL_WEBHOOK_EVENTS: BrevoEventType[] = [
  'request',
  'delivered',
  'opened',
  'click',
  'soft_bounce',
  'hard_bounce',
  'blocked',
  'spam',
  'unsubscribed',
  'invalid_email',
  'deferred',
  'error',
];

/**
 * Eventi marketing (campagne inviate a liste Brevo).
 * Volutamente ristretto agli eventi supportati da tutti i piani: un evento non
 * accettato farebbe fallire con 400 l'intera registrazione.
 */
export const MARKETING_WEBHOOK_EVENTS: BrevoEventType[] = [
  'delivered',
  'opened',
  'click',
  'soft_bounce',
  'hard_bounce',
  'spam',
  'unsubscribed',
  'list_addition',
];

// -----------------------------------------------------------------------------
// URL di ricezione
// -----------------------------------------------------------------------------

/**
 * URL su cui Brevo deve recapitare gli eventi.
 *
 * Punta direttamente alla Cloud Function `brevoWebhook` (endpoint stabile
 * `https://<region>-<project>.cloudfunctions.net/brevoWebhook`), così gli
 * eventi non attraversano il rendering della web app. `BREVO_WEBHOOK_URL`
 * permette di forzare un dominio personalizzato; in mancanza di entrambi si
 * ripiega sulla route applicativa `/api/brevo/webhook`.
 */
export function resolveWebhookUrl(appUrl?: string | null): string {
  const override = process.env.BREVO_WEBHOOK_URL?.trim();
  if (override) return override;

  const project = gcpProjectId();
  if (project) return `https://${REGION}-${project}.cloudfunctions.net/brevoWebhook`;

  const base = (appUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new AppError(
      'failed_precondition',
      'Impossibile determinare l\'URL del webhook: configura APP_URL o BREVO_WEBHOOK_URL.',
    );
  }
  return `${base}/api/brevo/webhook`;
}

// -----------------------------------------------------------------------------
// CRUD
// -----------------------------------------------------------------------------

/** Elenca i webhook registrati, opzionalmente per tipo. */
export async function listBrevoWebhooks(
  apiKey: string,
  type?: BrevoWebhookType,
): Promise<BrevoWebhook[]> {
  const response = await brevoRequest<{ webhooks?: BrevoWebhook[] }>('/webhooks', {
    apiKey,
    method: 'GET',
    query: { type },
  });
  return response?.webhooks ?? [];
}

export interface CreateWebhookInput {
  url: string;
  events: ReadonlyArray<BrevoEventType | string>;
  type: BrevoWebhookType;
  description?: string;
}

/** Registra un nuovo webhook. */
export async function createBrevoWebhook(
  apiKey: string,
  input: CreateWebhookInput,
): Promise<{ id: number }> {
  const response = await brevoRequest<{ id: number }>('/webhooks', {
    apiKey,
    method: 'POST',
    body: {
      url: input.url,
      events: toBrevoWebhookEvents(input.events),
      type: input.type,
      description: input.description,
    },
  });
  if (!response?.id) {
    throw new AppError('upstream_error', 'Brevo non ha restituito l\'id del webhook creato.');
  }
  return { id: response.id };
}

/** Aggiorna URL, eventi o descrizione di un webhook esistente. */
export async function updateBrevoWebhook(
  apiKey: string,
  webhookId: number,
  patch: { url?: string; events?: ReadonlyArray<BrevoEventType | string>; description?: string },
): Promise<void> {
  await brevoRequest<void>(`/webhooks/${webhookId}`, {
    apiKey,
    method: 'PUT',
    body: {
      url: patch.url,
      events: patch.events ? toBrevoWebhookEvents(patch.events) : undefined,
      description: patch.description,
    },
  });
}

/** Elimina un webhook. Tollera l'assenza. */
export async function deleteBrevoWebhook(apiKey: string, webhookId: number): Promise<void> {
  await brevoRequest<void>(`/webhooks/${webhookId}`, {
    apiKey,
    method: 'DELETE',
    ignoreStatuses: [404],
  });
}

// -----------------------------------------------------------------------------
// Sincronizzazione
// -----------------------------------------------------------------------------

/** Voce persistita in `settings/brevo.webhooks`. */
export interface RegisteredWebhook {
  id: number;
  url: string;
  type: BrevoWebhookType;
  events: string[];
  createdAt?: IsoDate | null;
}

export interface SyncWebhooksResult {
  url: string;
  webhooks: RegisteredWebhook[];
  created: number;
  updated: number;
}

function sameEvents(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

async function ensureWebhook(
  apiKey: string,
  type: BrevoWebhookType,
  url: string,
  events: BrevoEventType[],
  description: string,
): Promise<{ webhook: RegisteredWebhook; created: boolean; updated: boolean }> {
  const wanted = toBrevoWebhookEvents(events);
  const existing = (await listBrevoWebhooks(apiKey, type)).find(
    (webhook) => webhook.url.trim() === url,
  );

  if (!existing) {
    const { id } = await createBrevoWebhook(apiKey, { url, events: wanted, type, description });
    log.info('Webhook Brevo creato', { id, type, url });
    return { webhook: { id, url, type, events: wanted, createdAt: null }, created: true, updated: false };
  }

  if (!sameEvents(existing.events ?? [], wanted)) {
    await updateBrevoWebhook(apiKey, existing.id, { url, events: wanted, description });
    log.info('Webhook Brevo aggiornato', { id: existing.id, type, url });
    return {
      webhook: { id: existing.id, url, type, events: wanted, createdAt: existing.createdAt ?? null },
      created: false,
      updated: true,
    };
  }

  return {
    webhook: {
      id: existing.id,
      url,
      type,
      events: existing.events ?? wanted,
      createdAt: existing.createdAt ?? null,
    },
    created: false,
    updated: false,
  };
}

/**
 * Garantisce l'esistenza dei due webhook (transazionale e marketing) puntati
 * sull'endpoint `brevoWebhook`. È idempotente: se esistono già con gli stessi
 * eventi non tocca nulla.
 */
export async function syncBrevoWebhooks(
  apiKey: string,
  appUrl?: string | null,
): Promise<SyncWebhooksResult> {
  const url = resolveWebhookUrl(appUrl);

  const transactional = await ensureWebhook(
    apiKey,
    'transactional',
    url,
    TRANSACTIONAL_WEBHOOK_EVENTS,
    'AlphaInk Newsletter — eventi transazionali',
  );
  const marketing = await ensureWebhook(
    apiKey,
    'marketing',
    url,
    MARKETING_WEBHOOK_EVENTS,
    'AlphaInk Newsletter — eventi campagne',
  );

  const entries = [transactional, marketing];
  return {
    url,
    webhooks: entries.map((entry) => entry.webhook),
    created: entries.filter((entry) => entry.created).length,
    updated: entries.filter((entry) => entry.updated).length,
  };
}
