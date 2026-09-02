/**
 * Orchestratore della sincronizzazione.
 *
 * Un job = un negozio. I due negozi AlphaInk si sincronizzano in modo
 * indipendente (cursori, contatori ed errori separati), ma scrivono sugli
 * stessi contatti: la deduplica avviene sull'email normalizzata dentro
 * `repository.ts`, quindi un cliente presente su entrambi i negozi resta un
 * documento solo con `sources` ed `externalIds` accumulati.
 *
 * Principi di funzionamento:
 *
 * - **Resilienza.** Ogni entità è isolata: se gli ordini falliscono, clienti e
 *   carrelli vengono comunque sincronizzati e il job si chiude in stato
 *   `partial` con l'errore registrato, invece di perdere tutto il lavoro.
 *
 * - **Ripresa.** Cursore e contatori sono salvati sul documento `syncJobs` ad
 *   ogni pagina. Se il budget di tempo finisce (le Functions hanno un limite di
 *   9 minuti) il job si chiude in `partial` indicando da dove ripartire: la
 *   corsa successiva riprende dal cursore invece che dall'inizio.
 *
 * - **Finestra di sovrapposizione.** L'incrementale riparte da
 *   `lastSyncAt - 15 minuti`: gli orologi di negozio e Functions non sono
 *   allineati al secondo e un record scritto durante il job precedente
 *   andrebbe altrimenti perso. Le scritture sono idempotenti, quindi rileggere
 *   qualche record non fa danni.
 *
 * - **Avanzamento della finestra.** `lastSyncAt` avanza solo quando la finestra
 *   è stata davvero coperta (job `success`) e solo fino all'avvio della PRIMA
 *   corsa della catena: un'entità fallita o una ripresa ancora in sospeso
 *   lasciano scoperto un pezzo di finestra che, se `lastSyncAt` avanzasse,
 *   nessuna corsa successiva rileggerebbe più.
 *
 * - **Annullamento.** `cancelSiteSync` marca il job con `cancelRequested`;
 *   l'orchestratore lo rilegge ad ogni pagina e si ferma in modo pulito.
 */

import { FieldPath } from 'firebase-admin/firestore';
import {
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  SITE_SOURCE_LABELS,
  STORE_DEFAULT_SEGMENT,
  randomId,
} from '@alphaink/shared';
import type {
  IsoDate,
  PrestaShopStoreSettings,
  StoreSource,
  SyncCounts,
  SyncEntity,
  SyncJob,
  SyncJobStatus,
} from '@alphaink/shared';
import { AppError } from '../lib/errors';
import { col, commitInBatches, logActivity, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { getAdapter } from './prestashop';
import {
  recomputeContactsStats,
  upsertAbandonedCartsBatch,
  upsertContactsBatch,
  upsertOrdersBatch,
} from './repository';
import { markStoreSync, readSiteSettings, writeSiteSettings } from './settings';
import type { SiteAdapter } from './types';
import { SYNC_DEFAULT_PAGE_SIZE } from './types';

const log = createLogger('sync.orchestrator');

/**
 * Ordine di esecuzione delle entità.
 * Le tabelle di supporto (gruppi, categorie) vengono per prime perché
 * arricchiscono clienti e righe d'ordine; i buoni per ultimi perché
 * riconciliano dati già scritti.
 */
export const ENTITY_ORDER: SyncEntity[] = [
  'customer_groups',
  'categories',
  'customers',
  'orders',
  'carts',
  'products',
  'coupons',
];

/** Entità sincronizzate quando il chiamante non ne indica nessuna. */
export const DEFAULT_ENTITIES: SyncEntity[] = ['customer_groups', 'customers', 'orders', 'carts'];

/** Minuti riletti prima dell'ultimo sync riuscito (vedi testata). */
export const SYNC_OVERLAP_MINUTES = 15;

/** Budget di default: sotto i 540 s di timeout, con margine per la chiusura. */
export const DEFAULT_TIME_BUDGET_MS = 480_000;

/** Oltre questa soglia il ricalcolo statistiche è rimandato allo scheduler. */
const MAX_STATS_RECOMPUTE = 3_000;

/** Pagine dopo le quali si controlla la richiesta di annullamento. */
const CANCEL_CHECK_EVERY = 1;

export interface RunSyncInput {
  source: StoreSource;
  entities?: SyncEntity[];
  /** Data di partenza dell'incrementale; assente = riparte da `lastSyncAt`. */
  since?: IsoDate | null;
  /** Ignora `lastSyncAt` e rilegge tutto. */
  fullResync?: boolean;
  requestedBy?: string | null;
  trigger?: SyncJob['trigger'];
  timeBudgetMs?: number;
  pageSize?: number;
  /**
   * Cursori da cui riprendere, per entità. Se assenti l'orchestratore cerca da
   * solo l'ultimo job interrotto per budget di tempo su questo negozio.
   */
  resumeCursors?: Record<string, string | null>;
  /** Disattiva la ripresa automatica dall'ultimo job interrotto. */
  resume?: boolean;
}

export interface RunSyncResult {
  jobId: string;
  source: StoreSource;
  status: SyncJobStatus;
  counts: Record<string, SyncCounts>;
  warnings: string[];
  error: string | null;
  durationMs: number;
  /** Cursore per entità: presente quando il job va ripreso. */
  cursors: Record<string, string | null>;
  resumeRequired: boolean;
}

function emptySyncCounts(): SyncCounts {
  return { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
}

/** Messaggio d'errore leggibile, senza stack. */
function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Annullamento richiesto dall'utente: interrompe il job in modo pulito. */
class SyncCancelled extends Error {
  constructor() {
    super('Sincronizzazione annullata su richiesta.');
    this.name = 'SyncCancelled';
  }
}

/** Budget di tempo esaurito: il job si chiude salvando il cursore. */
class TimeBudgetExhausted extends Error {
  constructor() {
    super('Budget di tempo esaurito.');
    this.name = 'TimeBudgetExhausted';
  }
}

/** Cursore dell'entità in corso, condiviso fra ciclo di pagine e job. */
interface EntityProgress {
  cursor(): string | null;
  setCursor(value: string | null): void;
}

/**
 * Id del job: sorgente + istante di avvio + suffisso casuale.
 *
 * L'id è ordinabile lessicograficamente, quindi "ultimo job del negozio X" si
 * risolve con un filtro per prefisso sull'id del documento — una query servita
 * dall'indice automatico su `__name__`, senza bisogno di un indice composto.
 */
export function buildJobId(source: StoreSource, startedAt: IsoDate): string {
  const compact = startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${source}_${compact}_${randomId(6)}`;
}

interface ResumableJob {
  jobId: string;
  since: IsoDate | null;
  /** Avvio della PRIMA corsa della catena: fine della finestra in lavorazione. */
  windowStartedAt: IsoDate | null;
  cursors: Record<string, string | null>;
  completed: SyncEntity[];
}

/**
 * Ultimo job del negozio interrotto per esaurimento del budget di tempo.
 * Restituisce `null` se l'ultimo job concluso non è ripristinabile: in quel
 * caso si riparte dalla finestra incrementale normale.
 */
async function findResumableJob(source: StoreSource): Promise<ResumableJob | null> {
  const snapshot = await col
    .syncJobs()
    .orderBy(FieldPath.documentId(), 'desc')
    .where(FieldPath.documentId(), '>=', `${source}_`)
    .where(FieldPath.documentId(), '<', `${source}_\uf8ff`)
    .limit(5)
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data() as SyncJob & {
      resumeRequired?: boolean;
      completedEntities?: SyncEntity[];
      windowStartedAt?: IsoDate | null;
    };
    // Un job ancora in corso appartiene a un'altra esecuzione: non si tocca.
    if (data.status === 'running' || data.status === 'queued') continue;
    if (data.status !== 'partial' || !data.resumeRequired || !data.cursor) return null;

    let cursors: Record<string, string | null> = {};
    try {
      cursors = JSON.parse(data.cursor) as Record<string, string | null>;
    } catch {
      return null;
    }
    return {
      jobId: doc.id,
      since: data.since ?? null,
      // I job scritti prima di questo campo non lo hanno: l'avvio del job
      // ripreso è comunque anteriore a quello della corsa corrente.
      windowStartedAt: data.windowStartedAt ?? data.startedAt ?? null,
      cursors,
      completed: data.completedEntities ?? [],
    };
  }
  return null;
}

/**
 * Esegue la sincronizzazione di un negozio.
 * Non solleva mai per errori di singola entità: l'esito è nel risultato.
 */
export async function runSync(input: RunSyncInput): Promise<RunSyncResult> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const deadline = startedMs + (input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const pageSize = input.pageSize ?? SYNC_DEFAULT_PAGE_SIZE;

  const requested = (input.entities?.length ? input.entities : DEFAULT_ENTITIES).filter(
    (entity, index, all) => all.indexOf(entity) === index,
  );
  const entities = ENTITY_ORDER.filter((entity) => requested.includes(entity));

  const settings = await readSiteSettings();
  const store = settings.stores?.[input.source];
  if (!store) {
    throw new AppError('not_found', `Configurazione mancante per il negozio ${input.source}.`);
  }
  if (!store.enabled) {
    throw new AppError(
      'failed_precondition',
      `Il negozio ${store.label} è disattivato: attivalo in Impostazioni → Sito prima di sincronizzare.`,
    );
  }
  if (entities.length === 0) {
    throw new AppError('invalid_argument', 'Nessuna entità valida da sincronizzare.');
  }

  // `since`: esplicito → richiesto dal chiamante; altrimenti l'ultimo sync
  // riuscito arretrato della finestra di sovrapposizione.
  let since: IsoDate | null = null;
  if (!input.fullResync) {
    const base = input.since ?? store.lastSyncAt ?? null;
    if (base) {
      const baseMs = Date.parse(base);
      since = Number.isFinite(baseMs)
        ? new Date(baseMs - SYNC_OVERLAP_MINUTES * 60_000).toISOString()
        : null;
    }
  }

  const counts: Record<string, SyncCounts> = {};
  for (const entity of entities) counts[entity] = emptySyncCounts();
  const cursors: Record<string, string | null> = {};
  const warnings: string[] = [];
  /** Entità portate a termine: alla ripresa non vengono rifatte. */
  const completed: SyncEntity[] = [];

  /**
   * Istante fino al quale la finestra incrementale sarà coperta quando la
   * catena di riprese si chiuderà. È l'avvio della PRIMA corsa: nelle riprese
   * la scansione riparte dal cursore keyset e non rivede i record già superati,
   * quindi avanzare `lastSyncAt` all'avvio della corsa corrente perderebbe per
   * sempre i record modificati durante la catena e rimasti sotto al cursore.
   */
  let windowStartedAt: IsoDate = startedAt;

  // Ripresa di un job interrotto per budget di tempo: si ereditano finestra
  // temporale e cursori, altrimenti il cursore punterebbe a una selezione
  // diversa da quella su cui era stato calcolato.
  let pending = entities;
  if (input.resumeCursors) {
    Object.assign(cursors, input.resumeCursors);
  } else if (input.resume !== false && !input.fullResync && !input.since) {
    const previous = await findResumableJob(input.source);
    if (previous) {
      Object.assign(cursors, previous.cursors);
      since = previous.since;
      windowStartedAt = previous.windowStartedAt ?? startedAt;
      pending = entities.filter((entity) => !previous.completed.includes(entity));
      for (const entity of previous.completed) if (entities.includes(entity)) completed.push(entity);
      warnings.push(
        `Ripresa del job ${previous.jobId}: ${previous.completed.length} entità già completate, ` +
          'finestra temporale ereditata.',
      );
      log.info('Ripresa di un job interrotto', { jobId: previous.jobId, source: input.source, since });
    }
  }
  if (pending.length === 0) pending = entities;

  const jobRef = col.syncJobs().doc(buildJobId(input.source, startedAt));
  const job: SyncJob & {
    cancelRequested: boolean;
    completedEntities: SyncEntity[];
    resumeRequired: boolean;
    windowStartedAt: IsoDate;
  } = {
    id: jobRef.id,
    source: input.source,
    entities,
    status: 'running',
    trigger: input.trigger ?? 'manual',
    since,
    cursor: Object.keys(cursors).length > 0 ? JSON.stringify(cursors) : null,
    counts,
    startedAt,
    finishedAt: null,
    durationMs: null,
    error: null,
    warnings: [],
    requestedBy: input.requestedBy ?? null,
    cancelRequested: false,
    completedEntities: [...completed],
    resumeRequired: false,
    windowStartedAt,
  };
  await jobRef.set(job);

  log.info('Sincronizzazione avviata', { jobId: jobRef.id, source: input.source, entities, since });

  let adapter: SiteAdapter | null = null;
  let cancelled = false;
  let resumeRequired = false;
  let fatalError: string | null = null;
  const touchedContacts = new Set<string>();

  const persist = async (): Promise<void> => {
    await jobRef.set(
      {
        counts,
        cursor: JSON.stringify(cursors),
        completedEntities: completed,
        warnings: warnings.slice(0, 50),
      },
      { merge: true },
    );
  };

  /** Cursore dell'entità in corso, letto e riscritto ad ogni pagina. */
  const progressFor = (entity: SyncEntity): EntityProgress => ({
    cursor: () => cursors[entity] ?? null,
    setCursor: (value) => {
      cursors[entity] = value;
    },
  });

  const ensureRunning = async (): Promise<void> => {
    if (Date.now() >= deadline) throw new TimeBudgetExhausted();
    const snapshot = await jobRef.get();
    if ((snapshot.data() as { cancelRequested?: boolean } | undefined)?.cancelRequested) {
      throw new SyncCancelled();
    }
  };

  try {
    adapter = getAdapter(input.source, settings);

    for (const entity of pending) {
      if (cancelled || resumeRequired) break;
      const entityCounts = counts[entity] as SyncCounts;
      const progress = progressFor(entity);
      try {
        switch (entity) {
          case 'customer_groups':
            await syncCustomerGroups(adapter, input.source, entityCounts, warnings);
            break;
          case 'categories':
            await syncCategories(adapter, entityCounts);
            break;
          case 'customers':
            await syncCustomers(adapter, store, since, pageSize, entityCounts, progress, ensureRunning, persist);
            break;
          case 'orders':
            await syncOrders(
              adapter,
              store,
              settings.abandonedPaymentAfterMinutes,
              since,
              pageSize,
              entityCounts,
              touchedContacts,
              progress,
              ensureRunning,
              persist,
            );
            break;
          case 'carts':
            await syncCarts(
              adapter,
              settings.abandonedCartAfterMinutes,
              since,
              pageSize,
              entityCounts,
              progress,
              ensureRunning,
              persist,
            );
            break;
          case 'products':
            await syncProducts(adapter, since, pageSize, entityCounts, progress, ensureRunning, persist);
            break;
          case 'coupons':
            await syncCoupons(adapter, entityCounts, warnings);
            break;
          default:
            break;
        }
        // Entità conclusa: alla ripresa si riparte da quella successiva.
        completed.push(entity);
        cursors[entity] = null;
      } catch (error) {
        if (error instanceof SyncCancelled) {
          cancelled = true;
          warnings.push(`Annullato durante la sincronizzazione di "${entity}".`);
          break;
        }
        if (error instanceof TimeBudgetExhausted) {
          resumeRequired = true;
          warnings.push(
            `Budget di tempo esaurito durante "${entity}": la sincronizzazione riprenderà dal punto raggiunto.`,
          );
          break;
        }
        // Un'entità che fallisce non blocca le altre.
        entityCounts.failed += 1;
        const message = errorMessage(error);
        warnings.push(`Entità "${entity}": ${message}`);
        log.error('Entità non sincronizzata', error, { jobId: jobRef.id, source: input.source, entity });
      }
      await persist();
    }

    // Le statistiche si ricalcolano una sola volta a fine job, non a ogni ordine.
    if (touchedContacts.size > 0 && !cancelled) {
      if (touchedContacts.size > MAX_STATS_RECOMPUTE) {
        warnings.push(
          `Statistiche ricalcolate solo per i primi ${MAX_STATS_RECOMPUTE} contatti su ${touchedContacts.size}: ` +
            'le restanti verranno aggiornate alla prossima sincronizzazione.',
        );
      }
      const ids = [...touchedContacts].slice(0, MAX_STATS_RECOMPUTE);
      const recomputed = await recomputeContactsStats(ids, {
        repurchaseCycleDays: settings.repurchaseCycleDays ?? DEFAULT_REPURCHASE_CYCLE_DAYS,
      });
      log.info('Statistiche contatti ricalcolate', { jobId: jobRef.id, recomputed });
    }
  } catch (error) {
    fatalError = errorMessage(error);
    log.error('Sincronizzazione interrotta', error, { jobId: jobRef.id, source: input.source });
  } finally {
    if (adapter) {
      try {
        await adapter.close();
      } catch (error) {
        log.warn('Chiusura adapter non riuscita', { error: errorMessage(error) });
      }
    }
  }

  const status = finalStatus({ cancelled, fatalError, counts, entities, resumeRequired });
  const finishedAt = nowIso();
  const durationMs = Date.now() - startedMs;
  const failedEntities = entities.filter((entity) => (counts[entity]?.failed ?? 0) > 0);

  // La finestra incrementale è coperta solo se ogni entità richiesta è arrivata
  // in fondo: un'entità fallita o una ripresa ancora da fare lasciano scoperto
  // un pezzo di `[since, windowStartedAt]`.
  const windowClosed = status === 'success';
  if (!windowClosed && !cancelled) {
    warnings.push(
      since
        ? `Finestra incrementale non chiusa: la prossima corsa ripartirà da ${since}.`
        : 'Finestra incrementale non chiusa: la prossima corsa rileggerà tutto lo storico.',
    );
  }

  await jobRef.set(
    {
      status,
      counts,
      cursor: resumeRequired ? JSON.stringify(cursors) : null,
      completedEntities: completed,
      resumeRequired,
      warnings: warnings.slice(0, 50),
      error: fatalError,
      finishedAt,
      durationMs,
    },
    { merge: true },
  );

  // `lastSyncAt` avanza solo fino al punto realmente coperto: l'avvio della
  // PRIMA corsa della catena, non la fine del job (i record modificati durante
  // il job devono rientrare nella finestra successiva) né l'avvio della corsa
  // corrente (nelle riprese la scansione riparte dal cursore e i record già
  // superati non vengono rivisti).
  if (windowClosed) {
    await markStoreSync(input.source, { at: windowStartedAt, error: null });
  } else if (status === 'failed') {
    // Solo l'errore: `lastSyncAt` resta al valore precedente.
    await markStoreSync(input.source, { error: fatalError ?? 'Sincronizzazione fallita.' });
  } else if (status === 'partial') {
    // Idem per il parziale: la finestra non coperta va riletta. Si segnala come
    // errore solo un'entità fallita; la ripresa per budget di tempo è normale.
    await markStoreSync(input.source, {
      error:
        failedEntities.length > 0
          ? `Entità non sincronizzate: ${failedEntities.join(', ')}. La finestra verrà riletta alla prossima corsa.`
          : null,
    });
  }

  const totals = Object.values(counts).reduce(
    (sum, entry) => ({
      fetched: sum.fetched + entry.fetched,
      created: sum.created + entry.created,
      updated: sum.updated + entry.updated,
      skipped: sum.skipped + entry.skipped,
      failed: sum.failed + entry.failed,
    }),
    emptySyncCounts(),
  );

  await logActivity({
    action: 'sync.run',
    entityType: 'syncJob',
    entityId: jobRef.id,
    userId: input.requestedBy ?? null,
    summary:
      `Sincronizzazione ${SITE_SOURCE_LABELS[input.source]}: ${status} — ` +
      `${totals.fetched} letti, ${totals.created} creati, ${totals.updated} aggiornati.`,
    metadata: { source: input.source, entities, counts, durationMs, warnings: warnings.slice(0, 10) },
    severity: status === 'failed' ? 'error' : status === 'success' ? 'info' : 'warning',
  });

  log.info('Sincronizzazione conclusa', { jobId: jobRef.id, source: input.source, status, durationMs, totals });

  return {
    jobId: jobRef.id,
    source: input.source,
    status,
    counts,
    warnings,
    error: fatalError,
    durationMs,
    cursors,
    resumeRequired,
  };
}

function finalStatus(input: {
  cancelled: boolean;
  fatalError: string | null;
  counts: Record<string, SyncCounts>;
  entities: SyncEntity[];
  resumeRequired: boolean;
}): SyncJobStatus {
  if (input.cancelled) return 'cancelled';
  if (input.fatalError) return 'failed';
  const failed = input.entities.filter((entity) => (input.counts[entity]?.failed ?? 0) > 0);
  if (failed.length === input.entities.length && failed.length > 0) return 'failed';
  if (failed.length > 0 || input.resumeRequired) return 'partial';
  return 'success';
}

/** Segnala all'orchestratore che il job deve fermarsi. */
export async function requestSyncCancel(jobId: string, uid?: string | null): Promise<void> {
  const ref = col.syncJobs().doc(jobId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new AppError('not_found', `Job di sincronizzazione "${jobId}" non trovato.`);
  }
  const data = snapshot.data() as SyncJob;
  if (data.status !== 'running' && data.status !== 'queued') {
    throw new AppError(
      'failed_precondition',
      `Il job è già in stato "${data.status}": non c'è nulla da annullare.`,
    );
  }
  await ref.set({ cancelRequested: true, updatedAt: nowIso(), cancelledBy: uid ?? null }, { merge: true });
}

// -----------------------------------------------------------------------------
// Entità
// -----------------------------------------------------------------------------

/**
 * Gruppi cliente: alimentano la mappa gruppo → segmento B2B/B2C.
 * I gruppi nuovi entrano con il segmento di default del negozio, così un
 * gruppo aggiunto su PrestaShop non lascia i contatti senza segmento.
 */
async function syncCustomerGroups(
  adapter: SiteAdapter,
  source: StoreSource,
  counts: SyncCounts,
  warnings: string[],
): Promise<void> {
  const groups = await adapter.fetchCustomerGroups();
  counts.fetched = groups.length;
  if (groups.length === 0) {
    warnings.push('Nessun gruppo cliente letto dal negozio.');
    return;
  }

  const settings = await readSiteSettings();
  const store = settings.stores[source];
  const mapping = { ...store.customerGroupMapping };
  let added = 0;
  for (const group of groups) {
    if (!group.name || mapping[group.name] !== undefined) {
      counts.skipped += 1;
      continue;
    }
    mapping[group.name] = STORE_DEFAULT_SEGMENT[source];
    added += 1;
  }

  if (added > 0) {
    await writeSiteSettings({ stores: { [source]: { customerGroupMapping: mapping } } });
    counts.created = added;
  }
  counts.updated = groups.length - added - counts.skipped;
}

/** Categorie: scaldano la cache dei percorsi usata da ordini e prodotti. */
async function syncCategories(adapter: SiteAdapter, counts: SyncCounts): Promise<void> {
  const categories = await adapter.fetchCategories();
  counts.fetched = categories.length;
  counts.updated = categories.length;
}

async function syncCustomers(
  adapter: SiteAdapter,
  store: PrestaShopStoreSettings,
  since: IsoDate | null,
  pageSize: number,
  counts: SyncCounts,
  progress: EntityProgress,
  ensureRunning: () => Promise<void>,
  persist: () => Promise<void>,
): Promise<void> {
  let cursor: string | null = progress.cursor();
  let pages = 0;

  for (;;) {
    if (pages % CANCEL_CHECK_EVERY === 0) await ensureRunning();
    const page = await adapter.fetchCustomers(since, cursor, pageSize);
    counts.fetched += page.items.length;

    if (page.items.length > 0) {
      const result = await upsertContactsBatch(page.items, store, {
        consentSource: `sync:${store.source}`,
      });
      counts.created += result.created;
      counts.updated += result.updated;
      counts.skipped += result.skipped;
    }

    pages += 1;
    cursor = page.nextCursor;
    progress.setCursor(cursor);
    await persist();
    if (!page.hasMore || !cursor) return;
  }
}

async function syncOrders(
  adapter: SiteAdapter,
  store: PrestaShopStoreSettings,
  abandonedPaymentAfterMinutes: number,
  since: IsoDate | null,
  pageSize: number,
  counts: SyncCounts,
  touchedContacts: Set<string>,
  progress: EntityProgress,
  ensureRunning: () => Promise<void>,
  persist: () => Promise<void>,
): Promise<void> {
  let cursor: string | null = progress.cursor();
  let pages = 0;

  for (;;) {
    if (pages % CANCEL_CHECK_EVERY === 0) await ensureRunning();
    const page = await adapter.fetchOrders(since, cursor, pageSize);
    counts.fetched += page.items.length;

    if (page.items.length > 0) {
      const result = await upsertOrdersBatch(page.items, store, { abandonedPaymentAfterMinutes });
      counts.created += result.created;
      counts.updated += result.updated;
      counts.skipped += result.skipped;
      for (const contactId of result.contactIds) touchedContacts.add(contactId);
    }

    pages += 1;
    cursor = page.nextCursor;
    progress.setCursor(cursor);
    await persist();
    if (!page.hasMore || !cursor) return;
  }
}

async function syncCarts(
  adapter: SiteAdapter,
  abandonedCartAfterMinutes: number,
  since: IsoDate | null,
  pageSize: number,
  counts: SyncCounts,
  progress: EntityProgress,
  ensureRunning: () => Promise<void>,
  persist: () => Promise<void>,
): Promise<void> {
  let cursor: string | null = progress.cursor();
  let pages = 0;

  for (;;) {
    if (pages % CANCEL_CHECK_EVERY === 0) await ensureRunning();
    const page = await adapter.fetchCarts(since, cursor, pageSize);
    counts.fetched += page.items.length;

    if (page.items.length > 0) {
      const result = await upsertAbandonedCartsBatch(page.items, {
        abandonedAfterMinutes: abandonedCartAfterMinutes,
      });
      counts.created += result.created;
      counts.updated += result.updated;
      counts.skipped += result.skipped;
    }

    pages += 1;
    cursor = page.nextCursor;
    progress.setCursor(cursor);
    await persist();
    if (!page.hasMore || !cursor) return;
  }
}

/**
 * Prodotti.
 *
 * Non esiste una collezione `products` su Firestore (le regole non la
 * prevedono): la lettura serve a verificare la classificazione per famiglia e a
 * riempire la cache di categorie e prezzi usata da ordini e carrelli. Il
 * riepilogo per famiglia finisce sul documento del job, dove la UI può
 * mostrarlo per capire se le regole di classificazione vanno corrette.
 */
async function syncProducts(
  adapter: SiteAdapter,
  since: IsoDate | null,
  pageSize: number,
  counts: SyncCounts,
  progress: EntityProgress,
  ensureRunning: () => Promise<void>,
  persist: () => Promise<void>,
): Promise<void> {
  let cursor: string | null = progress.cursor();
  let pages = 0;
  const families: Record<string, number> = {};

  for (;;) {
    if (pages % CANCEL_CHECK_EVERY === 0) await ensureRunning();
    const page = await adapter.fetchProducts(since, cursor, pageSize);
    counts.fetched += page.items.length;
    for (const product of page.items) {
      families[product.family] = (families[product.family] ?? 0) + 1;
      if (product.active) counts.updated += 1;
      else counts.skipped += 1;
    }

    pages += 1;
    cursor = page.nextCursor;
    progress.setCursor(cursor);
    await persist();
    if (!page.hasMore || !cursor) {
      log.info('Catalogo classificato per famiglia', { families });
      return;
    }
  }
}

/**
 * Buoni sconto: riconcilia i coupon emessi dall'app con lo stato sul negozio.
 * PrestaShop scala `quantity` ad ogni utilizzo, quindi un buono a quota zero è
 * stato riscattato.
 */
async function syncCoupons(adapter: SiteAdapter, counts: SyncCounts, warnings: string[]): Promise<void> {
  if (!adapter.fetchCoupons) {
    warnings.push('La modalità configurata non permette di rileggere i buoni sconto dal negozio.');
    return;
  }

  // Filtrare con `redeemedAt == null` non basta: Firestore distingue "campo
  // nullo" da "campo assente" e i buoni creati senza quel campo resterebbero
  // fuori. Si parte quindi dai buoni ancora validi e si scarta in memoria.
  const now = nowIso();
  const snapshot = await col.coupons().where('expiresAt', '>=', now).limit(500).get();
  const pending = snapshot.docs
    .map((doc) => {
      const data = doc.data() as { code?: string; redeemedAt?: string | null };
      return { id: doc.id, code: data.code ?? '', redeemed: Boolean(data.redeemedAt) };
    })
    .filter((entry) => entry.code.length > 0 && !entry.redeemed);

  counts.fetched = pending.length;
  if (pending.length === 0) return;

  const statuses = await adapter.fetchCoupons(pending.map((entry) => entry.code));
  const byCode = new Map(statuses.map((status) => [status.code.toUpperCase(), status]));
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const entry of pending) {
    const status = byCode.get(entry.code.toUpperCase());
    if (!status) {
      // Buono non ancora propagato al negozio: nessuna conclusione da trarre.
      counts.skipped += 1;
      continue;
    }
    const patch = status.redeemed
      ? { redeemedAt: now, siteCouponId: status.id, siteSyncError: null, updatedAt: now }
      : { siteCouponId: status.id, siteSyncError: null, updatedAt: now };
    operations.push((batch) => batch.set(col.coupons().doc(entry.id), patch, { merge: true }));
    if (status.redeemed) counts.updated += 1;
    else counts.skipped += 1;
  }

  await commitInBatches(operations);
}
