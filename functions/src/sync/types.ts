/**
 * Contratto degli adapter di sincronizzazione.
 *
 * Un `SiteAdapter` è la vista astratta di un negozio AlphaInk: espone letture
 * paginate già normalizzate (`NormalizedCustomer`, `NormalizedOrder`,
 * `NormalizedCart`) e le poche scritture che servono all'app (i coupon).
 * L'orchestratore non sa nulla di PrestaShop: parla solo con questa interfaccia.
 *
 * Sotto l'adapter vivono due backend intercambiabili — Webservice e MySQL —
 * che parlano lo stesso linguaggio intermedio (`Ps*Row`): righe grezze con i
 * campi già estratti dalla piattaforma ma non ancora tradotte nel dominio
 * applicativo. Tenere separati "lettura" e "normalizzazione" evita di
 * duplicare le regole di business nei due backend.
 */

import type {
  IsoDate,
  NormalizedCart,
  NormalizedCustomer,
  NormalizedOrder,
  PrestaShopMode,
  ProductFamily,
  StoreSource,
} from '@alphaink/shared';

// -----------------------------------------------------------------------------
// Paginazione
// -----------------------------------------------------------------------------

/** Pagina restituita da una lettura dell'adapter. */
export interface FetchPage<T> {
  items: T[];
  /**
   * Cursore opaco da ripassare alla chiamata successiva.
   * `null` quando non c'è altro da leggere.
   */
  nextCursor: string | null;
  hasMore: boolean;
}

/** Pagina vuota: risposta canonica quando la sorgente non ha record. */
export function emptyPage<T>(): FetchPage<T> {
  return { items: [], nextCursor: null, hasMore: false };
}

/** Dimensione di pagina di default delle letture. */
export const SYNC_DEFAULT_PAGE_SIZE = 200;

/** Tetto di sicurezza: oltre questa soglia il Webservice PrestaShop va in timeout. */
export const SYNC_MAX_PAGE_SIZE = 1000;

/** Normalizza la dimensione di pagina richiesta dal chiamante. */
export function clampPageSize(limit: number | undefined | null): number {
  if (!limit || !Number.isFinite(limit)) return SYNC_DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(SYNC_MAX_PAGE_SIZE, Math.floor(limit)));
}

/**
 * I cursori portano il prefisso del backend che li ha generati (`ws:` / `db:`).
 * Se l'operatore cambia modalità fra due esecuzioni, il cursore vecchio viene
 * ignorato invece di produrre una paginazione incoerente.
 */
export function encodeCursor(prefix: 'ws' | 'db', lastId: number | string): string {
  return `${prefix}:${lastId}`;
}

/** Legge un cursore keyset. Restituisce 0 se assente o generato da un altro backend. */
export function decodeCursor(cursor: string | null | undefined, prefix: 'ws' | 'db'): number {
  if (!cursor) return 0;
  const [kind, value] = cursor.split(':');
  if (kind !== prefix) return 0;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// -----------------------------------------------------------------------------
// Entità normalizzate non presenti nel contratto condiviso
// -----------------------------------------------------------------------------

/**
 * Prodotto normalizzato.
 *
 * Non esiste una collezione Firestore "products" (le regole di sicurezza non la
 * prevedono): il catalogo serve ad arricchire righe ordine e carrelli e a
 * verificare la classificazione per famiglia, quindi vive in memoria durante il
 * job di sincronizzazione.
 */
export interface NormalizedProduct {
  externalId: string;
  source: StoreSource;
  /** Reference PrestaShop, usata come SKU applicativo. */
  sku: string;
  name: string;
  ean13?: string | null;
  price: number;
  active: boolean;
  categoryPath: string[];
  family: ProductFamily;
  brand?: string | null;
  printerModels: string[];
  createdAt?: IsoDate | null;
  updatedAt?: IsoDate | null;
  raw?: Record<string, unknown>;
}

/** Nodo dell'albero categorie, con percorso già risolto. */
export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  /** Percorso completo dalla radice visibile, es. `['Toner', 'HP']`. */
  path: string[];
  active: boolean;
  depth: number;
}

/** Gruppo cliente della piattaforma (PrestaShop: `ps_group`). */
export interface CustomerGroupInfo {
  id: string;
  name: string;
  /** Sconto percentuale associato al gruppo, se presente. */
  reduction?: number | null;
}

/** Stato ordine della piattaforma, con etichetta leggibile. */
export interface OrderStateInfo {
  id: string;
  name: string;
}

// -----------------------------------------------------------------------------
// Coupon
// -----------------------------------------------------------------------------

/** Richiesta di creazione di un buono sconto sul negozio. */
export interface CouponPayload {
  code: string;
  /** Nome mostrato nel carrello del cliente. */
  name?: string;
  description?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderTotal?: number | null;
  startsAt?: IsoDate | null;
  expiresAt: IsoDate;
  /** Limita il buono a un cliente specifico (id PrestaShop). */
  customerExternalId?: string | null;
  /** Numero di utilizzi totali e per utente. */
  quantity?: number;
  quantityPerUser?: number;
  freeShipping?: boolean;
  /** Mostra il buono nel carrello del cliente. */
  highlight?: boolean;
  /** Consente l'uso parziale del valore residuo (solo sconti a importo fisso). */
  partialUse?: boolean;
  /** Valuta dello sconto a importo fisso; default = valuta di default del negozio. */
  currencyId?: number | null;
  /** Lingua per nome e descrizione; default = `languageId` del negozio. */
  languageId?: number | null;
}

export interface CreatedCoupon {
  /** `id_cart_rule` sul negozio. */
  id: string;
  code: string;
  expiresAt: IsoDate;
}

/** Stato di un buono già emesso, letto dal negozio per la riconciliazione. */
export interface CouponStatus {
  id: string;
  code: string;
  active: boolean;
  /** Utilizzi residui: 0 = buono consumato. */
  remainingQuantity: number;
  redeemed: boolean;
  validFrom?: IsoDate | null;
  expiresAt?: IsoDate | null;
}

// -----------------------------------------------------------------------------
// Diagnostica
// -----------------------------------------------------------------------------

export interface ConnectionCheck {
  ok: boolean;
  mode: PrestaShopMode;
  /** Messaggio pronto per la UI, in italiano. */
  message: string;
  details?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Adapter
// -----------------------------------------------------------------------------

/**
 * Vista uniforme di un negozio. Le letture sono incrementali:
 * `since` filtra sulla data di ultima modifica, `cursor` riprende la
 * paginazione keyset dall'ultimo id letto.
 */
export interface SiteAdapter {
  readonly source: StoreSource;
  readonly mode: PrestaShopMode;

  fetchCustomers(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedCustomer>>;

  fetchOrders(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedOrder>>;

  fetchCarts(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedCart>>;

  fetchProducts(
    since: IsoDate | null,
    cursor: string | null,
    limit: number,
  ): Promise<FetchPage<NormalizedProduct>>;

  /** Albero categorie completo: serve a costruire i percorsi delle righe ordine. */
  fetchCategories(): Promise<CategoryNode[]>;

  /** Gruppi cliente: alimentano la mappa gruppo → segmento B2B/B2C. */
  fetchCustomerGroups(): Promise<CustomerGroupInfo[]>;

  /** Crea un buono sconto sul negozio (richiede il Webservice: vedi `prestashop.ts`). */
  createCoupon(payload: CouponPayload): Promise<CreatedCoupon>;

  testConnection(): Promise<ConnectionCheck>;

  /**
   * Rilegge lo stato dei buoni già emessi (opzionale).
   * Usata dall'entità `coupons` per marcare i riscatti.
   */
  fetchCoupons?(codes: string[]): Promise<CouponStatus[]>;

  /** Rilascia le risorse aperte (pool MySQL). Sempre sicura da chiamare. */
  close(): Promise<void>;
}

// -----------------------------------------------------------------------------
// Righe grezze condivise dai due backend PrestaShop
// -----------------------------------------------------------------------------

/** Riga cliente: unione dei campi utili di `customer` + `address` + `group`. */
export interface PsCustomerRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  phone: string | null;
  newsletter: boolean;
  optin: boolean;
  active: boolean;
  isGuest: boolean;
  deleted: boolean;
  groupId: string | null;
  groupName: string | null;
  /** Tutti i gruppi a cui il cliente appartiene. */
  groupNames: string[];
  languageId: string | null;
  /** Codice ISO del paese quando risolvibile, altrimenti `null`. */
  country: string | null;
  /** Sigla provincia (PrestaShop registra le province italiane come "states"). */
  province: string | null;
  city: string | null;
  postcode: string | null;
  /** Date nel formato PrestaShop `YYYY-MM-DD HH:MM:SS`, ora locale del negozio. */
  dateAdd: string | null;
  dateUpd: string | null;
  raw: Record<string, unknown>;
}

/** Riga di dettaglio di un ordine o di un carrello. */
export interface PsLineRow {
  productId: string | null;
  reference: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  categoryPath: string[];
}

export interface PsOrderRow {
  id: string;
  reference: string | null;
  customerId: string | null;
  cartId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** `current_state`: id dello stato ordine PrestaShop. */
  currentState: string | null;
  total: number;
  subtotal: number | null;
  shipping: number | null;
  tax: number | null;
  discounts: number | null;
  currency: string;
  payment: string | null;
  valid: boolean;
  couponCode: string | null;
  dateAdd: string | null;
  dateUpd: string | null;
  items: PsLineRow[];
  /** Storico degli stati, ordinato per data crescente. */
  stateHistory: Array<{ stateId: string; date: string | null }>;
  raw: Record<string, unknown>;
}

export interface PsCartRow {
  id: string;
  customerId: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  currency: string;
  /** `secure_key` del cliente: serve a costruire il link di ripresa del carrello. */
  secureKey: string | null;
  total: number;
  items: PsLineRow[];
  dateAdd: string | null;
  dateUpd: string | null;
  raw: Record<string, unknown>;
}

export interface PsProductRow {
  id: string;
  reference: string | null;
  ean13: string | null;
  name: string;
  price: number;
  active: boolean;
  categoryPath: string[];
  dateAdd: string | null;
  dateUpd: string | null;
  raw: Record<string, unknown>;
}

/**
 * Backend di lettura di un negozio PrestaShop.
 * Implementato da `PrestaShopWebserviceBackend` e `PrestaShopMysqlBackend`.
 */
export interface PrestaShopBackend {
  readonly mode: PrestaShopMode;

  fetchCustomerRows(since: IsoDate | null, cursor: string | null, limit: number): Promise<FetchPage<PsCustomerRow>>;
  fetchOrderRows(since: IsoDate | null, cursor: string | null, limit: number): Promise<FetchPage<PsOrderRow>>;
  fetchCartRows(since: IsoDate | null, cursor: string | null, limit: number): Promise<FetchPage<PsCartRow>>;
  fetchProductRows(since: IsoDate | null, cursor: string | null, limit: number): Promise<FetchPage<PsProductRow>>;

  fetchCategoryTree(): Promise<CategoryNode[]>;
  fetchGroups(): Promise<CustomerGroupInfo[]>;
  /** Etichette degli stati ordine, per rendere leggibile `Order.rawStatus`. */
  fetchOrderStates(): Promise<OrderStateInfo[]>;
  fetchCartRuleStatuses(codes: string[]): Promise<CouponStatus[]>;
  /** Scrittura: disponibile solo sul backend Webservice (MySQL è in sola lettura). */
  createCartRule?(payload: CouponPayload): Promise<CreatedCoupon>;

  ping(): Promise<ConnectionCheck>;
  close(): Promise<void>;
}

/** Chiave con cui l'adapter deposita nel `raw` dell'ordine le date di stato. */
export const ORDER_STATE_TIMESTAMPS_KEY = 'stateTimestamps';

/**
 * Date dei passaggi di stato: `NormalizedOrder` non le prevede, ma il documento
 * `Order` su Firestore sì. Viaggiano dentro `raw.stateTimestamps`.
 */
export interface OrderStateTimestamps {
  paidAt: IsoDate | null;
  completedAt: IsoDate | null;
  cancelledAt: IsoDate | null;
  refundedAt: IsoDate | null;
}
