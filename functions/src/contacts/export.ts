/**
 * Esportazione dei contatti in CSV su Firebase Storage.
 *
 * Il file viene scritto sotto `exports/` e restituito come **signed URL** valida
 * un'ora: l'anagrafica non deve essere raggiungibile con un link permanente.
 * Il separatore è il punto e virgola e il file porta il BOM UTF-8, così Excel
 * in italiano apre le colonne correttamente senza importazione guidata.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { STORAGE_PATHS, displayNameFor, SITE_SOURCE_LABELS, SUBSCRIPTION_STATUS_LABELS } from '@alphaink/shared';
import type { Cluster, Contact, SubscriptionStatus } from '@alphaink/shared';
import { FieldPath } from 'firebase-admin/firestore';
import { requirePermission } from '../lib/auth';
import { HEAVY_RUNTIME } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import { bucket, col, logActivity, nowIso, paginateQuery, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('contacts.export');

/** Validità della signed URL restituita al client. */
export const EXPORT_URL_TTL_MS = 60 * 60 * 1000;

/** Contatti massimi esportabili in un colpo solo. */
export const EXPORT_MAX_ROWS = 200_000;

const exportSchema = z.object({
  /** Esporta solo i membri di questo cluster (statici o dinamici). */
  clusterId: z.string().min(1).nullable().optional(),
  status: z
    .array(z.enum(['subscribed', 'unsubscribed', 'pending', 'bounced', 'blocked', 'never_subscribed']))
    .max(6)
    .optional(),
  segment: z.enum(['b2c', 'b2b']).nullable().optional(),
  source: z
    .enum(['prestashop_b2c', 'prestashop_b2b', 'csv', 'manual', 'brevo'])
    .nullable()
    .optional(),
  /** Solo contatti effettivamente contattabili. */
  onlySendable: z.boolean().default(false),
  limit: z.number().int().min(1).max(EXPORT_MAX_ROWS).default(50_000),
  fileName: z.string().max(80).optional(),
});

export interface ExportContactsResult {
  url: string;
  fileName: string;
  path: string;
  rows: number;
  expiresAt: string;
}

/** Intestazioni del CSV, nell'ordine in cui compaiono le colonne. */
export const EXPORT_COLUMNS = [
  'email',
  'nome',
  'cognome',
  'azienda',
  'stato',
  'segmento',
  'sorgente',
  'ordini',
  'spesa totale',
  'ultimo ordine',
  'punteggio engagement',
  'cluster',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Il punto e virgola è il separatore: vanno protetti anche apici e a capo.
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(';');
}

/** Data in formato locale italiano, vuota se assente. */
function isoToLocalDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function decimal(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0,00';
  // Virgola decimale: è il formato atteso da Excel in italiano.
  return value.toFixed(2).replace('.', ',');
}

/** Riga CSV di un contatto. */
export function contactToCsvRow(contact: Contact, clusterNames: Map<string, string>): string {
  const clusters = Array.from(
    new Set([...(contact.clusterIds ?? []), ...(contact.dynamicClusterIds ?? [])]),
  )
    .map((id) => clusterNames.get(id) ?? id)
    .join(' | ');

  return csvRow([
    contact.email,
    contact.firstName ?? '',
    contact.lastName ?? '',
    contact.company ?? '',
    SUBSCRIPTION_STATUS_LABELS[contact.status] ?? contact.status,
    contact.segment === 'b2b' ? 'B2B' : 'B2C',
    SITE_SOURCE_LABELS[contact.source] ?? contact.source,
    contact.stats?.ordersCount ?? 0,
    decimal(contact.stats?.totalSpent ?? 0),
    isoToLocalDate(contact.stats?.lastOrderAt),
    contact.engagement?.engagementScore ?? 0,
    clusters,
  ]);
}

/** Costruisce l'intero CSV, BOM incluso. */
export function buildContactsCsv(contacts: readonly Contact[], clusterNames: Map<string, string>): string {
  const lines = [csvRow(EXPORT_COLUMNS), ...contacts.map((contact) => contactToCsvRow(contact, clusterNames))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Mappa id → nome di tutti i cluster, per la colonna "cluster". */
async function clusterNameMap(): Promise<Map<string, string>> {
  const snapshot = await col.clusters().get();
  const names = new Map<string, string>();
  for (const doc of snapshot.docs) {
    names.set(doc.id, withId<Cluster>(doc).name);
  }
  return names;
}

type ExportInput = z.infer<typeof exportSchema>;

/** Interruzione controllata della scansione al raggiungimento del limite. */
class ExportLimitReached extends Error {
  constructor() {
    super('export-limit-reached');
    this.name = 'ExportLimitReached';
  }
}

/**
 * Legge i contatti che soddisfano il filtro.
 * Il filtro sul cluster è spinto nella query (`array-contains`); stato,
 * segmento e sorgente sono applicati in memoria per non dipendere da indici
 * compositi che potrebbero non esistere.
 */
async function collectContacts(input: ExportInput): Promise<Contact[]> {
  const statuses = new Set<SubscriptionStatus>(input.status ?? []);
  const contacts: Contact[] = [];
  const seen = new Set<string>();

  const matches = (contact: Contact): boolean => {
    if (statuses.size > 0 && !statuses.has(contact.status)) return false;
    if (input.onlySendable && contact.status !== 'subscribed') return false;
    if (input.segment && contact.segment !== input.segment) return false;
    if (input.source && contact.source !== input.source) return false;
    return true;
  };

  const scan = async (query: FirebaseFirestore.Query): Promise<void> => {
    try {
      await paginateQuery(query.orderBy(FieldPath.documentId()), 500, async (docs) => {
        for (const doc of docs) {
          if (contacts.length >= input.limit) throw new ExportLimitReached();
          if (seen.has(doc.id)) continue;
          const contact = withId<Contact>(doc);
          if (!matches(contact)) continue;
          seen.add(doc.id);
          contacts.push(contact);
        }
      });
    } catch (error) {
      // Il limite non è un errore: interrompe soltanto la scansione.
      if (!(error instanceof ExportLimitReached)) throw error;
    }
  };

  if (input.clusterId) {
    // L'appartenenza può essere manuale (clusterIds) o calcolata (dynamicClusterIds).
    await scan(col.contacts().where('clusterIds', 'array-contains', input.clusterId));
    await scan(col.contacts().where('dynamicClusterIds', 'array-contains', input.clusterId));
  } else {
    await scan(col.contacts());
  }

  return contacts;
}

export const exportContacts = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<ExportContactsResult> => {
    try {
      const caller = requirePermission(request, 'contacts:export');
      const parsed = exportSchema.safeParse(request.data ?? {});
      if (!parsed.success) {
        throw invalidArgument('Filtri di esportazione non validi.', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      const input = parsed.data;

      const [contacts, clusterNames] = await Promise.all([collectContacts(input), clusterNameMap()]);
      const csv = buildContactsCsv(contacts, clusterNames);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeName = (input.fileName ?? `contatti-${stamp}`)
        .replace(/[^A-Za-z0-9._-]/g, '-')
        .replace(/-{2,}/g, '-')
        .slice(0, 80);
      const fileName = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`;
      const path = `${STORAGE_PATHS.exports}/${fileName}`;

      const file = bucket.file(path);
      await file.save(Buffer.from(csv, 'utf8'), {
        contentType: 'text/csv; charset=utf-8',
        resumable: false,
        metadata: {
          cacheControl: 'private, max-age=0, no-store',
          metadata: {
            exportedBy: caller.uid,
            exportedAt: nowIso(),
            rows: String(contacts.length),
          },
        },
      });

      const expires = Date.now() + EXPORT_URL_TTL_MS;
      const [url] = await file.getSignedUrl({ action: 'read', expires });

      await logActivity({
        action: 'contacts.export',
        entityType: 'contact',
        userId: caller.uid,
        summary: `Esportati ${contacts.length} contatti in ${fileName}`,
        metadata: {
          rows: contacts.length,
          clusterId: input.clusterId ?? null,
          segment: input.segment ?? null,
          onlySendable: input.onlySendable,
        },
      });

      log.info('Esportazione contatti completata', { rows: contacts.length, path });

      return {
        url,
        fileName,
        path,
        rows: contacts.length,
        expiresAt: new Date(expires).toISOString(),
      };
    } catch (error) {
      log.error('Callable exportContacts fallita', error);
      throw toHttpsError(error);
    }
  },
);
