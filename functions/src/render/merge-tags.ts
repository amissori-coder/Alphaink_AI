/**
 * Risoluzione dei merge tag (`{{contact.firstName}}`, `{{coupon.code}}`, ...).
 *
 * I valori del contesto sono già pronti per essere inseriti nell'HTML: chi
 * costruisce il contesto (`buildMergeContext`) applica l'escaping. Il solo
 * valore che contiene markup è `order.itemsList`, generato qui a partire da
 * dati escapati.
 *
 * Un token non valorizzato ripiega sul `fallback` dichiarato in `MERGE_TAGS`
 * (così l'anteprima e l'invio mostrano "Cliente" invece di un buco), e un token
 * del tutto sconosciuto diventa stringa vuota.
 */
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  MERGE_TAGS,
  MERGE_TAG_PATTERN,
  displayNameFor,
  formatCurrency,
} from '@alphaink/shared';
import type { Contact, IsoDate, Locale, NormalizedOrderItem } from '@alphaink/shared';

import { escapeHtml } from './html-utils';
import { resolveBranding, resolveUrls } from './types';
import type { RenderBranding, RenderUrls } from './types';

// ---------------------------------------------------------------------------
// Contesto
// ---------------------------------------------------------------------------

export interface MergeContext {
  contact: Record<string, string>;
  order: Record<string, string>;
  coupon: Record<string, string>;
  company: Record<string, string>;
  system: Record<string, string>;
}

export function emptyMergeContext(): MergeContext {
  return { contact: {}, order: {}, coupon: {}, company: {}, system: {} };
}

/** Sottoinsieme di `Contact` che serve ai merge tag. */
export type MergeContactInput = Partial<
  Pick<
    Contact,
    'email' | 'firstName' | 'lastName' | 'displayName' | 'company' | 'city' | 'stats' | 'printers' | 'customAttributes'
  >
>;

/**
 * Sorgente dei tag `order.*`. La forma è compatibile sia con `Order` sia con
 * `AbandonedCart` (che usa `abandonedAt` al posto di `placedAt` e porta con sé
 * l'URL di ripristino del carrello).
 */
export interface MergeOrderInput {
  orderNumber?: string | null;
  externalId?: string | null;
  total?: number | null;
  currency?: string | null;
  placedAt?: IsoDate | null;
  abandonedAt?: IsoDate | null;
  items?: NormalizedOrderItem[];
  recoveryUrl?: string | null;
}

/** Sorgente dei tag `coupon.*`; compatibile con `IssuedCoupon`. */
export interface MergeCouponInput {
  code?: string | null;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: number | null;
  /** Etichetta già pronta (es. "-15%"): ha la precedenza su tipo/valore. */
  discountLabel?: string | null;
  expiresAt?: IsoDate | null;
  url?: string | null;
}

export interface MergeContextInput {
  contact?: MergeContactInput | null;
  order?: MergeOrderInput | null;
  coupon?: MergeCouponInput | null;
  branding?: Partial<RenderBranding> | null;
  urls?: Partial<RenderUrls> | null;
  now?: Date;
  locale?: Locale;
  timezone?: string;
  currency?: string;
}

function formatIsoDate(value: string | null | undefined, locale: Locale, timezone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);
}

/** Elenco prodotti in HTML: l'unico valore del contesto che contiene markup. */
function itemsListHtml(items: NormalizedOrderItem[], currency: string, locale: Locale): string {
  if (!items.length) return '';
  const rows = items
    .map((item) => {
      const quantity = item.quantity > 1 ? `${item.quantity} × ` : '';
      const price = Number.isFinite(item.total) ? ` — ${formatCurrency(item.total, currency, locale)}` : '';
      return `<li>${escapeHtml(quantity)}${escapeHtml(item.name || item.sku)}${escapeHtml(price)}</li>`;
    })
    .join('');
  return `<ul style="margin:0;padding-left:20px;">${rows}</ul>`;
}

function couponDiscountLabel(coupon: MergeCouponInput, currency: string, locale: Locale): string {
  if (coupon.discountLabel) return coupon.discountLabel;
  if (typeof coupon.discountValue !== 'number') return '';
  if (coupon.discountType === 'fixed') return formatCurrency(coupon.discountValue, currency, locale);
  return `${Math.round(coupon.discountValue)}%`;
}

/** Aggiunge il codice sconto all'URL del negozio (PrestaShop: `?discount=`). */
function couponUrlFor(code: string, base: string, explicit?: string | null): string {
  if (explicit) return explicit;
  if (!code || !base) return base || '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}discount=${encodeURIComponent(code)}`;
}

/**
 * Costruisce il contesto di risoluzione. Tutti i valori escono già escapati:
 * possono quindi finire sia nel testo sia in un attributo `href`.
 */
export function buildMergeContext(input: MergeContextInput = {}): MergeContext {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const now = input.now ?? new Date();
  const branding = resolveBranding(input.branding);
  const urls = resolveUrls(input.urls);

  const context = emptyMergeContext();

  // --- Contatto -------------------------------------------------------------
  const contact = input.contact;
  if (contact) {
    const stats = contact.stats;
    const printer = contact.printers?.[0];
    const values: Record<string, string> = {
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      fullName:
        contact.displayName ||
        (contact.email
          ? displayNameFor({
              firstName: contact.firstName,
              lastName: contact.lastName,
              company: contact.company,
              email: contact.email,
            })
          : ''),
      email: contact.email ?? '',
      company: contact.company ?? '',
      city: contact.city ?? '',
      ordersCount: stats ? String(stats.ordersCount ?? 0) : '',
      totalSpent: stats ? formatCurrency(stats.totalSpent ?? 0, currency, locale) : '',
      lastOrderDate: formatIsoDate(stats?.lastOrderAt ?? null, locale, timezone),
      printerBrand: printer?.brand ?? '',
      printerModel: printer?.model ?? '',
    };
    for (const [key, value] of Object.entries(values)) {
      if (value) context.contact[key] = escapeHtml(value);
    }
    // Attributi liberi provenienti dal sito: esposti come `{{contact.<chiave>}}`.
    for (const [key, value] of Object.entries(contact.customAttributes ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      if (context.contact[key] === undefined) context.contact[key] = escapeHtml(String(value));
    }
  }

  // --- Ordine / carrello ----------------------------------------------------
  const order = input.order;
  if (order) {
    const orderCurrency = order.currency || currency;
    const number = order.orderNumber || (order.externalId ? `#${order.externalId}` : '');
    const items = order.items ?? [];
    if (number) context.order.number = escapeHtml(number);
    if (typeof order.total === 'number') {
      context.order.total = escapeHtml(formatCurrency(order.total, orderCurrency, locale));
    }
    const date = formatIsoDate(order.placedAt ?? order.abandonedAt ?? null, locale, timezone);
    if (date) context.order.date = escapeHtml(date);
    if (items.length) {
      // Già escapato riga per riga da `itemsListHtml`: qui NON si ri-escapa.
      context.order.itemsList = itemsListHtml(items, orderCurrency, locale);
      const first = items[0];
      context.order.firstProductName = escapeHtml(first.name || first.sku || '');
    }
    const recovery = order.recoveryUrl ?? urls.recoveryUrl ?? '';
    if (recovery) context.order.recoveryUrl = escapeHtml(recovery);
  }

  // --- Coupon ---------------------------------------------------------------
  const coupon = input.coupon;
  if (coupon) {
    const code = coupon.code ?? '';
    if (code) context.coupon.code = escapeHtml(code);
    const discount = couponDiscountLabel(coupon, currency, locale);
    if (discount) context.coupon.discount = escapeHtml(discount);
    const expires = formatIsoDate(coupon.expiresAt ?? null, locale, timezone);
    if (expires) context.coupon.expiresAt = escapeHtml(expires);
    const url = couponUrlFor(code, branding.websiteUrl, coupon.url ?? urls.couponUrl ?? null);
    if (url) context.coupon.url = escapeHtml(url);
  }

  // --- Azienda --------------------------------------------------------------
  context.company.name = escapeHtml(branding.companyName);
  context.company.legalName = escapeHtml(branding.legalName);
  context.company.address = escapeHtml(branding.address);
  context.company.website = escapeHtml(branding.websiteUrl);
  context.company.supportEmail = escapeHtml(branding.supportEmail);
  if (branding.supportPhone) context.company.supportPhone = escapeHtml(branding.supportPhone);
  if (branding.vatNumber) context.company.vatNumber = escapeHtml(branding.vatNumber);

  // --- Sistema --------------------------------------------------------------
  context.system.unsubscribeUrl = escapeHtml(urls.unsubscribeUrl);
  context.system.preferencesUrl = escapeHtml(urls.preferencesUrl);
  context.system.webviewUrl = escapeHtml(urls.webviewUrl);
  context.system.currentYear = String(now.getFullYear());

  return context;
}

// ---------------------------------------------------------------------------
// Risoluzione
// ---------------------------------------------------------------------------

/**
 * `MERGE_TAG_PATTERN` è una regex globale condivisa: riusarla direttamente
 * porterebbe con sé `lastIndex` fra una chiamata e l'altra.
 */
function tagPattern(): RegExp {
  return new RegExp(MERGE_TAG_PATTERN.source, 'g');
}

const FALLBACKS: Map<string, string> = new Map(
  MERGE_TAGS.map((tag) => [tag.token.replace(/[{}\s]/g, ''), tag.fallback]),
);

const KNOWN_PATHS: Set<string> = new Set(FALLBACKS.keys());

function lookup(context: MergeContext, path: string): string | undefined {
  const dot = path.indexOf('.');
  if (dot <= 0) return undefined;
  const group = path.slice(0, dot);
  const key = path.slice(dot + 1);
  const bucket = (context as unknown as Record<string, Record<string, string> | undefined>)[group];
  if (!bucket) return undefined;
  const value = bucket[key];
  return value === undefined || value === '' ? undefined : value;
}

export interface ResolveOptions {
  /** Lascia intatti i token non riconosciuti invece di rimuoverli. */
  keepUnknown?: boolean;
  /** Usa i `fallback` dichiarati quando il valore manca (default: true). */
  useFallbacks?: boolean;
  /**
   * Percorsi da lasciare intatti (es. `['coupon.code']`): il valore verrà
   * sostituito più avanti, per singolo destinatario, da chi invia. Senza questo
   * elenco un token senza valore diventerebbe il proprio fallback.
   */
  defer?: string[];
}

/** Sostituisce tutti i merge tag presenti nell'HTML (o nel testo). */
export function resolveMergeTags(html: string, context: MergeContext, options: ResolveOptions = {}): string {
  if (!html) return '';
  const useFallbacks = options.useFallbacks !== false;
  const deferred = new Set((options.defer ?? []).map((path) => path.replace(/[{}\s]/g, '')));
  return String(html).replace(tagPattern(), (match, rawPath: string) => {
    const path = String(rawPath).trim();
    if (deferred.has(path)) return match;
    const value = lookup(context, path);
    if (value !== undefined) return value;
    if (useFallbacks) {
      const fallback = FALLBACKS.get(path);
      if (fallback !== undefined) return fallback;
    }
    return options.keepUnknown && !KNOWN_PATHS.has(path) ? match : '';
  });
}

/**
 * Token presenti nel testo ma non previsti dal catalogo `MERGE_TAGS`: la UI li
 * segnala all'utente perché all'invio diventerebbero stringa vuota.
 */
export function listUnknownTags(html: string): string[] {
  if (!html) return [];
  const found = new Set<string>();
  const pattern = tagPattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html))) !== null) {
    const path = String(match[1]).trim();
    if (!KNOWN_PATHS.has(path)) found.add(`{{${path}}}`);
  }
  return Array.from(found);
}

/**
 * Token che restano volutamente non risolti dopo `resolveMergeTags`: sono
 * quelli il cui valore nel contesto è il token stesso, come gli URL di sistema
 * che vengono firmati per singolo destinatario al momento dell'invio.
 */
export function deferredTokens(context: MergeContext, extra: string[] = []): Set<string> {
  const tokens = new Set(extra.map((path) => `{{${path.replace(/[{}\s]/g, '')}}}`));
  for (const [group, bucket] of Object.entries(context)) {
    for (const [key, value] of Object.entries(bucket as Record<string, string>)) {
      if (/\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(value)) tokens.add(`{{${group}.${key}}}`);
    }
  }
  return tokens;
}

/** Tutti i token presenti nel testo, in forma normalizzata. */
export function listMergeTags(html: string): string[] {
  if (!html) return [];
  const found = new Set<string>();
  const pattern = tagPattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html))) !== null) {
    found.add(`{{${String(match[1]).trim()}}}`);
  }
  return Array.from(found);
}

/**
 * Appiattisce il contesto in `campo → valore` per le regole di visibilità dei
 * blocchi (`contact.ordersCount > 0`).
 */
export function mergeContextToFields(context: MergeContext): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [group, bucket] of Object.entries(context)) {
    for (const [key, value] of Object.entries(bucket as Record<string, string>)) {
      fields[`${group}.${key}`] = value;
    }
  }
  return fields;
}
