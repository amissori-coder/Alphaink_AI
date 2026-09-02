/**
 * Sincronizzazione contatti, liste e cartelle su Brevo.
 *
 * Gli attributi Brevo sono globali sull'account e DEVONO esistere prima di
 * essere valorizzati: `ensureBrevoAttributes` li crea in modo idempotente.
 * I nomi degli attributi sono in italiano perché compaiono nell'interfaccia
 * Brevo usata dallo staff AlphaInk.
 */

import { LIMITS, normalizeEmail } from '@alphaink/shared';
import type {
  Contact,
  ContactEngagement,
  ContactStats,
  OwnedPrinter,
  SubscriptionStatus,
} from '@alphaink/shared';
import { chunk } from '../lib/async';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { brevoRequest } from './client';

const log = createLogger('brevo.contacts');

// -----------------------------------------------------------------------------
// Attributi
// -----------------------------------------------------------------------------

/** Mappa "chiave applicativa" → "attributo Brevo" usata di default. */
export const BREVO_ATTRIBUTES = {
  firstName: 'NOME',
  lastName: 'COGNOME',
  phone: 'TELEFONO',
  company: 'AZIENDA',
  ordersCount: 'ORDINI',
  totalSpent: 'SPESA_TOTALE',
  lastOrderAt: 'ULTIMO_ORDINE',
  segment: 'SEGMENTO',
  engagementScore: 'PUNTEGGIO_ENGAGEMENT',
  printerBrand: 'MARCA_STAMPANTE',
  printerModel: 'MODELLO_STAMPANTE',
} as const;

export type BrevoAttributeKey = keyof typeof BREVO_ATTRIBUTES;

export type BrevoAttributeType = 'text' | 'date' | 'float' | 'boolean';

/** Definizione degli attributi creati sull'account (categoria `normal`). */
export const BREVO_ATTRIBUTE_DEFINITIONS: Array<{ name: string; type: BrevoAttributeType }> = [
  { name: BREVO_ATTRIBUTES.firstName, type: 'text' },
  { name: BREVO_ATTRIBUTES.lastName, type: 'text' },
  { name: BREVO_ATTRIBUTES.phone, type: 'text' },
  { name: BREVO_ATTRIBUTES.company, type: 'text' },
  { name: BREVO_ATTRIBUTES.ordersCount, type: 'float' },
  { name: BREVO_ATTRIBUTES.totalSpent, type: 'float' },
  { name: BREVO_ATTRIBUTES.lastOrderAt, type: 'date' },
  { name: BREVO_ATTRIBUTES.segment, type: 'text' },
  { name: BREVO_ATTRIBUTES.engagementScore, type: 'float' },
  { name: BREVO_ATTRIBUTES.printerBrand, type: 'text' },
  { name: BREVO_ATTRIBUTES.printerModel, type: 'text' },
];

/** Valori ammessi da Brevo negli attributi di un contatto. */
export type BrevoAttributeValue = string | number | boolean;

/** Vincolo a compile time: fallisce se l'asserzione non è vera. */
type Assert<T extends true> = T;

/** Sottoinsieme di `Contact` sufficiente a costruire il payload Brevo. */
export interface BrevoContactSource {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  segment?: 'b2c' | 'b2b';
  status?: SubscriptionStatus;
  stats?: Partial<ContactStats> | null;
  engagement?: Partial<ContactEngagement> | null;
  printers?: OwnedPrinter[] | null;
  brevoContactId?: number | null;
  brevoListIds?: number[] | null;
  customAttributes?: Record<string, string | number | boolean | null> | null;
}

/**
 * Garanzia a compile time: un `Contact` completo resta sempre un input valido.
 * Se lo schema condiviso cambia in modo incompatibile, la build fallisce qui.
 */
export type ContactIsBrevoSource = Assert<Contact extends BrevoContactSource ? true : false>;

/**
 * Brevo accetta solo nomi attributo maiuscoli con lettere, cifre e underscore:
 * gli attributi liberi provenienti dal sito vanno normalizzati.
 */
function normalizeAttributeName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

/** Gli attributi `date` di Brevo vogliono `YYYY-MM-DD`. */
function toBrevoDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Costruisce gli attributi Brevo del contatto.
 * `mapping` (da `settings/brevo.attributeMapping`) permette di rinominare gli
 * attributi senza toccare il codice: chiave applicativa → nome su Brevo.
 */
export function buildBrevoAttributes(
  contact: BrevoContactSource,
  mapping: Record<string, string> = {},
): Record<string, BrevoAttributeValue> {
  const name = (key: BrevoAttributeKey): string => mapping[key] ?? BREVO_ATTRIBUTES[key];
  const attributes: Record<string, BrevoAttributeValue> = {};

  const set = (key: BrevoAttributeKey, value: BrevoAttributeValue | undefined | null): void => {
    if (value === undefined || value === null || value === '') return;
    attributes[name(key)] = value;
  };

  set('firstName', contact.firstName ?? undefined);
  set('lastName', contact.lastName ?? undefined);
  set('phone', contact.phone ?? undefined);
  set('company', contact.company ?? undefined);
  set('segment', contact.segment ?? undefined);

  const stats = contact.stats ?? undefined;
  if (stats) {
    set('ordersCount', typeof stats.ordersCount === 'number' ? stats.ordersCount : undefined);
    set('totalSpent', typeof stats.totalSpent === 'number' ? round2(stats.totalSpent) : undefined);
    set('lastOrderAt', toBrevoDate(stats.lastOrderAt ?? undefined));
  }

  const engagement = contact.engagement ?? undefined;
  if (engagement && typeof engagement.engagementScore === 'number') {
    set('engagementScore', Math.round(engagement.engagementScore));
  }

  // La stampante più recente è quella che guida le offerte sui consumabili.
  const printers = (contact.printers ?? []).filter((printer) => printer?.model);
  if (printers.length > 0) {
    const latest = [...printers].sort((a, b) =>
      String(b.detectedAt ?? '').localeCompare(String(a.detectedAt ?? '')),
    )[0] as OwnedPrinter;
    set('printerBrand', latest.brand);
    set('printerModel', latest.model);
  }

  for (const [key, value] of Object.entries(contact.customAttributes ?? {})) {
    if (value === null || value === undefined || value === '') continue;
    const attributeName = normalizeAttributeName(key);
    if (!attributeName || attributeName in attributes) continue;
    attributes[attributeName] = value;
  }

  return attributes;
}

/** Stati che su Brevo corrispondono a un contatto in blacklist email. */
const BLACKLISTED_STATUSES: SubscriptionStatus[] = ['unsubscribed', 'blocked'];

// -----------------------------------------------------------------------------
// Contatti
// -----------------------------------------------------------------------------

export interface BrevoContact {
  id: number;
  email: string;
  emailBlacklisted: boolean;
  smsBlacklisted: boolean;
  createdAt?: string;
  modifiedAt?: string;
  listIds?: number[];
  attributes?: Record<string, unknown>;
}

export interface UpsertContactOptions {
  /** Liste a cui iscrivere il contatto. */
  listIds?: number[];
  /** Liste da cui rimuoverlo nella stessa chiamata. */
  unlinkListIds?: number[];
  /** Rinomina degli attributi (da `settings/brevo`). */
  attributeMapping?: Record<string, string>;
  /**
   * Rimuove il contatto dalla blacklist email.
   * Da usare SOLO su un opt-in esplicito: Brevo mette in blacklist anche i
   * bounce definitivi, riattivarli d'ufficio danneggia la reputazione.
   */
  resubscribe?: boolean;
  /** Se il POST aggiorna (204 senza corpo) recupera comunque l'id. */
  resolveId?: boolean;
}

export interface UpsertContactResult {
  id: number | null;
  /** `true` se il contatto non esisteva su Brevo. */
  created: boolean;
}

/**
 * Crea o aggiorna un contatto (`POST /contacts` con `updateEnabled: true`).
 * Brevo risponde `201 {id}` in creazione e `204` senza corpo in aggiornamento.
 */
export async function upsertBrevoContact(
  apiKey: string,
  contact: BrevoContactSource,
  options: UpsertContactOptions = {},
): Promise<UpsertContactResult> {
  const email = normalizeEmail(contact.email);
  if (!email) throw new AppError('invalid_argument', 'Email del contatto mancante.');

  const blacklisted = contact.status ? BLACKLISTED_STATUSES.includes(contact.status) : undefined;
  const body: Record<string, unknown> = {
    email,
    updateEnabled: true,
    attributes: buildBrevoAttributes(contact, options.attributeMapping),
    listIds: options.listIds?.length ? options.listIds : undefined,
    unlinkListIds: options.unlinkListIds?.length ? options.unlinkListIds : undefined,
    // Mai forzare `false` senza `resubscribe`: vedi commento in UpsertContactOptions.
    emailBlacklisted: blacklisted === true ? true : options.resubscribe ? false : undefined,
  };

  const response = await brevoRequest<{ id?: number } | undefined>('/contacts', {
    apiKey,
    method: 'POST',
    body,
  });

  if (response?.id) return { id: response.id, created: true };

  if (options.resolveId === false) return { id: contact.brevoContactId ?? null, created: false };
  if (contact.brevoContactId) return { id: contact.brevoContactId, created: false };

  const existing = await getBrevoContact(apiKey, email);
  return { id: existing?.id ?? null, created: false };
}

export interface BatchUpsertResult {
  /** Un `processId` per ogni blocco inviato: l'import Brevo è asincrono. */
  processIds: number[];
  /** Contatti inviati. */
  total: number;
  batches: number;
}

/** Dimensione di un blocco di import: sotto il tetto di 10 MB di `jsonBody`. */
export const CONTACT_IMPORT_BATCH_SIZE = 500;

/**
 * Import massivo (`POST /contacts/import`) a blocchi da 500.
 * L'operazione è asincrona: Brevo restituisce un `processId` per blocco,
 * consultabile su `GET /processes/{id}`.
 */
export async function batchUpsertBrevoContacts(
  apiKey: string,
  contacts: readonly BrevoContactSource[],
  listIds: number[] = [],
  options: { attributeMapping?: Record<string, string>; updateExisting?: boolean } = {},
): Promise<BatchUpsertResult> {
  const rows = contacts
    .map((contact) => ({
      email: normalizeEmail(contact.email),
      attributes: buildBrevoAttributes(contact, options.attributeMapping),
    }))
    .filter((row) => row.email.length > 0);

  if (rows.length === 0) return { processIds: [], total: 0, batches: 0 };

  const blocks = chunk(rows, CONTACT_IMPORT_BATCH_SIZE);
  const processIds: number[] = [];

  for (const block of blocks) {
    const response = await brevoRequest<{ processId?: number }>('/contacts/import', {
      apiKey,
      method: 'POST',
      body: {
        jsonBody: block,
        listIds: listIds.length ? listIds : undefined,
        updateExistingContacts: options.updateExisting ?? true,
        // `false`: un attributo assente nel blocco non deve cancellare il valore già su Brevo.
        emptyContactsAttributes: false,
      },
    });
    if (typeof response?.processId === 'number') processIds.push(response.processId);
  }

  log.info('Import contatti inviato a Brevo', {
    total: rows.length,
    batches: blocks.length,
    processIds,
  });

  return { processIds, total: rows.length, batches: blocks.length };
}

/** Legge un contatto per email. Restituisce `null` se non esiste. */
export async function getBrevoContact(apiKey: string, email: string): Promise<BrevoContact | null> {
  const identifier = encodeURIComponent(normalizeEmail(email));
  try {
    const contact = await brevoRequest<BrevoContact>(`/contacts/${identifier}`, {
      apiKey,
      method: 'GET',
    });
    return contact ?? null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return null;
    throw error;
  }
}

/** Elimina definitivamente un contatto da Brevo. Tollera l'assenza. */
export async function deleteBrevoContact(apiKey: string, email: string): Promise<void> {
  const identifier = encodeURIComponent(normalizeEmail(email));
  await brevoRequest<void>(`/contacts/${identifier}`, {
    apiKey,
    method: 'DELETE',
    ignoreStatuses: [404],
  });
}

/**
 * Mette (o toglie) un contatto dalla blacklist email.
 * È la traduzione Brevo della disiscrizione: il contatto resta nelle liste
 * ma non riceve più campagne.
 */
export async function blocklistBrevoContact(
  apiKey: string,
  email: string,
  blocked = true,
): Promise<void> {
  const identifier = encodeURIComponent(normalizeEmail(email));
  await brevoRequest<void>(`/contacts/${identifier}`, {
    apiKey,
    method: 'PUT',
    body: { emailBlacklisted: blocked },
    ignoreStatuses: [404],
  });
}

// -----------------------------------------------------------------------------
// Liste e cartelle
// -----------------------------------------------------------------------------

export interface BrevoList {
  id: number;
  name: string;
  folderId?: number;
  totalBlacklisted?: number;
  totalSubscribers?: number;
  uniqueSubscribers?: number;
}

export interface BrevoFolder {
  id: number;
  name: string;
  totalBlacklisted?: number;
  totalSubscribers?: number;
  uniqueSubscribers?: number;
}

/** Pagina massima accettata dagli endpoint di lettura liste/cartelle. */
const LIST_PAGE_SIZE = 50;

/** Elenca tutte le liste, seguendo la paginazione. */
export async function listBrevoLists(apiKey: string, folderId?: number): Promise<BrevoList[]> {
  const path = folderId ? `/contacts/folders/${folderId}/lists` : '/contacts/lists';
  const lists: BrevoList[] = [];
  let offset = 0;

  for (;;) {
    const response = await brevoRequest<{ lists?: BrevoList[]; count?: number }>(path, {
      apiKey,
      method: 'GET',
      query: { limit: LIST_PAGE_SIZE, offset },
    });
    const page = response?.lists ?? [];
    lists.push(...page);
    offset += page.length;
    if (page.length < LIST_PAGE_SIZE) break;
    if (typeof response?.count === 'number' && offset >= response.count) break;
    // Guardia contro loop infiniti su risposte incoerenti.
    if (offset > 5_000) break;
  }

  return lists;
}

/** Crea una lista contatti. `folderId` è obbligatorio lato Brevo. */
export async function createBrevoList(
  apiKey: string,
  input: { name: string; folderId: number },
): Promise<BrevoList> {
  const response = await brevoRequest<{ id: number }>('/contacts/lists', {
    apiKey,
    method: 'POST',
    body: { name: input.name, folderId: input.folderId },
  });
  if (!response?.id) {
    throw new AppError('upstream_error', 'Brevo non ha restituito l\'id della lista creata.');
  }
  return { id: response.id, name: input.name, folderId: input.folderId };
}

/**
 * Elimina una lista contatti.
 *
 * Su Brevo eliminare una lista non elimina i contatti che vi appartengono:
 * restano nell'account e nelle altre liste. È quindi sicuro ripulire le liste
 * che abbiamo creato noi quando il cluster corrispondente viene eliminato.
 * Una lista già assente (404) non è un errore: l'operazione è idempotente.
 */
export async function deleteBrevoList(apiKey: string, listId: number): Promise<{ deleted: boolean }> {
  try {
    await brevoRequest<unknown>(`/contacts/lists/${listId}`, { apiKey, method: 'DELETE' });
    return { deleted: true };
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return { deleted: false };
    throw error;
  }
}

/** Elenca le cartelle contatti. */
export async function listBrevoFolders(apiKey: string): Promise<BrevoFolder[]> {
  const folders: BrevoFolder[] = [];
  let offset = 0;

  for (;;) {
    const response = await brevoRequest<{ folders?: BrevoFolder[]; count?: number }>(
      '/contacts/folders',
      { apiKey, method: 'GET', query: { limit: LIST_PAGE_SIZE, offset } },
    );
    const page = response?.folders ?? [];
    folders.push(...page);
    offset += page.length;
    if (page.length < LIST_PAGE_SIZE) break;
    if (typeof response?.count === 'number' && offset >= response.count) break;
    if (offset > 5_000) break;
  }

  return folders;
}

/** Restituisce la cartella con quel nome, creandola se assente. */
export async function ensureBrevoFolder(apiKey: string, name: string): Promise<BrevoFolder> {
  const target = name.trim();
  const folders = await listBrevoFolders(apiKey);
  const existing = folders.find((folder) => folder.name.trim().toLowerCase() === target.toLowerCase());
  if (existing) return existing;

  const response = await brevoRequest<{ id: number }>('/contacts/folders', {
    apiKey,
    method: 'POST',
    body: { name: target },
  });
  if (!response?.id) {
    throw new AppError('upstream_error', 'Brevo non ha restituito l\'id della cartella creata.');
  }
  return { id: response.id, name: target };
}

/** Restituisce la lista con quel nome dentro la cartella indicata, creandola se assente. */
export async function ensureBrevoList(
  apiKey: string,
  input: { name: string; folderName?: string },
): Promise<BrevoList> {
  const folder = await ensureBrevoFolder(apiKey, input.folderName ?? 'AlphaInk');
  const lists = await listBrevoLists(apiKey, folder.id);
  const existing = lists.find(
    (list) => list.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
  );
  if (existing) return existing;
  return createBrevoList(apiKey, { name: input.name.trim(), folderId: folder.id });
}

/** Brevo accetta al massimo 150 email per chiamata su add/remove. */
const LIST_MEMBERSHIP_BATCH = Math.min(150, LIMITS.brevoBatchSize);

async function changeListMembership(
  apiKey: string,
  listId: number,
  emails: readonly string[],
  action: 'add' | 'remove',
): Promise<number> {
  const normalized = Array.from(
    new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean)),
  );
  if (normalized.length === 0) return 0;

  let affected = 0;
  for (const block of chunk(normalized, LIST_MEMBERSHIP_BATCH)) {
    const response = await brevoRequest<{ contacts?: { success?: string[]; failure?: string[] } }>(
      `/contacts/lists/${listId}/contacts/${action}`,
      { apiKey, method: 'POST', body: { emails: block } },
    );
    affected += response?.contacts?.success?.length ?? block.length;
  }
  return affected;
}

/** Iscrive i contatti a una lista. Restituisce quanti sono stati aggiunti. */
export async function addContactsToList(
  apiKey: string,
  listId: number,
  emails: readonly string[],
): Promise<number> {
  return changeListMembership(apiKey, listId, emails, 'add');
}

/** Rimuove i contatti da una lista. Restituisce quanti sono stati rimossi. */
export async function removeContactsFromList(
  apiKey: string,
  listId: number,
  emails: readonly string[],
): Promise<number> {
  return changeListMembership(apiKey, listId, emails, 'remove');
}

// -----------------------------------------------------------------------------
// Attributi dell'account
// -----------------------------------------------------------------------------

export interface BrevoAccountAttribute {
  name: string;
  category: string;
  type?: string;
}

/** Elenca gli attributi contatto definiti sull'account. */
export async function listBrevoAttributes(apiKey: string): Promise<BrevoAccountAttribute[]> {
  const response = await brevoRequest<{ attributes?: BrevoAccountAttribute[] }>(
    '/contacts/attributes',
    { apiKey, method: 'GET' },
  );
  return response?.attributes ?? [];
}

/**
 * Crea gli attributi AlphaInk mancanti sull'account.
 * Senza di essi ogni upsert fallirebbe con 400 `invalid_parameter`.
 * Restituisce i nomi effettivamente creati.
 */
export async function ensureBrevoAttributes(
  apiKey: string,
  mapping: Record<string, string> = {},
): Promise<string[]> {
  const existing = new Set(
    (await listBrevoAttributes(apiKey))
      .filter((attribute) => attribute.category === 'normal')
      .map((attribute) => attribute.name.toUpperCase()),
  );

  const wanted = BREVO_ATTRIBUTE_DEFINITIONS.map((definition) => {
    const key = (Object.keys(BREVO_ATTRIBUTES) as BrevoAttributeKey[]).find(
      (attributeKey) => BREVO_ATTRIBUTES[attributeKey] === definition.name,
    );
    return { ...definition, name: (key && mapping[key]) || definition.name };
  });

  const created: string[] = [];
  for (const definition of wanted) {
    const name = normalizeAttributeName(definition.name);
    if (!name || existing.has(name)) continue;
    try {
      await brevoRequest<void>(`/contacts/attributes/normal/${encodeURIComponent(name)}`, {
        apiKey,
        method: 'POST',
        body: { type: definition.type },
      });
      created.push(name);
    } catch (error) {
      // Attributo già presente con un altro tipo (o in un'altra categoria):
      // segnaliamo e proseguiamo, la sync userà comunque il nome esistente.
      if (
        error instanceof AppError &&
        (error.code === 'already_exists' || error.code === 'invalid_argument')
      ) {
        log.warn('Attributo Brevo non creato', { name, message: error.message });
        continue;
      }
      throw error;
    }
  }

  if (created.length > 0) log.info('Attributi Brevo creati', { created });
  return created;
}
