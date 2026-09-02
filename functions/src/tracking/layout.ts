/**
 * Impaginazione delle pagine pubbliche (disiscrizione, preferenze, webview).
 *
 * Sono pagine servite direttamente dalle Cloud Functions, quindi niente React e
 * niente asset esterni: un solo file HTML con CSS inline, che deve aprirsi in
 * fretta anche da un client di posta su rete mobile. Il layout è responsive
 * (una colonna, larghezza massima 560 px) e usa la palette salvata in
 * `settings/branding`.
 */

import type { BrandingSettings } from '@alphaink/shared';
import type { Response } from 'express';

import { escapeAttr, escapeHtml, isHexColor } from '../render/html-utils';

export interface PublicPageOptions {
  branding: BrandingSettings;
  /** Titolo del documento (tag `<title>`). */
  title: string;
  /** Titolo visibile nella scheda. */
  heading: string;
  /** Corpo HTML già costruito e già sanificato dal chiamante. */
  bodyHtml: string;
  /** Testo introduttivo facoltativo, mostrato sotto al titolo. */
  intro?: string | null;
  /** Colore della barra superiore: `primary` (default), `success`, `danger`. */
  accent?: 'primary' | 'success' | 'danger';
  /** Nasconde il piè di pagina legale (usato nelle pagine di errore). */
  hideFooter?: boolean;
}

/**
 * Colore utilizzabile in un blocco `<style>`.
 *
 * I valori arrivano da Firestore: se non sono esadecimali validi vanno
 * scartati, altrimenti una stringa come `red;} body{display:none` uscirebbe
 * dal blocco di stile.
 */
function cssColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

/** Restituisce il colore d'accento richiesto. */
function accentColor(branding: BrandingSettings, accent: PublicPageOptions['accent']): string {
  if (accent === 'success') return cssColor(branding.palette.success, '#10B981');
  if (accent === 'danger') return cssColor(branding.palette.danger, '#EF4444');
  return cssColor(branding.palette.primary, '#00AEEF');
}

/** Logo se configurato, altrimenti il nome azienda in testo. */
function renderBrand(branding: BrandingSettings): string {
  if (branding.logoUrl) {
    return (
      `<img class="logo" src="${escapeAttr(branding.logoUrl)}"` +
      ` alt="${escapeAttr(branding.companyName)}" />`
    );
  }
  return `<span class="wordmark">${escapeHtml(branding.companyName)}</span>`;
}

function renderFooter(branding: BrandingSettings): string {
  const parts: string[] = [];
  if (branding.legalName) parts.push(escapeHtml(branding.legalName));
  if (branding.address) parts.push(escapeHtml(branding.address));
  if (branding.vatNumber) parts.push(`P. IVA ${escapeHtml(branding.vatNumber)}`);

  const contacts: string[] = [];
  if (branding.supportEmail) {
    contacts.push(
      `<a href="mailto:${escapeAttr(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a>`,
    );
  }
  if (branding.websiteUrl) {
    contacts.push(`<a href="${escapeAttr(branding.websiteUrl)}">${escapeHtml(branding.websiteUrl)}</a>`);
  }

  return (
    '<footer class="footer">' +
    `<p>${parts.join(' · ')}</p>` +
    (contacts.length ? `<p>${contacts.join(' · ')}</p>` : '') +
    '</footer>'
  );
}

/** Costruisce la pagina completa. */
export function renderPublicPage(options: PublicPageOptions): string {
  const { branding } = options;
  const accent = accentColor(branding, options.accent);
  const palette = branding.palette;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(options.title)}</title>
${branding.faviconUrl ? `<link rel="icon" href="${escapeAttr(branding.faviconUrl)}" />` : ''}
<style>
  :root {
    --primary: ${cssColor(palette.primary, '#00AEEF')};
    --accent: ${accent};
    --text: ${cssColor(palette.text, '#0F172A')};
    --muted: ${cssColor(palette.muted, '#94A3B8')};
    --surface: ${cssColor(palette.surface, '#FFFFFF')};
    --background: ${cssColor(palette.background, '#F1F5F9')};
    --danger: ${cssColor(palette.danger, '#EF4444')};
    --success: ${cssColor(palette.success, '#10B981')};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 16px 48px;
    background: var(--background);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .shell { max-width: 560px; margin: 0 auto; }
  .brand { text-align: center; margin-bottom: 24px; }
  .logo { max-height: 44px; max-width: 220px; height: auto; width: auto; }
  .wordmark { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; color: var(--text); }
  .card {
    background: var(--surface);
    border-radius: 16px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 12px 32px rgba(15, 23, 42, .08);
    overflow: hidden;
  }
  .card::before { content: ''; display: block; height: 4px; background: var(--accent); }
  .card-body { padding: 32px 28px; }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; letter-spacing: -0.5px; }
  h2 { margin: 28px 0 12px; font-size: 17px; letter-spacing: -0.2px; }
  p { margin: 0 0 16px; }
  .intro { color: var(--muted); }
  .email {
    display: inline-block;
    background: var(--background);
    border-radius: 8px;
    padding: 6px 12px;
    font-weight: 600;
    word-break: break-all;
  }
  form { margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
  button, .btn {
    appearance: none;
    border: 0;
    border-radius: 10px;
    padding: 13px 22px;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    text-align: center;
  }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-ghost { background: transparent; color: var(--muted); border: 1px solid rgba(148, 163, 184, .45); }
  button:hover, .btn:hover { filter: brightness(.94); }
  .options { display: grid; gap: 10px; margin: 0 0 8px; padding: 0; list-style: none; }
  .option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid rgba(148, 163, 184, .35);
    border-radius: 12px;
    cursor: pointer;
  }
  .option:hover { border-color: var(--primary); }
  .option input { margin: 4px 0 0; width: 18px; height: 18px; accent-color: var(--primary); flex: 0 0 auto; }
  .option-text { display: block; }
  .option-title { font-weight: 600; }
  .option-hint { display: block; color: var(--muted); font-size: 14px; }
  .note { font-size: 14px; color: var(--muted); }
  .notice {
    border-radius: 12px;
    padding: 14px 16px;
    font-size: 15px;
    margin: 0 0 20px;
    background: rgba(148, 163, 184, .14);
  }
  .notice-success { background: rgba(16, 185, 129, .12); }
  .notice-danger { background: rgba(239, 68, 68, .1); }
  .footer { margin: 24px auto 0; text-align: center; font-size: 13px; color: var(--muted); }
  .footer p { margin: 0 0 4px; }
  .footer a { color: var(--muted); }
  a { color: var(--primary); }
  @media (max-width: 480px) {
    body { padding: 20px 12px 32px; }
    .card-body { padding: 24px 20px; }
    .actions { flex-direction: column; }
    button, .btn { width: 100%; }
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="brand">${renderBrand(branding)}</div>
    <main class="card">
      <div class="card-body">
        <h1>${escapeHtml(options.heading)}</h1>
        ${options.intro ? `<p class="intro">${escapeHtml(options.intro)}</p>` : ''}
        ${options.bodyHtml}
      </div>
    </main>
    ${options.hideFooter ? '' : renderFooter(branding)}
  </div>
</body>
</html>`;
}

/** Invia una pagina HTML senza cache (contiene dati personali). */
export function sendHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .set('Referrer-Policy', 'no-referrer')
    .send(html);
}

/** Pagina di errore uniforme per link scaduti o manomessi. */
export function renderErrorPage(
  branding: BrandingSettings,
  heading: string,
  message: string,
): string {
  return renderPublicPage({
    branding,
    title: `${heading} — ${branding.companyName}`,
    heading,
    accent: 'danger',
    bodyHtml:
      `<p>${escapeHtml(message)}</p>` +
      (branding.supportEmail
        ? `<p class="note">Se hai bisogno di aiuto scrivici a ` +
          `<a href="mailto:${escapeAttr(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a>.</p>`
        : ''),
  });
}
