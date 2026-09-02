/**
 * Utility di basso livello per la generazione di HTML email.
 *
 * Tutto ciò che finisce nell'email arriva dall'editor (testo libero, HTML
 * incollato) o dai dati cliente: nulla è considerato sicuro. Ogni valore passa
 * quindi da `escapeHtml` / `escapeAttr` / `sanitizeInlineHtml` prima di essere
 * concatenato al markup.
 */
import type { BorderStyle, Spacing } from '@alphaink/shared';

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** Escape completo per il contenuto testuale di un nodo HTML. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape per il valore di un attributo. Identico a `escapeHtml` ma rimuove
 * anche i caratteri di controllo: alcuni client interrompono il parsing
 * dell'attributo su un a-capo dentro un `href`.
 */
export function escapeAttr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeHtml(String(value).replace(/[\u0000-\u001F\u007F]/g, ''));
}

const NAMED_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/**
 * Decodifica le entità di base. Serve prima di manipolare un URL preso da un
 * attributo `href`: nell'HTML l'URL è scritto `a=1&amp;b=2`, ma per firmarlo e
 * codificarlo in base64 serve la forma reale `a=1&b=2`.
 */
export function decodeBasicEntities(value: string): string {
  return String(value ?? '')
    .replace(/&(?:lt|gt|quot|apos|nbsp|#39|#x27);/gi, (match) => NAMED_ENTITIES[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_m, code: string) => safeFromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => safeFromCharCode(Number.parseInt(code, 16)))
    // `&amp;` va decodificato per ultimo: altrimenti `&amp;lt;` diventerebbe `<`.
    .replace(/&amp;/gi, '&');
}

function safeFromCharCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Testo semplice di un frammento HTML (usato per `alt`, anteprime, controlli). */
export function stripTags(html: string): string {
  return decodeBasicEntities(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Stili inline
// ---------------------------------------------------------------------------

export type StyleValue = string | number | null | undefined | false;
export type StyleRecord = Record<string, StyleValue>;

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Serializza un record di proprietà CSS ignorando i valori vuoti. */
export function styleString(record: StyleRecord): string {
  const parts: string[] = [];
  for (const [prop, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === false || value === '') continue;
    const cssValue = typeof value === 'number' ? String(value) : value.trim();
    if (!cssValue) continue;
    parts.push(`${kebab(prop)}:${cssValue}`);
  }
  return parts.join(';');
}

/** Come `styleString`, ma restituisce direttamente ` style="..."` (o stringa vuota). */
export function styleAttr(record: StyleRecord): string {
  const css = styleString(record);
  return css ? ` style="${escapeAttr(css)}"` : '';
}

/** Serializza attributi HTML saltando quelli non valorizzati. */
export function attrs(record: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function px(value: number): string {
  return `${Math.round(Number.isFinite(value) ? value : 0)}px`;
}

/** Larghezza in pixel oppure `auto` quando non specificata. */
export function pxOrAuto(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? px(value) : 'auto';
}

const ZERO_SPACING: Spacing = { top: 0, right: 0, bottom: 0, left: 0 };

export function normalizeSpacing(spacing?: Spacing | null): Spacing {
  if (!spacing) return ZERO_SPACING;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
  return { top: num(spacing.top), right: num(spacing.right), bottom: num(spacing.bottom), left: num(spacing.left) };
}

/** `padding` in forma abbreviata: `10px 16px 10px 16px`. */
export function spacingToCss(spacing?: Spacing | null): string {
  const s = normalizeSpacing(spacing);
  return `${px(s.top)} ${px(s.right)} ${px(s.bottom)} ${px(s.left)}`;
}

/** Spazio orizzontale occupato da un padding: serve a calcolare le larghezze. */
export function spacingHorizontal(spacing?: Spacing | null): number {
  const s = normalizeSpacing(spacing);
  return s.left + s.right;
}

/** `border` in forma abbreviata; `none` quando il bordo è assente o a spessore 0. */
export function borderToCss(border?: BorderStyle | null): string {
  if (!border || border.style === 'none' || !border.width) return 'none';
  return `${px(border.width)} ${border.style} ${border.color || '#000000'}`;
}

/** Spessore totale (sinistra + destra) di un bordo. */
export function borderHorizontal(border?: BorderStyle | null): number {
  if (!border || border.style === 'none' || !border.width) return 0;
  return border.width * 2;
}

// ---------------------------------------------------------------------------
// Colori
// ---------------------------------------------------------------------------

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Schiarisce un colore verso il bianco (0 = invariato, 1 = bianco). */
export function lightenHex(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const k = Math.max(0, Math.min(1, amount));
  return rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k);
}

/** Scurisce un colore verso il nero (0 = invariato, 1 = nero). */
export function darkenHex(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const k = 1 - Math.max(0, Math.min(1, amount));
  return rgbToHex(r * k, g * k, b * k);
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

const MERGE_TAG_INLINE = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/;

/** true se il valore contiene un merge tag non ancora risolto. */
export function containsMergeTag(value: string): boolean {
  return MERGE_TAG_INLINE.test(String(value ?? ''));
}

/**
 * Normalizza un URL destinato a un `href`. Restituisce `null` quando lo schema
 * non è ammesso (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`).
 */
export function safeUrl(url: string | null | undefined, options: { allowRelative?: boolean } = {}): string | null {
  if (url === null || url === undefined) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  // Un URL ancora "templatizzato" viene risolto più avanti nella pipeline.
  if (containsMergeTag(trimmed)) return trimmed;
  // I caratteri di controllo servono solo a mascherare lo schema (`java\nscript:`).
  const probe = trimmed.replace(/[\s\u0000-\u001F]/g, '').toLowerCase();
  if (/^(?:javascript|vbscript|data|file|blob):/.test(probe)) return null;
  if (/^(?:https?:|mailto:|tel:|sms:)/.test(probe)) return trimmed;
  if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('/')) return trimmed;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (!hasScheme && options.allowRelative !== false) return trimmed;
  return null;
}

/** Come `safeUrl` ma per `img[src]`: ammette anche `data:image/...` e `cid:`. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (containsMergeTag(trimmed)) return trimmed;
  const probe = trimmed.replace(/[\s\u0000-\u001F]/g, '').toLowerCase();
  if (probe.startsWith('data:image/')) return trimmed;
  if (probe.startsWith('cid:')) return trimmed;
  return safeUrl(trimmed);
}

/** Unisce base URL e percorso senza duplicare le barre. */
export function joinUrl(base: string, path: string): string {
  return `${String(base ?? '').replace(/\/+$/, '')}/${String(path ?? '').replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// Commenti condizionali Outlook
// ---------------------------------------------------------------------------

/** Markup visibile solo a Outlook/Word. */
export function msoConditional(html: string): string {
  return `<!--[if mso]>${html}<![endif]-->`;
}

/** Markup visibile a tutti i client TRANNE Outlook/Word. */
export function nonMsoConditional(html: string): string {
  return `<!--[if !mso]><!-->${html}<!--<![endif]-->`;
}

// ---------------------------------------------------------------------------
// Sanificazione HTML
// ---------------------------------------------------------------------------

/** Tag ammessi nel testo ricco prodotto dall'editor. */
const ALLOWED_INLINE_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'a', 'span', 'br',
  'p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4',
]);

const VOID_TAGS = new Set(['br']);

/** Proprietà CSS ammesse negli attributi `style` del testo ricco. */
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'font-size', 'font-weight', 'text-decoration', 'background-color',
]);

const ALLOWED_ATTRS = new Set(['href', 'target', 'rel', 'style']);

const ALLOWED_REL_TOKENS = new Set(['noopener', 'noreferrer', 'nofollow', 'sponsored', 'ugc']);

/** Elementi rimossi insieme al loro contenuto. */
const DANGEROUS_TAGS =
  'script|style|iframe|object|embed|noscript|svg|math|template|form|textarea|select|applet|frame|frameset';

/**
 * Rimuove gli elementi pericolosi, i gestori `on*` e gli URL con schema
 * eseguibile mantenendo il resto del markup. Usato dal blocco "HTML
 * personalizzato", dove l'utente deve poter scrivere tabelle e tag arbitrari.
 */
export function stripUnsafeHtml(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    // Attributi evento: `onclick="..."`, `onerror='...'`, `onload=x`.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /\s(?:href|src|background|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|file|blob)\s*:[^"]*"|'\s*(?:javascript|vbscript|file|blob)\s*:[^']*'|(?:javascript|vbscript|file|blob):[^\s>]*)/gi,
      '',
    )
    .replace(/\sstyle\s*=\s*(?:"[^"]*expression\s*\([^"]*"|'[^']*expression\s*\([^']*')/gi, '');
}

/**
 * Sanifica l'HTML inline dell'editor: conserva solo i tag della whitelist e,
 * per ciascuno, solo gli attributi ammessi. Il markup non ammesso viene tolto
 * ma il testo contenuto resta: eliminare anche il testo farebbe sparire
 * contenuto scritto dall'utente senza che se ne accorga.
 */
export function sanitizeInlineHtml(html: string): string {
  if (!html) return '';
  const source = String(html)
    .replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<![\s\S]*?>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  const open: string[] = [];
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(source)) !== null) {
    out += escapeTextChunk(source.slice(cursor, match.index));
    cursor = tagRe.lastIndex;

    const isClosing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (!ALLOWED_INLINE_TAGS.has(name)) continue;

    if (isClosing) {
      const index = open.lastIndexOf(name);
      if (index === -1) continue; // chiusura orfana: ignorata
      // Chiude anche gli elementi rimasti aperti dentro a questo.
      for (let i = open.length - 1; i >= index; i -= 1) out += `</${open[i]}>`;
      open.splice(index);
      continue;
    }

    const rawAttrs = (match[3] ?? '').replace(/\/\s*$/, '');
    out += `<${name}${filterAttributes(name, rawAttrs)}${VOID_TAGS.has(name) ? ' /' : ''}>`;
    if (!VOID_TAGS.has(name)) open.push(name);
  }

  out += escapeTextChunk(source.slice(cursor));
  // Chiude i tag lasciati aperti: un `<b>` non chiuso colorerebbe il resto dell'email.
  for (let i = open.length - 1; i >= 0; i -= 1) out += `</${open[i]}>`;
  return out;
}

/**
 * Nel testo fra un tag e l'altro si escapano solo `<` e `>`: `&` resta com'è
 * per non rompere le entità già presenti (`&nbsp;`, `&egrave;`, ...).
 */
function escapeTextChunk(chunk: string): string {
  return chunk.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function filterAttributes(tag: string, raw: string): string {
  if (!raw.trim()) return '';
  const kept: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name === 'href') {
      if (tag !== 'a') continue;
      const url = safeUrl(decodeBasicEntities(value));
      if (url) kept.href = url;
      continue;
    }
    if (name === 'target') {
      const target = value.trim().toLowerCase();
      if (target === '_blank' || target === '_self') kept.target = target;
      continue;
    }
    if (name === 'rel') {
      const tokens = value
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => ALLOWED_REL_TOKENS.has(t));
      if (tokens.length) kept.rel = Array.from(new Set(tokens)).join(' ');
      continue;
    }
    if (name === 'style') {
      const style = sanitizeStyleValue(decodeBasicEntities(value));
      if (style) kept.style = style;
    }
  }
  if (tag === 'a' && kept.target === '_blank' && !kept.rel) kept.rel = 'noopener noreferrer';
  return attrs(kept);
}

/** Filtra un attributo `style` lasciando solo le proprietà della whitelist. */
export function sanitizeStyleValue(value: string): string {
  if (!value) return '';
  const parts: string[] = [];
  for (const declaration of value.split(';')) {
    const idx = declaration.indexOf(':');
    if (idx <= 0) continue;
    const prop = declaration.slice(0, idx).trim().toLowerCase();
    const cssValue = declaration.slice(idx + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !cssValue) continue;
    if (/(?:url\s*\(|expression\s*\(|javascript\s*:|@import|<|\\)/i.test(cssValue)) continue;
    parts.push(`${prop}:${cssValue}`);
  }
  return parts.join(';');
}
