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
 * Ripulitura lato client dell'HTML mostrato nel canvas.
 *
 * Il renderer delle Functions applica la sanificazione autorevole prima
 * dell'invio; qui serve solo a non eseguire nulla di pericoloso dentro
 * l'anteprima dell'editor, che gira nella stessa pagina dell'applicazione.
 */
export function sanitizePreviewHtml(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s(?:href|src|background|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data|file|blob)\s*:[^"]*"|'\s*(?:javascript|vbscript|data|file|blob)\s*:[^']*')/gi,
      '',
    );
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
