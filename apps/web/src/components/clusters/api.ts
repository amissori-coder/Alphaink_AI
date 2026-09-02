'use client';

import type { ClusterPreview } from '@alphaink/shared';

import { callable } from '@/lib/firebase/client';

import type {
  DeleteClusterResult,
  PreviewClusterInput,
  RecomputeClusterCallableResult,
  SaveClusterInput,
  SaveClusterResult,
} from './types';

/**
 * Callable dell'area cluster. I nomi e la forma dei payload corrispondono
 * esattamente a quanto esposto da `functions/src/clusters/callables.ts`:
 * in particolare `saveCluster` identifica il cluster esistente con `id`
 * (non `clusterId`), mentre le altre callable usano `clusterId`.
 */

/** Conta i contatti che soddisfano una definizione, senza salvarla. */
export const previewCluster = callable<PreviewClusterInput, ClusterPreview>('previewCluster', {
  timeoutMs: 120_000,
});

/** Crea o aggiorna un cluster e ne lancia il primo ricalcolo. */
export const saveCluster = callable<SaveClusterInput, SaveClusterResult>('saveCluster', {
  timeoutMs: 300_000,
});

/** Elimina un cluster; `force` serve quando è ancora usato da newsletter o automazioni. */
export const deleteCluster = callable<{ clusterId: string; force?: boolean }, DeleteClusterResult>(
  'deleteCluster',
  { timeoutMs: 300_000 },
);

/** Rivaluta le regole e riallinea l'appartenenza dei contatti. */
export const recomputeCluster = callable<
  { clusterId: string; syncToBrevo?: boolean },
  RecomputeClusterCallableResult
>('recomputeCluster', { timeoutMs: 300_000 });
