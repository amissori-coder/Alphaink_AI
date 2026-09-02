import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Firestore, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';
import { COLLECTIONS } from '@alphaink/shared';
import type { IsoDate } from '@alphaink/shared';

/** Inizializza l'app Admin una sola volta per istanza. */
if (getApps().length === 0) {
  initializeApp();
}

export const db: Firestore = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const auth = getAuth();
export const storage = getStorage();
export const bucket = storage.bucket();

export { FieldValue, Timestamp };

// -----------------------------------------------------------------------------
// Riferimenti tipizzati alle collezioni
// -----------------------------------------------------------------------------

export const col = {
  users: () => db.collection(COLLECTIONS.users),
  contacts: () => db.collection(COLLECTIONS.contacts),
  clusters: () => db.collection(COLLECTIONS.clusters),
  newsletters: () => db.collection(COLLECTIONS.newsletters),
  recipients: (newsletterId: string) =>
    db.collection(COLLECTIONS.newsletters).doc(newsletterId).collection(COLLECTIONS.recipients),
  templates: () => db.collection(COLLECTIONS.templates),
  automations: () => db.collection(COLLECTIONS.automations),
  automationRuns: (automationId: string) =>
    db.collection(COLLECTIONS.automations).doc(automationId).collection(COLLECTIONS.automationRuns),
  orders: () => db.collection(COLLECTIONS.orders),
  abandonedCarts: () => db.collection(COLLECTIONS.abandonedCarts),
  coupons: () => db.collection(COLLECTIONS.coupons),
  events: () => db.collection(COLLECTIONS.events),
  attributionTouches: () => db.collection(COLLECTIONS.attributionTouches),
  syncJobs: () => db.collection(COLLECTIONS.syncJobs),
  mediaAssets: () => db.collection(COLLECTIONS.mediaAssets),
  settings: () => db.collection(COLLECTIONS.settings),
  sendQueue: () => db.collection(COLLECTIONS.sendQueue),
  activityLog: () => db.collection(COLLECTIONS.activityLog),
  metricsDaily: () => db.collection(COLLECTIONS.metricsDaily),
  /** Query trasversale su tutte le sotto-collezioni `runs`. */
  allAutomationRuns: () => db.collectionGroup(COLLECTIONS.automationRuns),
  /** Query trasversale su tutte le sotto-collezioni `recipients`. */
  allRecipients: () => db.collectionGroup(COLLECTIONS.recipients),
};

// -----------------------------------------------------------------------------
// Conversione date
// -----------------------------------------------------------------------------

/** Converte un valore Firestore in stringa ISO, o `null`. */
export function isoOrNull(value: unknown): IsoDate | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

export function nowIso(): IsoDate {
  return new Date().toISOString();
}

/**
 * Converte ricorsivamente i `Timestamp` in stringhe ISO.
 * Usata prima di restituire documenti alle callable e alle API HTTP.
 */
export function serializeDoc<T = Record<string, unknown>>(data: unknown): T {
  if (data === null || data === undefined) return data as T;
  if (data instanceof Timestamp) return data.toDate().toISOString() as unknown as T;
  if (data instanceof Date) return data.toISOString() as unknown as T;
  if (Array.isArray(data)) return data.map((item) => serializeDoc(item)) as unknown as T;
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      out[key] = serializeDoc(value);
    }
    return out as T;
  }
  return data as T;
}

/** Documento + id, già serializzato. */
export function withId<T>(
  snapshot: FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot,
): T & { id: string } {
  return { ...(serializeDoc(snapshot.data()) as T), id: snapshot.id };
}

/** Campi di audit per una creazione. */
export function auditCreate(userId?: string | null): {
  createdAt: IsoDate; updatedAt: IsoDate; createdBy: string | null; updatedBy: string | null;
} {
  const now = nowIso();
  return { createdAt: now, updatedAt: now, createdBy: userId ?? null, updatedBy: userId ?? null };
}

/** Campi di audit per un aggiornamento. */
export function auditUpdate(userId?: string | null): { updatedAt: IsoDate; updatedBy: string | null } {
  return { updatedAt: nowIso(), updatedBy: userId ?? null };
}

// -----------------------------------------------------------------------------
// Utility di scrittura
// -----------------------------------------------------------------------------

/** Limite di operazioni per batch imposto da Firestore. */
export const BATCH_LIMIT = 500;

/**
 * Applica un elenco di operazioni in batch da 500, gestendo lo split.
 * Ogni operazione riceve il `WriteBatch` corrente.
 */
export async function commitInBatches(
  operations: Array<(batch: FirebaseFirestore.WriteBatch) => void>,
): Promise<number> {
  let committed = 0;
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const op of operations.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
    committed += Math.min(BATCH_LIMIT, operations.length - i);
  }
  return committed;
}

/**
 * Itera una query a pagine, senza caricare tutto in memoria.
 * La query deve avere un `orderBy` stabile (di norma `__name__`).
 */
export async function paginateQuery(
  query: FirebaseFirestore.Query,
  pageSize: number,
  handler: (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => Promise<void>,
): Promise<number> {
  let processed = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let page = query.limit(pageSize);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) break;
    await handler(snapshot.docs);
    processed += snapshot.size;
    cursor = snapshot.docs[snapshot.size - 1];
    if (snapshot.size < pageSize) break;
  }
  return processed;
}

/** Registra una voce nel log attività consultabile dalla UI. */
export async function logActivity(entry: {
  action: string;
  entityType: string;
  entityId?: string | null;
  userId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error';
}): Promise<void> {
  await col.activityLog().add({
    ...entry,
    entityId: entry.entityId ?? null,
    userId: entry.userId ?? null,
    severity: entry.severity ?? 'info',
    createdAt: nowIso(),
  });
}
