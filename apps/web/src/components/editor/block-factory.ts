/**
 * Fabbrica dei blocchi e delle sezioni dell'editor.
 *
 * Ogni nuovo elemento nasce già completo e coerente con la palette AlphaInk:
 * l'utente trascina un blocco e vede subito qualcosa di presentabile, senza
 * dover compilare un modulo prima di capire dove finirà.
 *
 * I valori qui dentro rispettano i vincoli di `emailDocumentSchema`: colori
 * esadecimali, spaziature fra 0 e 200, span di colonna fra 1 e 12.
 */

import {
  ALPHAINK_PALETTE,
  DEFAULT_CURRENCY,
  DEFAULT_HEADING_TYPOGRAPHY,
  DEFAULT_TYPOGRAPHY,
  FONT_STACK_BODY,
  blockId as newBlockId,
  randomId,
  spacing,
} from '@alphaink/shared';
import type {
  BlockContent,
  BlockType,
  EmailBlock,
  EmailColumn,
  EmailSection,
  TypographyStyle,
} from '@alphaink/shared';

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

function typography(patch: Partial<TypographyStyle> = {}): TypographyStyle {
  return { ...DEFAULT_TYPOGRAPHY, ...patch };
}

function headingTypography(patch: Partial<TypographyStyle> = {}): TypographyStyle {
  return { ...DEFAULT_HEADING_TYPOGRAPHY, ...patch };
}

/** Data ISO fra `days` giorni, usata dai default di countdown e coupon. */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

function makeColumn(span = 12, blocks: EmailBlock[] = []): EmailColumn {
  return {
    id: `col_${randomId(8)}`,
    span,
    blocks,
    verticalAlign: 'top',
    backgroundColor: null,
    padding: spacing(0),
  };
}

// -----------------------------------------------------------------------------
// Contenuti predefiniti
// -----------------------------------------------------------------------------

/** Contenuto di un blocco prodotto, discriminante incluso. */
type ProductContent = Extract<BlockContent, { type: 'product' }>;

function placeholderProduct(name: string, price: number, compareAt: number | null): ProductContent {
  return {
    type: 'product',
    sku: '',
    name,
    imageUrl: '',
    price,
    compareAtPrice: compareAt,
    currency: DEFAULT_CURRENCY,
    url: 'https://alphaink.net',
    ctaLabel: 'Acquista ora',
    showPrice: true,
    showDiscountBadge: true,
    layout: 'horizontal',
  };
}

/** Contenuto iniziale di ciascun tipo di blocco. */
export function defaultContent(type: BlockType): BlockContent {
  switch (type) {
    case 'text':
      return {
        type: 'text',
        html:
          '<p>Racconta qui la tua novità: poche righe chiare, un vantaggio concreto ' +
          'e un invito ad agire. Puoi usare i merge tag come {{contact.firstName}} ' +
          'per parlare al cliente per nome.</p>',
        typography: typography(),
      };

    case 'heading':
      return {
        type: 'heading',
        text: 'Un titolo che cattura l’attenzione',
        level: 2,
        typography: headingTypography({ fontSize: 26 }),
      };

    case 'image':
      return {
        type: 'image',
        src: '',
        storagePath: null,
        alt: '',
        width: null,
        href: null,
        trackClick: true,
        borderRadius: 8,
      };

    case 'button':
      return {
        type: 'button',
        label: 'Scopri l’offerta',
        href: 'https://alphaink.net',
        trackClick: true,
        backgroundColor: ALPHAINK_PALETTE.cyan,
        textColor: '#FFFFFF',
        fontSize: 16,
        fontWeight: 700,
        paddingX: 26,
        paddingY: 14,
        borderRadius: 8,
        fullWidth: false,
        border: null,
      };

    case 'divider':
      return {
        type: 'divider',
        color: ALPHAINK_PALETTE.border,
        thickness: 1,
        style: 'solid',
        widthPercent: 100,
      };

    case 'spacer':
      return { type: 'spacer', height: 24 };

    case 'social':
      return {
        type: 'social',
        items: [
          { network: 'facebook', url: 'https://facebook.com/' },
          { network: 'instagram', url: 'https://instagram.com/' },
          { network: 'linkedin', url: 'https://linkedin.com/' },
        ],
        iconSize: 28,
        iconStyle: 'color',
        spacing: 10,
      };

    case 'video':
      return {
        type: 'video',
        url: '',
        thumbnailUrl: '',
        alt: 'Guarda il video',
        showPlayIcon: true,
      };

    case 'html':
      return {
        type: 'html',
        html: '<!-- Incolla qui il tuo HTML. Script e tag non sicuri vengono rimossi. -->',
      };

    case 'product':
      return placeholderProduct('Toner compatibile ad alta capacità', 24.9, 34.9);

    case 'product_grid':
      return {
        type: 'product_grid',
        products: [
          { ...placeholderProduct('Toner nero XL', 24.9, 34.9), layout: 'vertical' },
          { ...placeholderProduct('Cartuccia colore', 18.5, null), layout: 'vertical' },
          { ...placeholderProduct('Risma carta A4', 4.9, 6.5), layout: 'vertical' },
        ],
        columns: 3,
        dynamicSource: null,
      };

    case 'coupon':
      return {
        type: 'coupon',
        code: 'ALPHA10',
        dynamic: false,
        codePrefix: 'ALPHA',
        discountLabel: '10% di sconto sul prossimo ordine',
        description: 'Usa il codice al checkout su alphaink.net.',
        expiresAt: inDays(14),
        backgroundColor: '#F8FAFC',
        textColor: ALPHAINK_PALETTE.key,
        borderStyle: 'dashed',
        ctaLabel: 'Usa il coupon',
        ctaHref: 'https://alphaink.net',
      };

    case 'countdown':
      return {
        type: 'countdown',
        endsAt: inDays(7),
        label: 'L’offerta scade fra',
        showDays: true,
        showHours: true,
        accentColor: ALPHAINK_PALETTE.magenta,
      };

    case 'menu':
      return {
        type: 'menu',
        items: [
          { label: 'Toner', href: 'https://alphaink.net' },
          { label: 'Cartucce', href: 'https://alphaink.net' },
          { label: 'Carta', href: 'https://alphaink.net' },
          { label: 'Offerte', href: 'https://alphaink.net' },
        ],
        typography: typography({ fontSize: 14, fontWeight: 600, align: 'center', color: ALPHAINK_PALETTE.slate }),
        separator: '·',
      };

    case 'footer':
      return {
        type: 'footer',
        companyName: 'AlphaInk',
        address: 'Alphaink S.r.l. — Italia',
        vatLine: '',
        extraHtml: '',
        typography: typography({ fontSize: 12, lineHeight: 1.6, align: 'center', color: ALPHAINK_PALETTE.muted }),
      };

    case 'unsubscribe':
      return {
        type: 'unsubscribe',
        text: 'Ricevi questa email perché sei iscritto agli aggiornamenti di AlphaInk.',
        linkLabel: 'Disiscriviti',
        showPreferencesLink: true,
        preferencesLabel: 'Gestisci le preferenze',
        typography: typography({ fontSize: 12, lineHeight: 1.6, align: 'center', color: ALPHAINK_PALETTE.muted }),
      };

    default: {
      // Tipo sconosciuto: si ripiega su un testo, così nulla va perso.
      return { type: 'text', html: '<p></p>', typography: typography() };
    }
  }
}

/** Padding iniziale per tipo: i blocchi "di servizio" respirano meno. */
function defaultPadding(type: BlockType) {
  switch (type) {
    case 'spacer':
      return spacing(0);
    case 'divider':
      return spacing(8, 0, 8, 0);
    case 'image':
    case 'video':
      return spacing(0);
    case 'footer':
    case 'unsubscribe':
      return spacing(6, 0, 6, 0);
    case 'coupon':
    case 'product_grid':
      return spacing(12, 0, 12, 0);
    default:
      return spacing(10, 0, 10, 0);
  }
}

function defaultAlign(type: BlockType): 'left' | 'center' {
  return type === 'button' || type === 'social' || type === 'countdown' || type === 'menu'
    ? 'center'
    : 'left';
}

/** Crea un blocco pronto all'uso. */
export function createBlock(type: BlockType, overrides: Partial<EmailBlock> = {}): EmailBlock {
  return {
    id: newBlockId(type),
    type,
    content: defaultContent(type),
    style: {
      padding: defaultPadding(type),
      backgroundColor: null,
      border: null,
      align: defaultAlign(type),
      hideOnMobile: false,
      hideOnDesktop: false,
    },
    visibilityRule: null,
    locked: false,
    ...overrides,
  };
}

/** Crea una sezione, opzionalmente con più colonne e blocchi già dentro. */
export function createSection(options: {
  spans?: number[];
  blocks?: EmailBlock[][];
  patch?: Partial<EmailSection>;
} = {}): EmailSection {
  const spans = options.spans?.length ? options.spans : [12];
  const columns = spans.map((span, index) => makeColumn(span, options.blocks?.[index] ?? []));
  return {
    id: `sez_${randomId(8)}`,
    columns,
    fullWidthBackgroundColor: null,
    backgroundColor: null,
    backgroundImage: null,
    padding: spacing(24, 24, 24, 24),
    stackOnMobile: true,
    reverseOnMobile: false,
    border: null,
    ...options.patch,
  };
}

// -----------------------------------------------------------------------------
// Sezioni pronte
// -----------------------------------------------------------------------------

export type PresetSectionId =
  | 'hero'
  | 'testo_immagine'
  | 'prodotto'
  | 'griglia_prodotti'
  | 'coupon'
  | 'footer';

export interface PresetSection {
  id: PresetSectionId;
  label: string;
  description: string;
  /** Struttura schematica mostrata nell'anteprima della galleria. */
  layout: Array<{ rows: Array<'image' | 'title' | 'text' | 'button' | 'chip' | 'line'> }>;
  build: () => EmailSection;
}

/** Galleria delle sezioni pronte, inseribili con un clic. */
export const PRESET_SECTIONS: PresetSection[] = [
  {
    id: 'hero',
    label: 'Copertina',
    description: 'Immagine grande, titolo, testo e pulsante: l’apertura classica di una campagna.',
    layout: [{ rows: ['image', 'title', 'text', 'button'] }],
    build: () =>
      createSection({
        spans: [12],
        blocks: [
          [
            createBlock('image', {
              content: {
                ...(defaultContent('image') as Extract<BlockContent, { type: 'image' }>),
                alt: 'Immagine di copertina',
                borderRadius: 10,
              },
            }),
            createBlock('heading', {
              content: {
                type: 'heading',
                text: 'Ciao {{contact.firstName}}, le nuove offerte sono online',
                level: 1,
                typography: headingTypography({ fontSize: 30, align: 'center' }),
              },
              style: {
                padding: spacing(18, 0, 6, 0),
                backgroundColor: null,
                border: null,
                align: 'center',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
            createBlock('text', {
              content: {
                type: 'text',
                html:
                  '<p>Toner e cartucce compatibili per la tua stampante, con spedizione ' +
                  'in 24 ore e garanzia di rimborso.</p>',
                typography: typography({ align: 'center', color: ALPHAINK_PALETTE.slate }),
              },
              style: {
                padding: spacing(0, 12, 16, 12),
                backgroundColor: null,
                border: null,
                align: 'center',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
            createBlock('button'),
          ],
        ],
      }),
  },
  {
    id: 'testo_immagine',
    label: 'Testo e immagine',
    description: 'Due colonne affiancate che si impilano su mobile.',
    layout: [{ rows: ['title', 'text', 'button'] }, { rows: ['image'] }],
    build: () =>
      createSection({
        spans: [7, 5],
        blocks: [
          [
            createBlock('heading', {
              content: {
                type: 'heading',
                text: 'La cartuccia giusta, al primo colpo',
                level: 3,
                typography: headingTypography({ fontSize: 22 }),
              },
            }),
            createBlock('text', {
              content: {
                type: 'text',
                html:
                  '<p>Abbiamo selezionato i consumabili compatibili con ' +
                  '<strong>{{contact.printerModel}}</strong>: qualità originale, prezzo AlphaInk.</p>',
                typography: typography({ fontSize: 15, color: ALPHAINK_PALETTE.slate }),
              },
            }),
            createBlock('button', {
              style: {
                padding: spacing(6, 0, 0, 0),
                backgroundColor: null,
                border: null,
                align: 'left',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
          ],
          [
            createBlock('image', {
              content: {
                ...(defaultContent('image') as Extract<BlockContent, { type: 'image' }>),
                alt: 'Prodotto in evidenza',
              },
            }),
          ],
        ],
      }),
  },
  {
    id: 'prodotto',
    label: 'Prodotto singolo',
    description: 'Scheda con immagine, nome, prezzo, sconto e pulsante d’acquisto.',
    layout: [{ rows: ['title', 'image', 'text', 'button'] }],
    build: () =>
      createSection({
        spans: [12],
        blocks: [
          [
            createBlock('heading', {
              content: {
                type: 'heading',
                text: 'In evidenza questa settimana',
                level: 3,
                typography: headingTypography({ fontSize: 20 }),
              },
            }),
            createBlock('product'),
          ],
        ],
      }),
  },
  {
    id: 'griglia_prodotti',
    label: 'Griglia 3 prodotti',
    description: 'Tre schede affiancate, perfette per i più venduti.',
    layout: [{ rows: ['image', 'text'] }, { rows: ['image', 'text'] }, { rows: ['image', 'text'] }],
    build: () =>
      createSection({
        spans: [12],
        blocks: [
          [
            createBlock('heading', {
              content: {
                type: 'heading',
                text: 'I più venduti del mese',
                level: 3,
                typography: headingTypography({ fontSize: 20, align: 'center' }),
              },
              style: {
                padding: spacing(0, 0, 12, 0),
                backgroundColor: null,
                border: null,
                align: 'center',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
            createBlock('product_grid'),
          ],
        ],
      }),
  },
  {
    id: 'coupon',
    label: 'Coupon',
    description: 'Codice sconto in evidenza con scadenza e conto alla rovescia.',
    layout: [{ rows: ['chip', 'title', 'button'] }],
    build: () =>
      createSection({
        spans: [12],
        patch: { backgroundColor: '#F8FAFC' },
        blocks: [
          [
            createBlock('coupon'),
            createBlock('countdown', {
              style: {
                padding: spacing(14, 0, 0, 0),
                backgroundColor: null,
                border: null,
                align: 'center',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
          ],
        ],
      }),
  },
  {
    id: 'footer',
    label: 'Piè di pagina',
    description: 'Social, menu, dati aziendali e link di disiscrizione: sempre a norma.',
    layout: [{ rows: ['chip', 'line', 'text', 'text'] }],
    build: () =>
      createSection({
        spans: [12],
        patch: {
          backgroundColor: '#F1F5F9',
          padding: spacing(28, 24, 28, 24),
        },
        blocks: [
          [
            createBlock('social'),
            createBlock('menu'),
            createBlock('divider', {
              style: {
                padding: spacing(12, 0, 12, 0),
                backgroundColor: null,
                border: null,
                align: 'center',
                hideOnMobile: false,
                hideOnDesktop: false,
              },
            }),
            createBlock('footer'),
            createBlock('unsubscribe'),
          ],
        ],
      }),
  },
];

/** Sezione pronta cercata per identificatore. */
export function presetSectionById(id: PresetSectionId): PresetSection | undefined {
  return PRESET_SECTIONS.find((preset) => preset.id === id);
}
