import type { IsoDate } from './common';

/**
 * Sorgenti dati del sito AlphaInk.
 *
 * - `opencart`  → negozio B2C su https://alphaink.net/store (OpenCart)
 * - `prestashop`→ negozio B2B su https://b2b.alphaink.net (PrestaShop Webservice)
 * - `csv`       → import manuale da file
 * - `manual`    → contatto inserito a mano dalla web app
 * - `brevo`     → contatto già presente su Brevo e importato all'indietro
 */
export type SiteSource = 'opencart' | 'prestashop' | 'csv' | 'manual' | 'brevo';

export const SITE_SOURCES: SiteSource[] = ['opencart', 'prestashop', 'csv', 'manual', 'brevo'];

export const SITE_SOURCE_LABELS: Record<SiteSource, string> = {
  opencart: 'AlphaInk B2C (OpenCart)',
  prestashop: 'AlphaInk B2B (PrestaShop)',
  csv: 'Import CSV',
  manual: 'Inserimento manuale',
  brevo: 'Brevo',
};

/** Modalità di accesso ai dati OpenCart. */
export type OpenCartMode = 'rest' | 'mysql';

/** Entità sincronizzabili dal sito. */
export type SyncEntity = 'customers' | 'orders' | 'carts' | 'products' | 'categories' | 'coupons' | 'customer_groups';

export const SYNC_ENTITIES: SyncEntity[] = [
  'customers', 'orders', 'carts', 'products', 'categories', 'coupons', 'customer_groups',
];

export type SyncJobStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export interface SyncCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface SyncJob {
  id: string;
  source: SiteSource;
  entities: SyncEntity[];
  status: SyncJobStatus;
  trigger: 'manual' | 'schedule' | 'webhook' | 'backfill';
  /** Sincronizzazione incrementale: solo record modificati dopo questa data. */
  since?: IsoDate | null;
  cursor?: string | null;
  counts: Record<SyncEntity, SyncCounts> | Record<string, SyncCounts>;
  startedAt: IsoDate;
  finishedAt?: IsoDate | null;
  durationMs?: number | null;
  error?: string | null;
  warnings?: string[];
  requestedBy?: string | null;
}

/** Payload normalizzato prodotto dagli adapter, indipendente dalla piattaforma. */
export interface NormalizedCustomer {
  externalId: string;
  source: SiteSource;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;
  taxCode?: string | null;
  /** Gruppo cliente lato piattaforma (es. "Default", "Rivenditori"). */
  customerGroup?: string | null;
  newsletterOptIn: boolean;
  status: 'active' | 'inactive' | 'blocked';
  language?: string | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  postcode?: string | null;
  createdAt?: IsoDate | null;
  updatedAt?: IsoDate | null;
  /** Campi grezzi utili per debug e per regole di cluster custom. */
  raw?: Record<string, unknown>;
}

export interface NormalizedOrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  categoryPath?: string[];
  /** Famiglia prodotto normalizzata: usata dalle automazioni di riacquisto. */
  family?: ProductFamily;
  brand?: string | null;
  printerModels?: string[];
  externalProductId?: string | null;
}

export interface NormalizedOrder {
  externalId: string;
  source: SiteSource;
  orderNumber?: string | null;
  email: string;
  customerExternalId?: string | null;
  status: string;
  /** Stato normalizzato usato dalla logica applicativa. */
  normalizedStatus: OrderStatus;
  total: number;
  subtotal?: number | null;
  shipping?: number | null;
  tax?: number | null;
  currency: string;
  couponCode?: string | null;
  items: NormalizedOrderItem[];
  placedAt: IsoDate;
  updatedAt?: IsoDate | null;
  /** Parametri UTM catturati dal sito al checkout, se disponibili. */
  utm?: UtmParams | null;
  raw?: Record<string, unknown>;
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_payment'
  | 'paid'
  | 'shipped'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'failed';

/** Stati che contano come acquisto valido per l'attribuzione del fatturato. */
export const REVENUE_ORDER_STATUSES: OrderStatus[] = ['paid', 'shipped', 'completed', 'processing'];

/** Stati che indicano un pagamento non andato a buon fine → automazione "Pagamento Abbandonato". */
export const ABANDONED_PAYMENT_STATUSES: OrderStatus[] = ['awaiting_payment', 'pending', 'failed'];

export interface NormalizedCart {
  externalId: string;
  source: SiteSource;
  email: string;
  customerExternalId?: string | null;
  total: number;
  currency: string;
  items: NormalizedOrderItem[];
  /** URL per riprendere il checkout (se la piattaforma lo espone). */
  recoveryUrl?: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  raw?: Record<string, unknown>;
}

/**
 * Famiglie di prodotto AlphaInk. Guidano le automazioni di riacquisto
 * e la segmentazione per interesse.
 */
export type ProductFamily =
  | 'toner'
  | 'cartucce'
  | 'carta'
  | 'stampanti'
  | 'nastri'
  | 'accessori'
  | 'altro';

export const PRODUCT_FAMILIES: ProductFamily[] = [
  'toner', 'cartucce', 'carta', 'stampanti', 'nastri', 'accessori', 'altro',
];

export const PRODUCT_FAMILY_LABELS: Record<ProductFamily, string> = {
  toner: 'Toner',
  cartucce: 'Cartucce',
  carta: 'Carta',
  stampanti: 'Stampanti',
  nastri: 'Nastri',
  accessori: 'Accessori',
  altro: 'Altro',
};

export interface UtmParams {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  term?: string | null;
  content?: string | null;
}
