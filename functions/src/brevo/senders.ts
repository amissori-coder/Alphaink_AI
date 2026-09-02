/**
 * Mittenti Brevo.
 *
 * Un mittente può essere usato per inviare solo dopo essere stato verificato
 * (Brevo invia una mail di conferma all'indirizzo, oppure il dominio va
 * autenticato con SPF/DKIM). `active: false` significa "creato ma non ancora
 * verificato": l'invio con quel mittente verrà rifiutato con 400.
 */

import { normalizeEmail } from '@alphaink/shared';
import type { BrevoSender } from '@alphaink/shared';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { brevoRequest } from './client';

const log = createLogger('brevo.senders');

/** Risposta grezza di `GET /senders`. */
interface SendersResponse {
  senders?: Array<{
    id: number;
    name: string;
    email: string;
    active?: boolean;
    ips?: Array<{ ip: string; domain: string; weight: number }>;
  }>;
}

export interface SenderInput {
  name: string;
  email: string;
}

/** Elenco dei mittenti configurati sull'account. */
export async function listSenders(apiKey: string): Promise<BrevoSender[]> {
  const response = await brevoRequest<SendersResponse>('/senders', { apiKey, method: 'GET' });
  return (response?.senders ?? []).map((sender) => ({
    id: sender.id,
    name: sender.name,
    email: normalizeEmail(sender.email),
    active: sender.active ?? false,
  }));
}

/** Cerca un mittente per indirizzo (confronto normalizzato). */
export async function findSenderByEmail(
  apiKey: string,
  email: string,
): Promise<BrevoSender | null> {
  const target = normalizeEmail(email);
  const senders = await listSenders(apiKey);
  return senders.find((sender) => sender.email === target) ?? null;
}

/** Crea un mittente. Resta inattivo finché non viene verificato su Brevo. */
export async function createSender(apiKey: string, input: SenderInput): Promise<BrevoSender> {
  const response = await brevoRequest<{ id: number }>('/senders', {
    apiKey,
    method: 'POST',
    body: { name: input.name, email: normalizeEmail(input.email) },
  });
  if (!response?.id) {
    throw new AppError('upstream_error', 'Brevo non ha restituito l\'id del mittente creato.');
  }
  return { id: response.id, name: input.name, email: normalizeEmail(input.email), active: false };
}

/**
 * Restituisce il mittente richiesto creandolo se assente.
 * Se esiste ma non è verificato viene comunque restituito: sta alla UI
 * avvisare l'operatore controllando `active`.
 */
export async function ensureSender(apiKey: string, input: SenderInput): Promise<BrevoSender> {
  const existing = await findSenderByEmail(apiKey, input.email);
  if (existing) return existing;
  const created = await createSender(apiKey, input);
  log.info('Mittente Brevo creato: richiede verifica', { email: created.email, id: created.id });
  return created;
}

/** Rimuove un mittente. Tollera l'assenza (404). */
export async function deleteSender(apiKey: string, senderId: number): Promise<void> {
  await brevoRequest<void>(`/senders/${senderId}`, {
    apiKey,
    method: 'DELETE',
    ignoreStatuses: [404],
  });
}
