/**
 * Import massivo dei contatti (CSV già normalizzato dal client o elenco manuale).
 *
 * L'import non usa una transazione per riga: sarebbe corretto ma inutilizzabile
 * su migliaia di indirizzi. La strategia è "leggi tutto, poi scrivi in batch":
 *  1. validazione e deduplica delle righe in memoria;
 *  2. una sola lettura per blocchi di 30 email (`in`) per sapere chi esiste già;
 *  3. scritture raggruppate in batch da 500.
 * La deduplica in-file impedisce che due righe con la stessa email creino due
 * documenti nello stesso batch.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { importContactsSchema, isDisposableEmail, isValidEmail, normalizeEmail } from '@alphaink/shared';
import type { Cluster, DocId, SiteSource } from '@alphaink/shared';
import { requirePermission } from '../lib/auth';
import { LIGHT_RUNTIME } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import {
  col,
  commitInBatches,
  db,
  logActivity,
  nowIso,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { buildContactPatch, buildNewContactData, findContactsByEmails } from './repository';
import type { ContactUpsertInput } from './repository';

const log = createLogger('contacts.import');

export interface ImportRowError {
  /** Numero di riga (1 = prima riga di dati). */
  row: number;
  email: string;
  reason: string;
}

export interface ImportContactsResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: ImportRowError[];
  /** Cluster statici a cui i contatti sono stati aggiunti. */
  addedToClusters: DocId[];
  warnings: string[];
}

type ImportInput = z.infer<typeof importContactsSchema>;

interface PreparedRow {
  row: number;
  email: string;
  input: ContactUpsertInput;
}

/** Valida e deduplica le righe, separando quelle da scartare. */
function prepareRows(input: ImportInput): { rows: PreparedRow[]; invalid: ImportRowError[]; disposable: number } {
  const rows: PreparedRow[] = [];
  const invalid: ImportRowError[] = [];
  const seen = new Map<string, number>();
  let disposable = 0;

  input.rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const email = normalizeEmail(raw.email ?? '');

    if (!email || !isValidEmail(email)) {
      invalid.push({ row: rowNumber, email: raw.email ?? '', reason: 'Indirizzo email non valido' });
      return;
    }
    const firstSeen = seen.get(email);
    if (firstSeen !== undefined) {
      invalid.push({ row: rowNumber, email, reason: `Duplicato della riga ${firstSeen}` });
      return;
    }
    if (isDisposableEmail(email)) disposable += 1;

    seen.set(email, rowNumber);
    rows.push({
      row: rowNumber,
      email,
      input: {
        email,
        firstName: raw.firstName ?? null,
        lastName: raw.lastName ?? null,
        phone: raw.phone ?? null,
        company: raw.company ?? null,
        vatNumber: raw.vatNumber ?? null,
        language: raw.language,
        segment: raw.segment,
        tags: raw.tags,
        clusterIds: raw.clusterIds,
        status: raw.status,
        notes: raw.notes ?? null,
        consentSource: `import:${input.source}`,
      },
    });
  });

  return { rows, invalid, disposable };
}

/** Esegue l'import. Isolata dalla callable per poter essere riusata e testata. */
export async function runContactImport(
  input: ImportInput,
  uid?: string | null,
): Promise<ImportContactsResult> {
  const startedAt = Date.now();
  const { rows, invalid, disposable } = prepareRows(input);
  const warnings: string[] = [];
  const source = input.source as SiteSource;

  // Solo i cluster statici possono accogliere contatti aggiunti a mano.
  const targetClusters: Cluster[] = [];
  if (input.addToClusterIds.length > 0) {
    const snapshots = await db.getAll(
      ...input.addToClusterIds.map((id) => col.clusters().doc(id)),
    );
    for (const snapshot of snapshots) {
      if (!snapshot.exists) {
        warnings.push(`Cluster "${snapshot.id}" inesistente: ignorato.`);
        continue;
      }
      const cluster = withId<Cluster>(snapshot);
      if (cluster.type !== 'static') {
        warnings.push(`Il cluster "${cluster.name}" non è statico: i contatti non vi sono stati aggiunti.`);
        continue;
      }
      targetClusters.push(cluster);
    }
  }
  const clusterIds = targetClusters.map((cluster) => cluster.id);

  const existingByEmail = await findContactsByEmails(rows.map((row) => row.email));

  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const memberIds: DocId[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = existingByEmail.get(row.email);
    const contactInput: ContactUpsertInput = {
      ...row.input,
      clusterIds: Array.from(new Set([...(row.input.clusterIds ?? []), ...clusterIds])),
    };

    if (!existing) {
      const ref = col.contacts().doc();
      const data = buildNewContactData(contactInput, source, uid);
      operations.push((batch) => batch.set(ref, data));
      memberIds.push(ref.id);
      created += 1;
      continue;
    }

    memberIds.push(existing.id);
    if (!input.updateExisting) {
      skipped += 1;
      continue;
    }

    const patch = buildContactPatch(existing, contactInput, source, uid);
    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }
    const ref = col.contacts().doc(existing.id);
    operations.push((batch) => batch.update(ref, patch));
    updated += 1;
  }

  await commitInBatches(operations);

  // I cluster statici tengono l'elenco dei membri: va aggiornato dopo le scritture.
  if (targetClusters.length > 0 && memberIds.length > 0) {
    const clusterOps: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
    for (const cluster of targetClusters) {
      const merged = Array.from(new Set([...(cluster.contactIds ?? []), ...memberIds]));
      clusterOps.push((batch) =>
        batch.update(col.clusters().doc(cluster.id), {
          contactIds: merged,
          contactCount: merged.length,
          updatedAt: nowIso(),
        }),
      );
    }
    await commitInBatches(clusterOps);
  }

  if (disposable > 0) {
    warnings.push(`${disposable} indirizzi appartengono a domini usa-e-getta: verificane la provenienza.`);
  }

  const result: ImportContactsResult = {
    total: input.rows.length,
    created,
    updated,
    skipped,
    invalid,
    addedToClusters: clusterIds,
    warnings,
  };

  log.info('Import contatti completato', { ...result, invalid: invalid.length, durationMs: Date.now() - startedAt });
  return result;
}

export const importContacts = onCall(
  { ...LIGHT_RUNTIME, memory: '512MiB' as const, timeoutSeconds: 540 },
  async (request: CallableRequest<unknown>): Promise<ImportContactsResult> => {
    try {
      const caller = requirePermission(request, 'contacts:write');
      const parsed = importContactsSchema.safeParse(request.data ?? {});
      if (!parsed.success) {
        throw invalidArgument('Dati di import non validi.', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const result = await runContactImport(parsed.data, caller.uid);

      await logActivity({
        action: 'contacts.import',
        entityType: 'contact',
        userId: caller.uid,
        summary: `Import contatti: ${result.created} creati, ${result.updated} aggiornati, ${result.invalid.length} scartati`,
        metadata: {
          total: result.total,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          invalid: result.invalid.length,
          source: parsed.data.source,
        },
        severity: result.invalid.length > 0 ? 'warning' : 'info',
      });

      return result;
    } catch (error) {
      log.error('Callable importContacts fallita', error);
      throw toHttpsError(error);
    }
  },
);
