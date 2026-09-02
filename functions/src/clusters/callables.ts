/**
 * Callable dei cluster: anteprima, salvataggio, eliminazione e ricalcolo.
 *
 * Il salvataggio è l'unico punto in cui la struttura di un cluster cambia:
 * qui si validano le regole, si allinea l'appartenenza statica e si lancia il
 * primo ricalcolo, così la UI mostra subito conteggi coerenti.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  LIMITS,
  clusterInputSchema,
  filterGroupSchema,
} from '@alphaink/shared';
import type { Cluster, ClusterPreview, DocId } from '@alphaink/shared';
import { requirePermission } from '../lib/auth';
import { BREVO_API_KEY, HEAVY_RUNTIME } from '../lib/config';
import { AppError, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import {
  FieldValue,
  auditCreate,
  auditUpdate,
  col,
  commitInBatches,
  logActivity,
  nowIso,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { readApiKeyFromSecret } from '../brevo/settings';
import { removeClusterBrevoList } from './brevo-lists';
import { syncClusterToBrevoList } from './brevo-lists';
import {
  detachClusterFromContacts,
  previewClusterDefinition,
  previewClusterRules,
  recomputeCluster as recomputeClusterMembership,
} from './engine';
import type { RecomputeClusterResult } from './engine';

const log = createLogger('clusters.callables');

const CALLABLE_OPTIONS = { ...HEAVY_RUNTIME, secrets: [BREVO_API_KEY] };

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw invalidArgument('Dati non validi.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data as z.infer<S>;
}

async function guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`Callable ${operation} fallita`, error);
    throw toHttpsError(error);
  }
}

// -----------------------------------------------------------------------------
// previewCluster
// -----------------------------------------------------------------------------

const previewSchema = z.object({
  type: z.enum(['dynamic', 'static', 'site_group', 'brevo_list']).default('dynamic'),
  rules: filterGroupSchema.nullable().optional(),
  contactIds: z.array(z.string()).max(100_000).optional(),
  siteGroupName: z.string().max(120).nullable().optional(),
  brevoListId: z.number().int().positive().nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  /** Anteprima di un cluster già salvato: le regole vengono lette dal documento. */
  clusterId: z.string().min(1).optional(),
});

export const previewCluster = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<ClusterPreview> =>
    guard('previewCluster', async () => {
      requirePermission(request, 'clusters:read');
      const input = parseInput(previewSchema, request.data);
      const limit = input.limit ?? LIMITS.previewSampleSize;

      if (input.clusterId) {
        const snapshot = await col.clusters().doc(input.clusterId).get();
        if (!snapshot.exists) throw notFound('Cluster', input.clusterId);
        return previewClusterDefinition(withId<Cluster>(snapshot), limit);
      }

      if (input.type === 'dynamic') {
        return previewClusterRules(input.rules ?? null, limit);
      }

      return previewClusterDefinition(
        {
          type: input.type,
          contactIds: input.contactIds ?? [],
          siteGroupName: input.siteGroupName ?? null,
          brevoListId: input.brevoListId ?? null,
        },
        limit,
      );
    }),
);

// -----------------------------------------------------------------------------
// saveCluster
// -----------------------------------------------------------------------------

const saveSchema = clusterInputSchema.extend({
  id: z.string().min(1).optional(),
  /** Se false il ricalcolo è rimandato al job schedulato. */
  recompute: z.boolean().default(true),
});

export interface SaveClusterResult {
  cluster: Cluster;
  recompute: RecomputeClusterResult | null;
  warnings: string[];
}

/** Verifica che il cluster abbia i dati richiesti dal suo tipo. */
function validateClusterShape(input: z.infer<typeof saveSchema>): void {
  switch (input.type) {
    case 'dynamic':
      if (!input.rules) {
        throw invalidArgument('Un cluster dinamico deve avere almeno un gruppo di regole.');
      }
      break;
    case 'static':
      if (!input.contactIds || input.contactIds.length === 0) {
        throw invalidArgument('Un cluster statico deve contenere almeno un contatto.');
      }
      break;
    case 'site_group':
      if (!input.siteGroupName?.trim()) {
        throw invalidArgument('Indica il gruppo cliente del sito da rispecchiare.');
      }
      break;
    case 'brevo_list':
      if (!input.brevoListId) {
        throw invalidArgument('Indica la lista Brevo da rispecchiare.');
      }
      break;
    default:
      throw invalidArgument('Tipo di cluster non riconosciuto.');
  }
}

/** Allinea `contacts.clusterIds` all'elenco di un cluster statico. */
async function syncStaticMembership(
  clusterId: DocId,
  previous: readonly DocId[],
  next: readonly DocId[],
): Promise<void> {
  const before = new Set(previous);
  const after = new Set(next);
  const timestamp = nowIso();
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const id of after) {
    if (before.has(id)) continue;
    operations.push((batch) =>
      batch.update(col.contacts().doc(id), {
        clusterIds: FieldValue.arrayUnion(clusterId),
        updatedAt: timestamp,
      }),
    );
  }
  for (const id of before) {
    if (after.has(id)) continue;
    operations.push((batch) =>
      batch.update(col.contacts().doc(id), {
        clusterIds: FieldValue.arrayRemove(clusterId),
        updatedAt: timestamp,
      }),
    );
  }

  if (operations.length > 0) await commitInBatches(operations);
}

export const saveCluster = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<SaveClusterResult> =>
    guard('saveCluster', async () => {
      const caller = requirePermission(request, 'clusters:write');
      const input = parseInput(saveSchema, request.data);
      validateClusterShape(input);

      const warnings: string[] = [];
      const ref = input.id ? col.clusters().doc(input.id) : col.clusters().doc();
      const snapshot = input.id ? await ref.get() : null;
      if (input.id && !snapshot?.exists) throw notFound('Cluster', input.id);

      const existing = snapshot?.exists ? withId<Cluster>(snapshot) : null;
      const contactIds = input.type === 'static' ? Array.from(new Set(input.contactIds ?? [])) : [];

      const payload: Record<string, unknown> = {
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        color: input.color,
        icon: input.icon ?? null,
        rules: input.type === 'dynamic' ? (input.rules ?? null) : null,
        contactIds,
        siteGroupName: input.type === 'site_group' ? (input.siteGroupName ?? null) : null,
        brevoListId: input.type === 'brevo_list' ? (input.brevoListId ?? null) : (existing?.brevoListId ?? null),
        autoRefresh: input.autoRefresh,
        syncToBrevo: input.syncToBrevo,
        archived: existing?.archived ?? false,
      };

      if (existing) {
        await ref.update({ ...payload, ...auditUpdate(caller.uid) });
      } else {
        await ref.set({
          ...payload,
          contactCount: 0,
          sendableCount: 0,
          // Esplicitamente `null` (e non assente) perché il job di refresh
          // ordina per questo campo e Firestore scarta i documenti che non l'hanno.
          lastComputedAt: null,
          computeDurationMs: null,
          computeError: null,
          brevoSyncedAt: null,
          ...auditCreate(caller.uid),
        });
      }

      if (input.type === 'static') {
        await syncStaticMembership(ref.id, existing?.contactIds ?? [], contactIds);
      } else if (existing?.type === 'static') {
        // Cambio di tipo: l'appartenenza manuale non ha più senso.
        await syncStaticMembership(ref.id, existing.contactIds ?? [], []);
      }

      let recompute: RecomputeClusterResult | null = null;
      if (input.recompute) {
        try {
          recompute = await recomputeClusterMembership(ref.id);
          warnings.push(...recompute.warnings);
        } catch (error) {
          log.error('Ricalcolo dopo il salvataggio fallito', error, { clusterId: ref.id });
          warnings.push(
            'Il cluster è stato salvato ma il ricalcolo non è riuscito: verrà ritentato dal job automatico.',
          );
        }
      }

      const saved = withId<Cluster>(await ref.get());

      if (input.syncToBrevo) {
        const apiKey = readApiKeyFromSecret();
        if (!apiKey) {
          warnings.push('Sincronizzazione Brevo non eseguita: chiave API non configurata.');
        } else {
          try {
            const result = await syncClusterToBrevoList(saved, apiKey);
            warnings.push(...result.warnings);
          } catch (error) {
            log.error('Sincronizzazione Brevo del cluster fallita', error, { clusterId: ref.id });
            warnings.push(
              `Sincronizzazione Brevo non riuscita: ${error instanceof Error ? error.message : 'errore sconosciuto'}`,
            );
          }
        }
      }

      await logActivity({
        action: existing ? 'cluster.update' : 'cluster.create',
        entityType: 'cluster',
        entityId: ref.id,
        userId: caller.uid,
        summary: `${existing ? 'Aggiornato' : 'Creato'} il cluster "${input.name}"`,
        metadata: { type: input.type, contactCount: recompute?.contactCount ?? saved.contactCount },
      });

      return { cluster: withId<Cluster>(await ref.get()), recompute, warnings };
    }),
);

// -----------------------------------------------------------------------------
// deleteCluster
// -----------------------------------------------------------------------------

const deleteSchema = z.object({
  clusterId: z.string().min(1),
  /** Elimina anche se il cluster è usato da newsletter o automazioni. */
  force: z.boolean().default(false),
});

export interface DeleteClusterResult {
  clusterId: DocId;
  detachedContacts: number;
  /** Lista Brevo associata effettivamente eliminata. */
  brevoListDeleted: boolean;
  /** Motivo per cui la lista Brevo non è stata eliminata, se applicabile. */
  brevoListError: string | null;
}

export const deleteCluster = onCall(
  { ...HEAVY_RUNTIME, secrets: [BREVO_API_KEY] },
  async (request: CallableRequest<unknown>): Promise<DeleteClusterResult> =>
    guard('deleteCluster', async () => {
      const caller = requirePermission(request, 'clusters:write');
      const { clusterId, force } = parseInput(deleteSchema, request.data);

      const ref = col.clusters().doc(clusterId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw notFound('Cluster', clusterId);
      const cluster = withId<Cluster>(snapshot);

      if (!force) {
        const [usedByNewsletters, usedByAutomations] = await Promise.all([
          col.newsletters().where('audience.clusterIds', 'array-contains', clusterId).limit(1).get(),
          col.automations().where('excludeClusterIds', 'array-contains', clusterId).limit(1).get(),
        ]);
        if (!usedByNewsletters.empty || !usedByAutomations.empty) {
          throw new AppError(
            'failed_precondition',
            'Il cluster è usato da newsletter o automazioni: rimuovilo prima da lì oppure forza l\'eliminazione.',
            {
              details: {
                newsletters: usedByNewsletters.size,
                automations: usedByAutomations.size,
              },
            },
          );
        }
      }

      const detachedContacts = await detachClusterFromContacts(clusterId);

      // La lista Brevo va rimossa prima del documento: se l'eliminazione del
      // cluster riuscisse e questa fallisse senza traccia, resterebbe una lista
      // orfana su Brevo senza più alcun riferimento per ritrovarla.
      // Un errore qui non blocca l'eliminazione: viene riportato al chiamante.
      let brevoListDeleted = false;
      let brevoListError: string | null = null;
      if (cluster.brevoListId) {
        const apiKey = readApiKeyFromSecret();
        if (apiKey) {
          const outcome = await removeClusterBrevoList(cluster, apiKey);
          brevoListDeleted = outcome.deleted;
          brevoListError = outcome.error;
        } else {
          brevoListError = 'Chiave API Brevo non configurata: la lista va rimossa manualmente.';
        }
      }

      await ref.delete();

      await logActivity({
        action: 'cluster.delete',
        entityType: 'cluster',
        entityId: clusterId,
        userId: caller.uid,
        summary: `Eliminato il cluster "${cluster.name}"`,
        metadata: {
          detachedContacts,
          forced: force,
          brevoListId: cluster.brevoListId ?? null,
          brevoListDeleted,
          brevoListError,
        },
        severity: 'warning',
      });

      return { clusterId, detachedContacts, brevoListDeleted, brevoListError };
    }),
);

// -----------------------------------------------------------------------------
// recomputeCluster
// -----------------------------------------------------------------------------

const recomputeSchema = z.object({
  clusterId: z.string().min(1),
  /** Forza anche il rispecchiamento sulla lista Brevo. */
  syncToBrevo: z.boolean().optional(),
});

export interface RecomputeClusterCallableResult extends RecomputeClusterResult {
  cluster: Cluster;
  brevo: { listId: number; added: number; removed: number } | null;
}

export const recomputeCluster = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<RecomputeClusterCallableResult> =>
    guard('recomputeCluster', async () => {
      const caller = requirePermission(request, 'clusters:write');
      const { clusterId, syncToBrevo } = parseInput(recomputeSchema, request.data);

      const result = await recomputeClusterMembership(clusterId);
      const cluster = withId<Cluster>(await col.clusters().doc(clusterId).get());

      let brevo: RecomputeClusterCallableResult['brevo'] = null;
      if (syncToBrevo ?? cluster.syncToBrevo) {
        const apiKey = readApiKeyFromSecret();
        if (!apiKey) {
          result.warnings.push('Sincronizzazione Brevo non eseguita: chiave API non configurata.');
        } else {
          try {
            const synced = await syncClusterToBrevoList(cluster, apiKey);
            brevo = { listId: synced.listId, added: synced.added, removed: synced.removed };
            result.warnings.push(...synced.warnings);
          } catch (error) {
            log.error('Sincronizzazione Brevo del cluster fallita', error, { clusterId });
            result.warnings.push(
              `Sincronizzazione Brevo non riuscita: ${error instanceof Error ? error.message : 'errore sconosciuto'}`,
            );
          }
        }
      }

      await logActivity({
        action: 'cluster.recompute',
        entityType: 'cluster',
        entityId: clusterId,
        userId: caller.uid,
        summary: `Ricalcolato il cluster "${result.name}": ${result.contactCount} contatti`,
        metadata: { added: result.added, removed: result.removed, durationMs: result.durationMs },
      });

      return { ...result, cluster, brevo };
    }),
);
