/**
 * Client del Webservice PrestaShop (API ufficiale `/api/...`).
 *
 * -----------------------------------------------------------------------------
 * COME PARLA IL WEBSERVICE
 * -----------------------------------------------------------------------------
 * - Autenticazione HTTP Basic con la chiave Webservice come **username** e
 *   password **vuota**: `Authorization: Basic base64(wsKey + ':')`.
 * - Formato: `?output_format=JSON`. La lettura restituisce
 *   `{"customers": [ ... ]}`, cioè un oggetto con una sola chiave uguale al
 *   nome della risorsa.
 * - Paginazione: `limit={offset},{count}` con `sort=[id_ASC]`.
 * - Filtri: `filter[campo]=valore`, `filter[campo]=[a|b|c]` per l'OR,
 *   `filter[campo]=[da,a]` per l'intervallo. Sui campi data serve anche
 *   `date=1`, altrimenti il filtro viene ignorato in silenzio.
 * - Multistore: `id_shop={multistoreShopId}` su ogni richiesta.
 *
 * -----------------------------------------------------------------------------
 * LE TRAPPOLE VERE (e come sono gestite qui)
 * -----------------------------------------------------------------------------
 * (a) **Le risorse figlie non arrivano con `display=full` del padre.**
 *     `GET /api/orders?display=full` NON restituisce le righe d'ordine in modo
 *     affidabile: a seconda della versione compare solo `associations.order_rows`
 *     (parziale, senza imponibili) oppure niente. Le righe vere vivono nella
 *     risorsa `order_details` e vanno lette a parte. Farlo un ordine alla volta
 *     significherebbe N+1 richieste (200 ordini = 200 chiamate, minuti di
 *     attesa): qui si usa il filtro OR `filter[id_order]=[1|2|3]` a blocchi
 *     (`chunk`) con `mapWithConcurrency`, e `associations.order_rows` resta solo
 *     come rete di sicurezza per gli ordini che tornassero senza dettagli.
 *     Stesso schema per `order_histories` e per le righe carrello.
 *
 * (b) **I campi multilingua non sono stringhe.** `name` di prodotti, categorie,
 *     gruppi e stati ordine arriva come `[{"id":"1","value":"Toner"}]` (una voce
 *     per lingua). Concatenarlo produrrebbe stringhe assurde: `resolveMultilang`
 *     sceglie la voce con l'`id` uguale al `languageId` configurato sul negozio,
 *     con fallback sulla prima disponibile.
 *
 * Altre asperità gestite:
 * - **Risposta vuota**: quando un filtro non seleziona nulla PrestaShop può
 *   rispondere `200` con corpo vuoto, `{}` oppure `404`. Tutti e tre sono
 *   "nessun record", non errori.
 * - **Basic auth rimossa dall'hosting**: molte configurazioni PHP-CGI non
 *   propagano l'header `Authorization`. In quel caso si ritenta una volta sola
 *   passando la chiave come parametro `ws_key`, che PrestaShop accetta.
 * - **In scrittura il Webservice vuole XML** anche con `output_format=JSON`:
 *   `createCoupon` costruisce l'XML a mano (nessuna libreria aggiuntiva).
 * - **Numeri come stringhe**: `"120.000000"`; vedi `parseAmount` in `normalize.ts`.
 */

import { chunk, mapWithConcurrency, withRetry } from '../lib/async';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import type { IsoDate, StoreSource } from '@alphaink/shared';
import { formatPsDate, parseAmount, parseIntOrNull, psId, str, toBool } from './normalize';
import type {
  CategoryNode,
  ConnectionCheck,
  CouponPayload,
  CouponStatus,
  CreatedCoupon,
  CustomerGroupInfo,
  FetchPage,
  OrderStateInfo,
  PrestaShopBackend,
  PsCartRow,
  PsCustomerRow,
  PsLineRow,
  PsOrderRow,
  PsProductRow,
} from './types';
import { clampPageSize, decodeCursor, encodeCursor } from './types';

const log = createLogger('sync.prestashop.ws');

/** Id massimo usato come estremo destro dei filtri `filter[id]=[da,a]`. */
const MAX_ID = 999_999_999;

/** Ordini/carrelli letti in un solo filtro OR: oltre, l'URL diventa troppo lungo. */
const OR_CHUNK_SIZE = 25;

/** Richieste parallele verso il negozio: oltre, PHP-FPM inizia a rifiutare. */
const FETCH_CONCURRENCY = 4;

export interface WebserviceConfig {
  source: StoreSource;
  baseUrl: string;
  wsKey: string;
  languageId: number;
  multistoreShopId: number | null;
  timeoutMs?: number;
  /**
   * Risolve il percorso categoria dei prodotti citati negli ordini.
   * Costa una richiesta ogni 25 prodotti nuovi: disattivabile sui backfill
   * enormi, dove la classificazione per nome/SKU è già sufficiente.
   */
  resolveCategories?: boolean;
}

type QueryValue = string | number | null | undefined;

/** Estrae il valore di un campo multilingua PrestaShop. */
export function resolveMultilang(value: unknown, languageId: number): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    const entries = value as Array<{ id?: unknown; value?: unknown }>;
    const match = entries.find((entry) => String(entry?.id ?? '') === String(languageId));
    const chosen = match ?? entries[0];
    return chosen?.value === undefined || chosen?.value === null ? '' : String(chosen.value);
  }

  if (typeof value === 'object') {
    // Forma `{ "language": [...] }` restituita da alcune versioni.
    const language = (value as { language?: unknown }).language;
    if (language !== undefined) return resolveMultilang(language, languageId);
    const single = (value as { value?: unknown }).value;
    if (single !== undefined) return String(single);
  }
  return '';
}

/** Escape dei caratteri non ammessi nel testo XML. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface PsAssociationRef {
  id?: unknown;
  [key: string]: unknown;
}

export class PrestaShopWebserviceBackend implements PrestaShopBackend {
  readonly mode = 'webservice' as const;

  private readonly timeoutMs: number;
  private readonly resolveCategoriesEnabled: boolean;

  /** Cache per-istanza: le Functions riusano il processo fra invocazioni vicine. */
  private categoriesCache: CategoryNode[] | null = null;
  private categoryPathById = new Map<string, string[]>();
  private groupsCache: CustomerGroupInfo[] | null = null;
  private orderStatesCache: OrderStateInfo[] | null = null;
  private productCategoryCache = new Map<string, string[]>();
  private productInfoCache = new Map<string, { name: string; reference: string | null; price: number }>();
  /** Diventa true quando l'hosting non propaga l'header Authorization. */
  private useQueryKey = false;

  constructor(private readonly config: WebserviceConfig) {
    this.timeoutMs = config.timeoutMs ?? 45_000;
    this.resolveCategoriesEnabled = config.resolveCategories ?? true;
  }

  // ---------------------------------------------------------------------------
  // Livello HTTP
  // ---------------------------------------------------------------------------

  private buildUrl(resource: string, params: Record<string, QueryValue>): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const url = new URL(`${base}/api/${resource}`);
    url.searchParams.set('output_format', 'JSON');
    if (this.config.multistoreShopId !== null) {
      url.searchParams.set('id_shop', String(this.config.multistoreShopId));
    }
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    if (this.useQueryKey) url.searchParams.set('ws_key', this.config.wsKey);
    return url.toString();
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.wsKey}:`).toString('base64')}`;
  }

  private async send(
    resource: string,
    params: Record<string, QueryValue>,
    init: { method?: string; body?: string; contentType?: string } = {},
  ): Promise<{ status: number; text: string }> {
    const method = init.method ?? 'GET';
    const execute = async (): Promise<{ status: number; text: string }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          Authorization: this.authHeader(),
          Accept: 'application/json',
        };
        if (init.contentType) headers['Content-Type'] = init.contentType;

        const response = await fetch(this.buildUrl(resource, params), {
          method,
          headers,
          body: init.body,
          signal: controller.signal,
        });
        const text = await response.text();

        if (response.status >= 500 || response.status === 429) {
          throw new AppError(
            'upstream_error',
            `Webservice PrestaShop (${this.config.source}): HTTP ${response.status} su "${resource}".`,
            { retryable: true, details: { status: response.status } },
          );
        }
        return { status: response.status, text };
      } catch (error) {
        if (error instanceof AppError) throw error;
        const aborted = (error as { name?: string }).name === 'AbortError';
        throw new AppError(
          'upstream_error',
          aborted
            ? `Webservice PrestaShop (${this.config.source}): timeout su "${resource}".`
            : `Webservice PrestaShop (${this.config.source}): richiesta fallita su "${resource}".`,
          { retryable: true, cause: error },
        );
      } finally {
        clearTimeout(timer);
      }
    };

    let result = await withRetry(execute, { attempts: 3, baseDelayMs: 800, maxDelayMs: 8_000 });

    // Molti hosting PHP-CGI non propagano l'header Authorization: PrestaShop
    // risponde 401 anche con una chiave valida. Si ritenta una volta sola
    // passando la chiave in query string (formato supportato da PrestaShop).
    if (result.status === 401 && !this.useQueryKey) {
      log.warn('Webservice: 401 con Basic auth, ritento con ws_key in query string', {
        source: this.config.source,
        resource,
      });
      this.useQueryKey = true;
      result = await withRetry(execute, { attempts: 2, baseDelayMs: 800 });
    }

    return result;
  }

  /**
   * Legge una lista. Restituisce `[]` per tutte le forme che PrestaShop usa
   * per dire "nessun record": corpo vuoto, `{}`, `404`.
   */
  private async list<T = Record<string, unknown>>(
    resource: string,
    params: Record<string, QueryValue>,
  ): Promise<T[]> {
    const { status, text } = await this.send(resource, params);

    if (status === 404) return [];
    if (status === 401 || status === 403) {
      throw new AppError(
        'permission_denied',
        `Webservice PrestaShop (${this.config.source}): accesso negato alla risorsa "${resource}". ` +
          'Verifica la chiave e i permessi di lettura in Parametri avanzati → Webservice.',
      );
    }
    if (status >= 400) {
      throw new AppError(
        'upstream_error',
        `Webservice PrestaShop (${this.config.source}): HTTP ${status} su "${resource}". ${extractWsError(text)}`,
        { details: { status } },
      );
    }

    const trimmed = text.trim();
    if (!trimmed) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new AppError(
        'upstream_error',
        `Webservice PrestaShop (${this.config.source}): risposta non JSON su "${resource}". ` +
          'Controlla che output_format=JSON sia abilitato e che nessun modulo inietti HTML.',
      );
    }

    if (!parsed || typeof parsed !== 'object') return [];
    const body = parsed as Record<string, unknown>;
    if (Array.isArray(body.errors)) {
      throw new AppError(
        'upstream_error',
        `Webservice PrestaShop (${this.config.source}): ${extractWsError(trimmed)}`,
      );
    }

    const value = body[resource];
    if (Array.isArray(value)) return value as T[];
    // Alcune versioni restituiscono l'oggetto singolo invece dell'array.
    if (value && typeof value === 'object') return [value as T];
    return [];
  }

  /** Parametri comuni a tutte le letture paginate in keyset sull'id. */
  private pageParams(
    fromId: number,
    limit: number,
    since: IsoDate | null,
    dateField = 'date_upd',
  ): Record<string, QueryValue> {
    const params: Record<string, QueryValue> = {
      display: 'full',
      // Forma documentata `limit={offset},{count}`: l'offset resta 0 perché la
      // paginazione è keyset sull'id, immune allo scorrimento dei record.
      limit: `0,${limit}`,
      sort: '[id_ASC]',
      'filter[id]': `[${fromId + 1},${MAX_ID}]`,
    };
    if (since) {
      // `date=1` è obbligatorio: senza, il filtro sulle date viene ignorato.
      params[`filter[${dateField}]`] = `[${formatPsDate(since)},${formatPsDate(new Date())}]`;
      params.date = 1;
    }
    return params;
  }

  // ---------------------------------------------------------------------------
  // Cache di supporto
  // ---------------------------------------------------------------------------

  async fetchCategoryTree(): Promise<CategoryNode[]> {
    if (this.categoriesCache) return this.categoriesCache;

    const raw: Array<Record<string, unknown>> = [];
    let fromId = 0;
    for (let page = 0; page < 50; page += 1) {
      const batch = await this.list<Record<string, unknown>>('categories', {
        display: 'full',
        limit: `0,500`,
        sort: '[id_ASC]',
        'filter[id]': `[${fromId + 1},${MAX_ID}]`,
      });
      if (batch.length === 0) break;
      raw.push(...batch);
      const lastId = parseIntOrNull(batch[batch.length - 1]?.id) ?? 0;
      if (lastId <= fromId) break;
      fromId = lastId;
      if (batch.length < 500) break;
    }

    const byId = new Map<string, { id: string; name: string; parentId: string | null; depth: number; active: boolean }>();
    for (const item of raw) {
      const id = psId(item.id);
      if (!id) continue;
      byId.set(id, {
        id,
        name: resolveMultilang(item.name, this.config.languageId),
        parentId: psId(item.id_parent),
        depth: parseIntOrNull(item.level_depth) ?? 0,
        active: toBool(item.active),
      });
    }

    const nodes: CategoryNode[] = [];
    for (const entry of byId.values()) {
      nodes.push({ ...entry, path: buildCategoryPath(entry.id, byId) });
    }
    this.categoriesCache = nodes;
    this.categoryPathById = new Map(nodes.map((node) => [node.id, node.path]));
    return nodes;
  }

  async fetchGroups(): Promise<CustomerGroupInfo[]> {
    if (this.groupsCache) return this.groupsCache;
    const rows = await this.list<Record<string, unknown>>('groups', { display: 'full', limit: '0,200' });
    this.groupsCache = rows
      .map((row) => ({
        id: psId(row.id) ?? '',
        name: resolveMultilang(row.name, this.config.languageId),
        reduction: parseAmount(row.reduction),
      }))
      .filter((group) => group.id !== '');
    return this.groupsCache;
  }

  async fetchOrderStates(): Promise<OrderStateInfo[]> {
    if (this.orderStatesCache) return this.orderStatesCache;
    const rows = await this.list<Record<string, unknown>>('order_states', { display: 'full', limit: '0,200' });
    this.orderStatesCache = rows
      .map((row) => ({
        id: psId(row.id) ?? '',
        name: resolveMultilang(row.name, this.config.languageId),
      }))
      .filter((state) => state.id !== '');
    return this.orderStatesCache;
  }

  /**
   * Percorso categoria dei prodotti indicati, con cache cumulativa.
   * I prodotti si ripetono molto fra un ordine e l'altro: dopo le prime pagine
   * la cache assorbe quasi tutte le richieste.
   */
  private async resolveProductCategories(productIds: string[]): Promise<void> {
    if (!this.resolveCategoriesEnabled) return;
    const missing = productIds.filter((id) => id && !this.productCategoryCache.has(id));
    if (missing.length === 0) return;

    await this.fetchCategoryTree();
    const blocks = chunk(Array.from(new Set(missing)), OR_CHUNK_SIZE);
    await mapWithConcurrency(blocks, FETCH_CONCURRENCY, async (ids) => {
      const rows = await this.list<Record<string, unknown>>('products', {
        display: 'full',
        limit: `0,${OR_CHUNK_SIZE}`,
        'filter[id]': `[${ids.join('|')}]`,
      });
      for (const row of rows) {
        const id = psId(row.id);
        if (!id) continue;
        this.productCategoryCache.set(id, this.categoryPathFromAssociations(row));
        this.productInfoCache.set(id, {
          name: resolveMultilang(row.name, this.config.languageId),
          reference: str(row.reference),
          price: parseAmount(row.price),
        });
      }
      // I prodotti cancellati non tornano mai: la cache negativa evita di
      // richiederli ad ogni pagina.
      for (const id of ids) if (!this.productCategoryCache.has(id)) this.productCategoryCache.set(id, []);
      return null;
    });
  }

  /** Percorso categoria più profondo fra quelli associati al prodotto. */
  private categoryPathFromAssociations(row: Record<string, unknown>): string[] {
    const associations = row.associations as Record<string, unknown> | undefined;
    const refs = (associations?.categories as PsAssociationRef[] | undefined) ?? [];
    const defaultCategory = psId(row.id_category_default);

    const candidates: string[][] = [];
    for (const ref of refs) {
      const id = psId(ref?.id);
      if (!id) continue;
      const path = this.categoryPathById.get(id);
      if (path && path.length > 0) candidates.push(path);
    }
    if (defaultCategory) {
      const path = this.categoryPathById.get(defaultCategory);
      if (path && path.length > 0) return path;
    }
    if (candidates.length === 0) return [];
    return candidates.reduce((longest, path) => (path.length > longest.length ? path : longest));
  }

  // ---------------------------------------------------------------------------
  // Clienti
  // ---------------------------------------------------------------------------

  async fetchCustomerRows(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<PsCustomerRow>> {
    const pageSize = clampPageSize(limit);
    const fromId = decodeCursor(cursor, 'ws');
    const rows = await this.list<Record<string, unknown>>('customers', this.pageParams(fromId, pageSize, since));
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const groups = await this.fetchGroups();
    const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

    const ids = rows.map((row) => psId(row.id)).filter((id): id is string => Boolean(id));
    const addresses = await this.fetchAddressesByCustomer(ids);
    const geo = await this.fetchGeoLookup();

    const items: PsCustomerRow[] = [];
    for (const row of rows) {
      const id = psId(row.id);
      const email = str(row.email);
      if (!id || !email) continue;

      const address = addresses.get(id);
      const associations = row.associations as Record<string, unknown> | undefined;
      const groupRefs = (associations?.groups as PsAssociationRef[] | undefined) ?? [];
      const groupNames = groupRefs
        .map((ref) => groupNameById.get(psId(ref?.id) ?? ''))
        .filter((name): name is string => Boolean(name));
      const defaultGroupId = psId(row.id_default_group);

      items.push({
        id,
        email,
        firstName: str(row.firstname),
        lastName: str(row.lastname),
        company: str(row.company) ?? str(address?.company) ?? null,
        vatNumber: str(address?.vatNumber) ?? str(row.siret) ?? null,
        taxCode: str(address?.taxCode) ?? null,
        phone: str(address?.phone) ?? null,
        newsletter: toBool(row.newsletter),
        optin: toBool(row.optin),
        active: toBool(row.active),
        isGuest: toBool(row.is_guest),
        deleted: toBool(row.deleted),
        groupId: defaultGroupId,
        groupName: defaultGroupId ? groupNameById.get(defaultGroupId) ?? null : null,
        groupNames,
        languageId: psId(row.id_lang),
        country: address?.countryId ? geo.countries.get(address.countryId) ?? null : null,
        province: address?.stateId ? geo.states.get(address.stateId) ?? null : null,
        city: str(address?.city),
        postcode: str(address?.postcode),
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: { id_shop: row.id_shop ?? null, note: str(row.note) },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('ws', lastId) : null, hasMore };
  }

  private async fetchAddressesByCustomer(customerIds: string[]): Promise<
    Map<string, { company: string | null; vatNumber: string | null; taxCode: string | null; phone: string | null; city: string | null; postcode: string | null; countryId: string | null; stateId: string | null }>
  > {
    const result = new Map<string, {
      company: string | null; vatNumber: string | null; taxCode: string | null; phone: string | null;
      city: string | null; postcode: string | null; countryId: string | null; stateId: string | null;
    }>();
    if (customerIds.length === 0) return result;

    const blocks = chunk(customerIds, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (ids) =>
      this.list<Record<string, unknown>>('addresses', {
        display: 'full',
        limit: `0,${OR_CHUNK_SIZE * 10}`,
        sort: '[id_ASC]',
        'filter[id_customer]': `[${ids.join('|')}]`,
      }),
    );

    for (const rows of pages) {
      for (const row of rows) {
        const customerId = psId(row.id_customer);
        if (!customerId || toBool(row.deleted)) continue;
        // Le righe arrivano ordinate per id crescente: l'ultima sovrascrive le
        // precedenti, quindi vince l'indirizzo più recente.
        result.set(customerId, {
          company: str(row.company),
          vatNumber: str(row.vat_number),
          taxCode: str(row.dni),
          phone: str(row.phone_mobile) ?? str(row.phone),
          city: str(row.city),
          postcode: str(row.postcode),
          countryId: psId(row.id_country),
          stateId: psId(row.id_state),
        });
      }
    }
    return result;
  }

  private geoCache: { countries: Map<string, string>; states: Map<string, string> } | null = null;

  /**
   * Tabelle paesi e province.
   *
   * Non è fra le risorse "di sincronizzazione", ma senza di essa `country` e
   * `province` resterebbero id numerici, inutilizzabili nei filtri dei cluster.
   * Sono due letture piccole e fatte una sola volta per istanza.
   */
  private async fetchGeoLookup(): Promise<{ countries: Map<string, string>; states: Map<string, string> }> {
    if (this.geoCache) return this.geoCache;
    const countries = new Map<string, string>();
    const states = new Map<string, string>();
    try {
      const countryRows = await this.list<Record<string, unknown>>('countries', {
        display: '[id,iso_code]',
        limit: '0,500',
      });
      for (const row of countryRows) {
        const id = psId(row.id);
        const iso = str(row.iso_code);
        if (id && iso) countries.set(id, iso.toUpperCase());
      }
      const stateRows = await this.list<Record<string, unknown>>('states', {
        display: '[id,iso_code]',
        limit: '0,1000',
      });
      for (const row of stateRows) {
        const id = psId(row.id);
        const iso = str(row.iso_code);
        if (id && iso) states.set(id, iso.toUpperCase());
      }
    } catch (error) {
      // Le due risorse possono non essere abilitate sulla chiave: si prosegue
      // senza paese/provincia invece di far fallire l'intera sincronizzazione.
      log.warn('Webservice: risorse countries/states non disponibili', {
        source: this.config.source,
        error: (error as Error).message,
      });
    }
    this.geoCache = { countries, states };
    return this.geoCache;
  }

  // ---------------------------------------------------------------------------
  // Ordini
  // ---------------------------------------------------------------------------

  async fetchOrderRows(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<PsOrderRow>> {
    const pageSize = clampPageSize(limit);
    const fromId = decodeCursor(cursor, 'ws');
    const rows = await this.list<Record<string, unknown>>('orders', this.pageParams(fromId, pageSize, since));
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const orderIds = rows.map((row) => psId(row.id)).filter((id): id is string => Boolean(id));
    const [details, histories, customers] = await Promise.all([
      this.fetchOrderDetails(orderIds),
      this.fetchOrderHistories(orderIds),
      this.fetchCustomersById(rows.map((row) => psId(row.id_customer)).filter((id): id is string => Boolean(id))),
    ]);

    // I percorsi categoria si risolvono in blocco: una richiesta ogni 25
    // prodotti mai visti, non una per riga d'ordine.
    const productIds = new Set<string>();
    for (const lines of details.values()) {
      for (const line of lines) if (line.productId) productIds.add(line.productId);
    }
    await this.resolveProductCategories([...productIds]);

    const items: PsOrderRow[] = [];
    for (const row of rows) {
      const id = psId(row.id);
      if (!id) continue;
      const customerId = psId(row.id_customer);
      const customer = customerId ? customers.get(customerId) : undefined;

      let lines = details.get(id) ?? [];
      if (lines.length === 0) {
        // Rete di sicurezza: alcune installazioni espongono le righe solo
        // dentro `associations.order_rows` della risorsa `orders`.
        lines = this.linesFromOrderRows(row);
      }
      for (const line of lines) {
        line.categoryPath = line.productId ? this.productCategoryCache.get(line.productId) ?? [] : [];
      }

      const totalPaid = parseAmount(row.total_paid);
      const totalPaidExcl = parseAmount(row.total_paid_tax_excl);

      items.push({
        id,
        reference: str(row.reference),
        customerId,
        cartId: psId(row.id_cart),
        email: customer?.email ?? null,
        firstName: customer?.firstName ?? null,
        lastName: customer?.lastName ?? null,
        currentState: psId(row.current_state),
        total: totalPaid,
        subtotal: parseAmount(row.total_products_wt) || parseAmount(row.total_products),
        shipping: parseAmount(row.total_shipping),
        tax: totalPaidExcl > 0 ? Math.max(0, totalPaid - totalPaidExcl) : null,
        discounts: parseAmount(row.total_discounts),
        // Il Webservice espone solo `id_currency`: i negozi AlphaInk fatturano
        // in euro, quindi si assume EUR salvo indicazione contraria dal sito.
        currency: 'EUR',
        payment: str(row.payment),
        valid: toBool(row.valid),
        // Il codice del buono non è esposto dalla risorsa `orders`: arriva dal
        // webhook del sito (`order.created`) quando disponibile.
        couponCode: null,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        items: lines,
        stateHistory: histories.get(id) ?? [],
        raw: { id_currency: psId(row.id_currency), id_shop: row.id_shop ?? null },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('ws', lastId) : null, hasMore };
  }

  /** Trappola (a): le righe d'ordine vivono in `order_details`, lette a blocchi. */
  private async fetchOrderDetails(orderIds: string[]): Promise<Map<string, PsLineRow[]>> {
    const result = new Map<string, PsLineRow[]>();
    if (orderIds.length === 0) return result;

    const blocks = chunk(orderIds, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (ids) =>
      this.list<Record<string, unknown>>('order_details', {
        display: 'full',
        limit: '0,5000',
        sort: '[id_ASC]',
        'filter[id_order]': `[${ids.join('|')}]`,
      }),
    );

    for (const rows of pages) {
      for (const row of rows) {
        const orderId = psId(row.id_order);
        if (!orderId) continue;
        const quantity = parseAmount(row.product_quantity);
        const unitPrice = parseAmount(row.unit_price_tax_incl) || parseAmount(row.product_price);
        const total = parseAmount(row.total_price_tax_incl) || unitPrice * quantity;
        const line: PsLineRow = {
          productId: psId(row.product_id),
          reference: str(row.product_reference),
          name: str(row.product_name) ?? '',
          quantity,
          unitPrice,
          total,
          categoryPath: [],
        };
        const existing = result.get(orderId);
        if (existing) existing.push(line);
        else result.set(orderId, [line]);
      }
    }
    return result;
  }

  private linesFromOrderRows(row: Record<string, unknown>): PsLineRow[] {
    const associations = row.associations as Record<string, unknown> | undefined;
    const rows = (associations?.order_rows as Array<Record<string, unknown>> | undefined) ?? [];
    return rows.map((entry) => {
      const quantity = parseAmount(entry.product_quantity);
      const unitPrice = parseAmount(entry.unit_price_tax_incl) || parseAmount(entry.product_price);
      return {
        productId: psId(entry.product_id),
        reference: str(entry.product_reference),
        name: str(entry.product_name) ?? '',
        quantity,
        unitPrice,
        total: unitPrice * quantity,
        categoryPath: [],
      };
    });
  }

  /** Storico stati: serve a datare pagamento, annullamento e rimborso. */
  private async fetchOrderHistories(
    orderIds: string[],
  ): Promise<Map<string, Array<{ stateId: string; date: string | null }>>> {
    const result = new Map<string, Array<{ stateId: string; date: string | null }>>();
    if (orderIds.length === 0) return result;

    const blocks = chunk(orderIds, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (ids) =>
      this.list<Record<string, unknown>>('order_histories', {
        display: 'full',
        limit: '0,5000',
        sort: '[id_ASC]',
        'filter[id_order]': `[${ids.join('|')}]`,
      }),
    );

    for (const rows of pages) {
      for (const row of rows) {
        const orderId = psId(row.id_order);
        const stateId = psId(row.id_order_state);
        if (!orderId || !stateId) continue;
        const entry = { stateId, date: str(row.date_add) };
        const existing = result.get(orderId);
        if (existing) existing.push(entry);
        else result.set(orderId, [entry]);
      }
    }
    return result;
  }

  private async fetchCustomersById(
    customerIds: string[],
  ): Promise<Map<string, { email: string; firstName: string | null; lastName: string | null }>> {
    const result = new Map<string, { email: string; firstName: string | null; lastName: string | null }>();
    const unique = Array.from(new Set(customerIds.filter(Boolean)));
    if (unique.length === 0) return result;

    const blocks = chunk(unique, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (ids) =>
      this.list<Record<string, unknown>>('customers', {
        display: '[id,email,firstname,lastname]',
        limit: `0,${OR_CHUNK_SIZE}`,
        'filter[id]': `[${ids.join('|')}]`,
      }),
    );

    for (const rows of pages) {
      for (const row of rows) {
        const id = psId(row.id);
        const email = str(row.email);
        if (!id || !email) continue;
        result.set(id, { email, firstName: str(row.firstname), lastName: str(row.lastname) });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Carrelli
  // ---------------------------------------------------------------------------

  async fetchCartRows(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<PsCartRow>> {
    const pageSize = clampPageSize(limit);
    const fromId = decodeCursor(cursor, 'ws');
    const rows = await this.list<Record<string, unknown>>('carts', this.pageParams(fromId, pageSize, since));
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const cartIds = rows.map((row) => psId(row.id)).filter((id): id is string => Boolean(id));
    const converted = await this.fetchConvertedCartIds(cartIds);
    const customers = await this.fetchCustomersById(
      rows.map((row) => psId(row.id_customer)).filter((id): id is string => Boolean(id)),
    );

    const productIds = new Set<string>();
    for (const row of rows) {
      for (const line of cartRowRefs(row)) {
        const id = psId(line.id_product);
        if (id) productIds.add(id);
      }
    }
    await this.resolveProductCategories([...productIds]);

    const items: PsCartRow[] = [];
    for (const row of rows) {
      const id = psId(row.id);
      if (!id || converted.has(id)) continue;
      const customerId = psId(row.id_customer);
      const customer = customerId ? customers.get(customerId) : undefined;
      // Un carrello senza cliente identificato non è recuperabile via email.
      if (!customer?.email) continue;

      const lines: PsLineRow[] = [];
      for (const ref of cartRowRefs(row)) {
        const productId = psId(ref.id_product);
        const info = productId ? this.productInfoCache.get(productId) : undefined;
        const quantity = parseAmount(ref.quantity);
        const unitPrice = info?.price ?? 0;
        lines.push({
          productId,
          reference: info?.reference ?? null,
          name: info?.name ?? (productId ? `Prodotto ${productId}` : 'Prodotto'),
          quantity,
          unitPrice,
          total: unitPrice * quantity,
          categoryPath: productId ? this.productCategoryCache.get(productId) ?? [] : [],
        });
      }

      items.push({
        id,
        customerId,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        currency: 'EUR',
        secureKey: str(row.secure_key),
        // Il Webservice non espone il totale del carrello: si somma il listino
        // dei prodotti. È una stima (niente sconti/specific price), sufficiente
        // per l'email di recupero.
        total: lines.reduce((sum, line) => sum + line.total, 0),
        items: lines,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: { id_shop: row.id_shop ?? null, estimatedTotal: true },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('ws', lastId) : null, hasMore };
  }

  /** Carrelli già diventati ordini: non sono abbandonati. */
  private async fetchConvertedCartIds(cartIds: string[]): Promise<Set<string>> {
    const result = new Set<string>();
    if (cartIds.length === 0) return result;
    const blocks = chunk(cartIds, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (ids) =>
      this.list<Record<string, unknown>>('orders', {
        display: '[id,id_cart]',
        limit: `0,${OR_CHUNK_SIZE * 4}`,
        'filter[id_cart]': `[${ids.join('|')}]`,
      }),
    );
    for (const rows of pages) {
      for (const row of rows) {
        const cartId = psId(row.id_cart);
        if (cartId) result.add(cartId);
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Prodotti
  // ---------------------------------------------------------------------------

  async fetchProductRows(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<PsProductRow>> {
    const pageSize = clampPageSize(Math.min(limit, 100));
    const fromId = decodeCursor(cursor, 'ws');
    const rows = await this.list<Record<string, unknown>>('products', this.pageParams(fromId, pageSize, since));
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    await this.fetchCategoryTree();

    const items: PsProductRow[] = [];
    for (const row of rows) {
      const id = psId(row.id);
      if (!id) continue;
      const categoryPath = this.categoryPathFromAssociations(row);
      const name = resolveMultilang(row.name, this.config.languageId);
      this.productCategoryCache.set(id, categoryPath);
      this.productInfoCache.set(id, { name, reference: str(row.reference), price: parseAmount(row.price) });

      items.push({
        id,
        reference: str(row.reference),
        ean13: str(row.ean13),
        name,
        price: parseAmount(row.price),
        active: toBool(row.active),
        categoryPath,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: { id_manufacturer: psId(row.id_manufacturer), id_category_default: psId(row.id_category_default) },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('ws', lastId) : null, hasMore };
  }

  // ---------------------------------------------------------------------------
  // Buoni sconto
  // ---------------------------------------------------------------------------

  async fetchCartRuleStatuses(codes: string[]): Promise<CouponStatus[]> {
    const unique = Array.from(new Set(codes.filter(Boolean)));
    if (unique.length === 0) return [];

    const blocks = chunk(unique, OR_CHUNK_SIZE);
    const pages = await mapWithConcurrency(blocks, FETCH_CONCURRENCY, (batch) =>
      this.list<Record<string, unknown>>('cart_rules', {
        display: 'full',
        limit: `0,${OR_CHUNK_SIZE}`,
        'filter[code]': `[${batch.join('|')}]`,
      }),
    );

    const statuses: CouponStatus[] = [];
    for (const rows of pages) {
      for (const row of rows) {
        const code = str(row.code);
        if (!code) continue;
        const remaining = parseIntOrNull(row.quantity) ?? 0;
        const active = toBool(row.active);
        statuses.push({
          id: psId(row.id) ?? '',
          code,
          active,
          remainingQuantity: remaining,
          // PrestaShop scala `quantity` ad ogni utilizzo: zero = buono consumato.
          redeemed: remaining <= 0,
          validFrom: str(row.date_from),
          expiresAt: str(row.date_to),
        });
      }
    }
    return statuses;
  }

  /**
   * Crea un `cart_rule`.
   *
   * Trappola: **in scrittura il Webservice accetta solo XML**, anche quando la
   * query dichiara `output_format=JSON` (che influenza solo la risposta).
   * L'XML è costruito a mano: nessuna libreria aggiunta al progetto.
   * Tutti i campi obbligatori vanno valorizzati esplicitamente, perché la
   * validazione PrestaShop rifiuta le colonne NOT NULL mancanti.
   */
  async createCartRule(payload: CouponPayload): Promise<CreatedCoupon> {
    const languageId = payload.languageId ?? this.config.languageId;
    const percent = payload.discountType === 'percent';
    const name = payload.name ?? `Buono AlphaInk ${payload.code}`;
    const from = payload.startsAt ? formatPsDate(payload.startsAt) : formatPsDate(new Date());
    const to = formatPsDate(payload.expiresAt);

    const fields: Array<[string, string]> = [
      ['id_customer', payload.customerExternalId ?? '0'],
      ['date_from', from],
      ['date_to', to],
      ['description', payload.description ?? name],
      ['quantity', String(payload.quantity ?? 1)],
      ['quantity_per_user', String(payload.quantityPerUser ?? 1)],
      ['priority', '1'],
      ['partial_use', payload.partialUse === false ? '0' : '1'],
      ['code', payload.code],
      ['minimum_amount', String(payload.minOrderTotal ?? 0)],
      ['minimum_amount_tax', '1'],
      ['minimum_amount_currency', String(payload.currencyId ?? 1)],
      ['minimum_amount_shipping', '0'],
      ['country_restriction', '0'],
      ['carrier_restriction', '0'],
      ['group_restriction', '0'],
      ['cart_rule_restriction', '0'],
      ['product_restriction', '0'],
      ['shop_restriction', '0'],
      ['free_shipping', payload.freeShipping ? '1' : '0'],
      ['reduction_percent', percent ? String(payload.discountValue) : '0'],
      ['reduction_amount', percent ? '0' : String(payload.discountValue)],
      ['reduction_tax', '1'],
      ['reduction_currency', String(payload.currencyId ?? 1)],
      ['reduction_product', '0'],
      ['gift_product', '0'],
      ['gift_product_attribute', '0'],
      ['highlight', payload.highlight === false ? '0' : '1'],
      ['active', '1'],
    ];

    const body =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">\n  <cart_rule>\n' +
      fields.map(([key, value]) => `    <${key}>${escapeXml(value)}</${key}>`).join('\n') +
      `\n    <name>\n      <language id="${languageId}">${escapeXml(name)}</language>\n    </name>\n` +
      '  </cart_rule>\n</prestashop>';

    const { status, text } = await this.send(
      'cart_rules',
      {},
      { method: 'POST', body, contentType: 'text/xml; charset=utf-8' },
    );

    if (status !== 200 && status !== 201) {
      throw new AppError(
        'upstream_error',
        `Creazione buono su ${this.config.source} non riuscita (HTTP ${status}). ${extractWsError(text)}`,
        { details: { status, code: payload.code } },
      );
    }

    let id = '';
    try {
      const parsed = JSON.parse(text) as { cart_rule?: { id?: unknown } };
      id = String(parsed.cart_rule?.id ?? '');
    } catch {
      // Alcune installazioni rispondono comunque in XML: si estrae l'id a mano.
      id = text.match(/<id>\s*(?:<!\[CDATA\[)?(\d+)/)?.[1] ?? '';
    }
    if (!id) {
      throw new AppError('upstream_error', `Buono creato ma id non leggibile dalla risposta di ${this.config.source}.`);
    }

    log.info('Buono creato sul negozio', { source: this.config.source, code: payload.code, id });
    return { id, code: payload.code, expiresAt: payload.expiresAt };
  }

  // ---------------------------------------------------------------------------
  // Diagnostica
  // ---------------------------------------------------------------------------

  async ping(): Promise<ConnectionCheck> {
    const required = ['customers', 'orders', 'carts', 'products', 'categories', 'groups', 'order_states'];
    const { status, text } = await this.send('', {});

    if (status === 401 || status === 403) {
      return {
        ok: false,
        mode: this.mode,
        message:
          'Chiave Webservice rifiutata dal negozio. Verifica la chiave in Parametri avanzati → Webservice ' +
          'e che il servizio sia attivo.',
        details: { status },
      };
    }
    if (status >= 400) {
      return {
        ok: false,
        mode: this.mode,
        message: `Il negozio ha risposto HTTP ${status}. ${extractWsError(text)}`,
        details: { status },
      };
    }

    let available: string[] = [];
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const resources = (parsed.resources ?? parsed) as Record<string, unknown> | unknown[];
      available = Array.isArray(resources)
        ? resources.map((entry) => String((entry as { resource?: unknown }).resource ?? entry))
        : Object.keys(resources);
    } catch {
      available = [];
    }

    const missing = available.length > 0 ? required.filter((resource) => !available.includes(resource)) : [];
    if (missing.length > 0) {
      return {
        ok: false,
        mode: this.mode,
        message: `Permessi mancanti sulla chiave Webservice per: ${missing.join(', ')}.`,
        details: { missing, available },
      };
    }

    return {
      ok: true,
      mode: this.mode,
      message: `Connessione al Webservice riuscita${available.length ? ` (${available.length} risorse disponibili)` : ''}.`,
      details: { resources: available.length, queryKeyFallback: this.useQueryKey },
    };
  }

  async close(): Promise<void> {
    // Nessuna risorsa persistente: il client HTTP non mantiene stato.
  }
}

// -----------------------------------------------------------------------------
// Funzioni di supporto
// -----------------------------------------------------------------------------

/** Righe carrello dentro `associations.cart_rows`. */
function cartRowRefs(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const associations = row.associations as Record<string, unknown> | undefined;
  return (associations?.cart_rows as Array<Record<string, unknown>> | undefined) ?? [];
}

/** Percorso categoria risalendo i genitori, saltando Root e Home. */
function buildCategoryPath(
  id: string,
  byId: Map<string, { id: string; name: string; parentId: string | null; depth: number }>,
): string[] {
  const path: string[] = [];
  let current = byId.get(id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    // depth 0 = Root, depth 1 = Home: non sono categorie merceologiche.
    if (current.depth > 1 && current.name) path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Estrae il messaggio d'errore dal corpo (JSON o XML) restituito da PrestaShop. */
export function extractWsError(text: string): string {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ message?: string; code?: number }> };
    const messages = (parsed.errors ?? []).map((error) => error.message).filter(Boolean);
    if (messages.length > 0) return messages.join(' | ');
  } catch {
    const xml = text.match(/<message>\s*(?:<!\[CDATA\[)?([^\]<]+)/)?.[1];
    if (xml) return xml.trim();
  }
  return text.slice(0, 300);
}
