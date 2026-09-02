/**
 * Template di sistema di AlphaInk.
 *
 * Cinque email complete e già impaginate, che l'operatore usa come punto di
 * partenza: "Promo Toner", "Novità Prodotti", "Saldi Stagionali", "Newsletter
 * Informativa", "Offerta B2B Rivenditori".
 *
 * ## Regole seguite da tutti i template
 *  - impaginazione a 600 px, tabellare, con sezioni impilabili su mobile;
 *  - palette AlphaInk (ciano primario, magenta per le promozioni, giallo per i
 *    badge), sovrascritta dai colori salvati in `settings/branding`;
 *  - blocco di disiscrizione presente ovunque: senza, il renderer blocca
 *    l'invio (obbligo di legge);
 *  - merge tag usati con parsimonia e sempre con un fallback sensato
 *    (`{{contact.firstName}}` diventa "Cliente" quando il nome manca).
 *
 * ## Immagini
 * I template nascono con immagini segnaposto generate da `placehold.co`, con
 * le misure giuste per l'impaginazione. Sono lì per far vedere il risultato
 * finito: l'operatore le sostituisce dalla libreria immagini. Nessun file
 * inesistente viene mai referenziato.
 */

import {
  ALPHAINK_PALETTE,
  DEFAULT_BRANDING,
  DEFAULT_HEADING_TYPOGRAPHY,
  DEFAULT_TYPOGRAPHY,
  blockId,
  emptyDocument,
  spacing,
} from '@alphaink/shared';
import type {
  BlockContent,
  BlockStyle,
  BrandingSettings,
  EmailBlock,
  EmailColumn,
  EmailDocument,
  EmailSection,
  NewsletterTemplate,
  ProductBlockContent,
  Spacing,
  TextAlign,
  TypographyStyle,
} from '@alphaink/shared';

/** Template di sistema: come `NewsletterTemplate`, senza i campi di audit. */
export type SystemTemplate = Omit<NewsletterTemplate, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

/** Identità visiva accettata: qualsiasi sottoinsieme del branding salvato. */
export type BrandingInput = Partial<BrandingSettings> | null | undefined;

/** Id fissi: rendono `seedDefaults` idempotente e i template riconoscibili. */
export const SYSTEM_TEMPLATE_IDS = {
  promoToner: 'sistema-promo-toner',
  novitaProdotti: 'sistema-novita-prodotti',
  saldiStagionali: 'sistema-saldi-stagionali',
  informativa: 'sistema-newsletter-informativa',
  offertaB2b: 'sistema-offerta-b2b',
} as const;

const DAY_MS = 86_400_000;

// -----------------------------------------------------------------------------
// Identità visiva
// -----------------------------------------------------------------------------

interface Brand {
  companyName: string;
  legalName: string;
  address: string;
  vatNumber: string;
  supportEmail: string;
  supportPhone: string | null;
  websiteUrl: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  surface: string;
  background: string;
  unsubscribeText: string;
}

function resolveBrand(branding: BrandingInput): Brand {
  const palette = { ...DEFAULT_BRANDING.palette, ...(branding?.palette ?? {}) };
  return {
    companyName: branding?.companyName?.trim() || DEFAULT_BRANDING.companyName,
    legalName: branding?.legalName?.trim() || DEFAULT_BRANDING.legalName,
    address: branding?.address?.trim() || DEFAULT_BRANDING.address,
    vatNumber: branding?.vatNumber?.trim() || DEFAULT_BRANDING.vatNumber,
    supportEmail: branding?.supportEmail?.trim() || DEFAULT_BRANDING.supportEmail,
    supportPhone: branding?.supportPhone ?? DEFAULT_BRANDING.supportPhone ?? null,
    websiteUrl: (branding?.websiteUrl?.trim() || DEFAULT_BRANDING.websiteUrl).replace(/\/+$/, ''),
    logoUrl: branding?.logoUrl ?? DEFAULT_BRANDING.logoUrl ?? null,
    primary: palette.primary,
    secondary: palette.secondary,
    accent: palette.accent,
    text: palette.text,
    muted: palette.muted,
    surface: palette.surface,
    background: palette.background,
    unsubscribeText: branding?.unsubscribeText?.trim() || DEFAULT_BRANDING.unsubscribeText,
  };
}

/** URL di ricerca del negozio: PrestaShop espone il controller `search`. */
function searchUrl(brand: Brand, term: string): string {
  return `${brand.websiteUrl}/ricerca?controller=search&s=${encodeURIComponent(term)}`;
}

/** Colore esadecimale senza cancelletto, come lo vuole il servizio segnaposto. */
function rawHex(color: string): string {
  return color.replace('#', '').slice(0, 6);
}

/**
 * Immagine segnaposto con le proporzioni giuste per il blocco che la ospita.
 * L'operatore la sostituisce con una foto vera dalla libreria immagini.
 */
function placeholderImage(
  width: number,
  height: number,
  label: string,
  background: string,
  color = '#FFFFFF',
): string {
  return `https://placehold.co/${width}x${height}/${rawHex(background)}/${rawHex(color)}/png?text=${encodeURIComponent(label)}`;
}

// -----------------------------------------------------------------------------
// Costruttori di blocchi
// -----------------------------------------------------------------------------

function style(partial: Partial<BlockStyle> = {}): BlockStyle {
  return {
    padding: partial.padding ?? spacing(0, 0, 16, 0),
    backgroundColor: partial.backgroundColor ?? null,
    border: partial.border ?? null,
    align: partial.align ?? 'left',
    hideOnMobile: partial.hideOnMobile ?? false,
    hideOnDesktop: partial.hideOnDesktop ?? false,
  };
}

function makeBlock(content: BlockContent, partial: Partial<BlockStyle> = {}): EmailBlock {
  return {
    id: blockId(content.type),
    type: content.type,
    content,
    style: style(partial),
    visibilityRule: null,
    locked: false,
  };
}

function typography(overrides: Partial<TypographyStyle> = {}): TypographyStyle {
  return { ...DEFAULT_TYPOGRAPHY, ...overrides };
}

function headingTypography(overrides: Partial<TypographyStyle> = {}): TypographyStyle {
  return { ...DEFAULT_HEADING_TYPOGRAPHY, ...overrides };
}

function logoBlock(brand: Brand): EmailBlock {
  if (brand.logoUrl) {
    return makeBlock(
      {
        type: 'image',
        src: brand.logoUrl,
        storagePath: null,
        alt: brand.companyName,
        width: 168,
        href: brand.websiteUrl,
        trackClick: true,
        borderRadius: 0,
      },
      { padding: spacing(0), align: 'center' },
    );
  }
  // Senza logo caricato resta il nome azienda: l'email è comunque presentabile.
  return makeBlock(
    {
      type: 'heading',
      text: brand.companyName,
      level: 2,
      typography: headingTypography({
        fontSize: 26,
        fontWeight: 800,
        letterSpacing: -0.6,
        color: brand.primary,
        align: 'center',
      }),
    },
    { padding: spacing(0), align: 'center' },
  );
}

function menuBlock(brand: Brand, items: Array<{ label: string; term: string }>): EmailBlock {
  return makeBlock(
    {
      type: 'menu',
      items: items.map((item) => ({ label: item.label, href: searchUrl(brand, item.term) })),
      typography: typography({ fontSize: 13, fontWeight: 600, color: brand.muted, align: 'center' }),
      separator: '•',
    },
    { padding: spacing(12, 0, 0, 0), align: 'center' },
  );
}

function heroImage(brand: Brand, label: string, background: string, alt: string): EmailBlock {
  return makeBlock(
    {
      type: 'image',
      src: placeholderImage(1200, 600, label, background),
      storagePath: null,
      alt,
      width: null,
      href: brand.websiteUrl,
      trackClick: true,
      borderRadius: 12,
    },
    { padding: spacing(0, 0, 20, 0), align: 'center' },
  );
}

function eyebrowBlock(text: string, color: string): EmailBlock {
  return makeBlock(
    {
      type: 'text',
      html: text,
      typography: typography({
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1.2,
        color,
        textTransform: 'uppercase',
      }),
    },
    { padding: spacing(0, 0, 8, 0) },
  );
}

function titleBlock(text: string, brand: Brand, overrides: Partial<TypographyStyle> = {}): EmailBlock {
  return makeBlock(
    {
      type: 'heading',
      text,
      level: 1,
      typography: headingTypography({ fontSize: 30, color: brand.text, ...overrides }),
    },
    { padding: spacing(0, 0, 12, 0) },
  );
}

function subtitleBlock(text: string, brand: Brand, overrides: Partial<TypographyStyle> = {}): EmailBlock {
  return makeBlock(
    {
      type: 'heading',
      text,
      level: 2,
      typography: headingTypography({ fontSize: 20, color: brand.text, ...overrides }),
    },
    { padding: spacing(4, 0, 10, 0) },
  );
}

function paragraphBlock(
  html: string,
  options: { align?: TextAlign; size?: number; color?: string; padding?: Spacing } = {},
): EmailBlock {
  return makeBlock(
    {
      type: 'text',
      html,
      typography: typography({
        fontSize: options.size ?? 16,
        align: options.align ?? 'left',
        color: options.color ?? DEFAULT_TYPOGRAPHY.color,
      }),
    },
    { padding: options.padding ?? spacing(0, 0, 16, 0) },
  );
}

/** Elenco puntato: in email un `<ul>` con stili inline è più affidabile di una tabella. */
function bulletsBlock(items: string[], brand: Brand): EmailBlock {
  const rows = items.map((item) => `<li style="padding-bottom:6px;">${item}</li>`).join('');
  return makeBlock(
    {
      type: 'text',
      html: `<ul style="margin:0;padding-left:20px;">${rows}</ul>`,
      typography: typography({ fontSize: 15, color: brand.text }),
    },
    { padding: spacing(0, 0, 20, 0) },
  );
}

function buttonBlock(
  label: string,
  href: string,
  brand: Brand,
  options: { color?: string; textColor?: string; fullWidth?: boolean } = {},
): EmailBlock {
  return makeBlock(
    {
      type: 'button',
      label,
      href,
      trackClick: true,
      backgroundColor: options.color ?? brand.primary,
      textColor: options.textColor ?? '#FFFFFF',
      fontSize: 16,
      fontWeight: 700,
      paddingX: 30,
      paddingY: 14,
      borderRadius: 8,
      fullWidth: options.fullWidth ?? false,
      border: null,
    },
    { padding: spacing(4, 0, 20, 0), align: 'center' },
  );
}

function couponBlock(
  brand: Brand,
  spec: { code: string; discountLabel: string; description: string; ctaLabel: string; term: string },
): EmailBlock {
  return makeBlock(
    {
      type: 'coupon',
      // Codice fisso e uguale per tutti: nelle newsletter il buono è della
      // campagna, non del singolo destinatario (quelli personali li emettono
      // le automazioni).
      code: spec.code,
      dynamic: false,
      codePrefix: 'ALPHA',
      discountLabel: spec.discountLabel,
      description: spec.description,
      expiresAt: null,
      backgroundColor: '#F8FAFC',
      textColor: brand.text,
      borderStyle: 'dashed',
      ctaLabel: spec.ctaLabel,
      ctaHref: searchUrl(brand, spec.term),
    },
    { padding: spacing(0, 0, 24, 0), align: 'center' },
  );
}

interface ProductSpec {
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  term: string;
  imageLabel: string;
}

function product(brand: Brand, spec: ProductSpec, imageColor: string): ProductBlockContent {
  return {
    sku: spec.sku,
    name: spec.name,
    imageUrl: placeholderImage(600, 600, spec.imageLabel, imageColor),
    price: spec.price,
    compareAtPrice: spec.compareAtPrice ?? null,
    currency: 'EUR',
    url: searchUrl(brand, spec.term),
    ctaLabel: 'Acquista',
    showPrice: true,
    showDiscountBadge: Boolean(spec.compareAtPrice),
    layout: 'vertical',
  };
}

function productGridBlock(
  brand: Brand,
  specs: ProductSpec[],
  options: { columns?: 2 | 3; imageColor?: string } = {},
): EmailBlock {
  return makeBlock(
    {
      type: 'product_grid',
      products: specs.map((spec) => product(brand, spec, options.imageColor ?? brand.primary)),
      columns: options.columns ?? 3,
      dynamicSource: null,
    },
    { padding: spacing(0, 0, 20, 0) },
  );
}

function productBlock(brand: Brand, spec: ProductSpec, imageColor?: string): EmailBlock {
  return makeBlock(
    { type: 'product', ...product(brand, spec, imageColor ?? brand.primary), layout: 'horizontal' },
    { padding: spacing(0, 0, 16, 0) },
  );
}

function countdownBlock(brand: Brand, label: string, days: number): EmailBlock {
  return makeBlock(
    {
      type: 'countdown',
      // Data indicativa impostata alla creazione del template: va aggiornata
      // ad ogni riutilizzo (l'editor la propone in evidenza).
      endsAt: new Date(Date.now() + days * DAY_MS).toISOString(),
      label,
      showDays: true,
      showHours: false,
      accentColor: brand.secondary,
    },
    { padding: spacing(0, 0, 20, 0), align: 'center' },
  );
}

function dividerBlock(): EmailBlock {
  return makeBlock(
    { type: 'divider', color: ALPHAINK_PALETTE.border, thickness: 1, style: 'solid', widthPercent: 100 },
    { padding: spacing(4, 0, 16, 0) },
  );
}

function spacerBlock(height: number): EmailBlock {
  return makeBlock({ type: 'spacer', height }, { padding: spacing(0) });
}

function socialBlock(brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'social',
      items: [
        { network: 'facebook', url: 'https://www.facebook.com/' },
        { network: 'instagram', url: 'https://www.instagram.com/' },
        { network: 'linkedin', url: 'https://www.linkedin.com/' },
        { network: 'website', url: brand.websiteUrl },
      ],
      iconSize: 28,
      iconStyle: 'dark',
      spacing: 12,
    },
    { padding: spacing(4, 0, 12, 0), align: 'center' },
  );
}

function footerBlock(brand: Brand): EmailBlock {
  const domain = brand.websiteUrl.replace(/^https?:\/\//, '');
  const phone = brand.supportPhone ? ` oppure chiamaci allo ${brand.supportPhone}` : '';
  return makeBlock(
    {
      type: 'footer',
      companyName: brand.legalName,
      address: brand.address,
      vatLine: brand.vatNumber ? `P. IVA ${brand.vatNumber}` : undefined,
      extraHtml:
        `Hai bisogno di aiuto? Scrivici a <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a>${phone}. ` +
        `Trovi tutto il catalogo su <a href="${brand.websiteUrl}">${domain}</a>.`,
      typography: typography({ fontSize: 12, color: brand.muted, align: 'center', lineHeight: 1.6 }),
    },
    { padding: spacing(0, 0, 12, 0), align: 'center' },
  );
}

function unsubscribeBlock(brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'unsubscribe',
      text: brand.unsubscribeText,
      linkLabel: 'Cancella iscrizione',
      showPreferencesLink: true,
      preferencesLabel: 'Gestisci le preferenze',
      typography: typography({ fontSize: 12, color: brand.muted, align: 'center' }),
    },
    { padding: spacing(0), align: 'center' },
  );
}

// -----------------------------------------------------------------------------
// Sezioni e documento
// -----------------------------------------------------------------------------

function column(blocks: EmailBlock[], span = 12): EmailColumn {
  return {
    id: blockId('colonna'),
    span,
    blocks,
    verticalAlign: 'top',
    backgroundColor: null,
    padding: spacing(0),
  };
}

interface SectionOptions {
  name?: string;
  background?: string | null;
  fullWidthBackground?: string | null;
  padding?: Spacing;
}

function section(blocks: EmailBlock[], options: SectionOptions = {}): EmailSection {
  return {
    id: blockId('sezione'),
    name: options.name,
    columns: [column(blocks)],
    fullWidthBackgroundColor: options.fullWidthBackground ?? null,
    backgroundColor: options.background ?? null,
    backgroundImage: null,
    padding: options.padding ?? spacing(28, 32, 28, 32),
    stackOnMobile: true,
    reverseOnMobile: false,
    border: null,
  };
}

/** Sezione a due colonne: usata per i vantaggi affiancati. */
function twoColumnSection(
  left: EmailBlock[],
  right: EmailBlock[],
  options: SectionOptions = {},
): EmailSection {
  return {
    id: blockId('sezione'),
    name: options.name,
    columns: [column(left, 6), column(right, 6)],
    fullWidthBackgroundColor: options.fullWidthBackground ?? null,
    backgroundColor: options.background ?? null,
    backgroundImage: null,
    padding: options.padding ?? spacing(20, 32, 20, 32),
    stackOnMobile: true,
    reverseOnMobile: false,
    border: null,
  };
}

function buildDocument(sections: EmailSection[]): EmailDocument {
  // `emptyDocument` porta versione e stili globali coerenti con l'editor:
  // qui si sostituiscono soltanto le sezioni.
  const base = emptyDocument(blockId('sezione'), blockId('colonna'));
  return { ...base, sections };
}

/** Intestazione comune: logo e menu di navigazione. */
function headerSection(brand: Brand, items: Array<{ label: string; term: string }>): EmailSection {
  return section([logoBlock(brand), menuBlock(brand, items)], {
    name: 'Intestazione',
    padding: spacing(28, 32, 16, 32),
  });
}

/** Chiusura comune: social, footer legale e disiscrizione (obbligatoria). */
function footerSection(brand: Brand, closing?: string): EmailSection {
  const blocks: EmailBlock[] = [dividerBlock()];
  if (closing) {
    blocks.push(paragraphBlock(closing, { size: 13, align: 'center', color: brand.muted }));
  }
  blocks.push(socialBlock(brand), footerBlock(brand), unsubscribeBlock(brand));
  return section(blocks, { name: 'Chiusura', padding: spacing(8, 32, 28, 32) });
}

/** Riquadro "perché AlphaInk": tre rassicurazioni brevi. */
function trustSection(brand: Brand): EmailSection {
  return twoColumnSection(
    [
      subtitleBlock('Spedizione in 24/48 ore', brand, { fontSize: 16 }),
      paragraphBlock('Ordini entro le 15:00, ricevi il giorno lavorativo successivo.', {
        size: 14,
        color: brand.muted,
        padding: spacing(0),
      }),
    ],
    [
      subtitleBlock('Compatibilità garantita', brand, { fontSize: 16 }),
      paragraphBlock('Se la cartuccia non è compatibile con la tua stampante, te la cambiamo.', {
        size: 14,
        color: brand.muted,
        padding: spacing(0),
      }),
    ],
    { name: 'Rassicurazioni', background: brand.background, padding: spacing(20, 24, 20, 24) },
  );
}

// -----------------------------------------------------------------------------
// I cinque template
// -----------------------------------------------------------------------------

function promoTonerDocument(brand: Brand): EmailDocument {
  return buildDocument([
    headerSection(brand, [
      { label: 'Toner', term: 'toner' },
      { label: 'Cartucce', term: 'cartucce' },
      { label: 'Carta', term: 'carta' },
      { label: 'Stampanti', term: 'stampanti' },
    ]),
    section(
      [
        heroImage(brand, 'Promo Toner', brand.primary, 'Offerta sui toner compatibili AlphaInk'),
        eyebrowBlock('Offerta della settimana', brand.secondary),
        titleBlock('Toner al giusto prezzo, {{contact.firstName}}', brand),
        paragraphBlock(
          'Abbiamo rifornito il magazzino dei toner più richiesti e abbiamo abbassato i prezzi. ' +
            'Stessa resa dell’originale, spesa dimezzata: la scelta di chi stampa ogni giorno.',
        ),
        buttonBlock('Scopri i toner in offerta', searchUrl(brand, 'toner'), brand),
      ],
      { name: 'Apertura', padding: spacing(8, 32, 8, 32) },
    ),
    section(
      [
        couponBlock(brand, {
          code: 'TONER10',
          discountLabel: '-10%',
          description: 'Inserisci il codice al momento del pagamento. Valido su tutti i toner in offerta.',
          ctaLabel: 'Usa il codice',
          term: 'toner',
        }),
      ],
      { name: 'Coupon', padding: spacing(0, 32, 0, 32) },
    ),
    section(
      [
        subtitleBlock('I più venduti questa settimana', brand),
        productGridBlock(
          brand,
          [
            {
              sku: 'TN-2420',
              name: 'Toner compatibile Brother TN-2420',
              price: 18.9,
              compareAtPrice: 26.9,
              term: 'TN-2420',
              imageLabel: 'TN-2420',
            },
            {
              sku: 'CF259A',
              name: 'Toner compatibile HP 59A CF259A',
              price: 32.5,
              compareAtPrice: 44,
              term: 'CF259A',
              imageLabel: 'CF259A',
            },
            {
              sku: 'TK-1170',
              name: 'Toner compatibile Kyocera TK-1170',
              price: 24.9,
              compareAtPrice: 33.5,
              term: 'TK-1170',
              imageLabel: 'TK-1170',
            },
          ],
          { columns: 3 },
        ),
        paragraphBlock(
          'Non trovi il modello della tua <strong>{{contact.printerModel}}</strong>? ' +
            'Cerca il codice della cartuccia sul catalogo: copriamo oltre 3.000 modelli.',
          { size: 14, color: brand.muted },
        ),
        buttonBlock('Vai al catalogo completo', brand.websiteUrl, brand, { color: brand.secondary }),
      ],
      { name: 'Prodotti', padding: spacing(8, 32, 8, 32) },
    ),
    trustSection(brand),
    footerSection(
      brand,
      'Ricevi questa email perché sei cliente ' +
        `${brand.companyName}. Rispondi pure a questo messaggio: ti risponde una persona vera.`,
    ),
  ]);
}

function novitaProdottiDocument(brand: Brand): EmailDocument {
  return buildDocument([
    headerSection(brand, [
      { label: 'Novità', term: 'novita' },
      { label: 'Stampanti', term: 'stampanti' },
      { label: 'Consumabili', term: 'toner' },
    ]),
    section(
      [
        eyebrowBlock('Nuovi arrivi', brand.primary),
        titleBlock('Le novità di questo mese', brand),
        paragraphBlock(
          'Ciao {{contact.firstName}}, abbiamo selezionato tre novità che valgono il tuo tempo: ' +
            'più resa, meno costo per pagina, disponibilità immediata a magazzino.',
        ),
        heroImage(brand, 'Novita AlphaInk', brand.text, 'Le novità del catalogo AlphaInk'),
      ],
      { name: 'Apertura', padding: spacing(8, 32, 8, 32) },
    ),
    section(
      [
        subtitleBlock('In evidenza', brand),
        productBlock(brand, {
          sku: 'ECO-XL-KIT',
          name: 'Kit multipack XL: 4 cartucce a colori',
          price: 39.9,
          compareAtPrice: 52,
          term: 'multipack XL',
          imageLabel: 'Multipack XL',
        }),
        productBlock(brand, {
          sku: 'HP-M404',
          name: 'Stampante laser HP LaserJet Pro M404dn',
          price: 249,
          term: 'M404dn',
          imageLabel: 'HP M404dn',
        }),
        productBlock(brand, {
          sku: 'CARTA-A4-PREM',
          name: 'Carta A4 premium 80 g — 5 risme',
          price: 21.9,
          compareAtPrice: 27.5,
          term: 'carta A4',
          imageLabel: 'Carta A4',
        }),
      ],
      { name: 'Prodotti', padding: spacing(8, 32, 0, 32) },
    ),
    section(
      [
        paragraphBlock(
          'Ogni prodotto è testato dal nostro laboratorio prima di entrare in catalogo: ' +
            'controlliamo resa, qualità di stampa e compatibilità con i firmware più recenti.',
          { size: 15, color: brand.muted },
        ),
        buttonBlock('Vedi tutte le novità', searchUrl(brand, 'novita'), brand),
      ],
      { name: 'Chiamata all\'azione', padding: spacing(0, 32, 8, 32) },
    ),
    footerSection(brand, 'Ti scriviamo una volta al mese, solo quando abbiamo qualcosa di utile da dire.'),
  ]);
}

function saldiStagionaliDocument(brand: Brand): EmailDocument {
  return buildDocument([
    headerSection(brand, [
      { label: 'Saldi', term: 'saldi' },
      { label: 'Toner', term: 'toner' },
      { label: 'Cartucce', term: 'cartucce' },
    ]),
    section(
      [
        heroImage(brand, 'SALDI', brand.secondary, 'Saldi stagionali AlphaInk'),
        eyebrowBlock('Saldi di stagione', brand.secondary),
        titleBlock('Fino al 40% su toner e cartucce', brand, { fontSize: 32, align: 'center' }),
        paragraphBlock(
          'Sconti veri su oltre 500 codici, fino a esaurimento scorte. ' +
            'Approfittane per fare scorta prima del rincaro di listino.',
          { align: 'center' },
        ),
        countdownBlock(brand, 'L’offerta scade tra', 14),
        buttonBlock('Entra nei saldi', searchUrl(brand, 'saldi'), brand, { color: brand.secondary }),
      ],
      { name: 'Apertura', padding: spacing(8, 32, 8, 32) },
    ),
    section(
      [
        couponBlock(brand, {
          code: 'SALDI15',
          discountLabel: '-15% extra',
          description: 'Sconto aggiuntivo sopra i 79 € di spesa. Cumulabile con i prezzi già ribassati.',
          ctaLabel: 'Approfitta ora',
          term: 'saldi',
        }),
      ],
      { name: 'Coupon', padding: spacing(0, 32, 0, 32) },
    ),
    section(
      [
        subtitleBlock('Le occasioni migliori', brand),
        productGridBlock(
          brand,
          [
            {
              sku: 'CE285A',
              name: 'Toner compatibile HP 85A CE285A',
              price: 14.9,
              compareAtPrice: 24.9,
              term: 'CE285A',
              imageLabel: '-40%',
            },
            {
              sku: 'T0715',
              name: 'Multipack cartucce Epson T0715',
              price: 16.9,
              compareAtPrice: 27.9,
              term: 'T0715',
              imageLabel: '-39%',
            },
          ],
          { columns: 2, imageColor: brand.secondary },
        ),
        paragraphBlock(
          'Le quantità sono limitate: quando un codice finisce, il prezzo torna quello di listino.',
          { size: 14, align: 'center', color: brand.muted },
        ),
      ],
      { name: 'Prodotti', padding: spacing(8, 32, 8, 32) },
    ),
    trustSection(brand),
    footerSection(brand),
  ]);
}

function informativaDocument(brand: Brand): EmailDocument {
  return buildDocument([
    headerSection(brand, [
      { label: 'Guide', term: 'guide' },
      { label: 'Assistenza', term: 'assistenza' },
      { label: 'Catalogo', term: 'catalogo' },
    ]),
    section(
      [
        eyebrowBlock('Dalla redazione AlphaInk', brand.primary),
        titleBlock('Come far durare di più le tue cartucce', brand),
        paragraphBlock(
          'Ciao {{contact.firstName}}, in questo numero rispondiamo alla domanda che ci fate più spesso: ' +
            'perché una cartuccia finisce prima del previsto e cosa si può fare per evitarlo.',
        ),
        bulletsBlock(
          [
            '<strong>Stampa in bozza</strong> per i documenti interni: riduce il consumo fino al 30%.',
            '<strong>Non spegnere la stampante dalla presa</strong>: il ciclo di pulizia delle testine riparte ad ogni riaccensione e consuma inchiostro.',
            '<strong>Stampa almeno una pagina a settimana</strong>: l’inchiostro fermo si secca negli ugelli.',
            '<strong>Conserva le cartucce di scorta</strong> nella confezione sigillata, lontano da fonti di calore.',
          ],
          brand,
        ),
        buttonBlock('Leggi la guida completa', `${brand.websiteUrl}/blog`, brand),
      ],
      { name: 'Articolo principale', padding: spacing(8, 32, 8, 32) },
    ),
    section(
      [
        dividerBlock(),
        subtitleBlock('Il consiglio del mese', brand),
        paragraphBlock(
          'Se la stampa esce sbiadita, prima di cambiare cartuccia prova un ciclo di pulizia delle testine ' +
            'dal pannello della stampante: nella maggior parte dei casi basta questo. ' +
            'Se il problema resta, scrivici: ti aiutiamo a capire se è la cartuccia o la stampante.',
        ),
        paragraphBlock(
          `Hai una domanda per il prossimo numero? Rispondi a questa email o scrivi a ` +
            `<a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a>.`,
          { size: 14, color: brand.muted },
        ),
      ],
      { name: 'Approfondimento', padding: spacing(0, 32, 8, 32) },
    ),
    section(
      [
        subtitleBlock('Prodotti citati in questo numero', brand, { fontSize: 18 }),
        productGridBlock(
          brand,
          [
            {
              sku: 'KIT-PULIZIA',
              name: 'Kit pulizia testine per stampanti a getto',
              price: 12.9,
              term: 'kit pulizia',
              imageLabel: 'Kit pulizia',
            },
            {
              sku: 'CARTA-A4-STD',
              name: 'Carta A4 80 g — risma da 500 fogli',
              price: 4.9,
              term: 'carta A4',
              imageLabel: 'Carta A4',
            },
          ],
          { columns: 2 },
        ),
      ],
      { name: 'Prodotti', padding: spacing(0, 32, 8, 32) },
    ),
    footerSection(brand, 'Questa è la newsletter informativa di AlphaInk: niente offerte, solo consigli utili.'),
  ]);
}

function offertaB2bDocument(brand: Brand): EmailDocument {
  const b2bUrl = brand.websiteUrl.includes('b2b.') ? brand.websiteUrl : brand.websiteUrl.replace('https://', 'https://b2b.');
  return buildDocument([
    headerSection(brand, [
      { label: 'Listino', term: 'listino' },
      { label: 'Toner', term: 'toner' },
      { label: 'Contatti', term: 'contatti' },
    ]),
    section(
      [
        eyebrowBlock('Riservato ai rivenditori', brand.primary),
        titleBlock('Condizioni dedicate per {{contact.company}}', brand, { fontSize: 28 }),
        paragraphBlock(
          'Buongiorno {{contact.firstName}}, abbiamo aggiornato il listino riservato ai rivenditori: ' +
            'margini più alti sui volumi e consegna in 24 ore su tutti i codici a magazzino.',
        ),
        bulletsBlock(
          [
            '<strong>Sconto scaglionato</strong>: -15% oltre 500 €, -22% oltre 1.500 €, -28% oltre 3.000 € di ordine.',
            '<strong>Pagamento a 30 giorni</strong> data fattura, previa apertura del fido commerciale.',
            '<strong>Spedizione gratuita</strong> sopra i 250 € di imponibile, in tutta Italia.',
            '<strong>Reso semplificato</strong> entro 30 giorni sui prodotti integri.',
          ],
          brand,
        ),
        buttonBlock('Richiedi il listino aggiornato', `${b2bUrl}/contattaci`, brand),
      ],
      { name: 'Apertura', padding: spacing(8, 32, 8, 32) },
    ),
    section(
      [
        subtitleBlock('I codici a più alta rotazione', brand),
        productGridBlock(
          brand,
          [
            {
              sku: 'TN-2420-B2B',
              name: 'Toner Brother TN-2420 — conf. 10 pz',
              price: 159,
              compareAtPrice: 189,
              term: 'TN-2420',
              imageLabel: 'Conf. 10 pz',
            },
            {
              sku: 'CF259A-B2B',
              name: 'Toner HP CF259A — conf. 10 pz',
              price: 289,
              compareAtPrice: 325,
              term: 'CF259A',
              imageLabel: 'Conf. 10 pz',
            },
            {
              sku: 'CARTA-PALLET',
              name: 'Carta A4 80 g — bancale 200 risme',
              price: 799,
              term: 'carta bancale',
              imageLabel: 'Bancale',
            },
          ],
          { columns: 3 },
        ),
      ],
      { name: 'Prodotti', padding: spacing(8, 32, 0, 32) },
    ),
    twoColumnSection(
      [
        subtitleBlock('Il tuo referente', brand, { fontSize: 16 }),
        paragraphBlock(
          `Per preventivi su misura scrivi a <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a>: ` +
            'ti rispondiamo entro mezza giornata lavorativa.',
          { size: 14, color: brand.muted, padding: spacing(0) },
        ),
      ],
      [
        subtitleBlock('Ordini ricorrenti', brand, { fontSize: 16 }),
        paragraphBlock(
          'Impostiamo insieme una fornitura programmata: tu non resti mai senza scorte, noi ti garantiamo il prezzo bloccato.',
          { size: 14, color: brand.muted, padding: spacing(0) },
        ),
      ],
      { name: 'Servizi', background: brand.background, padding: spacing(20, 24, 20, 24) },
    ),
    section([buttonBlock('Accedi all\'area rivenditori', b2bUrl, brand, { color: brand.text })], {
      name: 'Chiamata all\'azione',
      padding: spacing(8, 32, 0, 32),
    }),
    footerSection(
      brand,
      'Ricevi questa email perché sei un partner commerciale AlphaInk. Prezzi IVA esclusa.',
    ),
  ]);
}

// -----------------------------------------------------------------------------
// Catalogo
// -----------------------------------------------------------------------------

/** I cinque template di sistema, costruiti sull'identità visiva salvata. */
export function buildSystemTemplates(branding?: BrandingInput): SystemTemplate[] {
  const brand = resolveBrand(branding);

  return [
    {
      id: SYSTEM_TEMPLATE_IDS.promoToner,
      name: 'Promo Toner',
      description:
        'Campagna promozionale sui toner: apertura con immagine, codice sconto, tre prodotti in evidenza e rassicurazioni.',
      category: 'promozione',
      document: promoTonerDocument(brand),
      thumbnailUrl: null,
      isSystem: true,
      usageCount: 0,
      tags: ['toner', 'promozione', 'coupon'],
    },
    {
      id: SYSTEM_TEMPLATE_IDS.novitaProdotti,
      name: 'Novità Prodotti',
      description:
        'Presentazione dei nuovi arrivi: tre schede prodotto orizzontali con prezzo, prezzo barrato e link al catalogo.',
      category: 'novita',
      document: novitaProdottiDocument(brand),
      thumbnailUrl: null,
      isSystem: true,
      usageCount: 0,
      tags: ['novità', 'catalogo'],
    },
    {
      id: SYSTEM_TEMPLATE_IDS.saldiStagionali,
      name: 'Saldi Stagionali',
      description:
        'Campagna saldi con conto alla rovescia, coupon extra e griglia di occasioni. Ricordati di aggiornare la data di scadenza.',
      category: 'saldi',
      document: saldiStagionaliDocument(brand),
      thumbnailUrl: null,
      isSystem: true,
      usageCount: 0,
      tags: ['saldi', 'countdown', 'coupon'],
    },
    {
      id: SYSTEM_TEMPLATE_IDS.informativa,
      name: 'Newsletter Informativa',
      description:
        'Numero editoriale senza offerte: guida principale, consiglio del mese e due prodotti citati nell’articolo.',
      category: 'informativa',
      document: informativaDocument(brand),
      thumbnailUrl: null,
      isSystem: true,
      usageCount: 0,
      tags: ['contenuti', 'guida'],
    },
    {
      id: SYSTEM_TEMPLATE_IDS.offertaB2b,
      name: 'Offerta B2B Rivenditori',
      description:
        'Comunicazione per il canale rivenditori: scaglioni di sconto, codici ad alta rotazione e accesso all’area B2B.',
      category: 'b2b',
      document: offertaB2bDocument(brand),
      thumbnailUrl: null,
      isSystem: true,
      usageCount: 0,
      tags: ['b2b', 'rivenditori', 'listino'],
    },
  ];
}
