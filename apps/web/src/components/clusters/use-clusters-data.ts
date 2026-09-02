'use client';

import { COLLECTIONS } from '@alphaink/shared';
import type { Cluster } from '@alphaink/shared';
import { limit, orderBy } from 'firebase/firestore';

import { type UseCollectionResult, useCollectionQuery } from '@/lib/hooks/use-collection';
import { type UseDocumentResult, useDocumentQuery } from '@/lib/hooks/use-document';

import { CLUSTER_FETCH_LIMIT } from './constants';

/**
 * Sottoscrizioni in tempo reale dell'area cluster.
 * L'ordinamento per nome usa l'indice a campo singolo creato in automatico da
 * Firestore: nessuna configurazione aggiuntiva richiesta.
 */
export function useClusters(enabled = true): UseCollectionResult<Cluster> {
  return useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limit(CLUSTER_FETCH_LIMIT)],
    { enabled, key: 'cluster-elenco' },
  );
}

/** Singolo cluster, in modifica. */
export function useCluster(clusterId: string | null): UseDocumentResult<Cluster> {
  return useDocumentQuery<Cluster>(COLLECTIONS.clusters, clusterId, {
    enabled: Boolean(clusterId),
  });
}
