/**
 * Normalizzazione condivisa dai due backend PrestaShop.
 *
 * Tutte le funzioni di questo file sono **pure**: nessuna I/O, nessuna lettura
 * di configurazione globale. Questo permette di riusarle identiche nel
 * Webservice, nel backend MySQL e nel webhook del sito, e di provarle senza
 * emulatore.
 *
 * Due punti delicati trattati qui:
 *
 * 1. **Le date di PrestaShop non sono UTC.** Le colonne `date_add`/`date_upd`
 *    contengono l'ora locale del negozio (per AlphaInk `Europe/Rome`) senza
 *    indicazione di fuso. Convertirle con `new Date(stringa)` le farebbe
 *    interpretare come UTC dal runtime delle Functions, spostando ogni ordine
 *    di 1-2 ore e falsando finestre di riacquisto e carrelli abbandonati.
 *    `parsePsDate` interpreta la stringa come ora locale del negozio,
 *    `formatPsDate` fa il percorso inverso per i filtri del Webservice.
 *
 * 2. **Gli importi arrivano come stringhe.** Sia il Webservice
 *    (`"120.000000"`) sia MySQL (colonne `DECIMAL`, restituite come stringa da
 *    `mysql2`) non danno numeri JavaScript: `parseAmount` centralizza la
 *    conversione e non produce mai `NaN`.
 */

import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_PRESTASHOP_ORDER_STATES,
  EMPTY_ENGAGEMENT,
  classifyProductFamily,
  displayNameFor,
  extractPrinterBrand,
  extractPrinterModels,
  normalizeEmail,
} from '@alphaink/shared';
import type {
  Contact,
  ContactStats,
  FamilyRule,
  IsoDate,
  NormalizedCart,
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedOrderItem,
  OrderStatus,
  PrestaShopStoreSettings,
  SiteSource,
  SubscriptionStatus,
} from '@alphaink/shared';
import type {
  NormalizedProduct,
  OrderStateTimestamps,
  PsCartRow,
  PsCustomerRow,
  PsLineRow,
  PsOrderRow,
  PsProductRow,
} from './types';
import { ORDER_STATE_TIMESTAMPS_KEY } from './types';

/** Fuso orario in cui i due negozi AlphaInk registrano le date. */
export const STORE_TIMEZONE = 'Europe/Rome';

/** Contesto di normalizzazione: tutto ciò che dipende dalla configurazione. */
export interface NormalizationContext {
  store: PrestaShopStoreSettings;
  /** Regole di classificazione per famiglia (da `settings/site`). */
  familyRules: FamilyRule[];
  /** `id stato ordine` → etichetta leggibile, da `order_states`. */
  stateNames?: Record<string, string>;
  /** Fuso del negozio; default `Europe/Rome`. */
  timeZone?: string;
}

// -----------------------------------------------------------------------------
// Parsing sicuro
// -----------------------------------------------------------------------------

/** Converte in numero qualunque forma restituita dalla piattaforma. Mai `NaN`. */
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Arrotonda a due decimali evitando gli strascichi in virgola mobile. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Interi PrestaShop: restituisce `null` se il valore non è un intero valido. */
export function parseIntOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Booleani PrestaShop: `1`/`"1"`/`true`/`"true"`. */
export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  return false;
}

/** Stringa non vuota oppure `null`. */
export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** Id PrestaShop come stringa: scarta `0` e valori vuoti (assenza di relazione). */
export function psId(value: unknown): string | null {
  const parsed = parseIntOrNull(value);
  return parsed && parsed > 0 ? String(parsed) : null;
}

// -----------------------------------------------------------------------------
// Date nel fuso del negozio
// -----------------------------------------------------------------------------

/** Scostamento in ms fra il fuso indicato e UTC nell'istante dato. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const get = (type: string): number => Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const hour = get('hour');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Alcune implementazioni rendono la mezzanotte come "24".
    hour === 24 ? 0 : hour,
    get('minute'),
    get('second'),
  );
  return asUtc - date.getTime();
}

/**
 * Interpreta `YYYY-MM-DD HH:MM:SS` come ora locale del negozio e restituisce
 * l'ISO UTC corrispondente. Accetta anche stringhe già ISO (con `T` o `Z`).
 */
export function parsePsDate(value: unknown, timeZone: string = STORE_TIMEZONE): IsoDate | null {
  const text = str(value);
  if (!text) return null;
  // Le date "vuote" di MySQL arrivano così.
  if (text.startsWith('0000-00-00')) return null;

  // Già in forma ISO con fuso esplicito: nessuna conversione.
  if (/[zZ]$/.test(text) || /[+-]\d{2}:?\d{2}$/.test(text)) {
    const direct = Date.parse(text);
    return Number.isNaN(direct) ? null : new Date(direct).toISOString();
  }

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) {
    const fallback = Date.parse(text);
    return Number.isNaN(fallback) ? null : new Date(fallback).toISOString();
  }

  const [, y, m, d, hh, mm, ss] = match;
  const naiveUtc = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh ?? '0'),
    Number(mm ?? '0'),
    Number(ss ?? '0'),
  );

  // Prima approssimazione, poi correzione: a cavallo del cambio d'ora legale
  // l'offset calcolato sull'istante sbagliato differisce di un'ora.
  const firstGuess = naiveUtc - timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const refined = naiveUtc - timeZoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(refined).toISOString();
}

/**
 * Converte un ISO UTC nella forma `YYYY-MM-DD HH:MM:SS` attesa dai filtri
 * PrestaShop, espressa nell'ora locale del negozio.
 */
export function formatPsDate(iso: IsoDate | Date, timeZone: string = STORE_TIMEZONE): string {
  const date = iso instanceof Date ? iso : new Date(Date.parse(iso));
  if (Number.isNaN(date.getTime())) return '1970-01-01 00:00:00';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

// -----------------------------------------------------------------------------
// Stati ordine
// -----------------------------------------------------------------------------

/**
 * Traduce l'id di stato PrestaShop nello stato applicativo.
 *
 * Fallback prudente: uno stato sconosciuto diventa `pending`, mai `paid`.
 * Un ordine non confermato non deve entrare nel fatturato attribuito alle
 * newsletter, quindi in caso di dubbio si sceglie lo stato più conservativo.
 */
export function mapOrderStatus(
  stateId: string | null | undefined,
  mapping: Record<string, OrderStatus> | undefined,
): OrderStatus {
  if (!stateId) return 'pending';
  const table = mapping && Object.keys(mapping).length > 0 ? mapping : DEFAULT_PRESTASHOP_ORDER_STATES;
  return table[String(stateId)] ?? 'pending';
}

/** Etichetta leggibile dello stato, con fallback sull'id. */
export function orderStateLabel(
  stateId: string | null | undefined,
  stateNames: Record<string, string> | undefined,
): string {
  if (!stateId) return 'sconosciuto';
  return stateNames?.[String(stateId)] ?? `stato ${stateId}`;
}

/**
 * Ricava le date dei passaggi di stato dallo storico ordine.
 * Serve a valorizzare `paidAt`, `completedAt`, `cancelledAt`, `refundedAt`
 * sul documento `Order`, che `NormalizedOrder` non prevede.
 */
export function deriveStateTimestamps(
  history: ReadonlyArray<{ stateId: string; date: string | null }>,
  mapping: Record<string, OrderStatus> | undefined,
  timeZone: string = STORE_TIMEZONE,
): OrderStateTimestamps {
  const result: OrderStateTimestamps = {
    paidAt: null,
    completedAt: null,
    cancelledAt: null,
    refundedAt: null,
  };

  const ordered = [...history].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  for (const entry of ordered) {
    const iso = parsePsDate(entry.date, timeZone);
    if (!iso) continue;
    const status = mapOrderStatus(entry.stateId, mapping);
    switch (status) {
      case 'paid':
      case 'processing':
      case 'shipped':
        // Il primo stato "incassato" vince: è l'istante della conversione.
        if (!result.paidAt) result.paidAt = iso;
        break;
      case 'completed':
        if (!result.paidAt) result.paidAt = iso;
        result.completedAt = iso;
        break;
      case 'cancelled':
        result.cancelledAt = iso;
        break;
      case 'refunded':
        result.refundedAt = iso;
        break;
      default:
        break;
    }
  }
  return result;
}

/** Rilegge le date di stato depositate nel `raw` dell'ordine normalizzato. */
export function readStateTimestamps(order: NormalizedOrder): OrderStateTimestamps {
  const raw = (order.raw ?? {}) as Record<string, unknown>;
  const value = raw[ORDER_STATE_TIMESTAMPS_KEY] as Partial<OrderStateTimestamps> | undefined;
  return {
    paidAt: value?.paidAt ?? null,
    completedAt: value?.completedAt ?? null,
    cancelledAt: value?.cancelledAt ?? null,
    refundedAt: value?.refundedAt ?? null,
  };
}

// -----------------------------------------------------------------------------
// Righe di prodotto
// -----------------------------------------------------------------------------

/**
 * Normalizza una riga d'ordine/carrello applicando la classificazione per
 * famiglia e l'estrazione di marca e modelli di stampante: sono le
 * informazioni su cui poggiano le automazioni di riacquisto e i cluster
 * "possiede stampante X".
 */
export function toNormalizedItem(line: PsLineRow, familyRules: FamilyRule[]): NormalizedOrderItem {
  const name = line.name || line.reference || 'Prodotto';
  const sku = line.reference || (line.productId ? `PS-${line.productId}` : name);
  const quantity = Math.max(0, parseAmount(line.quantity));
  const unitPrice = round2(parseAmount(line.unitPrice));
  const total = round2(line.total ? parseAmount(line.total) : unitPrice * quantity);
  const categoryPath = line.categoryPath ?? [];

  const family = classifyProductFamily({ sku, name, categoryPath }, familyRules);
  // La marca può comparire nel nome ("Toner HP 26A") o nella reference.
  const brand = extractPrinterBrand(name) ?? extractPrinterBrand(sku);
  const printerModels = Array.from(
    new Set([...extractPrinterModels(name), ...extractPrinterModels(sku)]),
  );

  return {
    sku,
    name,
    quantity,
    unitPrice,
    total,
    categoryPath,
    family,
    brand,
    printerModels,
    externalProductId: line.productId ?? null,
  };
}

// -----------------------------------------------------------------------------
// Clienti
// -----------------------------------------------------------------------------

/** Segmento commerciale del contatto a partire dai gruppi PrestaShop. */
export function segmentForGroups(
  store: PrestaShopStoreSettings,
  groupNames: ReadonlyArray<string | null | undefined>,
): 'b2c' | 'b2b' {
  const mapping = store.customerGroupMapping ?? {};
  const keys = Object.keys(mapping);
  for (const group of groupNames) {
    if (!group) continue;
    const match = keys.find((key) => key.toLowerCase() === group.toLowerCase());
    if (match) return mapping[match] as 'b2c' | 'b2b';
  }
  return store.defaultSegment;
}

export function toNormalizedCustomer(
  row: PsCustomerRow,
  store: PrestaShopStoreSettings,
  timeZone: string = STORE_TIMEZONE,
): NormalizedCustomer {
  const email = normalizeEmail(row.email);
  const isSameLanguage = row.languageId !== null && String(row.languageId) === String(store.languageId);

  return {
    externalId: row.id,
    source: store.source,
    email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    company: row.company,
    vatNumber: row.vatNumber,
    taxCode: row.taxCode,
    customerGroup: row.groupName,
    // In PrestaShop il consenso è `newsletter`; `optin` è il consenso alle
    // offerte dei partner e non basta da solo a iscrivere il contatto.
    newsletterOptIn: row.newsletter,
    status: row.deleted ? 'blocked' : row.active ? 'active' : 'inactive',
    // I negozi AlphaInk sono italiani: la lingua del negozio è quella del contatto.
    language: isSameLanguage ? DEFAULT_LOCALE : null,
    country: row.country,
    province: row.province,
    city: row.city,
    postcode: row.postcode,
    createdAt: parsePsDate(row.dateAdd, timeZone),
    updatedAt: parsePsDate(row.dateUpd, timeZone),
    raw: {
      ...row.raw,
      groupId: row.groupId,
      groupNames: row.groupNames,
      languageId: row.languageId,
      isGuest: row.isGuest,
      optin: row.optin,
      segment: segmentForGroups(store, [row.groupName, ...row.groupNames]),
    },
  };
}

// -----------------------------------------------------------------------------
// Ordini
// -----------------------------------------------------------------------------

export function toNormalizedOrder(row: PsOrderRow, ctx: NormalizationContext): NormalizedOrder {
  const { store, familyRules } = ctx;
  const timeZone = ctx.timeZone ?? STORE_TIMEZONE;
  const items = row.items.map((line) => toNormalizedItem(line, familyRules));
  const placedAt = parsePsDate(row.dateAdd, timeZone) ?? new Date().toISOString();
  const stateTimestamps = deriveStateTimestamps(row.stateHistory, store.orderStateMapping, timeZone);
  const normalizedStatus = mapOrderStatus(row.currentState, store.orderStateMapping);

  return {
    externalId: row.id,
    source: store.source,
    orderNumber: row.reference,
    email: normalizeEmail(row.email ?? ''),
    customerExternalId: row.customerId,
    status: orderStateLabel(row.currentState, ctx.stateNames),
    normalizedStatus,
    total: round2(row.total),
    subtotal: row.subtotal === null ? null : round2(row.subtotal),
    shipping: row.shipping === null ? null : round2(row.shipping),
    tax: row.tax === null ? null : round2(row.tax),
    currency: row.currency || DEFAULT_CURRENCY,
    couponCode: row.couponCode,
    items,
    placedAt,
    updatedAt: parsePsDate(row.dateUpd, timeZone),
    utm: null,
    raw: {
      ...row.raw,
      currentStateId: row.currentState,
      cartId: row.cartId,
      // Nome e cognome servono a creare il contatto minimo quando l'ordine
      // arriva prima del cliente (vedi `repository.upsertOrdersBatch`).
      firstName: row.firstName,
      lastName: row.lastName,
      payment: row.payment,
      valid: row.valid,
      discounts: row.discounts,
      [ORDER_STATE_TIMESTAMPS_KEY]: stateTimestamps,
    },
  };
}

// -----------------------------------------------------------------------------
// Carrelli
// -----------------------------------------------------------------------------

/**
 * Link di ripresa del carrello.
 *
 * PrestaShop non espone un "recovery URL": si usa lo stesso schema del back
 * office (`controller=order` + `id_cart` + `id_customer` + `key`), che
 * ricostruisce il carrello e porta il cliente al checkout. Senza `secure_key`
 * il link non è valido, quindi in quel caso non ne generiamo uno.
 */
export function buildCartRecoveryUrl(
  baseUrl: string,
  cart: { id: string; customerId: string | null; secureKey: string | null },
): string | null {
  if (!cart.customerId || !cart.secureKey) return null;
  const base = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    controller: 'order',
    id_cart: cart.id,
    id_customer: cart.customerId,
    key: cart.secureKey,
  });
  return `${base}/index.php?${params.toString()}`;
}

export function toNormalizedCart(row: PsCartRow, ctx: NormalizationContext): NormalizedCart {
  const { store, familyRules } = ctx;
  const timeZone = ctx.timeZone ?? STORE_TIMEZONE;
  const items = row.items.map((line) => toNormalizedItem(line, familyRules));
  const total = row.total > 0 ? round2(row.total) : round2(items.reduce((sum, item) => sum + item.total, 0));
  const createdAt = parsePsDate(row.dateAdd, timeZone) ?? new Date().toISOString();

  return {
    externalId: row.id,
    source: store.source,
    email: normalizeEmail(row.email ?? ''),
    customerExternalId: row.customerId,
    total,
    currency: row.currency || DEFAULT_CURRENCY,
    items,
    recoveryUrl: buildCartRecoveryUrl(store.baseUrl, {
      id: row.id,
      customerId: row.customerId,
      secureKey: row.secureKey,
    }),
    createdAt,
    updatedAt: parsePsDate(row.dateUpd, timeZone) ?? createdAt,
    raw: { ...row.raw, secureKeyPresent: Boolean(row.secureKey) },
  };
}

// -----------------------------------------------------------------------------
// Prodotti
// -----------------------------------------------------------------------------

export function toNormalizedProduct(row: PsProductRow, ctx: NormalizationContext): NormalizedProduct {
  const { store, familyRules } = ctx;
  const timeZone = ctx.timeZone ?? STORE_TIMEZONE;
  const sku = row.reference || `PS-${row.id}`;
  const name = row.name || sku;

  return {
    externalId: row.id,
    source: store.source,
    sku,
    name,
    ean13: row.ean13,
    price: round2(row.price),
    active: row.active,
    categoryPath: row.categoryPath,
    family: classifyProductFamily({ sku, name, categoryPath: row.categoryPath }, familyRules),
    brand: extractPrinterBrand(name) ?? extractPrinterBrand(sku),
    printerModels: Array.from(new Set([...extractPrinterModels(name), ...extractPrinterModels(sku)])),
    createdAt: parsePsDate(row.dateAdd, timeZone),
    updatedAt: parsePsDate(row.dateUpd, timeZone),
    raw: row.raw,
  };
}

// -----------------------------------------------------------------------------
// Contatti
// -----------------------------------------------------------------------------

/** Statistiche commerciali azzerate, usate alla creazione di un contatto. */
export const EMPTY_CONTACT_STATS: ContactStats = {
  ordersCount: 0,
  totalSpent: 0,
  averageOrderValue: 0,
  firstOrderAt: null,
  lastOrderAt: null,
  averageDaysBetweenOrders: null,
  nextPurchaseDueAt: {},
  spentByFamily: {},
  ordersByFamily: {},
  lastOrderByFamily: {},
};

/**
 * Stato di iscrizione risultante dalla sincronizzazione.
 *
 * Regola non negoziabile: la sincronizzazione non "resuscita" mai un contatto.
 * Se il contatto si è disiscritto, è rimbalzato o è stato bloccato, quello
 * stato resta — anche se sul sito la casella newsletter risulta spuntata.
 */
export function resolveSubscriptionStatus(
  customer: NormalizedCustomer,
  existing: Pick<Contact, 'status'> | null | undefined,
): SubscriptionStatus {
  const current = existing?.status;
  if (current === 'unsubscribed' || current === 'blocked' || current === 'bounced') return current;
  if (customer.status === 'blocked') return 'blocked';
  if (customer.newsletterOptIn) return 'subscribed';
  if (!current || current === 'never_subscribed') return 'never_subscribed';
  // Iscritto da un'altra sorgente (import, altro negozio): non retrocediamo.
  return current;
}

export interface BuildContactPatchOptions {
  /** Segmento calcolato dai gruppi cliente del negozio. */
  segment?: 'b2c' | 'b2b';
  /** Istante di riferimento; default: adesso. */
  now?: IsoDate;
  /** Origine del consenso da registrare alla prima iscrizione (GDPR). */
  consentSource?: string | null;
}

/**
 * Costruisce il patch da fondere sul documento `contacts`.
 *
 * Il contatto è **unico per email normalizzata**: un cliente presente sia sul
 * B2C sia sul B2B è lo stesso contatto, quindi `sources` e `externalIds` si
 * accumulano invece di sovrascriversi. I campi anagrafici vuoti sulla sorgente
 * non cancellano un valore già presente.
 */
export function buildContactPatch(
  customer: NormalizedCustomer,
  existing: Contact | null | undefined,
  options: BuildContactPatchOptions = {},
): Partial<Contact> {
  const now = options.now ?? new Date().toISOString();
  const emailNormalized = normalizeEmail(customer.email);
  const status = resolveSubscriptionStatus(customer, existing);

  const sources = Array.from(new Set([...(existing?.sources ?? []), customer.source])) as SiteSource[];
  const externalIds = { ...(existing?.externalIds ?? {}) } as Partial<Record<SiteSource, string>>;
  externalIds[customer.source] = customer.externalId;

  // `keep` preferisce il valore in arrivo, ma non sostituisce con il vuoto.
  const keep = <T>(incoming: T | null | undefined, current: T | null | undefined): T | null =>
    (incoming ?? null) !== null && incoming !== '' ? (incoming as T) : (current ?? null);

  const firstName = keep(customer.firstName, existing?.firstName);
  const lastName = keep(customer.lastName, existing?.lastName);
  const company = keep(customer.company, existing?.company);

  const patch: Partial<Contact> = {
    email: customer.email,
    emailNormalized,
    firstName,
    lastName,
    displayName: displayNameFor({ firstName, lastName, company, email: customer.email }),
    phone: keep(customer.phone, existing?.phone),
    company,
    vatNumber: keep(customer.vatNumber, existing?.vatNumber),
    source: existing?.source ?? customer.source,
    sources,
    externalIds,
    status,
    language: customer.language ?? existing?.language ?? DEFAULT_LOCALE,
    country: keep(customer.country, existing?.country),
    province: keep(customer.province, existing?.province),
    city: keep(customer.city, existing?.city),
    postcode: keep(customer.postcode, existing?.postcode),
    customerGroup: keep(customer.customerGroup, existing?.customerGroup),
    segment: options.segment ?? existing?.segment ?? 'b2c',
    lastSyncAt: now,
    updatedAt: now,
    customAttributes: {
      ...(existing?.customAttributes ?? {}),
      ...(customer.taxCode ? { taxCode: customer.taxCode } : {}),
      [`${customer.source}_id`]: customer.externalId,
    },
  };

  // Prima iscrizione: registriamo data e origine del consenso.
  if (status === 'subscribed' && existing?.status !== 'subscribed') {
    patch.optInAt = existing?.optInAt ?? customer.createdAt ?? now;
    patch.consentSource = existing?.consentSource ?? options.consentSource ?? `sync:${customer.source}`;
  }

  // Campi che esistono solo alla creazione: non vanno mai riscritti dal sync.
  if (!existing) {
    patch.createdAt = customer.createdAt ?? now;
    patch.tags = [];
    patch.clusterIds = [];
    patch.dynamicClusterIds = [];
    patch.stats = { ...EMPTY_CONTACT_STATS };
    patch.engagement = { ...EMPTY_ENGAGEMENT };
    patch.printers = [];
    patch.brevoContactId = null;
    patch.notes = null;
  }

  return patch;
}
