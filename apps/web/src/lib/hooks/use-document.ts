'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, onSnapshot } from 'firebase/firestore';
import * as React from 'react';

import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';
import { withId } from '@/lib/firebase/serialize';
import {
  clearDeferred,
  firestoreErrorMessage,
  rejectDeferred,
  resolveDeferred,
} from '@/lib/hooks/use-collection';

export interface UseDocumentOptions {
  /** Disattiva la sottoscrizione (es. in creazione, quando l'id non esiste). */
  enabled?: boolean;
}

export interface UseDocumentResult<T> {
  /** Documento serializzato, `null` se non esiste. */
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** False quando il documento è stato letto e non esiste. */
  exists: boolean;
}

// Ponte fra `onSnapshot` e React Query, analogo a quello di `use-collection`:
// la prima lettura attende lo snapshot iniziale, le successive arrivano in push.

type Waiter = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const pendingResolvers = new Map<string, Waiter[]>();
const latestValues = new Map<string, unknown>();

function documentPromise<T>(signature: string): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const waiters = pendingResolvers.get(signature) ?? [];
    waiters.push({ resolve: resolve as (value: unknown) => void, reject });
    pendingResolvers.set(signature, waiters);
  });
}

function settleDocument(signature: string, value: unknown): void {
  latestValues.set(signature, value);
  const waiting = pendingResolvers.get(signature);
  if (waiting) {
    for (const waiter of waiting) waiter.resolve(value);
    pendingResolvers.delete(signature);
  }
}

function failDocument(signature: string, error: unknown): void {
  const waiting = pendingResolvers.get(signature);
  if (waiting) {
    for (const waiter of waiting) waiter.reject(error);
    pendingResolvers.delete(signature);
  }
}

function cleanupDocument(signature: string): void {
  pendingResolvers.delete(signature);
  latestValues.delete(signature);
  clearDeferred(signature);
}

/**
 * Sottoscrive in tempo reale un singolo documento Firestore.
 *
 * ```ts
 * const { data, loading } = useDocumentQuery<Newsletter>(COLLECTIONS.newsletters, id);
 * ```
 *
 * `path` può essere una collezione (con `id` separato) oppure un percorso
 * completo con un numero pari di segmenti (in quel caso `id` va omesso).
 */
export function useDocumentQuery<T = Record<string, unknown>>(
  path: string,
  id?: string | null,
  options: UseDocumentOptions = {},
): UseDocumentResult<T> {
  const queryClient = useQueryClient();

  const fullPath = React.useMemo(() => {
    if (!path) return '';
    if (id) return `${path.replace(/\/+$/, '')}/${id}`;
    return path.split('/').length % 2 === 0 ? path : '';
  }, [path, id]);

  const enabled = (options.enabled ?? true) && Boolean(fullPath) && isFirebaseConfigured();
  const signature = `document:${fullPath}`;
  const queryKey = React.useMemo(() => ['firestore', 'document', fullPath] as const, [fullPath]);

  const [snapshotError, setSnapshotError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    setSnapshotError(null);

    const segments = fullPath.split('/');
    const reference = doc(getDb(), segments[0]!, ...segments.slice(1));

    const unsubscribe = onSnapshot(
      reference,
      (snapshot) => {
        const value = snapshot.exists() ? withId<T>(snapshot.id, snapshot.data()) : null;
        setSnapshotError(null);
        settleDocument(signature, value);
        resolveDeferred(signature, value);
        queryClient.setQueryData(queryKey, value);
      },
      (error) => {
        const normalized = new Error(firestoreErrorMessage(error));
        setSnapshotError(normalized);
        failDocument(signature, normalized);
        rejectDeferred(signature, normalized);
      },
    );

    return () => {
      unsubscribe();
      cleanupDocument(signature);
    };
  }, [enabled, fullPath, signature, queryKey, queryClient]);

  const query = useQuery<T | null>({
    queryKey,
    queryFn: () => {
      if (latestValues.has(signature)) {
        return Promise.resolve(latestValues.get(signature) as T | null);
      }
      return documentPromise<T>(signature);
    },
    enabled,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const error = snapshotError ?? (query.error ? new Error(firestoreErrorMessage(query.error)) : null);

  // `exists` è derivato dal dato e non da uno stato locale: al rimontaggio la
  // cache di React Query restituisce il documento in modo sincrono, mentre uno
  // stato ripartito da `false` avrebbe fatto lampeggiare "non trovato" su un
  // documento esistente finché non arrivava il primo snapshot.
  const exists = query.data !== undefined && query.data !== null;

  return {
    data: query.data ?? null,
    loading: enabled && query.data === undefined && !error,
    error,
    exists,
  };
}
