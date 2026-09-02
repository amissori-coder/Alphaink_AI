/**
 * Riscrittura dei link e tracciamento.
 *
 * Due trasformazioni, in quest'ordine:
 *  1. `appendUtm` aggiunge i parametri UTM mancanti (mai sovrascrive quelli
 *     già scritti dall'utente);
 *  2. `wrapTrackedLink` avvolge l'URL nel redirector firmato
 *     `{appUrl}/t/c?u=…&r=…&c=…&s=…`.
 *
 * La firma HMAC sul payload `u|r|c` impedisce di fabbricare click o di far
 * puntare il redirector a un dominio arbitrario manipolando la query string.
 */
import type { UtmParams } from '@alphaink/shared';

import { sign } from '../lib/signing';
import { containsMergeTag, decodeBasicEntities, escapeAttr } from './html-utils';

export interface TrackingLinkOptions {
  /** Riferimento dell'invio, es. `n:<newsletterId>:<variantId>` o `a:<automationId>:<stepId>`. */
  ref: string;
  contactId: string;
  /** Segreto HMAC (`LINK_SIGNING_KEY`). */
  secret: string;
  /** Base URL pubblica della web app (`APP_URL`). */
  appUrl: string;
}

/** URL su cui non ha senso (o è dannoso) intervenire. */
const UNTRACKABLE_SCHEMES = /^(?:mailto:|tel:|sms:|data:|javascript:|vbscript:|cid:|file:|blob:)/i;

/**
 * true se l'URL può essere arricchito con UTM e tracciato: solo `http(s)`
 * assoluti, senza merge tag ancora da risolvere.
 */
export function isTrackableUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = String(url).trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (containsMergeTag(trimmed)) return false;
  if (UNTRACKABLE_SCHEMES.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed);
}

// ---------------------------------------------------------------------------
// UTM
// ---------------------------------------------------------------------------

function utmPairs(utm: UtmParams): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (utm.source) pairs.push(['utm_source', utm.source]);
  if (utm.medium) pairs.push(['utm_medium', utm.medium]);
  if (utm.campaign) pairs.push(['utm_campaign', utm.campaign]);
  if (utm.term) pairs.push(['utm_term', utm.term]);
  if (utm.content) pairs.push(['utm_content', utm.content]);
  return pairs;
}

/**
 * Aggiunge i parametri UTM mancanti conservando l'URL così com'è.
 *
 * La manipolazione è testuale e non passa da `new URL()`: quest'ultima
 * normalizza e ri-codifica il percorso, rovinando gli URL che contengono
 * ancora merge tag o caratteri già codificati dal sito.
 */
export function appendUtm(url: string, utm?: UtmParams | null): string {
  if (!utm || !isTrackableUrl(url)) return url;
  const pairs = utmPairs(utm);
  if (!pairs.length) return url;

  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;

  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const existing = new Set(
    query
      .split('&')
      .filter(Boolean)
      .map((part) => part.split('=')[0].toLowerCase()),
  );

  const added = pairs
    .filter(([key]) => !existing.has(key))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  if (!added.length) return url;

  const newQuery = query ? `${query}&${added.join('&')}` : added.join('&');
  return `${path}?${newQuery}${hash}`;
}

// ---------------------------------------------------------------------------
// Redirector firmato
// ---------------------------------------------------------------------------

function baseAppUrl(appUrl: string): string {
  return String(appUrl ?? '').replace(/\/+$/, '');
}

/** Payload firmato del link tracciato: URL codificato, riferimento, contatto. */
export function clickSignaturePayload(encodedUrl: string, ref: string, contactId: string): string {
  return `${encodedUrl}|${ref}|${contactId}`;
}

/** Payload firmato del pixel di apertura. */
export function openSignaturePayload(ref: string, contactId: string): string {
  return `${ref}|${contactId}`;
}

/** Avvolge un URL nel redirector di tracciamento click. */
export function wrapTrackedLink(url: string, options: TrackingLinkOptions): string {
  const encoded = Buffer.from(String(url), 'utf8').toString('base64url');
  const signature = sign(clickSignaturePayload(encoded, options.ref, options.contactId), options.secret);
  const query = [
    `u=${encoded}`,
    `r=${encodeURIComponent(options.ref)}`,
    `c=${encodeURIComponent(options.contactId)}`,
    `s=${signature}`,
  ].join('&');
  return `${baseAppUrl(options.appUrl)}/t/c?${query}`;
}

/** URL del pixel di apertura firmato. */
export function openPixelUrl(options: TrackingLinkOptions): string {
  const signature = sign(openSignaturePayload(options.ref, options.contactId), options.secret);
  const query = [
    `r=${encodeURIComponent(options.ref)}`,
    `c=${encodeURIComponent(options.contactId)}`,
    `s=${signature}`,
  ].join('&');
  return `${baseAppUrl(options.appUrl)}/t/o?${query}`;
}

// ---------------------------------------------------------------------------
// Riscrittura degli href
// ---------------------------------------------------------------------------

export interface RewriteLinksOptions {
  utm?: UtmParams | null;
  /** Se assente, i link vengono solo arricchiti di UTM. */
  tracking?: TrackingLinkOptions | null;
  /** URL che corrispondono a questi pattern restano intatti. */
  skip?: RegExp[];
  /** Traccia anche i link che puntano alla web app (default: no). */
  trackAppUrls?: boolean;
}

export interface RewriteLinksResult {
  html: string;
  /** URL di destinazione (UTM inclusi, redirector escluso), deduplicati. */
  links: string[];
}

/**
 * Tag che portano un link su cui intervenire: gli ancoraggi e il pulsante VML
 * dentro i commenti condizionali di Outlook.
 *
 * Si passa per il tag e non direttamente per l'attributo perché `href` compare
 * anche nel `<link>` dei web font nell'head: riscriverlo romperebbe i font e
 * inquinerebbe le statistiche di click.
 */
const LINK_TAG_RE = /<(a|area|v:roundrect)(?=[\s>/])((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

/** Attributi `href` nelle tre forme ammesse (doppi apici, apici singoli, nudo). */
const HREF_RE = /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

export function rewriteLinks(html: string, options: RewriteLinksOptions = {}): RewriteLinksResult {
  if (!html) return { html: '', links: [] };
  const collected = new Set<string>();
  const appHost = options.tracking ? baseAppUrl(options.tracking.appUrl) : '';

  const rewriteHref = (match: string, prefix: string, dq?: string, sq?: string, bare?: string): string => {
    const rawValue = dq ?? sq ?? bare ?? '';
    // Nell'HTML l'URL è scritto con le entità (`&amp;`): qui serve la forma reale.
    const url = decodeBasicEntities(rawValue).trim();
    if (!isTrackableUrl(url)) return match;
    if (options.skip?.some((pattern) => pattern.test(url))) return match;
    // I link verso la web app (disiscrizione, preferenze, webview) restano
    // intatti: sono già firmati e passare dal redirector li invaliderebbe.
    const isAppUrl = Boolean(appHost) && url.startsWith(appHost);
    if (isAppUrl && !options.trackAppUrls) return match;

    const destination = appendUtm(url, options.utm);
    collected.add(destination);

    const finalUrl = options.tracking ? wrapTrackedLink(destination, options.tracking) : destination;
    return `${prefix}"${escapeAttr(finalUrl)}"`;
  };

  const output = String(html).replace(
    LINK_TAG_RE,
    (_tag, tagName: string, rawAttrs: string) => `<${tagName}${rawAttrs.replace(HREF_RE, rewriteHref)}>`,
  );

  return { html: output, links: Array.from(collected) };
}

// ---------------------------------------------------------------------------
// Pixel di apertura
// ---------------------------------------------------------------------------

/**
 * Inserisce il pixel di apertura appena prima di `</body>`. Serve solo come
 * tracciamento nostro: Brevo traccia già le proprie aperture.
 */
export function injectOpenPixel(html: string, options: TrackingLinkOptions): string {
  if (!html) return html;
  const url = openPixelUrl(options);
  const pixel =
    `<img src="${escapeAttr(url)}" alt="" width="1" height="1" border="0"` +
    ` style="display:block;width:1px;height:1px;max-height:1px;max-width:1px;border:0;outline:none;overflow:hidden;" />`;

  const index = html.toLowerCase().lastIndexOf('</body>');
  if (index === -1) return `${html}${pixel}`;
  return `${html.slice(0, index)}${pixel}${html.slice(index)}`;
}
