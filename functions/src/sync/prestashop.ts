/**
 * Adapter PrestaShop: la vista `SiteAdapter` di un negozio AlphaInk.
 *
 * Delega la lettura al backend scelto in `settings/site` (`webservice` oppure
 * `mysql`) e applica la normalizzazione comune di `normalize.ts`, così che
 * l'orchestratore veda gli stessi oggetti indipendentemente dalla modalità.
 *
 * Due scelte da tenere a mente:
 *
 * - **Le scritture passano sempre dal Webservice.** Il backend MySQL è in sola
 *   lettura per costruzione, quindi `createCoupon` usa il Webservice anche
 *   quando il negozio è configurato in modalità `mysql`. Se la chiave
 *   Webservice non è configurata, l'operazione fallisce con un messaggio
 *   esplicito invece di scrivere sul database del negozio.
 *
 * - **Stato ordine sconosciuto → `pending`, mai `paid`.** Gli id degli stati
 *   PrestaShop sono personalizzabili: se AlphaInk ne aggiunge uno e non lo
 *   mappa, l'ordine resta fuori dal fatturato attribuito finché la mappa non
 *   viene completata. Meglio sottostimare le vendite che attribuire ricavi a
 *   una newsletter per un ordine mai incassato.
 */

import { DEFAULT_FAMILY_RULES } from '@alphaink/shared';
import type {
  FamilyRule,
  IsoDate,
  NormalizedCart,
  NormalizedCustomer,
  NormalizedOrder,
  PrestaShopStoreSettings,
  SiteSettings,
  StoreSource,
} from '@alphaink/shared';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { storeParams } from '../lib/config';
import { PrestaShopMysqlBackend } from './prestashop-mysql';
import { PrestaShopWebserviceBackend } from './prestashop-webservice';
import {
  STORE_TIMEZONE,
  toNormalizedCart,
  toNormalizedCustomer,
  toNormalizedOrder,
  toNormalizedProduct,
} from './normalize';
import type { NormalizationContext } from './normalize';
import type {
  CategoryNode,
  ConnectionCheck,
  CouponPayload,
  CouponStatus,
  CreatedCoupon,
  CustomerGroupInfo,
  FetchPage,
  NormalizedProduct,
  PrestaShopBackend,
  SiteAdapter,
} from './types';

const log = createLogger('sync.prestashop');

export class PrestaShopAdapter implements SiteAdapter {
  readonly source: StoreSource;
  readonly mode: PrestaShopStoreSettings['mode'];

  private stateNames: Record<string, string> | null = null;
  /** Backend usato per le scritture; creato solo quando serve. */
  private writeBackend: PrestaShopWebserviceBackend | null = null;

  constructor(
    private readonly store: PrestaShopStoreSettings,
    private readonly backend: PrestaShopBackend,
    private readonly familyRules: FamilyRule[],
    private readonly credentials: { wsKey: string | null; languageId: number },
  ) {
    this.source = store.source;
    this.mode = store.mode;
    if (backend instanceof PrestaShopWebserviceBackend) this.writeBackend = backend;
  }

  private context(): NormalizationContext {
    return {
      store: this.store,
      familyRules: this.familyRules,
      stateNames: this.stateNames ?? undefined,
      timeZone: STORE_TIMEZONE,
    };
  }

  /** Etichette degli stati ordine: lette una sola volta per adapter. */
  private async ensureStateNames(): Promise<void> {
    if (this.stateNames) return;
    try {
      const states = await this.backend.fetchOrderStates();
      this.stateNames = Object.fromEntries(states.map((state) => [state.id, state.name]));
    } catch (error) {
      // Le etichette sono cosmetiche: senza, resta l'id dello stato.
      log.warn('Etichette stati ordine non disponibili', {
        source: this.source,
        error: (error as Error).message,
      });
      this.stateNames = {};
    }
  }

  async fetchCustomers(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedCustomer>> {
    const page = await this.backend.fetchCustomerRows(since, cursor, limit);
    const items = page.items
      // I clienti cancellati e quelli senza email non hanno valore per l'app.
      .filter((row) => !row.deleted && row.email.includes('@'))
      .map((row) => toNormalizedCustomer(row, this.store, STORE_TIMEZONE));
    return { ...page, items };
  }

  async fetchOrders(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedOrder>> {
    await this.ensureStateNames();
    const page = await this.backend.fetchOrderRows(since, cursor, limit);
    const ctx = this.context();
    // Senza email l'ordine non è collegabile a un contatto: viene scartato, ma
    // la cosa va segnalata (di solito significa cliente cancellato sul negozio).
    const usable = page.items.filter((row) => Boolean(row.email && row.email.includes('@')));
    if (usable.length < page.items.length) {
      log.warn('Ordini senza email scartati', {
        source: this.source,
        scartati: page.items.length - usable.length,
        esempi: page.items.filter((row) => !row.email).slice(0, 5).map((row) => row.id),
      });
    }
    return { ...page, items: usable.map((row) => toNormalizedOrder(row, ctx)) };
  }

  async fetchCarts(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedCart>> {
    const page = await this.backend.fetchCartRows(since, cursor, limit);
    const ctx = this.context();
    const items = page.items
      .filter((row) => Boolean(row.email && row.email.includes('@')) && row.items.length > 0)
      .map((row) => toNormalizedCart(row, ctx));
    return { ...page, items };
  }

  async fetchProducts(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedProduct>> {
    const page = await this.backend.fetchProductRows(since, cursor, limit);
    const ctx = this.context();
    return { ...page, items: page.items.map((row) => toNormalizedProduct(row, ctx)) };
  }

  fetchCategories(): Promise<CategoryNode[]> {
    return this.backend.fetchCategoryTree();
  }

  fetchCustomerGroups(): Promise<CustomerGroupInfo[]> {
    return this.backend.fetchGroups();
  }

  fetchCoupons(codes: string[]): Promise<CouponStatus[]> {
    return this.backend.fetchCartRuleStatuses(codes);
  }

  /** Crea un buono sconto. Richiede sempre il Webservice (vedi testata). */
  async createCoupon(payload: CouponPayload): Promise<CreatedCoupon> {
    const backend = this.ensureWriteBackend();
    return backend.createCartRule({
      ...payload,
      languageId: payload.languageId ?? this.credentials.languageId,
    });
  }

  private ensureWriteBackend(): PrestaShopWebserviceBackend {
    if (this.writeBackend) return this.writeBackend;
    if (!this.credentials.wsKey) {
      throw new AppError(
        'failed_precondition',
        `Il negozio ${this.store.label} è in modalità database (sola lettura) e non ha una chiave Webservice ` +
          'configurata: impossibile creare buoni sconto. Imposta la chiave in Impostazioni → Sito.',
      );
    }
    this.writeBackend = new PrestaShopWebserviceBackend({
      source: this.store.source,
      baseUrl: this.store.baseUrl,
      wsKey: this.credentials.wsKey,
      languageId: this.store.languageId,
      multistoreShopId: this.store.multistoreShopId,
    });
    return this.writeBackend;
  }

  async testConnection(): Promise<ConnectionCheck> {
    const check = await this.backend.ping();
    if (check.ok && this.mode === 'mysql' && !this.credentials.wsKey) {
      return {
        ...check,
        message: `${check.message} Nota: senza chiave Webservice non sarà possibile creare buoni sconto sul negozio.`,
      };
    }
    return check;
  }

  async close(): Promise<void> {
    await this.backend.close();
    if (this.writeBackend && this.writeBackend !== this.backend) await this.writeBackend.close();
  }
}

// -----------------------------------------------------------------------------
// Costruzione degli adapter
// -----------------------------------------------------------------------------

/** Legge un secret senza far esplodere l'esecuzione quando non è dichiarato. */
function readSecret(read: () => string): string | null {
  try {
    const value = read();
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Legge un parametro stringa con fallback. */
function readParam(read: () => string, fallback: string): string {
  try {
    const value = read();
    return value && value.trim().length > 0 ? value.trim() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Costruisce l'adapter del negozio richiesto.
 *
 * Le credenziali arrivano da Secret Manager (`storeParams`), mai da Firestore:
 * su `settings/site` resta solo `credentialsConfigured`.
 */
export function getAdapter(source: StoreSource, settings: SiteSettings): SiteAdapter {
  const store = settings.stores?.[source];
  if (!store) {
    throw new AppError('not_found', `Configurazione mancante per il negozio ${source}.`);
  }

  const params = storeParams(source);
  const wsKey = readSecret(() => params.wsKey.value());
  const baseUrl = store.baseUrl?.trim() || readParam(() => params.baseUrl.value(), '');
  const familyRules = settings.familyRules?.length ? settings.familyRules : DEFAULT_FAMILY_RULES;

  if (!baseUrl) {
    throw new AppError(
      'failed_precondition',
      `URL del negozio ${store.label} non configurato: impostalo in Impostazioni → Sito.`,
    );
  }

  let backend: PrestaShopBackend;
  if (store.mode === 'mysql') {
    const password = readSecret(() => params.dbPassword.value());
    const host = readParam(() => params.dbHost.value(), '');
    const user = readParam(() => params.dbUser.value(), '');
    const database = readParam(() => params.dbName.value(), '');
    const port = Number.parseInt(readParam(() => params.dbPort.value(), '3306'), 10);

    if (!host || !user || !database || !password) {
      throw new AppError(
        'failed_precondition',
        `Credenziali MySQL incomplete per ${store.label}. Configura host, utente, database e password ` +
          '(la password va salvata come secret) prima di sincronizzare in modalità database.',
      );
    }

    backend = new PrestaShopMysqlBackend({
      source,
      host,
      port: Number.isFinite(port) ? port : 3306,
      user,
      password,
      database,
      tablePrefix: store.tablePrefix || 'ps_',
      languageId: store.languageId,
      multistoreShopId: store.multistoreShopId,
    });
  } else {
    if (!wsKey) {
      throw new AppError(
        'failed_precondition',
        `Chiave Webservice mancante per ${store.label}. Salvala in Impostazioni → Sito prima di sincronizzare.`,
      );
    }
    backend = new PrestaShopWebserviceBackend({
      source,
      baseUrl,
      wsKey,
      languageId: store.languageId,
      multistoreShopId: store.multistoreShopId,
    });
  }

  return new PrestaShopAdapter({ ...store, baseUrl }, backend, familyRules, {
    wsKey,
    languageId: store.languageId,
  });
}

/** Adapter di tutti i negozi abilitati, nell'ordine di `settings.stores`. */
export function getAllAdapters(settings: SiteSettings): SiteAdapter[] {
  const adapters: SiteAdapter[] = [];
  for (const store of Object.values(settings.stores ?? {})) {
    if (!store?.enabled) continue;
    try {
      adapters.push(getAdapter(store.source, settings));
    } catch (error) {
      // Un negozio mal configurato non deve impedire di sincronizzare l'altro.
      log.warn('Negozio non configurabile, saltato', {
        source: store.source,
        error: (error as Error).message,
      });
    }
  }
  return adapters;
}
