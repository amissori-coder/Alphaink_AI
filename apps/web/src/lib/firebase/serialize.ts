import { type DocumentData, GeoPoint, Timestamp } from 'firebase/firestore';

/**
 * Converte ricorsivamente i valori Firestore in valori JSON-safe.
 * In particolare i `Timestamp` diventano stringhe ISO-8601, coerentemente con
 * il contratto di @alphaink/shared (le date nei documenti sono sempre stringhe).
 */
export function serializeFirestore<T = unknown>(value: unknown): T {
  return convert(value, 0) as T;
}

const MAX_DEPTH = 12;

function convert(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_DEPTH) return value;

  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };

  // DocumentReference e simili: si conserva solo il percorso.
  if (isDocumentReference(value)) return value.path;

  if (Array.isArray(value)) return value.map((item) => convert(item, depth + 1));

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      target[key] = convert(source[key], depth + 1);
    }
    return target;
  }

  return value;
}

function isDocumentReference(value: unknown): value is { path: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    'id' in value &&
    'firestore' in value &&
    typeof (value as { path: unknown }).path === 'string'
  );
}

/** Documento Firestore normalizzato: `id` più i campi serializzati. */
export function withId<T>(id: string, data: DocumentData | undefined): T {
  return { id, ...serializeFirestore<Record<string, unknown>>(data ?? {}) } as T;
}
