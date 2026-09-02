/**
 * Assemblaggio del documento email completo.
 *
 * Struttura prodotta (dall'esterno verso l'interno):
 *
 *   body
 *   └─ preheader nascosto
 *   └─ per ogni sezione: tabella 100% (sfondo a tutta larghezza)
 *      └─ td centrata (+ ghost table per Outlook)
 *         └─ div contenitore `max-width: contentWidth`
 *            └─ tabella superficie (sfondo, bordo, raggio, padding sezione)
 *               └─ riga di colonne (div inline-block "fluid hybrid")
 *                  └─ tabella dei blocchi
 *
 * Le colonne usano la tecnica "fluid hybrid": `div` inline-block con
 * `width:100%; max-width:<px>` dentro una ghost table condizionale per Outlook.
 * Così le colonne si impilano da sole quando lo schermo è più stretto della
 * somma delle larghezze massime, e la media query serve solo per i casi
 * particolari (colonne che non devono impilarsi, ordine invertito).
 */
import type { EmailColumn, EmailDocument, EmailGlobalStyles, EmailSection } from '@alphaink/shared';

import { renderBlocks } from './blocks';
import {
  borderHorizontal,
  borderToCss,
  escapeAttr,
  escapeHtml,
  lightenHex,
  normalizeSpacing,
  px,
  safeImageUrl,
  spacingHorizontal,
  spacingToCss,
  styleAttr,
} from './html-utils';
import { createRenderContext, pushWarning, withWidth } from './types';
import type { RenderBranding, RenderContext, RenderContextInput, RenderWarning } from './types';

export interface RenderDocumentResult {
  html: string;
  warnings: RenderWarning[];
}

// ---------------------------------------------------------------------------
// Colonne
// ---------------------------------------------------------------------------

/** Tabella dei blocchi di una colonna, con sfondo e padding della colonna. */
function renderColumnTable(column: EmailColumn, width: number, ctx: RenderContext): string {
  const padding = normalizeSpacing(column.padding);
  const contentWidth = Math.max(40, width - spacingHorizontal(padding));
  const blocks = renderBlocks(column.blocks, withWidth(ctx, contentWidth));
  if (!blocks) return '';
  const valign = column.verticalAlign === 'middle' || column.verticalAlign === 'bottom' ? column.verticalAlign : 'top';
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"` +
    styleAttr({ 'border-collapse': 'collapse', 'background-color': column.backgroundColor ?? undefined }) +
    `><tr><td valign="${valign}"${styleAttr({ padding: spacingToCss(padding) })}>` +
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">` +
    `${blocks}</table></td></tr></table>`
  );
}

/** Riga di colonne di una sezione. */
export function renderColumns(section: EmailSection, innerWidth: number, ctx: RenderContext): string {
  const columns = (section.columns ?? []).filter(Boolean);
  if (!columns.length) return '';

  // Colonna singola: nessun involucro inline-block, meno markup e meno rischi.
  if (columns.length === 1) {
    return renderColumnTable(columns[0], innerWidth, ctx);
  }

  const totalSpan = columns.reduce((sum, column) => sum + (column.span > 0 ? column.span : 1), 0) || 12;
  const stack = section.stackOnMobile !== false;
  const reverse = Boolean(section.reverseOnMobile) && stack;
  if (section.reverseOnMobile && columns.length !== 2) {
    pushWarning(
      ctx,
      'inversione_non_supportata',
      "L'inversione delle colonne su mobile è applicabile solo alle sezioni con due colonne: è stata ignorata.",
      'info',
      { sectionId: section.id },
    );
  }

  const widths = columns.map((column) => Math.floor((innerWidth * (column.span > 0 ? column.span : 1)) / totalSpan));
  const rendered: string[] = [];

  columns.forEach((column, index) => {
    const width = Math.max(40, widths[index]);
    const table = renderColumnTable(column, width, ctx);
    if (!table) return;

    const classes = [stack ? 'ai-col' : 'ai-col-fixed'];
    if (reverse && columns.length === 2) classes.push(index === 0 ? 'ai-col-first' : 'ai-col-last');

    const columnStyle = styleAttr({
      display: 'inline-block',
      'vertical-align': column.verticalAlign === 'middle' || column.verticalAlign === 'bottom' ? column.verticalAlign : 'top',
      // Con `width:100%` + `max-width` le colonne si impilano da sole sotto la
      // larghezza minima, senza dipendere dalle media query.
      width: stack ? '100%' : `${Math.round((width / innerWidth) * 100)}%`,
      'max-width': px(width),
      'font-size': px(ctx.globalStyles.baseFontSize),
      'line-height': `${ctx.globalStyles.baseLineHeight}`,
      'text-align': 'left',
    });

    rendered.push(
      `<!--[if mso]><td width="${width}" valign="top" style="padding:0;"><![endif]-->` +
        `<div class="${classes.join(' ')}"${columnStyle}>${table}</div>` +
        `<!--[if mso]></td><![endif]-->`,
    );
  });

  if (!rendered.length) return '';

  const rowClasses = ['ai-row'];
  if (reverse && columns.length === 2) rowClasses.push('ai-row-reverse');

  return (
    `<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${innerWidth}"><tr><![endif]-->` +
    // `font-size:0` elimina lo spazio bianco fra i div inline-block.
    `<div class="${rowClasses.join(' ')}"${styleAttr({ 'font-size': '0', 'line-height': '0', 'text-align': 'left' })}>` +
    `${rendered.join('')}</div>` +
    `<!--[if mso]></tr></table><![endif]-->`
  );
}

// ---------------------------------------------------------------------------
// Sezioni
// ---------------------------------------------------------------------------

export function renderSection(section: EmailSection, ctx: RenderContext): string {
  const gs = ctx.globalStyles;
  const padding = normalizeSpacing(section.padding);
  const border = section.border && section.border.style !== 'none' ? section.border : null;
  const innerWidth = Math.max(
    120,
    gs.contentWidth - spacingHorizontal(padding) - borderHorizontal(border),
  );

  const columns = renderColumns(section, innerWidth, ctx);
  if (!columns) return '';

  const hasFullBackground = Boolean(section.fullWidthBackgroundColor);
  const hasSurfaceBackground = Boolean(section.backgroundColor);
  const outerClasses = ['ai-section'];
  if (!hasFullBackground) outerClasses.push('ai-section-default');
  const surfaceClasses = ['ai-surface'];
  if (!hasSurfaceBackground) surfaceClasses.push('ai-surface-default');

  const backgroundImage = section.backgroundImage?.src ? safeImageUrl(section.backgroundImage.src) : null;
  if (backgroundImage) {
    pushWarning(
      ctx,
      'sfondo_immagine_outlook',
      "Le immagini di sfondo delle sezioni non sono supportate da Outlook per Windows: verrà mostrato solo il colore di sfondo.",
      'info',
      { sectionId: section.id },
    );
  }

  const surfaceStyle = styleAttr({
    'border-collapse': 'separate',
    'background-color': section.backgroundColor ?? gs.contentBackgroundColor,
    'background-image': backgroundImage ? `url('${backgroundImage}')` : undefined,
    'background-size': backgroundImage ? section.backgroundImage?.size ?? 'cover' : undefined,
    'background-repeat': backgroundImage ? (section.backgroundImage?.repeat ? 'repeat' : 'no-repeat') : undefined,
    'background-position': backgroundImage ? 'center center' : undefined,
    border: border ? borderToCss(border) : undefined,
    'border-radius': border && border.radius ? px(border.radius) : undefined,
  });

  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="${outerClasses.join(' ')}"` +
    styleAttr({
      'border-collapse': 'collapse',
      'background-color': section.fullWidthBackgroundColor ?? gs.backgroundColor,
    }) +
    `><tr><td align="center" class="ai-pad"${styleAttr({ padding: '0' })}>` +
    `<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${gs.contentWidth}" align="center"><tr><td><![endif]-->` +
    `<div class="ai-container"${styleAttr({ width: '100%', 'max-width': px(gs.contentWidth), margin: '0 auto' })}>` +
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="${surfaceClasses.join(' ')}"${surfaceStyle}>` +
    `<tr><td${attrsBackground(backgroundImage)}${styleAttr({ padding: spacingToCss(padding) })} valign="top">` +
    `${columns}</td></tr></table></div>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>`
  );
}

function attrsBackground(url: string | null): string {
  return url ? ` background="${escapeAttr(url)}"` : '';
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

/** Link ai web font Google, nascosti a Outlook che non li usa comunque. */
function fontLinks(gs: EmailGlobalStyles): string {
  const fonts = (gs.webFonts ?? []).filter((f) => typeof f === 'string' && f.trim());
  if (!fonts.length) return '';
  const links = fonts
    .map((font) => {
      const family = font.trim().replace(/\s+/g, '+');
      return `<link href="https://fonts.googleapis.com/css2?family=${escapeAttr(family)}&display=swap" rel="stylesheet" type="text/css" />`;
    })
    .join('');
  return `<!--[if !mso]><!--><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />${links}<!--<![endif]-->`;
}

/**
 * Regole dark mode. Sono applicate solo alle sezioni che usano i colori di
 * default: una sezione con sfondo scelto dall'utente conserva i propri colori,
 * altrimenti il testo bianco su fondo brandizzato diventerebbe illeggibile.
 */
function darkModeRules(gs: EmailGlobalStyles, branding: RenderBranding): string {
  const darkBg = gs.darkBackgroundColor || '#0B1220';
  const darkSurface = gs.darkContentBackgroundColor || '#111C2E';
  const darkText = gs.darkTextColor || '#E2E8F0';
  const darkLink = lightenHex(gs.linkColor, 0.4);
  const darkMuted = lightenHex(branding.palette.muted, 0.1);
  return [
    `body,.ai-body{background-color:${darkBg}!important;}`,
    `.ai-section-default{background-color:${darkBg}!important;}`,
    `.ai-surface-default{background-color:${darkSurface}!important;}`,
    `.ai-surface-default .ai-cell,.ai-surface-default .ai-text,.ai-surface-default .ai-text p,.ai-surface-default .ai-text span,.ai-surface-default .ai-text li,.ai-surface-default .ai-heading{color:${darkText}!important;}`,
    `.ai-surface-default .ai-text a{color:${darkLink}!important;}`,
    `.ai-surface-default .ai-muted,.ai-surface-default .ai-muted a,.ai-surface-default .ai-muted span{color:${darkMuted}!important;}`,
  ].join('');
}

function buildStyleSheet(gs: EmailGlobalStyles, branding: RenderBranding): string {
  const reset = [
    `html,body{margin:0!important;padding:0!important;width:100%!important;}`,
    `body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;background-color:${gs.backgroundColor};}`,
    `table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}`,
    `img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}`,
    `a{color:${gs.linkColor};}`,
    `p{margin:0;}`,
    `#outlook a{padding:0;}`,
    `.ExternalClass{width:100%;}`,
    `.ExternalClass,.ExternalClass p,.ExternalClass span,.ExternalClass font,.ExternalClass td,.ExternalClass div{line-height:100%;}`,
    // iOS trasforma date e numeri in link: qui si neutralizza lo stile imposto.
    `a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important;}`,
    `u + #body a{color:inherit;text-decoration:none;font-size:inherit;font-family:inherit;font-weight:inherit;line-height:inherit;}`,
    `.desktop-hide{display:none;mso-hide:all;max-height:0;overflow:hidden;}`,
  ].join('');

  const mobile = [
    `@media only screen and (max-width:600px){`,
    `.ai-container{width:100%!important;max-width:100%!important;}`,
    `.ai-col{display:block!important;width:100%!important;max-width:100%!important;}`,
    `.ai-stack{display:block!important;width:100%!important;max-width:100%!important;padding-right:0!important;padding-left:0!important;box-sizing:border-box!important;}`,
    `.ai-fluid{width:100%!important;max-width:100%!important;height:auto!important;}`,
    `.ai-pad{padding-left:12px!important;padding-right:12px!important;}`,
    `.mobile-hide{display:none!important;max-height:0!important;overflow:hidden!important;mso-hide:all!important;font-size:0!important;line-height:0!important;}`,
    `.desktop-hide{display:block!important;width:auto!important;max-height:none!important;overflow:visible!important;}`,
    // Inversione dell'ordine su mobile (solo sezioni a due colonne).
    `.ai-row-reverse{display:table!important;width:100%!important;}`,
    `.ai-row-reverse>.ai-col-first{display:table-footer-group!important;width:100%!important;}`,
    `.ai-row-reverse>.ai-col-last{display:table-header-group!important;width:100%!important;}`,
    `}`,
  ].join('');

  if (!gs.darkModeSupport) return `${reset}${mobile}`;

  const dark = darkModeRules(gs, branding);
  // `[data-ogsc]` / `[data-ogsb]` sono gli attributi iniettati da Outlook.com
  // quando converte l'email in tema scuro: le stesse regole vanno replicate lì.
  const ogsc = dark
    .split('}')
    .filter(Boolean)
    .map((rule) => {
      const [selectors, body] = rule.split('{');
      const prefixed = selectors
        .split(',')
        .map((s) => `[data-ogsc] ${s.trim()}`)
        .join(',');
      return `${prefixed}{${body}}`;
    })
    .join('');

  return `${reset}${mobile}@media (prefers-color-scheme: dark){${dark}}${ogsc}`;
}

/**
 * Preheader: testo di anteprima mostrato dalla inbox subito dopo l'oggetto.
 * I caratteri invisibili in coda impediscono al client di riempire l'anteprima
 * con l'inizio del corpo dell'email.
 */
function preheaderMarkup(preheader: string): string {
  if (!preheader.trim()) return '';
  const filler = '&#847;&zwnj;&nbsp;'.repeat(60);
  return (
    `<div class="ai-preheader"${styleAttr({
      display: 'none',
      'font-size': '1px',
      'line-height': '1px',
      'max-height': '0',
      'max-width': '0',
      opacity: '0',
      overflow: 'hidden',
      'mso-hide': 'all',
      color: 'transparent',
      height: '0',
    })}>${escapeHtml(preheader)}${filler}</div>`
  );
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

/**
 * Trasforma un `EmailDocument` in HTML email completo.
 * Non risolve i merge tag e non riscrive i link: se ne occupa `buildEmail`.
 */
export function renderEmailDocument(
  document: EmailDocument,
  input: RenderContextInput = {},
): RenderDocumentResult {
  // Gli stili del documento fanno da base; il chiamante può sovrascriverli
  // (anteprima con larghezza ridotta, forzatura del tema chiaro, ...).
  const ctx: RenderContext = createRenderContext({
    ...input,
    globalStyles: { ...(document?.globalStyles ?? {}), ...(input.globalStyles ?? {}) },
  });

  const gs = ctx.globalStyles;
  const sections = (document?.sections ?? []).filter(Boolean);
  if (!sections.length) {
    pushWarning(ctx, 'documento_vuoto', 'Il documento non contiene sezioni: il messaggio risulterebbe vuoto.', 'errore');
  }

  const body = sections.map((section) => renderSection(section, withWidth(ctx, gs.contentWidth))).join('');

  const html =
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html xmlns="https://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${ctx.locale}" dir="ltr">` +
    `<head>` +
    `<meta charset="utf-8" />` +
    `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge" />` +
    `<meta name="x-apple-disable-message-reformatting" />` +
    `<meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />` +
    `<meta name="color-scheme" content="${gs.darkModeSupport ? 'light dark' : 'light only'}" />` +
    `<meta name="supported-color-schemes" content="${gs.darkModeSupport ? 'light dark' : 'light only'}" />` +
    `<title>${escapeHtml(ctx.subject || ctx.branding.companyName)}</title>` +
    // Outlook rende a 120 DPI: senza questa impostazione le larghezze si dilatano.
    `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->` +
    fontLinks(gs) +
    // `data-embed` dice a juice di non toccare questo foglio di stile:
    // media query e regole dark mode devono restare nell'head, non inline.
    `<style type="text/css" data-embed>${buildStyleSheet(gs, ctx.branding)}</style>` +
    `</head>` +
    `<body id="body" class="ai-body"${styleAttr({
      margin: '0',
      padding: '0',
      width: '100%',
      'background-color': gs.backgroundColor,
      'font-family': gs.fontFamily,
      'font-size': px(gs.baseFontSize),
      'line-height': `${gs.baseLineHeight}`,
      color: gs.textColor,
      '-webkit-font-smoothing': 'antialiased',
    })}>` +
    preheaderMarkup(ctx.preheader) +
    `<div role="article" aria-roledescription="email" aria-label="${escapeAttr(ctx.subject || ctx.branding.companyName)}" lang="${ctx.locale}"${styleAttr(
      { 'background-color': gs.backgroundColor },
    )}>` +
    body +
    `</div></body></html>`;

  return { html, warnings: ctx.warnings };
}
