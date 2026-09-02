/**
 * Utilità condivise dai componenti dell'editor.
 *
 * Traducono il modello del documento (`Spacing`, `BorderStyle`,
 * `TypographyStyle`) nelle proprietà CSS di React, così il canvas mostra
 * esattamente ciò che il renderer produrrà nell'email finale.
 */

import { MERGE_TAGS, MERGE_TAG_PATTERN } from '@alphaink/shared';
import type {
  BorderStyle,
  EmailSection,
  MergeTag,
  Spacing,
  TextAlign,
  TypographyStyle,
} from '@alphaink/shared';
import type * as React from 'react';

// -----------------------------------------------------------------------------
// Stili
// -----------------------------------------------------------------------------

export function spacingToCss(padding?: Spacing | null): string {
  const value = padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`;
}

export function borderToCss(border?: BorderStyle | null): string | undefined {
  if (!border || border.style === 'none' || border.width <= 0) return undefined;
  return `${border.width}px ${border.style} ${border.color}`;
}

/** Converte una tipografia del documento in stile inline React. */
export function typographyToStyle(style?: TypographyStyle | null): React.CSSProperties {
  if (!style) return {};
  return {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    color: style.color,
    textAlign: style.align,
    textTransform:
      style.textTransform && style.textTransform !== 'none'
        ? (style.textTransform as React.CSSProperties['textTransform'])
        : undefined,
    margin: 0,
  };
}

/** L'attributo `align` dell'email non conosce `justify`. */
export function alignToFlex(align?: TextAlign | null): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'center') return 'center';
  if (align === 'right') return 'flex-end';
  return 'flex-start';
}

// -----------------------------------------------------------------------------
// Colonne
// -----------------------------------------------------------------------------

/** Larghezze in pixel delle colonne di una sezione, dato lo spazio interno. */
export function columnWidths(section: EmailSection, innerWidth: number): number[] {
  const columns = section.columns ?? [];
  if (!columns.length) return [];
  const total = columns.reduce((sum, column) => sum + (column.span > 0 ? column.span : 1), 0) || 12;
  return columns.map((column) =>
    Math.max(40, Math.floor((innerWidth * (column.span > 0 ? column.span : 1)) / total)),
  );
}

/** Etichetta leggibile di un preset colonne, es. "7 · 5". */
export function spansLabel(spans: number[]): string {
  return spans.join(' · ');
}

// -----------------------------------------------------------------------------
// Merge tag
// -----------------------------------------------------------------------------

const MERGE_TAG_BY_KEY = new Map<string, MergeTag>(
  MERGE_TAGS.map((tag) => [tag.token.replace(/[{}\s]/g, ''), tag]),
);

/** Valore mostrato in anteprima per un merge tag: contesto, poi fallback. */
export function mergeTagPreviewValue(key: string, context: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(context, key)) return context[key] ?? '';
  const token = `{{${key}}}`;
  if (Object.prototype.hasOwnProperty.call(context, token)) return context[token] ?? '';
  const tag = MERGE_TAG_BY_KEY.get(key);
  if (tag) return tag.fallback || tag.label;
  return `{{${key}}}`;
}

/**
 * Sostituisce i merge tag con i valori di anteprima.
 * Usata per testi semplici (titoli, etichette, nomi prodotto).
 */
export function resolveMergeTags(value: string, context: Record<string, string>): string {
  if (!value) return '';
  return value.replace(MERGE_TAG_PATTERN, (_match, key: string) =>
    mergeTagPreviewValue(key, context),
  );
}

/** Vero se il testo contiene almeno un merge tag. */
export function hasMergeTag(value: string): boolean {
  if (!value) return false;
  const pattern = new RegExp(MERGE_TAG_PATTERN.source, 'g');
  return pattern.test(value);
}

/** Descrizione di un merge tag, per i suggerimenti dell'interfaccia. */
export function mergeTagLabel(token: string): string {
  const key = token.replace(/[{}\s]/g, '');
  return MERGE_TAG_BY_KEY.get(key)?.label ?? token;
}

// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------

const DANGEROUS_TAGS =
  'script|style|iframe|object|embed|noscript|svg|math|template|form|textarea|select|applet|frame|frameset';

/**
 * Tag ammessi nell'anteprima. È una whitelist: quello che non è in elenco esce
 * dal markup, senza dover riconoscere le forme con cui un attacco si traveste
 * (`<img/onerror=…>`, maiuscole miste, separatori insoliti). Ci sono anche i
 * tag di documento perché la stessa funzione ripulisce l'HTML completo mostrato
 * nelle anteprime `srcDoc`.
 *
 * NOTA: la logica è gemella di `stripUnsafeHtml` in
 * `functions/src/render/html-utils.ts` — quella resta la sanificazione
 * autorevole (è l'HTML che parte davvero). Non è condivisa perché
 * `@alphaink/shared` non dipende dal renderer: se una delle due cambia va
 * allineata anche l'altra.
 */
const ALLOWED_PREVIEW_TAGS = new Set([
  'html', 'head', 'body', 'title',
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'br', 'p', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
  'img', 'hr', 'blockquote', 'pre', 'code', 'small', 'sub', 'sup',
  'strike', 'center', 'font', 'abbr', 'big', 'tt', 'dl', 'dt', 'dd',
  'figure', 'figcaption',
]);

/** Attributi ammessi nell'anteprima. Nessun `on*`: non sono in elenco. */
const ALLOWED_PREVIEW_ATTRS = new Set([
  'href', 'target', 'rel', 'name', 'title', 'alt', 'src', 'background',
  'width', 'height', 'border', 'align', 'valign', 'bgcolor', 'nowrap', 'summary',
  'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'span', 'start', 'type',
  'class', 'id', 'dir', 'lang', 'role', 'style', 'color', 'face', 'size',
]);

const ALLOWED_PREVIEW_REL = new Set(['noopener', 'noreferrer', 'nofollow', 'sponsored', 'ugc']);

/** Commento, dichiarazione o tag. Un `>` fra virgolette non chiude il tag. */
const PREVIEW_NODE_RE =
  /<!--[\s\S]*?-->|<![\s\S]*?>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;

const PREVIEW_ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

/**
 * Ripulitura lato client dell'HTML mostrato nel canvas.
 *
 * Il renderer delle Functions applica la sanificazione autorevole prima
 * dell'invio, ma questa non è solo una copia di cortesia: il canvas inserisce
 * il markup con `dangerouslySetInnerHTML` nella pagina dell'applicazione, con
 * la sessione dell'utente che sta guardando. Quello che esce da qui deve essere
 * inerte anche se la bozza è stata scritta da qualcun altro.
 */
export function sanitizePreviewHtml(html: string): string {
  if (!html) return '';
  // Gli elementi pericolosi vanno via con tutto il contenuto: togliere solo il
  // tag lascerebbe il corpo dello script come testo visibile.
  const source = String(html)
    .replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  PREVIEW_NODE_RE.lastIndex = 0;

  while ((match = PREVIEW_NODE_RE.exec(source)) !== null) {
    out += source.slice(cursor, match.index).replace(/</g, '&lt;');
    cursor = PREVIEW_NODE_RE.lastIndex;

    const node = match[0];
    if (node.startsWith('<!--')) {
      out += node; // condizionali Outlook: inerti nel browser
      continue;
    }
    if (node.startsWith('<!')) {
      if (/^<!doctype\b/i.test(node)) out += node;
      continue;
    }

    const name = match[2].toLowerCase();
    if (!ALLOWED_PREVIEW_TAGS.has(name)) continue;
    if (match[1] === '/') {
      out += `</${name}>`;
      continue;
    }
    out += `<${name}${filterPreviewAttributes(match[3] ?? '')}>`;
  }

  out += source.slice(cursor).replace(/</g, '&lt;');
  return out;
}

/** Riscrive gli attributi di un tag tenendo solo quelli ammessi e validati. */
function filterPreviewAttributes(raw: string): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  PREVIEW_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PREVIEW_ATTR_RE.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4];
    if (!ALLOWED_PREVIEW_ATTRS.has(name) || seen.has(name)) continue;
    seen.add(name);

    if (rawValue === undefined) {
      parts.push(name);
      continue;
    }
    const value = previewAttrValue(name, rawValue);
    if (value === null) continue;
    parts.push(`${name}="${value}"`);
  }

  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Valore pronto per essere riscritto fra virgolette, `null` se l'attributo va
 * scartato. Gli attributi non-URL restano nella forma originale (sono già testo
 * HTML): ri-escaparli rovinerebbe entità come `&egrave;`.
 */
function previewAttrValue(name: string, rawValue: string): string | null {
  if (name === 'href') {
    const url = safePreviewUrl(decodePreviewEntities(rawValue), false);
    return url === null ? null : escapePreviewAttr(url);
  }
  if (name === 'src' || name === 'background') {
    const url = safePreviewUrl(decodePreviewEntities(rawValue), true);
    return url === null ? null : escapePreviewAttr(url);
  }
  if (name === 'style') {
    const style = sanitizePreviewStyle(decodePreviewEntities(rawValue));
    return style ? escapePreviewAttr(style) : null;
  }
  if (name === 'target') {
    const target = rawValue.trim().toLowerCase();
    return target === '_blank' || target === '_self' ? target : null;
  }
  if (name === 'rel') {
    const tokens = rawValue
      .split(/\s+/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => ALLOWED_PREVIEW_REL.has(token));
    return tokens.length ? Array.from(new Set(tokens)).join(' ') : null;
  }
  return rawValue.replace(/[\u0000-\u001F\u007F]/g, '').replace(/"/g, '&quot;');
}

function escapePreviewAttr(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Decodifica le entità di base prima di guardare lo schema di un URL:
 * `java&#115;cript:` e `&#106;avascript:` sono `javascript:` per il browser.
 */
function decodePreviewEntities(value: string): string {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_match, code: string) => fromCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => fromCode(Number.parseInt(code, 16)))
    .replace(/&(?:quot|apos|nbsp);/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** URL ammesso in anteprima: solo schemi inerti, mai `javascript:` & co. */
function safePreviewUrl(value: string, allowDataImage: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{{')) return trimmed; // merge tag non ancora risolto
  // Spazi e caratteri di controllo servono solo a mascherare lo schema.
  const probe = trimmed.replace(/[\s\u0000-\u001F]/g, '').toLowerCase();
  if (allowDataImage && probe.startsWith('data:image/')) return trimmed;
  if (probe.startsWith('cid:')) return trimmed;
  if (/^(?:javascript|vbscript|data|file|blob|about):/.test(probe)) return null;
  if (/^(?:https?:|mailto:|tel:|sms:)/.test(probe)) return trimmed;
  // Relativi, protocol-relative e ancore: nessuno schema da eseguire.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return null;
}

/** Filtra uno `style`: proprietà con nome CSS valido e valori senza codice. */
function sanitizePreviewStyle(value: string): string {
  const parts: string[] = [];
  for (const declaration of value.split(';')) {
    const idx = declaration.indexOf(':');
    if (idx <= 0) continue;
    const prop = declaration.slice(0, idx).trim().toLowerCase();
    const cssValue = declaration.slice(idx + 1).trim();
    if (!/^-?[a-z][a-z0-9-]*$/.test(prop) || !cssValue) continue;
    if (/(?:binding|behaviou?r)$/.test(prop)) continue;
    // La barra rovescia è l'escape CSS con cui si maschera uno schema (`\6a`).
    if (/(?:expression\s*\(|@import|\\)/i.test(cssValue)) continue;
    const opened = cssValue.match(/url\s*\(/gi)?.length ?? 0;
    const closed = cssValue.match(/url\s*\([^)]*\)/gi) ?? [];
    if (opened !== closed.length) continue;
    if (closed.some((url) => !isSafePreviewCssUrl(url))) continue;
    parts.push(`${prop}:${cssValue}`);
  }
  return parts.join(';');
}

function isSafePreviewCssUrl(raw: string): boolean {
  const inner = raw
    .replace(/^url\s*\(/i, '')
    .replace(/\)$/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[\s\u0000-\u001F]/g, '')
    .toLowerCase();
  if (!inner) return false;
  if (/^(?:javascript|vbscript|file|blob|about):/.test(inner)) return false;
  if (inner.startsWith('data:') && !inner.startsWith('data:image/')) return false;
  return true;
}

/** Testo semplice estratto da un frammento HTML (contatori, anteprime brevi). */
export function htmlToPlainText(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// -----------------------------------------------------------------------------
// URL
// -----------------------------------------------------------------------------

/** Vero se la stringa è un URL http(s) utilizzabile in un'email. */
export function isUsableUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Aggiunge `https://` quando l'utente scrive solo il dominio. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(https?:)?\/\//i.test(trimmed) || /^(mailto|tel):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('{{')) return trimmed; // merge tag: lasciato intatto
  return `https://${trimmed}`;
}

/** Nome file leggibile ricavato da un URL. */
export function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(last ?? parsed.hostname);
  } catch {
    return url;
  }
}

// -----------------------------------------------------------------------------
// Varie
// -----------------------------------------------------------------------------

/** Vincola un numero, tollerando input non numerici dei campi di testo. */
export function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/** Luminanza percepita di un colore esadecimale (0 = nero, 1 = bianco). */
export function hexLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.slice(0, 6);
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return 1;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Colore di testo leggibile sopra uno sfondo dato. */
export function readableTextOn(hex: string): string {
  return hexLuminance(hex) > 0.6 ? '#0F172A' : '#FFFFFF';
}
