/**
 * Tipi condivisi dal motore di rendering.
 *
 * Il `RenderContext` è l'unico oggetto che attraversa tutti i renderer: porta
 * gli stili globali, l'identità visiva, gli URL di sistema, l'istante di render
 * (usato dal countdown) e l'accumulatore degli avvisi.
 */
import {
  DEFAULT_BRANDING,
  DEFAULT_CURRENCY,
  DEFAULT_GLOBAL_STYLES,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
} from '@alphaink/shared';
import type { BrandingSettings, EmailGlobalStyles, Locale } from '@alphaink/shared';

// ---------------------------------------------------------------------------
// Avvisi
// ---------------------------------------------------------------------------

/**
 * `errore` blocca l'invio, `avviso` lo consente segnalando un rischio,
 * `info` è puramente descrittivo.
 */
export type WarningSeverity = 'errore' | 'avviso' | 'info';

export interface RenderWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
  blockId?: string;
  sectionId?: string;
}

export function makeWarning(
  code: string,
  message: string,
  severity: WarningSeverity = 'avviso',
  extra: { blockId?: string; sectionId?: string } = {},
): RenderWarning {
  return { code, message, severity, ...extra };
}

/** true se fra gli avvisi c'è almeno un problema bloccante. */
export function hasBlockingIssues(warnings: RenderWarning[]): boolean {
  return warnings.some((w) => w.severity === 'errore');
}

// ---------------------------------------------------------------------------
// Identità visiva
// ---------------------------------------------------------------------------

/**
 * Identità visiva usata dal renderer: `BrandingSettings` senza i campi di
 * audit, più la base URL delle icone social.
 */
export interface RenderBranding extends Omit<BrandingSettings, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> {
  /**
   * Base URL da cui scaricare le icone social (es.
   * `https://cdn.alphaink.net/email/social`). Il renderer compone
   * `<base>/<stile>/<rete>.png`. Se assente ripiega su etichette testuali.
   */
  socialIconBaseUrl?: string | null;
}

/** Completa un branding parziale con i default AlphaInk. */
export function resolveBranding(partial?: Partial<RenderBranding> | null): RenderBranding {
  const b = partial ?? {};
  return {
    companyName: b.companyName || DEFAULT_BRANDING.companyName,
    legalName: b.legalName || DEFAULT_BRANDING.legalName,
    address: b.address || DEFAULT_BRANDING.address,
    vatNumber: b.vatNumber ?? DEFAULT_BRANDING.vatNumber,
    supportEmail: b.supportEmail || DEFAULT_BRANDING.supportEmail,
    supportPhone: b.supportPhone ?? DEFAULT_BRANDING.supportPhone,
    websiteUrl: b.websiteUrl || DEFAULT_BRANDING.websiteUrl,
    logoUrl: b.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    logoDarkUrl: b.logoDarkUrl ?? DEFAULT_BRANDING.logoDarkUrl,
    faviconUrl: b.faviconUrl ?? DEFAULT_BRANDING.faviconUrl,
    palette: { ...DEFAULT_BRANDING.palette, ...(b.palette ?? {}) },
    fonts: { ...DEFAULT_BRANDING.fonts, ...(b.fonts ?? {}) },
    socialLinks: b.socialLinks ?? DEFAULT_BRANDING.socialLinks,
    legalFooterHtml: b.legalFooterHtml ?? DEFAULT_BRANDING.legalFooterHtml,
    unsubscribeText: b.unsubscribeText ?? DEFAULT_BRANDING.unsubscribeText,
    socialIconBaseUrl: b.socialIconBaseUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// URL di sistema
// ---------------------------------------------------------------------------

export interface RenderUrls {
  unsubscribeUrl: string;
  preferencesUrl: string;
  webviewUrl: string;
  /** Link al sito con il coupon già applicato. */
  couponUrl?: string | null;
  /** Link di ripristino carrello (automazioni di recupero). */
  recoveryUrl?: string | null;
}

/**
 * Di default gli URL restano merge tag: vengono risolti per destinatario dal
 * modulo di invio, che è l'unico a conoscere il token firmato del contatto.
 */
export const DEFAULT_RENDER_URLS: RenderUrls = {
  unsubscribeUrl: '{{system.unsubscribeUrl}}',
  preferencesUrl: '{{system.preferencesUrl}}',
  webviewUrl: '{{system.webviewUrl}}',
  couponUrl: null,
  recoveryUrl: null,
};

export function resolveUrls(partial?: Partial<RenderUrls> | null): RenderUrls {
  return { ...DEFAULT_RENDER_URLS, ...(partial ?? {}) };
}

// ---------------------------------------------------------------------------
// Contesto di rendering
// ---------------------------------------------------------------------------

/** Valori usati dalle regole di visibilità dei blocchi. */
export type FieldValues = Record<string, string | number | boolean | null>;

export interface RenderContext {
  globalStyles: EmailGlobalStyles;
  branding: RenderBranding;
  urls: RenderUrls;
  /** Istante del render: il countdown calcola i giorni residui rispetto a questo. */
  now: Date;
  locale: Locale;
  timezone: string;
  currency: string;
  subject: string;
  preheader: string;
  /** true durante l'anteprima in editor: i dati mancanti usano i fallback. */
  isPreview: boolean;
  /** Larghezza in px disponibile per il blocco in corso di render. */
  availableWidth: number;
  /** Valori piatti (`contact.ordersCount`, ...) per le regole di visibilità. */
  fields: FieldValues;
  /** Accumulatore condiviso: i renderer vi aggiungono i problemi trovati. */
  warnings: RenderWarning[];
}

export type RenderContextInput = Partial<Omit<RenderContext, 'branding' | 'urls' | 'globalStyles'>> & {
  globalStyles?: Partial<EmailGlobalStyles> | null;
  branding?: Partial<RenderBranding> | null;
  urls?: Partial<RenderUrls> | null;
};

export function createRenderContext(input: RenderContextInput = {}): RenderContext {
  const globalStyles: EmailGlobalStyles = { ...DEFAULT_GLOBAL_STYLES, ...(input.globalStyles ?? {}) };
  return {
    globalStyles,
    branding: resolveBranding(input.branding),
    urls: resolveUrls(input.urls),
    now: input.now ?? new Date(),
    locale: input.locale ?? DEFAULT_LOCALE,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
    currency: input.currency ?? DEFAULT_CURRENCY,
    subject: input.subject ?? '',
    preheader: input.preheader ?? '',
    isPreview: input.isPreview ?? false,
    availableWidth: input.availableWidth ?? globalStyles.contentWidth,
    fields: input.fields ?? {},
    warnings: input.warnings ?? [],
  };
}

/** Registra un avviso nel contesto corrente. */
export function pushWarning(
  ctx: RenderContext,
  code: string,
  message: string,
  severity: WarningSeverity = 'avviso',
  extra: { blockId?: string; sectionId?: string } = {},
): void {
  ctx.warnings.push(makeWarning(code, message, severity, extra));
}

/** Copia del contesto con una larghezza disponibile diversa (colonne annidate). */
export function withWidth(ctx: RenderContext, availableWidth: number): RenderContext {
  return { ...ctx, availableWidth: Math.max(1, Math.round(availableWidth)) };
}
