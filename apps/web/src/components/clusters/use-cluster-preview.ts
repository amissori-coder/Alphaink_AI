'use client';

import type { ClusterPreview } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { isFirebaseConfigured } from '@/lib/firebase/client';

import { previewCluster } from './api';
import { PREVIEW_DEBOUNCE_MS, PREVIEW_SAMPLE_SIZE } from './constants';
import type { ClusterDraft, PreviewClusterInput } from './types';

/** Parte della bozza che influenza il conteggio: il resto (nome, colore) no. */
function toPreviewInput(draft: ClusterDraft): PreviewClusterInput {
  return {
    type: draft.type,
    rules: draft.type === 'dynamic' ? draft.rules : null,
    contactIds: draft.type === 'static' ? draft.contactIds : [],
    siteGroupName: draft.type === 'site_group' ? draft.siteGroupName.trim() || null : null,
    brevoListId: draft.type === 'brevo_list' ? draft.brevoListId : null,
    limit: PREVIEW_SAMPLE_SIZE,
  };
}

export interface UseClusterPreviewResult {
  preview: ClusterPreview | null;
  loading: boolean;
  error: Error | null;
  /** True quando la bozza è cambiata ma il debounce non è ancora scaduto. */
  stale: boolean;
  /** Forza il ricalcolo immediato, saltando il debounce. */
  refresh: () => void;
}

/**
 * Anteprima live del cluster in costruzione.
 *
 * La chiamata è in debounce: digitare dentro una condizione non deve produrre
 * una richiesta per ogni carattere. La firma dell'input fa da chiave di cache,
 * così tornare su una configurazione già vista mostra subito il risultato.
 */
export function useClusterPreview(
  draft: ClusterDraft,
  enabled = true,
): UseClusterPreviewResult {
  const input = React.useMemo(() => toPreviewInput(draft), [draft]);
  const signature = React.useMemo(() => JSON.stringify(input), [input]);

  const [debouncedSignature, setDebouncedSignature] = React.useState(signature);

  React.useEffect(() => {
    if (signature === debouncedSignature) return undefined;
    const timer = window.setTimeout(() => setDebouncedSignature(signature), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [signature, debouncedSignature]);

  const query = useQuery<ClusterPreview, Error>({
    queryKey: ['cluster', 'anteprima', debouncedSignature],
    // La firma è la serializzazione dell'input: si rilegge da lì invece di
    // catturare `input`, così la query resta legata alla chiave di cache.
    queryFn: () => previewCluster(JSON.parse(debouncedSignature) as PreviewClusterInput),
    enabled: enabled && isFirebaseConfigured(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const refresh = React.useCallback(() => {
    if (signature !== debouncedSignature) {
      setDebouncedSignature(signature);
      return;
    }
    void query.refetch();
  }, [signature, debouncedSignature, query]);

  return {
    preview: query.data ?? null,
    loading: query.isFetching,
    error: query.error ?? null,
    stale: signature !== debouncedSignature,
    refresh,
  };
}
