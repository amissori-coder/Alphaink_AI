import type {
  EmailDocument, EmailGlobalStyles, EmailSection, Spacing, TypographyStyle,
} from '../types/email';
import type { BrandingSettings, TrackingSettings } from '../types/settings';
import { DEFAULT_ATTRIBUTION_SETTINGS } from '../types/tracking';

/**
 * Palette AlphaInk ispirata alla quadricromia CMYK.
 * Modificabile da Impostazioni → Brand senza toccare il codice.
 */
export const ALPHAINK_PALETTE = {
  /** Nero "key": testi e superfici scure. */
  key: '#0F172A',
  /** Ciano: colore primario di brand. */
  cyan: '#00AEEF',
  cyanDark: '#0086BC',
  /** Magenta: accento per promozioni e saldi. */
  magenta: '#EC008C',
  /** Giallo: evidenziazioni e badge. */
  yellow: '#FFC400',
  slate: '#475569',
  muted: '#94A3B8',
  border: '#E2E8F0',
  surface: '#FFFFFF',
  background: '#F1F5F9',
  success: '#10B981',
  danger: '#EF4444',
} as const;

export const FONT_STACK_BODY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_STACK_HEADING =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function spacing(top = 0, right = top, bottom = top, left = right): Spacing {
  return { top, right, bottom, left };
}

export const DEFAULT_TYPOGRAPHY: TypographyStyle = {
  fontFamily: FONT_STACK_BODY,
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.6,
  letterSpacing: 0,
  color: ALPHAINK_PALETTE.key,
  align: 'left',
  textTransform: 'none',
};

export const DEFAULT_HEADING_TYPOGRAPHY: TypographyStyle = {
  ...DEFAULT_TYPOGRAPHY,
  fontFamily: FONT_STACK_HEADING,
  fontSize: 28,
  fontWeight: 700,
  lineHeight: 1.25,
  letterSpacing: -0.4,
};

export const DEFAULT_GLOBAL_STYLES: EmailGlobalStyles = {
  contentWidth: 600,
  backgroundColor: ALPHAINK_PALETTE.background,
  contentBackgroundColor: ALPHAINK_PALETTE.surface,
  fontFamily: FONT_STACK_BODY,
  textColor: ALPHAINK_PALETTE.key,
  linkColor: ALPHAINK_PALETTE.cyanDark,
  headingColor: ALPHAINK_PALETTE.key,
  baseFontSize: 16,
  baseLineHeight: 1.6,
  borderRadius: 12,
  webFonts: ['Inter:wght@400;500;600;700;800'],
  darkModeSupport: true,
  darkBackgroundColor: '#0B1220',
  darkContentBackgroundColor: '#111C2E',
  darkTextColor: '#E2E8F0',
};

/** Sezione vuota a colonna singola: unità base dell'editor. */
export function emptySection(id: string, columnId: string): EmailSection {
  return {
    id,
    columns: [
      {
        id: columnId,
        span: 12,
        blocks: [],
        verticalAlign: 'top',
        backgroundColor: null,
        padding: spacing(0),
      },
    ],
    fullWidthBackgroundColor: null,
    backgroundColor: null,
    backgroundImage: null,
    padding: spacing(24, 24, 24, 24),
    stackOnMobile: true,
    border: null,
  };
}

export function emptyDocument(sectionId: string, columnId: string): EmailDocument {
  return {
    version: 1,
    sections: [emptySection(sectionId, columnId)],
    globalStyles: { ...DEFAULT_GLOBAL_STYLES },
  };
}

export const DEFAULT_BRANDING: Omit<BrandingSettings, 'createdAt' | 'updatedAt'> = {
  companyName: 'AlphaInk',
  legalName: 'Alphaink S.r.l.',
  address: 'Alphaink S.r.l. — Italia',
  vatNumber: '',
  supportEmail: 'info@alphaink.net',
  supportPhone: null,
  websiteUrl: 'https://alphaink.net',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  palette: {
    primary: ALPHAINK_PALETTE.cyan,
    secondary: ALPHAINK_PALETTE.magenta,
    accent: ALPHAINK_PALETTE.yellow,
    background: ALPHAINK_PALETTE.background,
    surface: ALPHAINK_PALETTE.surface,
    text: ALPHAINK_PALETTE.key,
    muted: ALPHAINK_PALETTE.muted,
    success: ALPHAINK_PALETTE.success,
    danger: ALPHAINK_PALETTE.danger,
  },
  fonts: { heading: 'Inter', body: 'Inter' },
  socialLinks: [],
  legalFooterHtml:
    'Ricevi questa email perché sei iscritto agli aggiornamenti di AlphaInk.',
  unsubscribeText: 'Non vuoi più ricevere le nostre email?',
};

export const DEFAULT_TRACKING_SETTINGS: Omit<TrackingSettings, 'createdAt' | 'updatedAt'> = {
  attribution: DEFAULT_ATTRIBUTION_SETTINGS,
  autoUtm: true,
  utmSource: 'newsletter',
  utmMedium: 'email',
  utmCampaignTemplate: '{{newsletter.slug}}',
  useOwnClickTracking: true,
  clickTrackingDomain: '',
  excludeProxyOpens: true,
};

/** Larghezza massima dei preset colonna offerti dall'editor (dodicesimi). */
export const COLUMN_PRESETS: Array<{ label: string; spans: number[] }> = [
  { label: '1 colonna', spans: [12] },
  { label: '2 colonne', spans: [6, 6] },
  { label: '2 colonne (1/3 · 2/3)', spans: [4, 8] },
  { label: '2 colonne (2/3 · 1/3)', spans: [8, 4] },
  { label: '3 colonne', spans: [4, 4, 4] },
  { label: '4 colonne', spans: [3, 3, 3, 3] },
];

/** Limiti operativi. */
export const LIMITS = {
  maxRecipientsPerCampaign: 500_000,
  /** Brevo accetta al massimo 1000 destinatari per chiamata transazionale. */
  brevoBatchSize: 100,
  maxImageBytes: 8 * 1024 * 1024,
  maxSubjectLength: 200,
  maxPreheaderLength: 150,
  maxBlocksPerDocument: 500,
  maxTestRecipients: 10,
  previewSampleSize: 25,
} as const;
