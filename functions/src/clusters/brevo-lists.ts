/**
 * Rispecchiamento di un cluster su una lista Brevo.
 *
 * Il cluster resta la fonte di verità: la lista Brevo è una copia allineata ad
 * ogni ricalcolo, utile per le campagne create direttamente dal pannello Brevo
 * e per le automazioni native della piattaforma.
 *
 * L'allineamento è differenziale (aggiunge i nuovi, rimuove chi non appartiene
 * più): un `import` completo ad ogni giro sarebbe più semplice ma lascerebbe
 * nella lista i contatti usciti dal cluster.
 */

import { chunk } from '../lib/async';
import { AppError } from '../lib/errors';
import { col, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import type { Cluster, Contact } from '@alphaink/shared';
import { normalizeEmail, SENDABLE_STATUSES } from '@alphaink/shared';
import {
  batchUpsertBrevoContacts,
  brevoRequest,
  createBrevoList,
  deleteBrevoList,
  ensureBrevoFolder,
  listBrevoLists,
  removeContactsFromList,
} from '../brevo';
import { readBrevoSettings } from '../brevo/settings';
import { resolveClusterContacts } from './engine';

const log = createLogger('clusters.brevo');

/** Cartella Brevo in cui finiscono le liste generate dai cluster. */
export const CLUSTER_FOLDER_NAME = 'AlphaInk — Cluster';

/** Oltre questa soglia la lista non viene sincronizzata: costerebbe troppe chiamate. */
export const MAX_SYNCED_MEMBERS = 100_000;

/** Contatti letti per pagina da `GET /contacts/lists/{id}/contacts`. */
const LIST_READ_PAGE_SIZE = 500;

export interface ClusterBrevoSyncResult {
  listId: number;
  listName: string;
  /** Contatti inviati in import (creati o aggiornati). */
  added: number;
  /** Contatti rimossi perché non appartengono più al cluster. */
  removed: number;
  /** Membri contattabili del cluster. */
  total: number;
  /** Contatti saltati perché non contattabili o con email non valida. */
  skipped: number;
  warnings: string[];
}

/** Email già presenti nella lista Brevo, seguendo la paginazione. */
export async function fetchListEmails(apiKey: string, listId: number): Promise<Set<string>> {
  const emails = new Set<string>();
  let offset = 0;

  for (;;) {
    const response = await brevoRequest<{ contacts?: Array<{ email?: string }>; count?: number }>(
      `/contacts/lists/${listId}/contacts`,
      { apiKey, method: 'GET', query: { limit: LIST_READ_PAGE_SIZE, offset } },
    );
    const page = response?.contacts ?? [];
    for (const contact of page) {
      if (contact.email) emails.add(normalizeEmail(contact.email));
    }
    offset += page.length;
    if (page.length < LIST_READ_PAGE_SIZE) break;
    if (typeof response?.count === 'number' && offset >= response.count) break;
    // Guardia contro risposte incoerenti che non terminerebbero mai.
    if (offset >= MAX_SYNCED_MEMBERS) break;
  }

  return emails;
}

/** Trova la lista del cluster, creandola se non esiste. */
async function ensureClusterList(
  apiKey: string,
  cluster: Cluster,
): Promise<{ id: number; name: string }> {
  const name = cluster.name.trim().slice(0, 100) || `Cluster ${cluster.id}`;

  if (cluster.brevoListId) {
    const lists = await listBrevoLists(apiKey);
    const existing = lists.find((list) => list.id === cluster.brevoListId);
    if (existing) return { id: existing.id, name: existing.name };
    log.warn('Lista Brevo collegata non più esistente: ne verrà creata una nuova', {
      clusterId: cluster.id,
      brevoListId: cluster.brevoListId,
    });
  }

  const folder = await ensureBrevoFolder(apiKey, CLUSTER_FOLDER_NAME);
  const lists = await listBrevoLists(apiKey, folder.id);
  const existing = lists.find((list) => list.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return { id: existing.id, name: existing.name };

  const created = await createBrevoList(apiKey, { name, folderId: folder.id });
  return { id: created.id, name: created.name };
}

/**
 * Allinea la lista Brevo omonima al contenuto del cluster.
 * Sincronizza solo i contatti contattabili: mandare i disiscritti su Brevo
 * gonfierebbe la lista senza poterli comunque raggiungere.
 */
export async function syncClusterToBrevoList(
  cluster: Cluster,
  apiKey: string,
): Promise<ClusterBrevoSyncResult> {
  if (!apiKey) {
    throw new AppError('failed_precondition', 'Chiave API Brevo non configurata.');
  }

  const warnings: string[] = [];
  const resolved = await resolveClusterContacts(cluster, {
    collectContacts: true,
    limit: MAX_SYNCED_MEMBERS,
  });
  if (resolved.truncated) {
    warnings.push(`Cluster troppo grande: sincronizzati i primi ${MAX_SYNCED_MEMBERS} contatti.`);
  }

  const sendable: Contact[] = [];
  let skipped = 0;
  for (const contact of resolved.contacts) {
    const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
    if (!email || !SENDABLE_STATUSES.includes(contact.status)) {
      skipped += 1;
      continue;
    }
    sendable.push(contact);
  }

  const list = await ensureClusterList(apiKey, cluster);
  const settings = await readBrevoSettings();

  const targetEmails = new Set(
    sendable.map((contact) => contact.emailNormalized || normalizeEmail(contact.email)),
  );
  const currentEmails = await fetchListEmails(apiKey, list.id);

  const toAdd = sendable.filter(
    (contact) => !currentEmails.has(contact.emailNormalized || normalizeEmail(contact.email)),
  );
  const toRemove = Array.from(currentEmails).filter((email) => !targetEmails.has(email));

  let added = 0;
  if (toAdd.length > 0) {
    // L'import di Brevo è asincrono: crea/aggiorna i contatti e li iscrive alla lista.
    const result = await batchUpsertBrevoContacts(apiKey, toAdd, [list.id], {
      attributeMapping: settings.attributeMapping,
      updateExisting: true,
    });
    added = result.total;
  }

  let removed = 0;
  if (toRemove.length > 0) {
    for (const block of chunk(toRemove, 150)) {
      removed += await removeContactsFromList(apiKey, list.id, block);
    }
  }

  await col
    .clusters()
    .doc(cluster.id)
    .update({
      brevoListId: list.id,
      brevoSyncedAt: nowIso(),
      updatedAt: nowIso(),
    })
    .catch((error: unknown) => {
      log.error('Aggiornamento del cluster dopo la sincronizzazione Brevo fallito', error, {
        clusterId: cluster.id,
      });
    });

  log.info('Cluster sincronizzato su Brevo', {
    clusterId: cluster.id,
    listId: list.id,
    added,
    removed,
    total: sendable.length,
  });

  return {
    listId: list.id,
    listName: list.name,
    added,
    removed,
    total: sendable.length,
    skipped,
    warnings,
  };
}

/**
 * Elimina la lista Brevo associata a un cluster, se ne possiede una.
 *
 * Chiamata quando il cluster viene eliminato: senza questa pulizia l'account
 * Brevo accumula liste orfane che nessuno userà più, rendendo confusa la scelta
 * della lista negli invii fatti direttamente da Brevo.
 */
export async function removeClusterBrevoList(
  cluster: Pick<Cluster, 'id' | 'name' | 'brevoListId' | 'type'>,
  apiKey: string,
): Promise<{ deleted: boolean; listId: number | null; error: string | null }> {
  // Le liste importate da Brevo non sono nostre: non vanno mai eliminate.
  if (cluster.type === 'brevo_list' || !cluster.brevoListId) {
    return { deleted: false, listId: cluster.brevoListId ?? null, error: null };
  }
  try {
    const result = await deleteBrevoList(apiKey, cluster.brevoListId);
    return { deleted: result.deleted, listId: cluster.brevoListId, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Lista Brevo del cluster non eliminata', {
      clusterId: cluster.id,
      listId: cluster.brevoListId,
      error: message,
    });
    return { deleted: false, listId: cluster.brevoListId, error: message };
  }
}
