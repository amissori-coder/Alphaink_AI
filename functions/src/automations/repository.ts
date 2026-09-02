/**
 * Accesso a Firestore per il motore delle automazioni.
 *
 * Due collezioni:
 *  - `automations/{automationId}` — definizione, contenuti e statistiche;
 *  - `automations/{automationId}/runs/{dedupeKey}` — una esecuzione programmata.
 *
 * Scelta chiave: **l'id del documento `run` è la sua `dedupeKey`**. Così due
 * arruolamenti generati dallo stesso trigger collidono a livello di Firestore
 * (`create()` fallisce con `ALREADY_EXISTS`) e l'idempotenza non dipende da una
 * lettura preventiva soggetta a race condition.
 *
 * Le automazioni predefinite usano la propria `key` come id documento: rende
 * `ensureCoreAutomations` idempotente e la lettura per chiave una `get` diretta.
 */

import {
  DEFAULT_BRANDING,
  DEFAULT_TRACKING_SETTINGS,
  EMPTY_AUTOMATION_STATS,
  EMPTY_STEP_STATS,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationKey,
  AutomationRun,
  AutomationRunStatus,
  AutomationStats,
  AutomationStep,
  AutomationStepStats,
  BrandingSettings,
  DocId,
  IsoDate,
  TrackingSettings,
} from '@alphaink/shared';

import { AppError, notFound } from '../lib/errors';
import {
  auditCreate,
  auditUpdate,
  col,
  db,
  nowIso,
  serializeDoc,
  withId,
} from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { buildDefaultAutomations } from './defaults';
import type { DefaultAutomation } from './defaults';

const log = createLogger('automations.repository');

// -----------------------------------------------------------------------------
// Impostazioni usate dalle automazioni
// -----------------------------------------------------------------------------

/** `settings/branding` completato con i default AlphaInk. */
export async function readBrandingSettings(): Promise<BrandingSettings> {
  const snapshot = await col.settings().doc('branding').get();
  const now = nowIso();
  const defaults: BrandingSettings = { ...DEFAULT_BRANDING, createdAt: now, updatedAt: now };
  if (!snapshot.exists) return defaults;
  const stored = serializeDoc<Partial<BrandingSettings>>(snapshot.data() ?? {});
  return {
    ...defaults,
    ...stored,
    palette: { ...defaults.palette, ...(stored.palette ?? {}) },
    fonts: { ...defaults.fonts, ...(stored.fonts ?? {}) },
    socialLinks: stored.socialLinks ?? defaults.socialLinks,
  };
}

/** `settings/tracking` completato con i default. */
export async function readTrackingSettings(): Promise<TrackingSettings> {
  const snapshot = await col.settings().doc('tracking').get();
  const now = nowIso();
  const defaults: TrackingSettings = { ...DEFAULT_TRACKING_SETTINGS, createdAt: now, updatedAt: now };
  if (!snapshot.exists) return defaults;
  const stored = serializeDoc<Partial<TrackingSettings>>(snapshot.data() ?? {});
  return {
    ...defaults,
    ...stored,
    attribution: { ...defaults.attribution, ...(stored.attribution ?? {}) },
  };
}

// -----------------------------------------------------------------------------
// Automazioni — lettura
// -----------------------------------------------------------------------------

export async function listAutomations(): Promise<Automation[]> {
  const snapshot = await col.automations().get();
  return snapshot.docs.map((doc) => withId<Automation>(doc));
}

export async function getAutomation(automationId: DocId): Promise<Automation | null> {
  const snapshot = await col.automations().doc(automationId).get();
  return snapshot.exists ? withId<Automation>(snapshot) : null;
}

/** Come `getAutomation` ma solleva `not_found` invece di restituire `null`. */
export async function requireAutomation(automationId: DocId): Promise<Automation> {
  const automation = await getAutomation(automationId);
  if (!automation) throw notFound('Automazione', automationId);
  return automation;
}

/**
 * Automazione di una chiave nota.
 * Prima si tenta l'id deterministico, poi si ripiega sulla query: le
 * automazioni create a mano dalla UI hanno un id casuale.
 */
export async function getAutomationByKey(key: AutomationKey): Promise<Automation | null> {
  const direct = await col.automations().doc(key).get();
  if (direct.exists) return withId<Automation>(direct);

  const snapshot = await col.automations().where('key', '==', key).limit(1).get();
  const doc = snapshot.docs[0];
  return doc ? withId<Automation>(doc) : null;
}

/** Tutte le automazioni attive di un tipo di trigger. */
export async function getEnabledAutomationsByTrigger(
  triggerType: Automation['trigger']['type'],
): Promise<Automation[]> {
  const snapshot = await col.automations().where('enabled', '==', true).get();
  return snapshot.docs
    .map((doc) => withId<Automation>(doc))
    .filter((automation) => automation.trigger?.type === triggerType);
}

/** Step di un'automazione, per id. */
export function findStep(automation: Automation, stepId: string): AutomationStep | null {
  return (automation.steps ?? []).find((step) => step.id === stepId) ?? null;
}

// -----------------------------------------------------------------------------
// Automazioni — scrittura
// -----------------------------------------------------------------------------

/** Crea un'automazione. Con `docId` valorizzato l'id è deterministico. */
export async function createAutomation(
  data: DefaultAutomation | Omit<Automation, 'id'>,
  options: { docId?: string; userId?: string | null } = {},
): Promise<Automation> {
  const ref = options.docId ? col.automations().doc(options.docId) : col.automations().doc();
  const payload = { ...data, ...auditCreate(options.userId ?? null) };
  await ref.set(payload);
  return { ...(payload as Omit<Automation, 'id'>), id: ref.id };
}

export async function updateAutomation(
  automationId: DocId,
  patch: Partial<Omit<Automation, 'id'>>,
  userId?: string | null,
): Promise<Automation> {
  const ref = col.automations().doc(automationId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw notFound('Automazione', automationId);
  await ref.set({ ...patch, ...auditUpdate(userId ?? null) }, { merge: true });
  return requireAutomation(automationId);
}

/**
 * Elimina un'automazione e le sue esecuzioni.
 * Le automazioni core non si eliminano: si disattivano.
 */
export async function deleteAutomation(automationId: DocId): Promise<void> {
  const automation = await requireAutomation(automationId);
  if (automation.isCore) {
    throw new AppError(
      'failed_precondition',
      `"${automation.name}" è un'automazione obbligatoria: puoi disattivarla, non eliminarla.`,
    );
  }
  await deleteRuns(automationId);
  await col.automations().doc(automationId).delete();
}

/** Cancella tutte le run di un'automazione, a blocchi. */
export async function deleteRuns(automationId: DocId): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snapshot = await runsRef(automationId).limit(400).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < 400) break;
  }
  return deleted;
}

export interface EnsureCoreResult {
  created: AutomationKey[];
  existing: AutomationKey[];
}

/**
 * Crea le automazioni predefinite mancanti (le quattro obbligatorie più
 * benvenuto e win-back). Idempotente: le automazioni già presenti non vengono
 * toccate, così un nuovo `seedDefaults` non sovrascrive il lavoro dell'operatore.
 */
export async function ensureCoreAutomations(
  options: { userId?: string | null } = {},
): Promise<EnsureCoreResult> {
  const branding = await readBrandingSettings();
  const defaults = buildDefaultAutomations(branding);
  const created: AutomationKey[] = [];
  const existing: AutomationKey[] = [];

  for (const definition of defaults) {
    const ref = col.automations().doc(definition.key);
    try {
      // `create` fallisce se il documento esiste già: è la garanzia di
      // idempotenza anche con due seed lanciati in parallelo.
      await ref.create({ ...definition, ...auditCreate(options.userId ?? null) });
      created.push(definition.key);
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      // 6 = ALREADY_EXISTS nel protocollo gRPC di Firestore.
      if (code === 6 || code === 'already-exists') {
        existing.push(definition.key);
        continue;
      }
      throw error;
    }
  }

  if (created.length) {
    log.info('Automazioni predefinite create', { created });
  }
  return { created, existing };
}

// -----------------------------------------------------------------------------
// Statistiche
// -----------------------------------------------------------------------------

export type StepStatsDelta = Partial<AutomationStepStats>;
export type AutomationStatsDelta = Partial<Omit<AutomationStats, 'currency' | 'updatedAt'>>;

function addStats<T extends Record<string, number>>(base: T, delta: Partial<T>): T {
  const out: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value !== 'number' || value === 0) continue;
    out[key] = (out[key] ?? 0) + value;
  }
  return out as T;
}

export interface ApplyStatsInput {
  /** Incrementi per step, indicizzati per `stepId`. */
  steps?: Record<string, StepStatsDelta>;
  /** Incrementi sui contatori aggregati dell'automazione. */
  automation?: AutomationStatsDelta;
  lastRunAt?: IsoDate | null;
  lastError?: string | null;
}

/**
 * Applica gli incrementi di statistica in un'unica transazione.
 *
 * Gli step vivono dentro un array del documento automazione, quindi non è
 * possibile usare `FieldValue.increment`: serve leggere, ricalcolare e
 * riscrivere. Per limitare la contesa il dispatcher accumula i delta di un
 * intero ciclo e chiama questa funzione una volta per automazione.
 */
export async function applyAutomationStats(
  automationId: DocId,
  input: ApplyStatsInput,
): Promise<void> {
  const ref = col.automations().doc(automationId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const current = serializeDoc<Automation>(snapshot.data() ?? {});

    const steps = (current.steps ?? []).map((step) => {
      const delta = input.steps?.[step.id];
      if (!delta) return step;
      return { ...step, stats: addStats({ ...EMPTY_STEP_STATS, ...(step.stats ?? {}) }, delta) };
    });

    const stats: AutomationStats = {
      ...EMPTY_AUTOMATION_STATS,
      ...(current.stats ?? {}),
      ...addStats(
        {
          enrolled: current.stats?.enrolled ?? 0,
          scheduled: current.stats?.scheduled ?? 0,
          sent: current.stats?.sent ?? 0,
          cancelled: current.stats?.cancelled ?? 0,
          delivered: current.stats?.delivered ?? 0,
          opened: current.stats?.opened ?? 0,
          clicked: current.stats?.clicked ?? 0,
          orders: current.stats?.orders ?? 0,
          revenue: current.stats?.revenue ?? 0,
        },
        input.automation ?? {},
      ),
      currency: current.stats?.currency ?? EMPTY_AUTOMATION_STATS.currency,
      updatedAt: nowIso(),
    };

    const patch: Record<string, unknown> = { steps, stats, updatedAt: nowIso() };
    if (input.lastRunAt !== undefined) patch.lastRunAt = input.lastRunAt;
    if (input.lastError !== undefined) {
      patch.lastError = input.lastError;
      patch.lastErrorAt = input.lastError ? nowIso() : null;
    }
    tx.set(ref, patch, { merge: true });
  });
}

// -----------------------------------------------------------------------------
// Esecuzioni (`runs`)
// -----------------------------------------------------------------------------

export function runsRef(automationId: DocId): FirebaseFirestore.CollectionReference {
  return col.automationRuns(automationId);
}

/** Id dell'automazione a partire da un documento letto in collection group. */
export function automationIdOf(doc: FirebaseFirestore.QueryDocumentSnapshot): DocId {
  return doc.ref.parent.parent?.id ?? '';
}

export async function getRun(automationId: DocId, runId: DocId): Promise<AutomationRun | null> {
  const snapshot = await runsRef(automationId).doc(runId).get();
  return snapshot.exists ? withId<AutomationRun>(snapshot) : null;
}

/**
 * Crea una run con id = `dedupeKey`.
 * Restituisce `false` se esisteva già: è il caso "duplicato", non un errore.
 */
export async function createRun(
  automationId: DocId,
  run: Omit<AutomationRun, 'id'>,
): Promise<{ created: boolean; id: DocId }> {
  const ref = runsRef(automationId).doc(run.dedupeKey);
  try {
    await ref.create(run);
    return { created: true, id: ref.id };
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 6 || code === 'already-exists') return { created: false, id: ref.id };
    throw error;
  }
}

export async function updateRun(
  automationId: DocId,
  runId: DocId,
  patch: Partial<AutomationRun>,
): Promise<void> {
  await runsRef(automationId).doc(runId).set(patch, { merge: true });
}

/** Run pronte per l'invio: programmate e con orario già trascorso. */
export async function dueRuns(limit: number, now: IsoDate = nowIso()): Promise<AutomationRun[]> {
  const snapshot = await col
    .allAutomationRuns()
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', now)
    .orderBy('scheduledFor', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => ({
    ...withId<AutomationRun>(doc),
    automationId: automationIdOf(doc),
  }));
}

export interface RunHistoryQuery {
  contactId: DocId;
  automationKey: AutomationKey;
  /** Solo le run create dopo questa data. */
  since?: IsoDate | null;
  limit?: number;
}

/** Storico delle run di un contatto per una automazione, dalla più recente. */
export async function findRunsForContact(query: RunHistoryQuery): Promise<AutomationRun[]> {
  let firestoreQuery = col
    .allAutomationRuns()
    .where('contactId', '==', query.contactId)
    .where('automationKey', '==', query.automationKey);
  if (query.since) firestoreQuery = firestoreQuery.where('createdAt', '>=', query.since);
  const snapshot = await firestoreQuery
    .orderBy('createdAt', 'desc')
    .limit(query.limit ?? 50)
    .get();
  return snapshot.docs.map((doc) => ({
    ...withId<AutomationRun>(doc),
    automationId: automationIdOf(doc),
  }));
}

/** Run ancora programmate per un contatto (usate dalle condizioni di annullamento). */
export async function findPendingRunsForContact(
  contactId: DocId,
  automationKey: AutomationKey,
  limit = 50,
): Promise<AutomationRun[]> {
  const runs = await findRunsForContact({ contactId, automationKey, limit });
  return runs.filter((run) => run.status === 'scheduled');
}

/** Marca una run come annullata. */
export async function cancelRun(
  automationId: DocId,
  runId: DocId,
  reason: NonNullable<AutomationRun['cancelledReason']>,
): Promise<void> {
  await updateRun(automationId, runId, {
    status: 'cancelled',
    cancelledReason: reason,
    processedAt: nowIso(),
  });
}

/**
 * Annulla tutte le run programmate di un contatto per le automazioni indicate.
 * Restituisce il numero di run annullate per automazione, così il chiamante può
 * aggiornare le statistiche in un colpo solo.
 */
export async function cancelPendingRuns(options: {
  contactId: DocId;
  automationKeys: AutomationKey[];
  reason: NonNullable<AutomationRun['cancelledReason']>;
  /** Filtro aggiuntivo sulla run (es. stesso ordine, stessa famiglia). */
  filter?: (run: AutomationRun) => boolean;
}): Promise<Array<{ automationId: DocId; stepId: string; runId: DocId }>> {
  const cancelled: Array<{ automationId: DocId; stepId: string; runId: DocId }> = [];

  for (const key of options.automationKeys) {
    const runs = await findPendingRunsForContact(options.contactId, key);
    for (const run of runs) {
      if (options.filter && !options.filter(run)) continue;
      if (!run.automationId) continue;
      await cancelRun(run.automationId, run.id, options.reason);
      cancelled.push({ automationId: run.automationId, stepId: run.stepId, runId: run.id });
    }
  }
  return cancelled;
}

export interface ListRunsOptions {
  status?: AutomationRunStatus;
  stepId?: string;
  limit?: number;
}

/**
 * Ultime run di un'automazione, dalla più recente.
 *
 * Stato e step si filtrano in memoria: un `where` su `status` combinato con
 * l'ordinamento richiederebbe un indice composito di collezione che non è
 * dichiarato (quelli su `runs` sono tutti di gruppo). Si legge quindi un po'
 * più del necessario e si scarta qui.
 */
export async function listRuns(
  automationId: DocId,
  options: ListRunsOptions = {},
): Promise<AutomationRun[]> {
  const limit = options.limit ?? 50;
  const overfetch = options.status || options.stepId ? Math.min(limit * 5, 500) : limit;
  const snapshot = await runsRef(automationId).orderBy('createdAt', 'desc').limit(overfetch).get();
  const runs = snapshot.docs.map((doc) => ({ ...withId<AutomationRun>(doc), automationId }));
  return runs
    .filter((run) => (options.status ? run.status === options.status : true))
    .filter((run) => (options.stepId ? run.stepId === options.stepId : true))
    .slice(0, limit);
}

/** Run inviate in un intervallo: base della serie temporale del report. */
export async function listSentRunsBetween(
  automationId: DocId,
  from: IsoDate,
  to: IsoDate,
  limit = 2000,
): Promise<AutomationRun[]> {
  const snapshot = await runsRef(automationId)
    .where('sentAt', '>=', from)
    .where('sentAt', '<=', to)
    .orderBy('sentAt', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => ({ ...withId<AutomationRun>(doc), automationId }));
}
