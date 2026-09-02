/**
 * Invio di email transazionali (`POST /smtp/email`).
 *
 * È il canale usato dalle automazioni, dai test e dagli invii scaglionati
 * delle newsletter: a differenza delle campagne permette un HTML diverso per
 * ogni destinatario (i merge tag li risolviamo noi prima dell'invio).
 *
 * Vincoli Brevo rilevanti:
 *  - `sender.email` deve essere un mittente verificato sull'account;
 *  - serve almeno uno fra `htmlContent`, `textContent` e `templateId`;
 *  - massimo 99 destinatari in `to`/`cc`/`bcc` di un singolo messaggio;
 *  - massimo 1000 elementi in `messageVersions`;
 *  - `messageVersions` condivide il contenuto: possono variare solo
 *    destinatari, oggetto, `params`, `cc`, `bcc` e `replyTo`. Per questo
 *    `sendTransactionalBatch` raggruppa i messaggi per contenuto identico.
 *  - `scheduledAt` accetta una data ISO-8601 con offset e non può superare
 *    le 72 ore rispetto al momento dell'invio.
 */

import { createHash } from 'node:crypto';
import { normalizeEmail } from '@alphaink/shared';
import type { SendSource } from '@alphaink/shared';
import { chunk } from '../lib/async';
import { invalidArgument } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { brevoRequest } from './client';

const log = createLogger('brevo.transactional');

/** Tag applicativo presente su ogni invio: filtra i log Brevo per app. */
export const APP_TAG = 'alphaink';

/** Header applicativi propagati nei webhook Brevo (`X-Mailin-custom` a parte). */
export const HEADER_SOURCE = 'X-Alphaink-Source';
export const HEADER_REF = 'X-Alphaink-Ref';

export const MAX_RECIPIENTS_PER_MESSAGE = 99;
export const MAX_MESSAGE_VERSIONS = 1000;

export interface BrevoEmailAddress {
  email: string;
  name?: string;
}

export interface BrevoAttachment {
  /** URL pubblico del file, alternativo a `content`. */
  url?: string;
  /** Contenuto in base64. */
  content?: string;
  name?: string;
}

/** Metadati applicativi tradotti in header e tag. */
export interface TransactionalMeta {
  /** Origine dell'invio: `newsletter`, `automation`, `test`, `transactional`. */
  source?: SendSource;
  /** Riferimento all'entità applicativa (id newsletter, id run, ...). */
  ref?: string | null;
  /** Tag aggiuntivi oltre a quello applicativo. */
  tags?: string[];
}

export interface SendTransactionalInput extends TransactionalMeta {
  to: BrevoEmailAddress[];
  sender: BrevoEmailAddress;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  replyTo?: BrevoEmailAddress | null;
  cc?: BrevoEmailAddress[];
  bcc?: BrevoEmailAddress[];
  headers?: Record<string, string>;
  /** Variabili del template Brevo (`{{ params.x }}`). */
  params?: Record<string, unknown>;
  /** Invio programmato, ISO-8601 con offset. */
  scheduledAt?: string | null;
  templateId?: number;
  attachment?: BrevoAttachment[];
  /** Raggruppa più invii programmati sotto un unico batch annullabile. */
  batchId?: string;
  idempotencyKey?: string;
}

export interface SendTransactionalResult {
  messageId: string;
  messageIds?: string[];
  batchId?: string;
}

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

function cleanAddress(address: BrevoEmailAddress): BrevoEmailAddress {
  const email = normalizeEmail(address.email);
  const name = address.name?.trim();
  return name ? { email, name } : { email };
}

function cleanAddresses(addresses?: BrevoEmailAddress[]): BrevoEmailAddress[] | undefined {
  if (!addresses?.length) return undefined;
  return addresses.filter((address) => address?.email).map(cleanAddress);
}

/** Unisce gli header applicativi a quelli richiesti dal chiamante. */
export function buildHeaders(meta: TransactionalMeta, extra?: Record<string, string>): Record<string, string> {
  return {
    ...(extra ?? {}),
    [HEADER_SOURCE]: meta.source ?? 'transactional',
    [HEADER_REF]: meta.ref ? String(meta.ref) : 'none',
  };
}

/** Tag applicativo + tag specifici, deduplicati e ripuliti. */
export function buildTags(meta: TransactionalMeta): string[] {
  const tags = [APP_TAG, ...(meta.source ? [meta.source] : []), ...(meta.tags ?? [])]
    .map((tag) => String(tag).trim().slice(0, 60))
    .filter(Boolean);
  return Array.from(new Set(tags));
}

function assertSendable(input: SendTransactionalInput): void {
  const recipients = cleanAddresses(input.to);
  if (!recipients?.length) {
    throw invalidArgument('Nessun destinatario indicato per l\'email transazionale.');
  }
  if (recipients.length > MAX_RECIPIENTS_PER_MESSAGE) {
    throw invalidArgument(
      `Brevo accetta al massimo ${MAX_RECIPIENTS_PER_MESSAGE} destinatari per messaggio.`,
    );
  }
  if (!input.sender?.email) {
    throw invalidArgument('Mittente mancante: configura un mittente verificato su Brevo.');
  }
  if (!input.htmlContent && !input.textContent && !input.templateId) {
    throw invalidArgument('L\'email deve avere un contenuto HTML, testuale o un template Brevo.');
  }
  if (!input.subject?.trim() && !input.templateId) {
    throw invalidArgument('Oggetto dell\'email mancante.');
  }
}

function buildBody(input: SendTransactionalInput): Record<string, unknown> {
  return {
    sender: cleanAddress(input.sender),
    to: cleanAddresses(input.to),
    cc: cleanAddresses(input.cc),
    bcc: cleanAddresses(input.bcc),
    replyTo: input.replyTo?.email ? cleanAddress(input.replyTo) : undefined,
    subject: input.subject,
    htmlContent: input.htmlContent,
    textContent: input.textContent,
    templateId: input.templateId,
    params: input.params,
    attachment: input.attachment?.length ? input.attachment : undefined,
    headers: buildHeaders(input, input.headers),
    tags: buildTags(input),
    scheduledAt: input.scheduledAt ?? undefined,
    batchId: input.batchId,
  };
}

// -----------------------------------------------------------------------------
// Invio singolo
// -----------------------------------------------------------------------------

/** Invia una singola email transazionale. */
export async function sendTransactionalEmail(
  apiKey: string,
  input: SendTransactionalInput,
): Promise<SendTransactionalResult> {
  assertSendable(input);

  const response = await brevoRequest<{
    messageId?: string;
    messageIds?: string[];
    batchId?: string;
  }>('/smtp/email', {
    apiKey,
    method: 'POST',
    body: buildBody(input),
    idempotencyKey: input.idempotencyKey,
  });

  const messageId = response?.messageId ?? response?.messageIds?.[0] ?? '';
  if (!messageId) {
    log.warn('Brevo non ha restituito un messageId', { to: input.to.map((item) => item.email) });
  }
  return {
    messageId,
    messageIds: response?.messageIds,
    batchId: response?.batchId,
  };
}

// -----------------------------------------------------------------------------
// Invio a blocchi (messageVersions)
// -----------------------------------------------------------------------------

/**
 * Chiave di raggruppamento: due messaggi possono viaggiare nella stessa
 * chiamata solo se condividono contenuto, mittente, tag, header, allegati e
 * programmazione. Oggetto, destinatari, `params`, cc/bcc e `replyTo` restano
 * personalizzabili per versione.
 */
function groupKey(input: SendTransactionalInput): string {
  const signature = JSON.stringify({
    sender: cleanAddress(input.sender),
    html: input.htmlContent ?? '',
    text: input.textContent ?? '',
    template: input.templateId ?? null,
    tags: buildTags(input),
    headers: buildHeaders(input, input.headers),
    attachment: input.attachment ?? null,
    scheduledAt: input.scheduledAt ?? null,
    batchId: input.batchId ?? null,
  });
  return createHash('sha1').update(signature).digest('hex');
}

interface MessageVersion {
  to: BrevoEmailAddress[];
  subject?: string;
  params?: Record<string, unknown>;
  replyTo?: BrevoEmailAddress;
  cc?: BrevoEmailAddress[];
  bcc?: BrevoEmailAddress[];
}

function toVersion(input: SendTransactionalInput): MessageVersion {
  return {
    to: cleanAddresses(input.to) ?? [],
    subject: input.subject,
    params: input.params,
    replyTo: input.replyTo?.email ? cleanAddress(input.replyTo) : undefined,
    cc: cleanAddresses(input.cc),
    bcc: cleanAddresses(input.bcc),
  };
}

/**
 * Invia più messaggi in poche chiamate, sfruttando `messageVersions`.
 *
 * I messaggi vengono raggruppati per contenuto identico e spezzati in blocchi
 * da 1000 versioni. Restituisce la mappa `email → messageId`; se Brevo non
 * restituisce un id per una versione, quella email resta fuori dalla mappa
 * (il chiamante la tratterà come non tracciabile, non come non inviata).
 */
export async function sendTransactionalBatch(
  apiKey: string,
  messages: readonly SendTransactionalInput[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (messages.length === 0) return result;

  const groups = new Map<string, SendTransactionalInput[]>();
  for (const message of messages) {
    assertSendable(message);
    const key = groupKey(message);
    const bucket = groups.get(key);
    if (bucket) bucket.push(message);
    else groups.set(key, [message]);
  }

  for (const group of groups.values()) {
    const base = group[0] as SendTransactionalInput;

    for (const block of chunk(group, MAX_MESSAGE_VERSIONS)) {
      // Un solo destinatario: `messageVersions` non serve e la risposta è più semplice.
      if (block.length === 1) {
        const single = block[0] as SendTransactionalInput;
        const sent = await sendTransactionalEmail(apiKey, single);
        if (sent.messageId) {
          for (const address of single.to) result[normalizeEmail(address.email)] = sent.messageId;
        }
        continue;
      }

      const versions = block.map(toVersion);
      const response = await brevoRequest<{ messageIds?: string[]; messageId?: string }>(
        '/smtp/email',
        {
          apiKey,
          method: 'POST',
          body: {
            ...buildBody(base),
            // In presenza di `messageVersions` il `to` di primo livello va omesso.
            to: undefined,
            cc: undefined,
            bcc: undefined,
            messageVersions: versions,
          },
        },
      );

      // Brevo restituisce gli id nello stesso ordine delle versioni inviate.
      const ids = response?.messageIds ?? (response?.messageId ? [response.messageId] : []);
      versions.forEach((version, index) => {
        const messageId = ids[index];
        if (!messageId) return;
        for (const address of version.to) result[normalizeEmail(address.email)] = messageId;
      });

      if (ids.length !== versions.length) {
        log.warn('Numero di messageId diverso dal numero di versioni inviate', {
          versions: versions.length,
          messageIds: ids.length,
        });
      }
    }
  }

  return result;
}

/**
 * Annulla un invio programmato: accetta un `messageId` oppure un `batchId`.
 * Tollera l'assenza (email già partita o id sconosciuto).
 */
export async function deleteScheduledEmail(apiKey: string, identifier: string): Promise<void> {
  await brevoRequest<void>(`/smtp/email/${encodeURIComponent(identifier)}`, {
    apiKey,
    method: 'DELETE',
    ignoreStatuses: [404],
  });
}
