/**
 * Lettura diretta dal database PrestaShop, in **sola lettura**.
 *
 * È la modalità consigliata per il backfill iniziale: AlphaInk ha volumi molto
 * grandi e il Webservice, che serve una richiesta HTTP per pagina e una per
 * ogni risorsa figlia, impiegherebbe ore dove una query ne impiega secondi.
 *
 * -----------------------------------------------------------------------------
 * REGOLE DI SICUREZZA APPLICATE QUI
 * -----------------------------------------------------------------------------
 * - **Sola lettura**: questo backend esegue solo `SELECT`. Le scritture (i
 *   buoni sconto) passano dal Webservice; l'utente MySQL dovrebbe avere il solo
 *   permesso `SELECT`.
 * - **Il prefisso tabelle non può essere un placeholder SQL**: il nome della
 *   tabella non è un valore. È quindi l'unico frammento interpolato, e solo
 *   dopo la validazione `/^[A-Za-z0-9_]{0,16}$/`; anche il nome della tabella è
 *   confrontato con una whitelist di caratteri. Ogni altro valore passa da `?`.
 * - **`query()` invece di `execute()`**: gli statement preparati di MySQL non
 *   accettano placeholder in `LIMIT` in modo affidabile su tutte le versioni.
 *   `query()` fa l'escaping lato client (mysql2), quindi la protezione da
 *   injection resta, e `LIMIT ?` funziona ovunque.
 * - **`dateStrings: true`**: senza, mysql2 convertirebbe i `DATETIME` in `Date`
 *   interpretandoli nel fuso del processo (UTC su Cloud Functions), mentre
 *   PrestaShop li salva nell'ora locale del negozio. Le stringhe grezze vengono
 *   convertite da `parsePsDate`, che conosce il fuso corretto.
 *
 * -----------------------------------------------------------------------------
 * PAGINAZIONE
 * -----------------------------------------------------------------------------
 * Keyset sull'id (`WHERE id > ? ORDER BY id ASC LIMIT ?`), mai `OFFSET`:
 * su milioni di righe l'offset costringe MySQL a scartare tutte le righe
 * precedenti ad ogni pagina, con un costo che cresce in modo quadratico.
 *
 * Nota operativa: perché una Cloud Function raggiunga il database, l'host deve
 * essere pubblicamente accessibile (con IP autorizzato) oppure la funzione deve
 * uscire da un connettore VPC.
 */

import { createPool } from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { IsoDate, StoreSource } from '@alphaink/shared';
import { AppError, invalidArgument } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { formatPsDate, parseAmount, parseIntOrNull, psId, str, toBool } from './normalize';
import type {
  CategoryNode,
  ConnectionCheck,
  CouponStatus,
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

const log = createLogger('sync.prestashop.mysql');

/** Prefisso ammesso: solo lettere, cifre e underscore. */
const TABLE_PREFIX_RE = /^[A-Za-z0-9_]{0,16}$/;

/** Nomi di tabella ammessi: sono costanti del codice, la regex è una rete. */
const TABLE_NAME_RE = /^[a-z_]+$/;

export interface MysqlConfig {
  source: StoreSource;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Prefisso delle tabelle, tipicamente `ps_`. */
  tablePrefix: string;
  languageId: number;
  multistoreShopId: number | null;
  connectionLimit?: number;
}

interface CategoryRecord {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  active: boolean;
}

export class PrestaShopMysqlBackend implements PrestaShopBackend {
  readonly mode = 'mysql' as const;

  private pool: Pool | null = null;
  private categoriesCache: CategoryNode[] | null = null;
  private categoryPathById = new Map<string, string[]>();
  private productCategoryCache = new Map<string, string[]>();
  private groupsCache: CustomerGroupInfo[] | null = null;
  private orderStatesCache: OrderStateInfo[] | null = null;
  private geoCache: { countries: Map<string, string>; states: Map<string, string> } | null = null;

  constructor(private readonly config: MysqlConfig) {
    if (!TABLE_PREFIX_RE.test(config.tablePrefix ?? '')) {
      throw invalidArgument(
        `Prefisso tabelle non valido: "${config.tablePrefix}". Sono ammessi solo lettere, cifre e underscore (max 16).`,
      );
    }
    if (!config.host || !config.user || !config.database) {
      throw new AppError(
        'failed_precondition',
        `Configurazione MySQL incompleta per ${config.source}: host, utente e nome database sono obbligatori.`,
      );
    }
  }

  /** Nome tabella completo e quotato. Unico punto di interpolazione consentito. */
  private t(name: string): string {
    if (!TABLE_NAME_RE.test(name)) {
      throw invalidArgument(`Nome tabella non valido: "${name}".`);
    }
    return `\`${this.config.tablePrefix}${name}\``;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = createPool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        connectionLimit: this.config.connectionLimit ?? 5,
        waitForConnections: true,
        queueLimit: 0,
        // Vedi nota in testa al file: le date restano stringhe.
        dateStrings: true,
        charset: 'utf8mb4_general_ci',
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        idleTimeout: 60_000,
      });
    }
    return this.pool;
  }

  private async query<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const [rows] = await this.getPool().query<RowDataPacket[]>(sql, params);
      return rows as T[];
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retryable = ['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ER_LOCK_WAIT_TIMEOUT']
        .includes(code ?? '');
      throw new AppError(
        'upstream_error',
        `MySQL (${this.config.source}): query non riuscita${code ? ` [${code}]` : ''}. ${(error as Error).message}`,
        { retryable, cause: error, details: { code } },
      );
    }
  }

  /** Condizione multistore, applicata solo quando l'installazione è condivisa. */
  private shopFilter(alias: string, column = 'id_shop'): { sql: string; params: number[] } {
    if (this.config.multistoreShopId === null) return { sql: '', params: [] };
    return { sql: ` AND ${alias}.${column} = ?`, params: [this.config.multistoreShopId] };
  }

  /** Condizione incrementale sulla data di ultima modifica. */
  private sinceFilter(alias: string, since: IsoDate | null): { sql: string; params: string[] } {
    if (!since) return { sql: '', params: [] };
    // Il confronto avviene su una colonna DATETIME in ora locale del negozio.
    return { sql: ` AND ${alias}.date_upd >= ?`, params: [formatPsDate(since)] };
  }

  // ---------------------------------------------------------------------------
  // Tabelle di supporto
  // ---------------------------------------------------------------------------

  async fetchGroups(): Promise<CustomerGroupInfo[]> {
    if (this.groupsCache) return this.groupsCache;
    const rows = await this.query<RowDataPacket>(
      `SELECT gl.id_group, gl.name FROM ${this.t('group_lang')} gl WHERE gl.id_lang = ?`,
      [this.config.languageId],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      const id = psId(row.id_group);
      const name = str(row.name);
      if (id && name) byId.set(id, name);
    }
    this.groupsCache = [...byId.entries()].map(([id, name]) => ({ id, name, reduction: null }));
    return this.groupsCache;
  }

  async fetchOrderStates(): Promise<OrderStateInfo[]> {
    if (this.orderStatesCache) return this.orderStatesCache;
    const rows = await this.query<RowDataPacket>(
      `SELECT osl.id_order_state, osl.name FROM ${this.t('order_state_lang')} osl WHERE osl.id_lang = ?`,
      [this.config.languageId],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      const id = psId(row.id_order_state);
      const name = str(row.name);
      if (id && name) byId.set(id, name);
    }
    this.orderStatesCache = [...byId.entries()].map(([id, name]) => ({ id, name }));
    return this.orderStatesCache;
  }

  /**
   * Albero categorie completo con percorso risolto risalendo `id_parent`.
   * La cache in memoria evita di rileggerlo ad ogni pagina di ordini.
   */
  async fetchCategoryTree(): Promise<CategoryNode[]> {
    if (this.categoriesCache) return this.categoriesCache;

    const rows = await this.query<RowDataPacket>(
      `SELECT c.id_category, c.id_parent, c.level_depth, c.active, cl.name
         FROM ${this.t('category')} c
         LEFT JOIN ${this.t('category_lang')} cl
           ON cl.id_category = c.id_category AND cl.id_lang = ?
        ORDER BY c.id_category ASC`,
      [this.config.languageId],
    );

    // In multistore `category_lang` ha una riga per shop: la Map deduplica.
    const byId = new Map<string, CategoryRecord>();
    for (const row of rows) {
      const id = psId(row.id_category);
      if (!id) continue;
      byId.set(id, {
        id,
        name: str(row.name) ?? '',
        parentId: psId(row.id_parent),
        depth: parseIntOrNull(row.level_depth) ?? 0,
        active: toBool(row.active),
      });
    }

    const nodes: CategoryNode[] = [];
    for (const record of byId.values()) {
      nodes.push({ ...record, path: buildPath(record.id, byId) });
    }
    this.categoriesCache = nodes;
    this.categoryPathById = new Map(nodes.map((node) => [node.id, node.path]));
    return nodes;
  }

  /** Paesi e province: senza, `country`/`province` resterebbero id numerici. */
  private async fetchGeoLookup(): Promise<{ countries: Map<string, string>; states: Map<string, string> }> {
    if (this.geoCache) return this.geoCache;
    const countries = new Map<string, string>();
    const states = new Map<string, string>();
    try {
      const countryRows = await this.query<RowDataPacket>(
        `SELECT id_country, iso_code FROM ${this.t('country')}`,
      );
      for (const row of countryRows) {
        const id = psId(row.id_country);
        const iso = str(row.iso_code);
        if (id && iso) countries.set(id, iso.toUpperCase());
      }
      const stateRows = await this.query<RowDataPacket>(`SELECT id_state, iso_code FROM ${this.t('state')}`);
      for (const row of stateRows) {
        const id = psId(row.id_state);
        const iso = str(row.iso_code);
        if (id && iso) states.set(id, iso.toUpperCase());
      }
    } catch (error) {
      log.warn('MySQL: tabelle country/state non leggibili, paese e provincia non risolti', {
        source: this.config.source,
        error: (error as Error).message,
      });
    }
    this.geoCache = { countries, states };
    return this.geoCache;
  }

  /** Percorso categoria dei prodotti indicati, con cache cumulativa. */
  private async loadProductCategories(productIds: string[]): Promise<void> {
    const missing = Array.from(new Set(productIds.filter((id) => id && !this.productCategoryCache.has(id))));
    if (missing.length === 0) return;
    await this.fetchCategoryTree();

    const rows = await this.query<RowDataPacket>(
      `SELECT cp.id_product, cp.id_category
         FROM ${this.t('category_product')} cp
        WHERE cp.id_product IN (?)
        ORDER BY cp.position ASC`,
      [missing],
    );

    const paths = new Map<string, string[]>();
    for (const row of rows) {
      const productId = psId(row.id_product);
      const categoryId = psId(row.id_category);
      if (!productId || !categoryId) continue;
      const path = this.categoryPathById.get(categoryId) ?? [];
      const current = paths.get(productId);
      // Vince il percorso più profondo: è quello merceologicamente più preciso.
      if (!current || path.length > current.length) paths.set(productId, path);
    }
    // Cache negativa sui prodotti senza categoria: non li richiediamo più.
    for (const id of missing) this.productCategoryCache.set(id, paths.get(id) ?? []);
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
    const fromId = decodeCursor(cursor, 'db');
    const shop = this.shopFilter('c');
    const incremental = this.sinceFilter('c', since);

    const rows = await this.query<RowDataPacket>(
      `SELECT c.id_customer, c.email, c.firstname, c.lastname, c.company, c.siret,
              c.newsletter, c.optin, c.active, c.deleted, c.is_guest,
              c.id_default_group, c.id_lang, c.date_add, c.date_upd
         FROM ${this.t('customer')} c
        WHERE c.id_customer > ? AND c.deleted = 0${shop.sql}${incremental.sql}
        ORDER BY c.id_customer ASC
        LIMIT ?`,
      [fromId, ...shop.params, ...incremental.params, pageSize],
    );
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const ids = rows.map((row) => psId(row.id_customer)).filter((id): id is string => Boolean(id));
    const [groupsByCustomer, addresses, geo, groups] = await Promise.all([
      this.fetchCustomerGroupNames(ids),
      this.fetchAddresses(ids),
      this.fetchGeoLookup(),
      this.fetchGroups(),
    ]);
    const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

    const items: PsCustomerRow[] = [];
    for (const row of rows) {
      const id = psId(row.id_customer);
      const email = str(row.email);
      if (!id || !email) continue;
      const address = addresses.get(id);
      const defaultGroupId = psId(row.id_default_group);

      items.push({
        id,
        email,
        firstName: str(row.firstname),
        lastName: str(row.lastname),
        company: str(row.company) ?? address?.company ?? null,
        vatNumber: address?.vatNumber ?? str(row.siret) ?? null,
        taxCode: address?.taxCode ?? null,
        phone: address?.phone ?? null,
        newsletter: toBool(row.newsletter),
        optin: toBool(row.optin),
        active: toBool(row.active),
        isGuest: toBool(row.is_guest),
        deleted: toBool(row.deleted),
        groupId: defaultGroupId,
        groupName: defaultGroupId ? groupNameById.get(defaultGroupId) ?? null : null,
        groupNames: groupsByCustomer.get(id) ?? [],
        languageId: psId(row.id_lang),
        country: address?.countryId ? geo.countries.get(address.countryId) ?? null : null,
        province: address?.stateId ? geo.states.get(address.stateId) ?? null : null,
        city: address?.city ?? null,
        postcode: address?.postcode ?? null,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: {},
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id_customer) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('db', lastId) : null, hasMore };
  }

  private async fetchCustomerGroupNames(customerIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (customerIds.length === 0) return result;
    const rows = await this.query<RowDataPacket>(
      `SELECT cg.id_customer, gl.name
         FROM ${this.t('customer_group')} cg
         LEFT JOIN ${this.t('group_lang')} gl ON gl.id_group = cg.id_group AND gl.id_lang = ?
        WHERE cg.id_customer IN (?)`,
      [this.config.languageId, customerIds],
    );
    for (const row of rows) {
      const id = psId(row.id_customer);
      const name = str(row.name);
      if (!id || !name) continue;
      const current = result.get(id);
      if (current) {
        if (!current.includes(name)) current.push(name);
      } else {
        result.set(id, [name]);
      }
    }
    return result;
  }

  private async fetchAddresses(customerIds: string[]): Promise<
    Map<string, {
      company: string | null; vatNumber: string | null; taxCode: string | null; phone: string | null;
      city: string | null; postcode: string | null; countryId: string | null; stateId: string | null;
    }>
  > {
    const result = new Map<string, {
      company: string | null; vatNumber: string | null; taxCode: string | null; phone: string | null;
      city: string | null; postcode: string | null; countryId: string | null; stateId: string | null;
    }>();
    if (customerIds.length === 0) return result;

    const rows = await this.query<RowDataPacket>(
      `SELECT a.id_address, a.id_customer, a.company, a.vat_number, a.dni, a.phone, a.phone_mobile,
              a.city, a.postcode, a.id_country, a.id_state
         FROM ${this.t('address')} a
        WHERE a.id_customer IN (?) AND a.deleted = 0
        ORDER BY a.id_address ASC`,
      [customerIds],
    );

    // Ordinamento crescente: l'ultima riga scritta è l'indirizzo più recente.
    for (const row of rows) {
      const customerId = psId(row.id_customer);
      if (!customerId) continue;
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
    return result;
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
    const fromId = decodeCursor(cursor, 'db');
    const shop = this.shopFilter('o');
    const incremental = this.sinceFilter('o', since);

    const rows = await this.query<RowDataPacket>(
      `SELECT o.id_order, o.reference, o.id_customer, o.id_cart, o.current_state,
              o.total_paid, o.total_paid_tax_excl, o.total_products, o.total_products_wt,
              o.total_shipping, o.total_discounts, o.id_currency, o.payment, o.valid,
              o.date_add, o.date_upd,
              cu.email, cu.firstname, cu.lastname
         FROM ${this.t('orders')} o
         LEFT JOIN ${this.t('customer')} cu ON cu.id_customer = o.id_customer
        WHERE o.id_order > ?${shop.sql}${incremental.sql}
        ORDER BY o.id_order ASC
        LIMIT ?`,
      [fromId, ...shop.params, ...incremental.params, pageSize],
    );
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const orderIds = rows.map((row) => psId(row.id_order)).filter((id): id is string => Boolean(id));
    const [details, histories] = await Promise.all([
      this.fetchOrderDetails(orderIds),
      this.fetchOrderHistories(orderIds),
    ]);

    const productIds = new Set<string>();
    for (const lines of details.values()) {
      for (const line of lines) if (line.productId) productIds.add(line.productId);
    }
    await this.loadProductCategories([...productIds]);

    const items: PsOrderRow[] = [];
    for (const row of rows) {
      const id = psId(row.id_order);
      if (!id) continue;
      const lines = details.get(id) ?? [];
      for (const line of lines) {
        line.categoryPath = line.productId ? this.productCategoryCache.get(line.productId) ?? [] : [];
      }
      const totalPaid = parseAmount(row.total_paid);
      const totalPaidExcl = parseAmount(row.total_paid_tax_excl);

      items.push({
        id,
        reference: str(row.reference),
        customerId: psId(row.id_customer),
        cartId: psId(row.id_cart),
        email: str(row.email),
        firstName: str(row.firstname),
        lastName: str(row.lastname),
        currentState: psId(row.current_state),
        total: totalPaid,
        subtotal: parseAmount(row.total_products_wt) || parseAmount(row.total_products),
        shipping: parseAmount(row.total_shipping),
        tax: totalPaidExcl > 0 ? Math.max(0, totalPaid - totalPaidExcl) : null,
        discounts: parseAmount(row.total_discounts),
        currency: 'EUR',
        payment: str(row.payment),
        valid: toBool(row.valid),
        couponCode: null,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        items: lines,
        stateHistory: histories.get(id) ?? [],
        raw: { id_currency: psId(row.id_currency) },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id_order) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('db', lastId) : null, hasMore };
  }

  private async fetchOrderDetails(orderIds: string[]): Promise<Map<string, PsLineRow[]>> {
    const result = new Map<string, PsLineRow[]>();
    if (orderIds.length === 0) return result;

    const rows = await this.query<RowDataPacket>(
      `SELECT od.id_order_detail, od.id_order, od.product_id, od.product_reference, od.product_name,
              od.product_quantity, od.product_price, od.unit_price_tax_incl, od.total_price_tax_incl
         FROM ${this.t('order_detail')} od
        WHERE od.id_order IN (?)
        ORDER BY od.id_order_detail ASC`,
      [orderIds],
    );

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
    return result;
  }

  private async fetchOrderHistories(
    orderIds: string[],
  ): Promise<Map<string, Array<{ stateId: string; date: string | null }>>> {
    const result = new Map<string, Array<{ stateId: string; date: string | null }>>();
    if (orderIds.length === 0) return result;

    const rows = await this.query<RowDataPacket>(
      `SELECT oh.id_order, oh.id_order_state, oh.date_add
         FROM ${this.t('order_history')} oh
        WHERE oh.id_order IN (?)
        ORDER BY oh.id_order_history ASC`,
      [orderIds],
    );

    for (const row of rows) {
      const orderId = psId(row.id_order);
      const stateId = psId(row.id_order_state);
      if (!orderId || !stateId) continue;
      const entry = { stateId, date: str(row.date_add) };
      const existing = result.get(orderId);
      if (existing) existing.push(entry);
      else result.set(orderId, [entry]);
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
    const fromId = decodeCursor(cursor, 'db');
    const shop = this.shopFilter('c');
    const incremental = this.sinceFilter('c', since);

    // Il LEFT JOIN su orders esclude i carrelli già convertiti in ordine:
    // quelli non sono abbandonati.
    const rows = await this.query<RowDataPacket>(
      `SELECT c.id_cart, c.id_customer, c.id_currency, c.secure_key, c.date_add, c.date_upd,
              cu.email, cu.firstname, cu.lastname
         FROM ${this.t('cart')} c
         INNER JOIN ${this.t('customer')} cu ON cu.id_customer = c.id_customer AND cu.deleted = 0
         LEFT JOIN ${this.t('orders')} o ON o.id_cart = c.id_cart
        WHERE c.id_cart > ? AND c.id_customer > 0 AND o.id_order IS NULL${shop.sql}${incremental.sql}
        ORDER BY c.id_cart ASC
        LIMIT ?`,
      [fromId, ...shop.params, ...incremental.params, pageSize],
    );
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const cartIds = rows.map((row) => psId(row.id_cart)).filter((id): id is string => Boolean(id));
    const lines = await this.fetchCartLines(cartIds);

    const productIds = new Set<string>();
    for (const cartLines of lines.values()) {
      for (const line of cartLines) if (line.productId) productIds.add(line.productId);
    }
    await this.loadProductCategories([...productIds]);

    const items: PsCartRow[] = [];
    for (const row of rows) {
      const id = psId(row.id_cart);
      const email = str(row.email);
      if (!id || !email) continue;
      const cartLines = lines.get(id) ?? [];
      if (cartLines.length === 0) continue; // carrello vuoto: niente da recuperare
      for (const line of cartLines) {
        line.categoryPath = line.productId ? this.productCategoryCache.get(line.productId) ?? [] : [];
      }

      items.push({
        id,
        customerId: psId(row.id_customer),
        email,
        firstName: str(row.firstname),
        lastName: str(row.lastname),
        currency: 'EUR',
        secureKey: str(row.secure_key),
        // Totale a listino: il carrello PrestaShop non memorizza un totale.
        total: cartLines.reduce((sum, line) => sum + line.total, 0),
        items: cartLines,
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: { estimatedTotal: true },
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id_cart) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('db', lastId) : null, hasMore };
  }

  private async fetchCartLines(cartIds: string[]): Promise<Map<string, PsLineRow[]>> {
    const result = new Map<string, PsLineRow[]>();
    if (cartIds.length === 0) return result;

    const rows = await this.query<RowDataPacket>(
      `SELECT cp.id_cart, cp.id_product, cp.quantity, p.reference, p.price, pl.name
         FROM ${this.t('cart_product')} cp
         LEFT JOIN ${this.t('product')} p ON p.id_product = cp.id_product
         LEFT JOIN ${this.t('product_lang')} pl ON pl.id_product = cp.id_product AND pl.id_lang = ?
        WHERE cp.id_cart IN (?)`,
      [this.config.languageId, cartIds],
    );

    // In multistore `product_lang` ha una riga per shop: la chiave composta
    // cart+prodotto evita di duplicare la riga di carrello.
    const seen = new Set<string>();
    for (const row of rows) {
      const cartId = psId(row.id_cart);
      const productId = psId(row.id_product);
      if (!cartId || !productId) continue;
      const key = `${cartId}:${productId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const quantity = parseAmount(row.quantity);
      const unitPrice = parseAmount(row.price);
      const line: PsLineRow = {
        productId,
        reference: str(row.reference),
        name: str(row.name) ?? `Prodotto ${productId}`,
        quantity,
        unitPrice,
        total: unitPrice * quantity,
        categoryPath: [],
      };
      const existing = result.get(cartId);
      if (existing) existing.push(line);
      else result.set(cartId, [line]);
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
    const pageSize = clampPageSize(limit);
    const fromId = decodeCursor(cursor, 'db');
    // In multistore il prodotto è legato allo shop tramite `id_shop_default`.
    const shop = this.shopFilter('p', 'id_shop_default');
    const incremental = this.sinceFilter('p', since);

    const rows = await this.query<RowDataPacket>(
      `SELECT p.id_product, p.reference, p.ean13, p.price, p.active, p.date_add, p.date_upd, pl.name
         FROM ${this.t('product')} p
         LEFT JOIN ${this.t('product_lang')} pl ON pl.id_product = p.id_product AND pl.id_lang = ?
        WHERE p.id_product > ?${shop.sql}${incremental.sql}
        ORDER BY p.id_product ASC
        LIMIT ?`,
      [this.config.languageId, fromId, ...shop.params, ...incremental.params, pageSize],
    );
    if (rows.length === 0) return { items: [], nextCursor: null, hasMore: false };

    const ids = rows.map((row) => psId(row.id_product)).filter((id): id is string => Boolean(id));
    await this.loadProductCategories(ids);

    const seen = new Set<string>();
    const items: PsProductRow[] = [];
    for (const row of rows) {
      const id = psId(row.id_product);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        reference: str(row.reference),
        ean13: str(row.ean13),
        name: str(row.name) ?? '',
        price: parseAmount(row.price),
        active: toBool(row.active),
        categoryPath: this.productCategoryCache.get(id) ?? [],
        dateAdd: str(row.date_add),
        dateUpd: str(row.date_upd),
        raw: {},
      });
    }

    const lastId = parseIntOrNull(rows[rows.length - 1]?.id_product) ?? fromId;
    const hasMore = rows.length >= pageSize;
    return { items, nextCursor: hasMore ? encodeCursor('db', lastId) : null, hasMore };
  }

  // ---------------------------------------------------------------------------
  // Buoni sconto (sola lettura)
  // ---------------------------------------------------------------------------

  async fetchCartRuleStatuses(codes: string[]): Promise<CouponStatus[]> {
    const unique = Array.from(new Set(codes.filter(Boolean)));
    if (unique.length === 0) return [];

    const rows = await this.query<RowDataPacket>(
      `SELECT id_cart_rule, code, quantity, active, date_from, date_to
         FROM ${this.t('cart_rule')}
        WHERE code IN (?)`,
      [unique],
    );

    const statuses: CouponStatus[] = [];
    for (const row of rows) {
      const code = str(row.code);
      if (!code) continue;
      const remaining = parseIntOrNull(row.quantity) ?? 0;
      statuses.push({
        id: psId(row.id_cart_rule) ?? '',
        code,
        active: toBool(row.active),
        remainingQuantity: remaining,
        // PrestaShop scala `quantity` ad ogni utilizzo: zero = buono consumato.
        redeemed: remaining <= 0,
        validFrom: str(row.date_from),
        expiresAt: str(row.date_to),
      });
    }
    return statuses;
  }

  // ---------------------------------------------------------------------------
  // Diagnostica
  // ---------------------------------------------------------------------------

  async ping(): Promise<ConnectionCheck> {
    try {
      const [customers] = await this.query<RowDataPacket>(
        `SELECT COUNT(*) AS total FROM ${this.t('customer')} WHERE deleted = 0`,
      );
      const [orders] = await this.query<RowDataPacket>(`SELECT COUNT(*) AS total FROM ${this.t('orders')}`);
      const shops = await this.query<RowDataPacket>(`SELECT id_shop, name FROM ${this.t('shop')}`);

      const shopIds = shops.map((row) => psId(row.id_shop)).filter((id): id is string => Boolean(id));
      const configured = this.config.multistoreShopId;
      if (configured !== null && !shopIds.includes(String(configured))) {
        return {
          ok: false,
          mode: this.mode,
          message:
            `Lo shop id ${configured} non esiste su questa installazione. ` +
            `Shop disponibili: ${shopIds.join(', ') || 'nessuno'}.`,
          details: { shops: shopIds },
        };
      }
      if (configured === null && shopIds.length > 1) {
        return {
          ok: true,
          mode: this.mode,
          message:
            `Connessione riuscita, ma l'installazione è in multistore (${shopIds.length} shop) e nessuno shop ` +
            'è selezionato: verranno letti i dati di tutti gli shop.',
          details: { shops: shopIds, customers: parseIntOrNull(customers?.total) ?? 0 },
        };
      }

      return {
        ok: true,
        mode: this.mode,
        message:
          `Connessione al database riuscita: ${parseIntOrNull(customers?.total) ?? 0} clienti, ` +
          `${parseIntOrNull(orders?.total) ?? 0} ordini.`,
        details: {
          customers: parseIntOrNull(customers?.total) ?? 0,
          orders: parseIntOrNull(orders?.total) ?? 0,
          shops: shopIds,
        },
      };
    } catch (error) {
      return {
        ok: false,
        mode: this.mode,
        message:
          error instanceof AppError
            ? error.message
            : `Connessione al database non riuscita: ${(error as Error).message}`,
      };
    }
  }

  async close(): Promise<void> {
    if (!this.pool) return;
    const pool = this.pool;
    this.pool = null;
    try {
      await pool.end();
    } catch (error) {
      log.warn('Chiusura del pool MySQL non riuscita', {
        source: this.config.source,
        error: (error as Error).message,
      });
    }
  }
}

/** Percorso categoria risalendo `id_parent`, saltando Root (0) e Home (1). */
function buildPath(id: string, byId: Map<string, CategoryRecord>): string[] {
  const path: string[] = [];
  const guard = new Set<string>();
  let current = byId.get(id);
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.depth > 1 && current.name) path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
