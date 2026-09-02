/**
 * Modello dell'editor email a blocchi.
 *
 * Un documento email è una lista ordinata di **sezioni**; ogni sezione contiene
 * 1-4 **colonne**; ogni colonna contiene una lista di **blocchi**. Il renderer
 * (`renderEmail`) trasforma questo albero in HTML table-based compatibile con
 * Outlook, Gmail, Apple Mail e i client mobile.
 */

export type BlockType =
  | 'text'
  | 'heading'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'social'
  | 'video'
  | 'html'
  | 'product'
  | 'product_grid'
  | 'coupon'
  | 'countdown'
  | 'menu'
  | 'footer'
  | 'unsubscribe';

export const BLOCK_TYPES: BlockType[] = [
  'heading', 'text', 'image', 'button', 'product', 'product_grid', 'coupon',
  'countdown', 'divider', 'spacer', 'social', 'video', 'menu', 'html', 'footer', 'unsubscribe',
];

export const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Testo',
  heading: 'Titolo',
  image: 'Immagine',
  button: 'Pulsante',
  divider: 'Separatore',
  spacer: 'Spazio',
  social: 'Social',
  video: 'Video',
  html: 'HTML personalizzato',
  product: 'Prodotto',
  product_grid: 'Griglia prodotti',
  coupon: 'Coupon',
  countdown: 'Countdown',
  menu: 'Menu di navigazione',
  footer: 'Footer',
  unsubscribe: 'Disiscrizione',
};

// ---------------------------------------------------------------------------
// Stili
// ---------------------------------------------------------------------------

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BorderStyle {
  width: number;
  style: 'none' | 'solid' | 'dashed' | 'dotted';
  color: string;
  radius: number;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

export interface TypographyStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeight;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  align: TextAlign;
  textTransform?: 'none' | 'uppercase' | 'capitalize';
}

export interface BlockStyle {
  padding: Spacing;
  backgroundColor?: string | null;
  border?: BorderStyle | null;
  align?: TextAlign;
  /** Nasconde il blocco su mobile (media query + classe `.mobile-hide`). */
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
}

// ---------------------------------------------------------------------------
// Contenuti dei blocchi
// ---------------------------------------------------------------------------

export interface TextBlockContent {
  /** HTML inline sanificato (b, i, u, a, span, br, ul/ol/li). */
  html: string;
  typography: TypographyStyle;
}

export interface HeadingBlockContent {
  text: string;
  level: 1 | 2 | 3 | 4;
  typography: TypographyStyle;
}

export interface ImageBlockContent {
  /** URL pubblico su Firebase Storage o esterno. */
  src: string;
  storagePath?: string | null;
  alt: string;
  /** Larghezza in px; `null` = full width della colonna. */
  width?: number | null;
  href?: string | null;
  /** Link tracciato: se true il renderer avvolge l'URL nel redirector. */
  trackClick?: boolean;
  borderRadius?: number;
}

export interface ButtonBlockContent {
  label: string;
  href: string;
  trackClick?: boolean;
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  fontWeight: FontWeight;
  paddingX: number;
  paddingY: number;
  borderRadius: number;
  fullWidth: boolean;
  border?: BorderStyle | null;
}

export interface DividerBlockContent {
  color: string;
  thickness: number;
  style: 'solid' | 'dashed' | 'dotted';
  widthPercent: number;
}

export interface SpacerBlockContent {
  height: number;
}

export type SocialNetwork =
  | 'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'x' | 'tiktok' | 'whatsapp' | 'website';

export interface SocialBlockContent {
  items: Array<{ network: SocialNetwork; url: string }>;
  iconSize: number;
  iconStyle: 'color' | 'dark' | 'light' | 'outline';
  spacing: number;
}

export interface VideoBlockContent {
  /** L'email non supporta video: si renderizza una thumbnail cliccabile. */
  url: string;
  thumbnailUrl: string;
  alt: string;
  showPlayIcon: boolean;
}

export interface HtmlBlockContent {
  html: string;
}

export interface ProductBlockContent {
  sku: string;
  name: string;
  imageUrl: string;
  price: number;
  compareAtPrice?: number | null;
  currency: string;
  url: string;
  ctaLabel: string;
  showPrice: boolean;
  showDiscountBadge: boolean;
  layout: 'horizontal' | 'vertical';
}

export interface ProductGridBlockContent {
  products: ProductBlockContent[];
  columns: 2 | 3;
  /** Se valorizzato, i prodotti sono risolti a runtime al momento dell'invio. */
  dynamicSource?: {
    type: 'bestsellers' | 'new_arrivals' | 'category' | 'recommended_for_contact' | 'compatible_with_printer';
    categoryPath?: string | null;
    limit: number;
  } | null;
}

export interface CouponBlockContent {
  /** Codice statico, oppure `null` se il codice viene generato per destinatario. */
  code: string | null;
  dynamic: boolean;
  /** Prefisso dei codici generati (es. `STAMP-`). */
  codePrefix?: string;
  discountLabel: string;
  description?: string;
  expiresAt?: string | null;
  backgroundColor: string;
  textColor: string;
  borderStyle: 'solid' | 'dashed';
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

export interface CountdownBlockContent {
  /** ISO date della scadenza. */
  endsAt: string;
  label: string;
  /** L'email statica mostra i giorni residui calcolati all'invio. */
  showDays: boolean;
  showHours: boolean;
  accentColor: string;
}

export interface MenuBlockContent {
  items: Array<{ label: string; href: string }>;
  typography: TypographyStyle;
  separator: string;
}

export interface FooterBlockContent {
  companyName: string;
  address: string;
  vatLine?: string;
  extraHtml?: string;
  typography: TypographyStyle;
}

export interface UnsubscribeBlockContent {
  text: string;
  linkLabel: string;
  showPreferencesLink: boolean;
  preferencesLabel?: string;
  typography: TypographyStyle;
}

export type BlockContent =
  | ({ type: 'text' } & TextBlockContent)
  | ({ type: 'heading' } & HeadingBlockContent)
  | ({ type: 'image' } & ImageBlockContent)
  | ({ type: 'button' } & ButtonBlockContent)
  | ({ type: 'divider' } & DividerBlockContent)
  | ({ type: 'spacer' } & SpacerBlockContent)
  | ({ type: 'social' } & SocialBlockContent)
  | ({ type: 'video' } & VideoBlockContent)
  | ({ type: 'html' } & HtmlBlockContent)
  | ({ type: 'product' } & ProductBlockContent)
  | ({ type: 'product_grid' } & ProductGridBlockContent)
  | ({ type: 'coupon' } & CouponBlockContent)
  | ({ type: 'countdown' } & CountdownBlockContent)
  | ({ type: 'menu' } & MenuBlockContent)
  | ({ type: 'footer' } & FooterBlockContent)
  | ({ type: 'unsubscribe' } & UnsubscribeBlockContent);

export interface EmailBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  style: BlockStyle;
  /** Mostra il blocco solo se la condizione è soddisfatta dal destinatario. */
  visibilityRule?: {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt' | 'is_empty' | 'is_not_empty';
    value?: string | number | null;
  } | null;
  locked?: boolean;
}

export interface EmailColumn {
  id: string;
  /** Larghezza in dodicesimi (griglia a 12 colonne). */
  span: number;
  blocks: EmailBlock[];
  verticalAlign: 'top' | 'middle' | 'bottom';
  backgroundColor?: string | null;
  padding: Spacing;
}

export interface EmailSection {
  id: string;
  name?: string;
  columns: EmailColumn[];
  /** Colore/immagine dell'area a tutta larghezza dietro il contenitore. */
  fullWidthBackgroundColor?: string | null;
  backgroundColor?: string | null;
  backgroundImage?: { src: string; size: 'cover' | 'contain' | 'auto'; repeat: boolean } | null;
  padding: Spacing;
  /** Su mobile impila le colonne. */
  stackOnMobile: boolean;
  /** Inverte l'ordine delle colonne su mobile. */
  reverseOnMobile?: boolean;
  border?: BorderStyle | null;
}

export interface EmailGlobalStyles {
  /** Larghezza del contenitore (px). Standard: 600. */
  contentWidth: number;
  backgroundColor: string;
  contentBackgroundColor: string;
  fontFamily: string;
  textColor: string;
  linkColor: string;
  headingColor: string;
  baseFontSize: number;
  baseLineHeight: number;
  borderRadius: number;
  /** Font Google da importare nell'head (fallback web-safe sempre incluso). */
  webFonts: string[];
  /** Attiva gli stili `prefers-color-scheme: dark`. */
  darkModeSupport: boolean;
  darkBackgroundColor?: string;
  darkContentBackgroundColor?: string;
  darkTextColor?: string;
}

export interface EmailDocument {
  version: 1;
  sections: EmailSection[];
  globalStyles: EmailGlobalStyles;
}

/** Merge tag disponibili nell'editor. */
export interface MergeTag {
  token: string;          // es. "{{contact.firstName}}"
  label: string;          // es. "Nome"
  group: 'contatto' | 'azienda' | 'ordine' | 'coupon' | 'sistema' | 'prodotto';
  /** Valore mostrato in anteprima e usato come fallback quando il dato manca. */
  fallback: string;
  description?: string;
}
