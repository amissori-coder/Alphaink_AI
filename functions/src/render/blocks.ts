/**
 * Renderer dei singoli blocchi dell'editor.
 *
 * Ogni renderer riceve `(block, ctx)` e restituisce il contenuto della cella
 * (`<td>`); l'involucro `<tr><td>` con padding, sfondo e bordo è aggiunto da
 * `renderBlock`, così tutti i blocchi condividono lo stesso trattamento.
 *
 * Vincoli di compatibilità applicati ovunque:
 *  - layout a tabelle, mai float o flexbox;
 *  - le immagini hanno sempre `alt`, `border="0"`, `display:block`, `max-width:100%`;
 *  - i pulsanti usano la tecnica "bulletproof" con fallback VML per Outlook;
 *  - nessuna risorsa esterna obbligatoria oltre alle immagini caricate dall'utente.
 */
import { DEFAULT_TYPOGRAPHY, formatCurrency } from '@alphaink/shared';
import type {
  BlockContent,
  BlockType,
  EmailBlock,
  ProductBlockContent,
  SocialNetwork,
  TextAlign,
  TypographyStyle,
} from '@alphaink/shared';

import {
  attrs,
  borderToCss,
  escapeAttr,
  escapeHtml,
  joinUrl,
  msoConditional,
  nonMsoConditional,
  normalizeSpacing,
  px,
  safeImageUrl,
  safeUrl,
  sanitizeInlineHtml,
  spacingHorizontal,
  spacingToCss,
  stripTags,
  stripUnsafeHtml,
  styleAttr,
} from './html-utils';
import type { StyleRecord } from './html-utils';
import { pushWarning } from './types';
import type { RenderContext } from './types';

export type BlockRenderer = (block: EmailBlock, ctx: RenderContext) => string;

// ---------------------------------------------------------------------------
// Helper comuni
// ---------------------------------------------------------------------------

/** Estrae il contenuto tipizzato di un blocco verificandone il discriminante. */
function contentOf<T extends BlockContent['type']>(
  block: EmailBlock,
  type: T,
): Extract<BlockContent, { type: T }> | null {
  const content = block.content as BlockContent | undefined;
  if (!content || content.type !== type) return null;
  return content as Extract<BlockContent, { type: T }>;
}

function typography(style?: TypographyStyle | null): TypographyStyle {
  return { ...DEFAULT_TYPOGRAPHY, ...(style ?? {}) };
}

/** Traduce una `TypographyStyle` in proprietà CSS inline. */
export function typographyCss(style?: TypographyStyle | null): StyleRecord {
  const t = typography(style);
  return {
    'font-family': t.fontFamily,
    'font-size': px(t.fontSize),
    'font-weight': String(t.fontWeight),
    'line-height': `${t.lineHeight}`,
    'letter-spacing': t.letterSpacing ? `${t.letterSpacing}px` : undefined,
    color: t.color,
    'text-align': t.align,
    'text-transform': t.textTransform && t.textTransform !== 'none' ? t.textTransform : undefined,
    margin: '0',
  };
}

/** L'attributo HTML `align` non conosce `justify`: si ripiega su `left`. */
function alignAttr(align?: TextAlign | null): 'left' | 'center' | 'right' {
  if (align === 'center' || align === 'right') return align;
  return 'left';
}

/** Larghezza realmente disponibile dentro la cella del blocco. */
function innerWidth(block: EmailBlock, ctx: RenderContext): number {
  return Math.max(40, ctx.availableWidth - spacingHorizontal(block.style?.padding));
}

function linkColor(ctx: RenderContext): string {
  return ctx.globalStyles.linkColor;
}

/** Apertura/chiusura di un link opzionale attorno a un contenuto. */
function wrapInLink(html: string, href: string | null, extra: StyleRecord = {}): string {
  if (!href) return html;
  const style = styleAttr({ 'text-decoration': 'none', ...extra });
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${style}>${html}</a>`;
}

/**
 * Immagine conforme alle regole email: `alt` sempre presente, `border="0"`,
 * `display:block` (elimina lo spazio sotto l'immagine in Gmail) e
 * `max-width:100%` per il ridimensionamento su mobile.
 */
function imageTag(options: {
  src: string;
  alt: string;
  width?: number | null;
  radius?: number;
  className?: string;
  extraStyle?: StyleRecord;
}): string {
  const width = options.width && options.width > 0 ? Math.round(options.width) : null;
  const style: StyleRecord = {
    display: 'block',
    border: '0',
    outline: 'none',
    'text-decoration': 'none',
    '-ms-interpolation-mode': 'bicubic',
    width: width ? px(width) : '100%',
    'max-width': '100%',
    height: 'auto',
    'border-radius': options.radius ? px(options.radius) : undefined,
    ...(options.extraStyle ?? {}),
  };
  return `<img${attrs({
    src: options.src,
    alt: options.alt,
    width: width ?? undefined,
    border: 0,
    class: options.className,
  })}${styleAttr(style)} />`;
}

/** Data in formato italiano breve (`05/03/2026`). */
export function formatDate(value: string | null | undefined, ctx: RenderContext): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(ctx.locale === 'en' ? 'en-GB' : 'it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: ctx.timezone,
  }).format(date);
}

function money(amount: number, currency: string | undefined, ctx: RenderContext): string {
  return formatCurrency(amount, currency || ctx.currency, ctx.locale);
}

// ---------------------------------------------------------------------------
// Regole di visibilità
// ---------------------------------------------------------------------------

/**
 * Valuta la `visibilityRule` del blocco sui valori del destinatario. Se il
 * campo non è noto (anteprima senza contatto) il blocco resta visibile: meglio
 * mostrare in più che nascondere contenuto in anteprima.
 */
export function isBlockVisible(block: EmailBlock, ctx: RenderContext): boolean {
  const rule = block.visibilityRule;
  if (!rule || !rule.field) return true;
  const has = Object.prototype.hasOwnProperty.call(ctx.fields, rule.field);
  const raw = has ? ctx.fields[rule.field] : undefined;

  if (rule.operator === 'is_empty') return raw === undefined || raw === null || raw === '';
  if (rule.operator === 'is_not_empty') return raw !== undefined && raw !== null && raw !== '';
  if (!has) return true;

  const expected = rule.value ?? null;
  if (rule.operator === 'eq') return String(raw ?? '') === String(expected ?? '');
  if (rule.operator === 'neq') return String(raw ?? '') !== String(expected ?? '');

  const left = Number(raw);
  const right = Number(expected);
  if (Number.isNaN(left) || Number.isNaN(right)) return true;
  return rule.operator === 'gt' ? left > right : left < right;
}

// ---------------------------------------------------------------------------
// Blocchi testuali
// ---------------------------------------------------------------------------

export const renderTextBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'text');
  if (!content) return '';
  const html = sanitizeInlineHtml(content.html ?? '');
  if (!stripTags(html)) return '';
  const style = styleAttr({
    ...typographyCss(content.typography),
    'mso-line-height-rule': 'exactly',
  });
  // La classe `ai-text` è il gancio delle regole dark mode.
  return `<div class="ai-text"${style}>${applyLinkColor(html, ctx)}</div>`;
};

/** Applica il colore link globale agli `<a>` privi di colore proprio. */
function applyLinkColor(html: string, ctx: RenderContext): string {
  return html.replace(/<a\b([^>]*)>/gi, (match, rawAttrs: string) => {
    if (/style\s*=\s*(?:"[^"]*color|'[^']*color)/i.test(rawAttrs)) return match;
    const style = styleAttr({ color: linkColor(ctx), 'text-decoration': 'underline' });
    return `<a${rawAttrs}${style}>`;
  });
}

export const renderHeadingBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'heading');
  if (!content) return '';
  const text = String(content.text ?? '').trim();
  if (!text) return '';
  const level = [1, 2, 3, 4].includes(content.level) ? content.level : 2;
  const t = typography(content.typography);
  const style = styleAttr({
    ...typographyCss({ ...t, color: t.color || ctx.globalStyles.headingColor }),
    'mso-line-height-rule': 'exactly',
    padding: '0',
  });
  return `<h${level} class="ai-heading"${style}>${escapeHtml(text)}</h${level}>`;
};

// ---------------------------------------------------------------------------
// Immagine
// ---------------------------------------------------------------------------

export const renderImageBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'image');
  if (!content) return '';
  const src = safeImageUrl(content.src);
  if (!src) {
    pushWarning(ctx, 'immagine_non_valida', "L'immagine di un blocco ha un indirizzo non valido ed è stata omessa.", 'avviso', { blockId: block.id });
    return '';
  }
  const alt = String(content.alt ?? '').trim();
  if (!alt) {
    pushWarning(ctx, 'immagine_senza_alt', "Un'immagine non ha testo alternativo: non sarà leggibile con le immagini bloccate.", 'avviso', { blockId: block.id });
  }
  const maxWidth = innerWidth(block, ctx);
  const width = content.width && content.width > 0 ? Math.min(content.width, maxWidth) : maxWidth;
  const img = imageTag({
    src,
    alt,
    width,
    radius: content.borderRadius,
    className: 'ai-fluid',
    extraStyle: { margin: block.style?.align === 'center' ? '0 auto' : undefined },
  });
  const href = content.href ? safeUrl(content.href) : null;
  return wrapInLink(img, href, { display: 'block' });
};

// ---------------------------------------------------------------------------
// Pulsante (bulletproof + VML)
// ---------------------------------------------------------------------------

export const renderButtonBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'button');
  if (!content) return '';
  const label = String(content.label ?? '').trim();
  if (!label) return '';
  const href = safeUrl(content.href);
  if (!href) {
    pushWarning(ctx, 'link_non_valido', `Il pulsante "${label}" non ha un indirizzo valido.`, 'errore', { blockId: block.id });
    return '';
  }

  const fontSize = content.fontSize || 16;
  const paddingX = content.paddingX ?? 24;
  const paddingY = content.paddingY ?? 14;
  const radius = content.borderRadius ?? 8;
  const bg = content.backgroundColor || ctx.branding.palette.primary;
  const fg = content.textColor || '#FFFFFF';
  const available = innerWidth(block, ctx);
  const height = Math.round(paddingY * 2 + fontSize * 1.3);
  // Outlook/VML pretende una larghezza esplicita: la si stima dal testo.
  const estimated = Math.round(paddingX * 2 + label.length * fontSize * 0.62);
  const vmlWidth = content.fullWidth ? available : Math.min(Math.max(estimated, 120), available);
  const arcsize = `${Math.min(50, Math.round((radius / Math.max(height, 1)) * 100))}%`;
  const border = content.border && content.border.style !== 'none' ? content.border : null;

  const vml = msoConditional(
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"` +
      ` href="${escapeAttr(href)}" style="height:${height}px;v-text-anchor:middle;width:${vmlWidth}px;"` +
      ` arcsize="${arcsize}" ${border ? `strokecolor="${escapeAttr(border.color)}" strokeweight="${px(border.width)}"` : 'stroke="f"'}` +
      ` fillcolor="${escapeAttr(bg)}">` +
      `<w:anchorlock/>` +
      `<center style="color:${escapeAttr(fg)};font-family:${escapeAttr(ctx.globalStyles.fontFamily)};font-size:${fontSize}px;font-weight:${content.fontWeight || 700};">` +
      `${escapeHtml(label)}</center></v:roundrect>`,
  );

  const anchorStyle = styleAttr({
    display: 'inline-block',
    padding: `${px(paddingY)} ${px(paddingX)}`,
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': px(fontSize),
    'font-weight': String(content.fontWeight || 700),
    'line-height': '1.2',
    color: fg,
    'text-decoration': 'none',
    'border-radius': px(radius),
    'background-color': bg,
    border: border ? borderToCss(border) : undefined,
    'mso-hide': 'all',
    width: content.fullWidth ? 'auto' : undefined,
    'text-align': 'center',
  });

  const table =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0"` +
    ` ${content.fullWidth ? 'width="100%"' : ''} style="border-collapse:separate;line-height:100%;${content.fullWidth ? 'width:100%;' : ''}">` +
    `<tr><td align="center" bgcolor="${escapeAttr(bg)}"` +
    styleAttr({
      'border-radius': px(radius),
      'background-color': bg,
      border: border ? borderToCss(border) : undefined,
      'mso-padding-alt': `${px(paddingY)} ${px(paddingX)}`,
    }) +
    `><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${anchorStyle}>${escapeHtml(label)}</a>` +
    `</td></tr></table>`;

  return `${vml}${nonMsoConditional(table)}`;
};

// ---------------------------------------------------------------------------
// Separatore e spaziatore
// ---------------------------------------------------------------------------

export const renderDividerBlock: BlockRenderer = (block) => {
  const content = contentOf(block, 'divider');
  if (!content) return '';
  const widthPercent = Math.min(100, Math.max(1, content.widthPercent || 100));
  const align = alignAttr(block.style?.align);
  const line = styleAttr({
    'border-top': `${px(content.thickness || 1)} ${content.style || 'solid'} ${content.color || '#E2E8F0'}`,
    'font-size': '0',
    'line-height': '0',
    height: '0',
  });
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${widthPercent}%"` +
    ` align="${align}" style="width:${widthPercent}%;border-collapse:collapse;${align === 'center' ? 'margin:0 auto;' : ''}">` +
    `<tr><td${line}>&nbsp;</td></tr></table>`
  );
};

export const renderSpacerBlock: BlockRenderer = (block) => {
  const content = contentOf(block, 'spacer');
  if (!content) return '';
  const height = Math.max(1, Math.round(content.height || 16));
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
    `<tr><td height="${height}"${styleAttr({ height: px(height), 'font-size': '0', 'line-height': '0' })}>&nbsp;</td></tr></table>`
  );
};

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  x: 'X',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Sito web',
};

/**
 * Icone social.
 *
 * Scelta: le icone SVG inline non sono supportate dai client email e le data-URI
 * vengono bloccate da Gmail e Outlook, quindi non sono un'opzione. Se
 * `branding.socialIconBaseUrl` è configurato si usano immagini remote
 * (`<base>/<stile>/<rete>.png`, servite dal CDN AlphaInk); altrimenti si ripiega
 * su etichette testuali in pillole colorate: rendono ovunque, restano leggibili
 * con le immagini bloccate e sono accessibili agli screen reader.
 */
export const renderSocialBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'social');
  if (!content) return '';
  const items = (content.items ?? []).filter((item) => item && item.url);
  if (!items.length) return '';

  const size = Math.max(16, content.iconSize || 28);
  const gap = Math.max(0, content.spacing ?? 8);
  const base = ctx.branding.socialIconBaseUrl;
  const style = content.iconStyle || 'color';

  const cells = items
    .map((item) => {
      const url = safeUrl(item.url);
      if (!url) return '';
      const label = SOCIAL_LABELS[item.network] ?? item.network;
      const inner = base
        ? imageTag({
            src: joinUrl(base, `${style}/${item.network}.png`),
            alt: label,
            width: size,
            extraStyle: { 'max-width': px(size) },
          })
        : socialTextChip(label, style, ctx);
      return `<td${styleAttr({ padding: `0 ${px(gap / 2)}` })} align="center" valign="middle">${wrapInLink(inner, url)}</td>`;
    })
    .filter(Boolean)
    .join('');

  if (!cells) return '';
  const align = alignAttr(block.style?.align ?? 'center');
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align}"` +
    ` style="border-collapse:collapse;${align === 'center' ? 'margin:0 auto;' : ''}"><tr>${cells}</tr></table>`
  );
};

function socialTextChip(label: string, style: string, ctx: RenderContext): string {
  const palette = ctx.branding.palette;
  const filled = style !== 'light' && style !== 'outline';
  const background = style === 'dark' ? palette.text : palette.primary;
  const chipStyle = styleAttr({
    display: 'inline-block',
    padding: '6px 12px',
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': '12px',
    'font-weight': '600',
    'line-height': '1',
    'border-radius': '999px',
    color: filled ? '#FFFFFF' : palette.text,
    'background-color': filled ? background : 'transparent',
    border: filled ? undefined : `1px solid ${palette.muted}`,
    'white-space': 'nowrap',
  });
  return `<span${chipStyle}>${escapeHtml(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

/**
 * L'email non riproduce video: si mostra la miniatura cliccabile. Il "play"
 * non può essere sovrapposto in modo affidabile (nessun client garantisce il
 * posizionamento assoluto), quindi quando `showPlayIcon` è attivo si aggiunge
 * una riga di invito sotto la miniatura.
 */
export const renderVideoBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'video');
  if (!content) return '';
  const url = safeUrl(content.url);
  const thumb = safeImageUrl(content.thumbnailUrl);
  if (!url || !thumb) {
    pushWarning(ctx, 'video_incompleto', 'Un blocco video non ha URL o miniatura validi ed è stato omesso.', 'avviso', { blockId: block.id });
    return '';
  }
  const alt = String(content.alt ?? '').trim() || 'Guarda il video';
  const img = imageTag({ src: thumb, alt, width: innerWidth(block, ctx), className: 'ai-fluid' });
  const caption = content.showPlayIcon
    ? `<div${styleAttr({
        'font-family': ctx.globalStyles.fontFamily,
        'font-size': '14px',
        'font-weight': '600',
        'line-height': '1.4',
        color: linkColor(ctx),
        'padding-top': '10px',
        'text-align': 'center',
      })}>${wrapInLink(`&#9654;&nbsp;${escapeHtml(alt)}`, url, { color: linkColor(ctx) })}</div>`
    : '';
  return `${wrapInLink(img, url, { display: 'block' })}${caption}`;
};

// ---------------------------------------------------------------------------
// HTML personalizzato
// ---------------------------------------------------------------------------

export const renderHtmlBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'html');
  if (!content) return '';
  const raw = String(content.html ?? '');
  if (!raw.trim()) return '';
  const safe = stripUnsafeHtml(raw);
  if (safe.length !== raw.length) {
    pushWarning(ctx, 'html_ripulito', 'Da un blocco HTML personalizzato sono stati rimossi script o attributi non sicuri.', 'info', { blockId: block.id });
  }
  return safe;
};

// ---------------------------------------------------------------------------
// Prodotti
// ---------------------------------------------------------------------------

function discountPercent(product: ProductBlockContent): number | null {
  if (!product.compareAtPrice || product.compareAtPrice <= product.price) return null;
  return Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100);
}

function productImage(product: ProductBlockContent, width: number): string {
  const src = safeImageUrl(product.imageUrl);
  if (!src) return '';
  const img = imageTag({ src, alt: product.name || product.sku || 'Prodotto', width, radius: 8, className: 'ai-fluid' });
  return wrapInLink(img, safeUrl(product.url), { display: 'block' }) || img;
}

function productPrice(product: ProductBlockContent, ctx: RenderContext): string {
  if (!product.showPrice) return '';
  const price = money(product.price ?? 0, product.currency, ctx);
  const compare =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? `<span${styleAttr({
          color: ctx.branding.palette.muted,
          'text-decoration': 'line-through',
          'font-size': '13px',
          'padding-left': '8px',
        })}>&nbsp;${escapeHtml(money(product.compareAtPrice, product.currency, ctx))}</span>`
      : '';
  return `<div${styleAttr({
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': '18px',
    'font-weight': '700',
    color: ctx.globalStyles.textColor,
    'padding-top': '6px',
  })}>${escapeHtml(price)}${compare}</div>`;
}

function productBadge(product: ProductBlockContent, ctx: RenderContext): string {
  if (!product.showDiscountBadge) return '';
  const percent = discountPercent(product);
  if (percent === null) return '';
  return `<div${styleAttr({ 'padding-bottom': '6px' })}><span${styleAttr({
    display: 'inline-block',
    padding: '3px 8px',
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': '12px',
    'font-weight': '700',
    'line-height': '1',
    color: '#FFFFFF',
    'background-color': ctx.branding.palette.secondary,
    'border-radius': '4px',
  })}>-${percent}%</span></div>`;
}

function productCta(product: ProductBlockContent, ctx: RenderContext): string {
  const url = safeUrl(product.url);
  const label = String(product.ctaLabel ?? '').trim();
  if (!url || !label) return '';
  return `<div${styleAttr({ 'padding-top': '10px' })}><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"${styleAttr(
    {
      display: 'inline-block',
      padding: '9px 18px',
      'font-family': ctx.globalStyles.fontFamily,
      'font-size': '14px',
      'font-weight': '600',
      'line-height': '1.2',
      color: '#FFFFFF',
      'background-color': ctx.branding.palette.primary,
      'border-radius': '6px',
      'text-decoration': 'none',
    },
  )}>${escapeHtml(label)}</a></div>`;
}

function productName(product: ProductBlockContent, ctx: RenderContext): string {
  const name = String(product.name ?? '').trim();
  if (!name) return '';
  const inner = `<span${styleAttr({
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': '16px',
    'font-weight': '600',
    'line-height': '1.4',
    color: ctx.globalStyles.headingColor,
  })}>${escapeHtml(name)}</span>`;
  return `<div class="ai-text">${wrapInLink(inner, safeUrl(product.url)) || inner}</div>`;
}

/** Scheda prodotto completa, usata dal blocco singolo e dalla griglia. */
function productCard(product: ProductBlockContent, width: number, ctx: RenderContext, layout: 'horizontal' | 'vertical'): string {
  const details = `${productBadge(product, ctx)}${productName(product, ctx)}${productPrice(product, ctx)}${productCta(product, ctx)}`;
  if (layout === 'horizontal') {
    const imageWidth = Math.round(width * 0.38);
    const textWidth = width - imageWidth - 16;
    return (
      `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
      `<tr>` +
      `<td class="ai-stack" width="${imageWidth}" valign="top"${styleAttr({ width: px(imageWidth), 'padding-right': '16px' })}>` +
      `${productImage(product, imageWidth)}</td>` +
      `<td class="ai-stack" width="${textWidth}" valign="top"${styleAttr({ width: px(textWidth) })}>${details}</td>` +
      `</tr></table>`
    );
  }
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
    `<tr><td valign="top">${productImage(product, width)}</td></tr>` +
    `<tr><td valign="top"${styleAttr({ 'padding-top': '10px' })}>${details}</td></tr>` +
    `</table>`
  );
}

export const renderProductBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'product');
  if (!content) return '';
  if (!content.name && !content.sku) return '';
  return productCard(content, innerWidth(block, ctx), ctx, content.layout === 'vertical' ? 'vertical' : 'horizontal');
};

export const renderProductGridBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'product_grid');
  if (!content) return '';
  const products = (content.products ?? []).filter((p) => p && (p.name || p.sku));
  if (!products.length) {
    if (content.dynamicSource) {
      // I prodotti dinamici sono risolti dal modulo di invio prima del render.
      pushWarning(ctx, 'griglia_prodotti_vuota', 'Una griglia prodotti dinamica non contiene prodotti risolti: sarà omessa.', 'avviso', { blockId: block.id });
    }
    return '';
  }

  const columns = content.columns === 3 ? 3 : 2;
  const gap = 16;
  const total = innerWidth(block, ctx);
  const cellWidth = Math.floor((total - gap * (columns - 1)) / columns);

  const rows: string[] = [];
  for (let i = 0; i < products.length; i += columns) {
    const slice = products.slice(i, i + columns);
    const cells = slice
      .map((product, index) => {
        const padding = index < slice.length - 1 ? `0 ${px(gap)} 0 0` : '0';
        return (
          `<td class="ai-stack" width="${cellWidth}" valign="top"${styleAttr({ width: px(cellWidth), padding })}>` +
          `${productCard(product, cellWidth, ctx, 'vertical')}</td>`
        );
      })
      .join('');
    // Celle vuote per pareggiare l'ultima riga: senza, Outlook allarga l'ultima colonna.
    const filler =
      slice.length < columns
        ? new Array(columns - slice.length)
            .fill(`<td class="ai-stack" width="${cellWidth}"${styleAttr({ width: px(cellWidth) })}>&nbsp;</td>`)
            .join('')
        : '';
    rows.push(`<tr>${cells}${filler}</tr>`);
    if (i + columns < products.length) {
      rows.push(`<tr><td colspan="${columns}" height="${gap}"${styleAttr({ height: px(gap), 'font-size': '0', 'line-height': '0' })}>&nbsp;</td></tr>`);
    }
  }

  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
    `${rows.join('')}</table>`
  );
};

// ---------------------------------------------------------------------------
// Coupon
// ---------------------------------------------------------------------------

export const renderCouponBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'coupon');
  if (!content) return '';
  // Codice generato per destinatario: resta un merge tag risolto in fase di invio.
  const code = content.dynamic ? '{{coupon.code}}' : String(content.code ?? '').trim();
  if (!code) {
    pushWarning(ctx, 'coupon_senza_codice', 'Un blocco coupon non ha codice ed è stato omesso.', 'avviso', { blockId: block.id });
    return '';
  }

  const bg = content.backgroundColor || '#F8FAFC';
  const fg = content.textColor || ctx.globalStyles.textColor;
  const borderStyle = content.borderStyle === 'solid' ? 'solid' : 'dashed';
  const expires = formatDate(content.expiresAt, ctx);

  const parts: string[] = [];
  if (content.discountLabel) {
    parts.push(
      `<div${styleAttr({
        'font-family': ctx.globalStyles.fontFamily,
        'font-size': '22px',
        'font-weight': '800',
        'line-height': '1.2',
        color: fg,
      })}>${escapeHtml(content.discountLabel)}</div>`,
    );
  }
  if (content.description) {
    parts.push(
      `<div${styleAttr({
        'font-family': ctx.globalStyles.fontFamily,
        'font-size': '14px',
        'line-height': '1.5',
        color: fg,
        'padding-top': '4px',
      })}>${escapeHtml(content.description)}</div>`,
    );
  }
  parts.push(
    `<div${styleAttr({ 'padding-top': '12px' })}><span${styleAttr({
      display: 'inline-block',
      padding: '10px 18px',
      'font-family': 'Consolas, Menlo, Monaco, "Courier New", monospace',
      'font-size': '18px',
      'font-weight': '700',
      'letter-spacing': '2px',
      color: fg,
      'background-color': '#FFFFFF',
      border: `1px ${borderStyle} ${ctx.branding.palette.muted}`,
      'border-radius': '6px',
    })}>${escapeHtml(code)}</span></div>`,
  );
  if (expires) {
    parts.push(
      `<div${styleAttr({
        'font-family': ctx.globalStyles.fontFamily,
        'font-size': '12px',
        'line-height': '1.4',
        color: ctx.branding.palette.muted,
        'padding-top': '8px',
      })}>Valido fino al ${escapeHtml(expires)}</div>`,
    );
  }
  const ctaHref = content.ctaHref ? safeUrl(content.ctaHref) : null;
  if (ctaHref && content.ctaLabel) {
    parts.push(
      `<div${styleAttr({ 'padding-top': '14px' })}><a href="${escapeAttr(ctaHref)}" target="_blank" rel="noopener noreferrer"${styleAttr(
        {
          display: 'inline-block',
          padding: '11px 22px',
          'font-family': ctx.globalStyles.fontFamily,
          'font-size': '15px',
          'font-weight': '700',
          color: '#FFFFFF',
          'background-color': ctx.branding.palette.primary,
          'border-radius': '6px',
          'text-decoration': 'none',
        },
      )}>${escapeHtml(content.ctaLabel)}</a></div>`,
    );
  }

  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
    `<tr><td align="center"${styleAttr({
      padding: '24px 20px',
      'background-color': bg,
      border: `2px ${borderStyle} ${ctx.branding.palette.primary}`,
      'border-radius': '10px',
      'text-align': 'center',
    })}>${parts.join('')}</td></tr></table>`
  );
};

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

/**
 * L'email è statica: il conto alla rovescia è calcolato **al momento del
 * render** e fotografato nell'HTML. Per gli invii schedulati il render avviene
 * poco prima della spedizione, quindi il valore resta coerente.
 */
export const renderCountdownBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'countdown');
  if (!content) return '';
  const end = new Date(content.endsAt);
  if (Number.isNaN(end.getTime())) {
    pushWarning(ctx, 'countdown_non_valido', 'Un blocco countdown ha una data di scadenza non valida.', 'avviso', { blockId: block.id });
    return '';
  }

  const accent = content.accentColor || ctx.branding.palette.secondary;
  const labelStyle = styleAttr({
    'font-family': ctx.globalStyles.fontFamily,
    'font-size': '14px',
    'font-weight': '600',
    'line-height': '1.4',
    color: ctx.globalStyles.textColor,
    'padding-bottom': '10px',
  });
  const label = content.label ? `<div class="ai-text"${labelStyle}>${escapeHtml(content.label)}</div>` : '';

  const diffMs = end.getTime() - ctx.now.getTime();
  if (diffMs <= 0) {
    pushWarning(ctx, 'countdown_scaduto', 'Un blocco countdown è già scaduto al momento del render.', 'avviso', { blockId: block.id });
    return (
      `${label}<div${styleAttr({
        'font-family': ctx.globalStyles.fontFamily,
        'font-size': '18px',
        'font-weight': '700',
        color: accent,
      })}>Offerta scaduta</div>`
    );
  }

  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  const boxes: string[] = [];
  if (content.showDays !== false) boxes.push(countdownBox(days, days === 1 ? 'giorno' : 'giorni', accent, ctx));
  if (content.showHours) boxes.push(countdownBox(hours, hours === 1 ? 'ora' : 'ore', accent, ctx));
  if (!boxes.length) boxes.push(countdownBox(days, days === 1 ? 'giorno' : 'giorni', accent, ctx));

  return (
    `${label}<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto;">` +
    `<tr>${boxes.join('')}</tr></table>`
  );
};

function countdownBox(value: number, unit: string, accent: string, ctx: RenderContext): string {
  return (
    `<td align="center" valign="middle"${styleAttr({ padding: '0 6px' })}>` +
    `<div${styleAttr({
      'min-width': '64px',
      padding: '12px 14px',
      'background-color': accent,
      'border-radius': '8px',
      'text-align': 'center',
    })}>` +
    `<div${styleAttr({
      'font-family': ctx.globalStyles.fontFamily,
      'font-size': '28px',
      'font-weight': '800',
      'line-height': '1',
      color: '#FFFFFF',
    })}>${value}</div>` +
    `<div${styleAttr({
      'font-family': ctx.globalStyles.fontFamily,
      'font-size': '11px',
      'font-weight': '600',
      'line-height': '1',
      'text-transform': 'uppercase',
      'letter-spacing': '1px',
      color: '#FFFFFF',
      'padding-top': '6px',
    })}>${escapeHtml(unit)}</div>` +
    `</div></td>`
  );
}

// ---------------------------------------------------------------------------
// Menu, footer, disiscrizione
// ---------------------------------------------------------------------------

export const renderMenuBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'menu');
  if (!content) return '';
  const items = (content.items ?? []).filter((item) => item && item.label);
  if (!items.length) return '';
  const t = typography(content.typography);
  const separator = content.separator ?? '·';

  const links = items
    .map((item) => {
      const href = safeUrl(item.href);
      const label = escapeHtml(item.label);
      if (!href) return `<span${styleAttr({ color: t.color })}>${label}</span>`;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${styleAttr({
        color: t.color || linkColor(ctx),
        'text-decoration': 'none',
        'white-space': 'nowrap',
      })}>${label}</a>`;
    })
    .join(
      `<span${styleAttr({ padding: '0 8px', color: ctx.branding.palette.muted })}>${escapeHtml(separator)}</span>`,
    );

  return `<div class="ai-text"${styleAttr(typographyCss(t))}>${links}</div>`;
};

export const renderFooterBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'footer');
  if (!content) return '';
  const t = typography(content.typography);
  const lines: string[] = [];
  const company = content.companyName || ctx.branding.companyName;
  if (company) lines.push(`<strong>${escapeHtml(company)}</strong>`);
  const address = content.address || ctx.branding.address;
  if (address) lines.push(escapeHtml(address));
  if (content.vatLine) lines.push(escapeHtml(content.vatLine));
  const body = lines.join('<br />');
  const extra = content.extraHtml ? `<div${styleAttr({ 'padding-top': '8px' })}>${sanitizeInlineHtml(content.extraHtml)}</div>` : '';
  return `<div class="ai-text ai-muted"${styleAttr(typographyCss(t))}>${body}${extra}</div>`;
};

/**
 * Blocco di disiscrizione: obbligatorio per legge e per la reputazione di invio.
 * Gli URL restano merge tag finché il modulo di invio non li firma per il
 * singolo destinatario.
 */
export const renderUnsubscribeBlock: BlockRenderer = (block, ctx) => {
  const content = contentOf(block, 'unsubscribe');
  if (!content) return '';
  const t = typography(content.typography);
  const text = content.text || ctx.branding.unsubscribeText || '';
  const linkLabel = content.linkLabel || 'Disiscriviti';
  const linkStyle = styleAttr({ color: t.color || ctx.branding.palette.muted, 'text-decoration': 'underline' });

  const links = [
    `<a href="${escapeAttr(ctx.urls.unsubscribeUrl)}" target="_blank" rel="noopener noreferrer"${linkStyle}>${escapeHtml(linkLabel)}</a>`,
  ];
  if (content.showPreferencesLink) {
    links.push(
      `<a href="${escapeAttr(ctx.urls.preferencesUrl)}" target="_blank" rel="noopener noreferrer"${linkStyle}>${escapeHtml(
        content.preferencesLabel || 'Gestisci le preferenze',
      )}</a>`,
    );
  }

  const separator = `<span${styleAttr({ padding: '0 6px', color: ctx.branding.palette.muted })}>|</span>`;
  return (
    `<div class="ai-text ai-muted"${styleAttr(typographyCss(t))}>` +
    `${text ? `${escapeHtml(text)}<br />` : ''}${links.join(separator)}</div>`
  );
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export const BLOCK_RENDERERS: Record<BlockType, BlockRenderer> = {
  text: renderTextBlock,
  heading: renderHeadingBlock,
  image: renderImageBlock,
  button: renderButtonBlock,
  divider: renderDividerBlock,
  spacer: renderSpacerBlock,
  social: renderSocialBlock,
  video: renderVideoBlock,
  html: renderHtmlBlock,
  product: renderProductBlock,
  product_grid: renderProductGridBlock,
  coupon: renderCouponBlock,
  countdown: renderCountdownBlock,
  menu: renderMenuBlock,
  footer: renderFooterBlock,
  unsubscribe: renderUnsubscribeBlock,
};

/** Contenuto della cella di un blocco, senza involucro. */
export function renderBlockContent(block: EmailBlock, ctx: RenderContext): string {
  // Il tipo autorevole è quello del contenuto: `block.type` potrebbe essere
  // rimasto indietro dopo una conversione nell'editor.
  const type = (block.content?.type ?? block.type) as BlockType;
  const renderer = BLOCK_RENDERERS[type];
  if (!renderer) {
    pushWarning(ctx, 'blocco_sconosciuto', `Tipo di blocco non riconosciuto: "${String(type)}".`, 'avviso', { blockId: block.id });
    return '';
  }
  return renderer(block, ctx);
}

/** Riga `<tr><td>` completa di padding, sfondo, bordo e classi responsive. */
export function renderBlock(block: EmailBlock, ctx: RenderContext): string {
  if (!block) return '';
  if (!isBlockVisible(block, ctx)) return '';

  const padding = normalizeSpacing(block.style?.padding);
  const inner = renderBlockContent(block, ctx);
  if (!inner) return '';

  const classes = ['ai-cell'];
  if (block.style?.hideOnMobile) classes.push('mobile-hide');
  if (block.style?.hideOnDesktop) classes.push('desktop-hide');

  const border = block.style?.border && block.style.border.style !== 'none' ? block.style.border : null;
  const cellStyle: StyleRecord = {
    padding: spacingToCss(padding),
    'background-color': block.style?.backgroundColor ?? undefined,
    'text-align': block.style?.align ?? undefined,
    border: border ? borderToCss(border) : undefined,
    'border-radius': border && border.radius ? px(border.radius) : undefined,
    'word-break': 'break-word',
    // Nascosto su desktop: reso visibile dalla media query mobile.
    ...(block.style?.hideOnDesktop
      ? { display: 'none', 'mso-hide': 'all', 'max-height': '0', overflow: 'hidden' }
      : {}),
  };

  return (
    `<tr><td class="${classes.join(' ')}" align="${alignAttr(block.style?.align)}" valign="top"${styleAttr(cellStyle)}>` +
    `${inner}</td></tr>`
  );
}

/** Righe di tutti i blocchi di una colonna. */
export function renderBlocks(blocks: EmailBlock[] | undefined, ctx: RenderContext): string {
  if (!blocks?.length) return '';
  return blocks.map((block) => renderBlock(block, ctx)).join('');
}
