'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type FirestoreError,
  type QueryConstraint,
  collection,
  onSnapshot,
  query as buildQuery,
} from 'firebase/firestore';
import * as React from 'react';

import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';
import { withId } from '@/lib/firebase/serialize';

export interface UseCollectionOptions {
  /** Disattiva la sottoscrizione (es. finché non è noto un id padre). */
  enabled?: boolean;
  /** Chiave aggiuntiva per distinguere query con gli stessi vincoli. */
  key?: string;
  /** Include i documenti ancora in scrittura locale (default: true). */
  includePendingWrites?: boolean;
}

export interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  /** True quando i dati provengono da scritture non ancora confermate dal server. */
  fromCache: boolean;
}

// -----------------------------------------------------------------------------
// Ponte fra `onSnapshot` (push) e React Query (pull).
// La query iniziale attende il primo snapshot tramite un "deferred" condiviso;
// gli snapshot successivi aggiornano direttamente la cache di React Query.
// -----------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, settled: false };
}

const deferreds = new Map<string, Deferred<unknown>>();

function deferredFor<T>(key: string): Deferred<T> {
  let entry = deferreds.get(key) as Deferred<T> | undefined;
  if (!entry) {
    entry = createDeferred<T>();
    deferreds.set(key, entry as Deferred<unknown>);
  }
  return entry;
}

/** Risolve (o sostituisce) il deferred con il valore più recente. */
export function resolveDeferred<T>(key: string, value: T): void {
  const entry = deferredFor<T>(key);
  if (entry.settled) {
    const fresh = createDeferred<T>();
    fresh.settled = true;
    fresh.resolve(value);
    deferreds.set(key, fresh as Deferred<unknown>);
    return;
  }
  entry.settled = true;
  entry.resolve(value);
}

/** Rifiuta il deferred in attesa (errore di permessi, rete, indice mancante…). */
export function rejectDeferred(key: string, error: unknown): void {
  const entry = deferreds.get(key);
  if (entry && !entry.settled) {
    entry.settled = true;
    entry.reject(error);
  }
  deferreds.delete(key);
}

export function clearDeferred(key: string): void {
  deferreds.delete(key);
}

/** Messaggi in italiano per gli errori Firestore più comuni. */
export function firestoreErrorMessage(error: unknown): string {
  const code = (error as FirestoreError | null)?.code;
  switch (code) {
    case 'permission-denied':
      return 'Non hai i permessi per leggere questi dati.';
    case 'unauthenticated':
      return 'Sessione scaduta: effettua di nuovo l’accesso.';
    case 'unavailable':
      return 'Connessione al database non disponibile. Riprova.';
    case 'failed-precondition':
      return 'Query non supportata: manca un indice Firestore.';
    case 'resource-exhausted':
      return 'Limite di lettura raggiunto. Riprova più tardi.';
    default:
      return (error as Error | null)?.message?.trim() || 'Impossibile caricare i dati.';
  }
}

/** Firma stabile dei vincoli, usata come parte della chiave di cache. */
function constraintsKey(constraints: QueryConstraint[]): string {
  return constraints
    .map((constraint) => {
      const anyConstraint = constraint as unknown as Record<string, unknown>;
      const type = (anyConstraint.type as string) ?? 'constraint';
      const field = anyConstraint._field ?? anyConstraint._forField ?? '';
      const op = anyConstraint._op ?? anyConstraint._direction ?? '';
      const value = anyConstraint._value ?? anyConstraint._limit ?? anyConstraint._docOrFields ?? '';
      try {
        return `${type}:${String(field)}:${String(op)}:${JSON.stringify(value)}`;
      } catch {
        return `${type}:${String(field)}:${String(op)}`;
      }
    })
    .join('|');
}

/**
 * Sottoscrive in tempo reale una collezione Firestore.
 *
 * ```ts
 * const { data, loading, error } = useCollectionQuery<Newsletter>(
 *   COLLECTIONS.newsletters,
 *   [where('status', '==', 'scheduled'), orderBy('schedule.sendAt', 'asc')],
 * );
 * ```
 */
export function useCollectionQuery<T = Record<string, unknown>>(
  path: string,
  constraints: QueryConstraint[] = [],
  options: UseCollectionOptions = {},
): UseCollectionResult<T> {
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && Boolean(path) && isFirebaseConfigured();

  const signature = React.useMemo(
    () => `${path}?${constraintsKey(constraints)}${options.key ? `#${options.key}` : ''}`,
    // I vincoli sono ricreati a ogni render: la firma serializzata è la vera dipendenza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, constraintsKey(constraints), options.key],
  );

  const queryKey = React.useMemo(() => ['firestore', 'collection', signature] as const, [signature]);

  const [fromCache, setFromCache] = React.useState(false);
  const [snapshotError, setSnapshotError] = React.useState<Error | null>(null);

  // Riferimento ai vincoli correnti: evita di ricreare la sottoscrizione a ogni render.
  const constraintsRef = React.useRef(constraints);
  constraintsRef.current = constraints;

  React.useEffect(() => {
    if (!enabled) return;
    setSnapshotError(null);

    const reference = buildQuery(collection(getDb(), path), ...constraintsRef.current);
    const unsubscribe = onSnapshot(
      reference,
      { includeMetadataChanges: options.includePendingWrites ?? false },
      (snapshot) => {
        const rows = snapshot.docs.map((document) => withId<T>(document.id, document.data()));
        setFromCache(snapshot.metadata.fromCache);
        setSnapshotError(null);
        resolveDeferred(signature, rows);
        queryClient.setQueryData(queryKey, rows);
      },
      (error) => {
        const normalized = new Error(firestoreErrorMessage(error));
        setSnapshotError(normalized);
        rejectDeferred(signature, normalized);
        queryClient.setQueryData(queryKey, (previous: T[] | undefined) => previous ?? []);
      },
    );

    return () => {
      unsubscribe();
      clearDeferred(signature);
    };
  }, [enabled, path, signature, queryKey, queryClient, options.includePendingWrites]);

  const query = useQuery<T[]>({
    queryKey,
    // Risolta dal primo snapshot: nessuna lettura aggiuntiva rispetto al listener.
    queryFn: () => deferredFor<T[]>(signature).promise,
    enabled,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const error = snapshotError ?? (query.error ? new Error(firestoreErrorMessage(query.error)) : null);

  return {
    data: query.data ?? [],
    loading: enabled && query.data === undefined && !error,
    error,
    fromCache,
  };
}
