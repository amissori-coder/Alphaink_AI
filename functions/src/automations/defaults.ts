/**
 * Automazioni predefinite di AlphaInk.
 *
 * Qui vivono i **default**: contenuti, ritardi, condizioni di annullamento e
 * politiche coupon delle sei automazioni installate al primo avvio (le quattro
 * obbligatorie richieste dal cliente più benvenuto e win-back). Tutto è
 * modificabile dalla UI: questo file è solo il punto di partenza e ciò che
 * `resetAutomationToDefaults` ripristina.
 *
 * ## Il parametro "1440" del Riacquisto Toner e Cartucce
 *
 * Il cliente ha indicato "1440" senza unità di misura. Lo interpretiamo come
 * **1440 ore**, cioè 60 giorni: è il ciclo medio di consumo di un toner o di una
 * cartuccia in un ufficio (coerente con `DEFAULT_REPURCHASE_CYCLE_DAYS.toner`,
 * che vale appunto 60 giorni). Il valore NON è cablato: è un `Delay`
 * `{ value: 1440, unit: 'hours' }` modificabile dalla UI con il selettore di
 * unità (minuti / ore / giorni), così l'operatore può passare a "60 giorni" o a
 * qualsiasi altro ritmo senza toccare il codice.
 *
 * ## Come si legge il ritardo di uno step
 *
 * Il ritardo di uno step è sempre calcolato **dall'istante del trigger**, non
 * dallo step precedente (vedi `AutomationStep.delay`). Per le automazioni di
 * riacquisto l'istante del trigger è la data dell'ultimo ordine della famiglia:
 * "45 giorni" significa quindi "45 giorni dopo l'ultimo acquisto di carta".
 */

import {
  ALPHAINK_PALETTE,
  AUTOMATION_DESCRIPTIONS,
  AUTOMATION_LABELS,
  CORE_AUTOMATION_KEYS,
  DEFAULT_BRANDING,
  DEFAULT_HEADING_TYPOGRAPHY,
  DEFAULT_TIMEZONE,
  DEFAULT_TYPOGRAPHY,
  EMPTY_AUTOMATION_STATS,
  EMPTY_STEP_STATS,
  blockId,
  emptyDocument,
  spacing,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationKey,
  AutomationStep,
  BlockContent,
  BlockStyle,
  BrandingSettings,
  CouponPolicy,
  EmailBlock,
  EmailColumn,
  EmailDocument,
  EmailSection,
  ProductFamily,
  TextAlign,
  TypographyStyle,
} from '@alphaink/shared';

/** Automazione predefinita: come `Automation` ma senza id (lo assegna Firestore). */
export type DefaultAutomation = Omit<Automation, 'id'>;

/** Identità visiva accettata dai default: qualsiasi sottoinsieme del branding. */
export type BrandingInput = Partial<BrandingSettings> | null | undefined;

// -----------------------------------------------------------------------------
// Identità visiva
// -----------------------------------------------------------------------------

interface Brand {
  companyName: string;
  legalName: string;
  address: string;
  vatNumber: string;
  supportEmail: string;
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
  // Senza logo caricato si usa il nome azienda: l'email resta presentabile.
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

function eyebrowBlock(text: string, brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'text',
      html: text,
      typography: typography({
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 1.2,
        color: brand.primary,
        textTransform: 'uppercase',
      }),
    },
    { padding: spacing(0, 0, 8, 0) },
  );
}

function titleBlock(text: string, brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'heading',
      text,
      level: 1,
      typography: headingTypography({ fontSize: 28, color: brand.text }),
    },
    { padding: spacing(0, 0, 12, 0) },
  );
}

function paragraphBlock(html: string, options: { align?: TextAlign; size?: number; color?: string } = {}): EmailBlock {
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
    { padding: spacing(0, 0, 16, 0) },
  );
}

/** Elenco puntato: in email un `<ul>` inline è più affidabile di una tabella. */
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

function buttonBlock(label: string, href: string, brand: Brand, options: { color?: string } = {}): EmailBlock {
  return makeBlock(
    {
      type: 'button',
      label,
      href,
      trackClick: true,
      backgroundColor: options.color ?? brand.primary,
      textColor: '#FFFFFF',
      fontSize: 16,
      fontWeight: 700,
      paddingX: 28,
      paddingY: 14,
      borderRadius: 8,
      fullWidth: false,
      border: null,
    },
    { padding: spacing(4, 0, 20, 0), align: 'center' },
  );
}

interface CouponBlockSpec {
  discountLabel: string;
  description: string;
  codePrefix: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * Blocco coupon "dinamico": il codice non è nel documento, viene generato per
 * destinatario dal dispatcher e sostituito al posto di `{{coupon.code}}`.
 */
function couponBlock(spec: CouponBlockSpec, brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'coupon',
      code: null,
      dynamic: true,
      codePrefix: spec.codePrefix,
      discountLabel: spec.discountLabel,
      description: spec.description,
      expiresAt: null,
      backgroundColor: '#F8FAFC',
      textColor: brand.text,
      borderStyle: 'dashed',
      ctaLabel: spec.ctaLabel,
      ctaHref: spec.ctaHref,
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

function footerBlock(brand: Brand): EmailBlock {
  return makeBlock(
    {
      type: 'footer',
      companyName: brand.legalName,
      address: brand.address,
      vatLine: brand.vatNumber ? `P. IVA ${brand.vatNumber}` : undefined,
      extraHtml:
        `Hai bisogno di aiuto? Scrivici a <a href="mailto:${brand.supportEmail}">${brand.supportEmail}</a>` +
        ` oppure visita <a href="${brand.websiteUrl}">${brand.websiteUrl.replace(/^https?:\/\//, '')}</a>.`,
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
// Costruttori di sezioni e documenti
// -----------------------------------------------------------------------------

function column(blocks: EmailBlock[]): EmailColumn {
  return {
    id: blockId('colonna'),
    span: 12,
    blocks,
    verticalAlign: 'top',
    backgroundColor: null,
    padding: spacing(0),
  };
}

function section(
  blocks: EmailBlock[],
  options: { name?: string; background?: string | null; fullWidthBackground?: string | null; padding?: EmailSection['padding'] } = {},
): EmailSection {
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

function buildDocument(sections: EmailSection[]): EmailDocument {
  // `emptyDocument` porta versione e stili globali coerenti con l'editor:
  // sostituiamo soltanto le sezioni.
  const base = emptyDocument(blockId('sezione'), blockId('colonna'));
  return { ...base, sections };
}

interface EmailSpec {
  /** Etichetta breve sopra il titolo. */
  eyebrow: string;
  title: string;
  /** Paragrafi HTML (merge tag ammessi). */
  paragraphs: string[];
  bullets?: string[];
  coupon?: CouponBlockSpec;
  cta: { label: string; href: string; color?: string };
  /** Testo di chiusura sotto la CTA. */
  closing?: string;
}

/**
 * Documento email completo: intestazione con logo, corpo, chiusura di
 * servizio, footer legale e disiscrizione (obbligatoria per legge, senza la
 * quale il renderer blocca l'invio).
 */
function buildEmailDocument(spec: EmailSpec, brand: Brand): EmailDocument {
  const body: EmailBlock[] = [
    eyebrowBlock(spec.eyebrow, brand),
    titleBlock(spec.title, brand),
    ...spec.paragraphs.map((paragraph) => paragraphBlock(paragraph)),
  ];
  if (spec.bullets?.length) body.push(bulletsBlock(spec.bullets, brand));
  if (spec.coupon) body.push(couponBlock(spec.coupon, brand));
  body.push(buttonBlock(spec.cta.label, spec.cta.href, brand, { color: spec.cta.color }));
  if (spec.closing) {
    body.push(paragraphBlock(spec.closing, { size: 14, align: 'center', color: brand.muted }));
  }

  return buildDocument([
    section([logoBlock(brand), spacerBlock(8)], {
      name: 'Intestazione',
      padding: spacing(28, 32, 8, 32),
    }),
    section(body, { name: 'Contenuto', padding: spacing(8, 32, 20, 32) }),
    section(
      [
        dividerBlock(),
        paragraphBlock(
          `Ricevi questa email perché sei cliente ${brand.companyName}. ` +
            'Rispondi a questo messaggio se hai bisogno di assistenza: ti risponde una persona vera.',
          { size: 13, align: 'center', color: brand.muted },
        ),
        footerBlock(brand),
        unsubscribeBlock(brand),
      ],
      { name: 'Piè di pagina', fullWidthBackground: brand.background, padding: spacing(8, 32, 28, 32) },
    ),
  ]);
}

// -----------------------------------------------------------------------------
// Politiche coupon
// -----------------------------------------------------------------------------

function percentCoupon(options: {
  prefix: string;
  percent: number;
  validForDays: number;
  families?: ProductFamily[];
  minOrderTotal?: number | null;
  compatibleOnly?: boolean;
}): CouponPolicy {
  return {
    enabled: true,
    mode: 'unique_per_contact',
    sharedCode: null,
    prefix: options.prefix,
    discountType: 'percent',
    discountValue: options.percent,
    minOrderTotal: options.minOrderTotal ?? null,
    validForDays: options.validForDays,
    restrictToFamilies: options.families,
    restrictToCompatibleSkus: options.compatibleOnly ?? false,
    // I coupon nascono anche sul negozio: senza `cart_rule` il codice non
    // sarebbe spendibile al checkout PrestaShop.
    createOnSite: true,
  };
}

// -----------------------------------------------------------------------------
// Scheletro comune delle automazioni
// -----------------------------------------------------------------------------

interface AutomationSpec {
  key: AutomationKey;
  trigger: Automation['trigger'];
  steps: AutomationStep[];
  cooldownDays: number;
  maxPerContactPerYear?: number | null;
  allowedWeekdays: number[];
  maxSendsPerHour: number;
  description?: string;
}

function makeAutomation(spec: AutomationSpec, brand: Brand, now: string): DefaultAutomation {
  return {
    key: spec.key,
    name: AUTOMATION_LABELS[spec.key],
    description: spec.description ?? AUTOMATION_DESCRIPTIONS[spec.key],
    /**
     * Le automazioni nascono **spente**: prima del primo invio reale servono un
     * mittente verificato su Brevo e una revisione dei testi. Si attivano dalla
     * UI con `toggleAutomation`; `resetAutomationToDefaults` non le rispegne.
     */
    enabled: false,
    testMode: false,
    testRecipients: [],
    trigger: spec.trigger,
    steps: spec.steps,
    audienceFilter: null,
    excludeClusterIds: [],
    cooldownDays: spec.cooldownDays,
    maxPerContactPerYear: spec.maxPerContactPerYear ?? null,
    /** Nessuna email fra le 21:00 e le 08:00: gli invii notturni bruciano reputazione. */
    quietHours: { start: '21:00', end: '08:00' },
    allowedWeekdays: spec.allowedWeekdays,
    maxSendsPerHour: spec.maxSendsPerHour,
    timezone: DEFAULT_TIMEZONE,
    fromName: brand.companyName,
    fromEmail: brand.supportEmail,
    replyTo: brand.supportEmail,
    stats: { ...EMPTY_AUTOMATION_STATS },
    lastRunAt: null,
    lastErrorAt: null,
    lastError: null,
    isCore: CORE_AUTOMATION_KEYS.includes(spec.key),
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

function makeStep(
  id: string,
  spec: {
    name: string;
    delay: AutomationStep['delay'];
    subject: string;
    preheader: string;
    document: EmailDocument;
    cancelIf: AutomationStep['cancelIf'];
    coupon?: CouponPolicy | null;
    enabled?: boolean;
  },
): AutomationStep {
  return {
    id,
    name: spec.name,
    enabled: spec.enabled ?? true,
    delay: spec.delay,
    subject: spec.subject,
    preheader: spec.preheader,
    document: spec.document,
    templateId: null,
    cancelIf: spec.cancelIf,
    coupon: spec.coupon ?? null,
    stats: { ...EMPTY_STEP_STATS },
  };
}

// Giorni consentiti: lunedì-sabato per le promozionali, tutti per le
// transazionali (un pagamento in sospeso non aspetta il lunedì).
const WEEKDAYS_MON_SAT = [1, 2, 3, 4, 5, 6];
const WEEKDAYS_ALL = [0, 1, 2, 3, 4, 5, 6];

// -----------------------------------------------------------------------------
// 1. Coupon Stampante
// -----------------------------------------------------------------------------

function couponStampante(brand: Brand, now: string): DefaultAutomation {
  const consumabiliUrl = searchUrl(brand, 'consumabili compatibili');

  const step = makeStep('coupon-consumabili', {
    name: 'Coupon consumabili compatibili',
    // Tre giorni: il tempo di ricevere la stampante e provarla.
    delay: { value: 3, unit: 'days' },
    subject: 'Un 15% sui consumabili per la tua nuova stampante, {{contact.firstName}}',
    preheader: 'Il coupon dedicato ai consumabili compatibili con {{contact.printerBrand}} {{contact.printerModel}}.',
    cancelIf: ['contact_unsubscribed'],
    coupon: percentCoupon({
      prefix: 'STAMP',
      percent: 15,
      validForDays: 30,
      families: ['toner', 'cartucce', 'nastri'],
      compatibleOnly: true,
    }),
    document: buildEmailDocument(
      {
        eyebrow: 'Il tuo coupon dedicato',
        title: 'Grazie per aver scelto la tua nuova stampante',
        paragraphs: [
          'Ciao {{contact.firstName}}, con l\'ordine <strong>{{order.number}}</strong> hai acquistato ' +
            '<strong>{{order.firstProductName}}</strong>. Per iniziare col piede giusto ti regaliamo il ' +
            '<strong>15%</strong> sui consumabili compatibili con {{contact.printerBrand}} {{contact.printerModel}}.',
          'Usa il codice qui sotto al momento del checkout: lo abbiamo già collegato al tuo account, ' +
            'quindi ti basta inserirlo nel carrello.',
        ],
        bullets: [
          'Toner, cartucce e nastri <strong>compatibili con il modello che hai acquistato</strong>',
          'Spedizione tracciata in 24/48 ore in tutta Italia',
          'Assistenza tecnica gratuita per la configurazione',
        ],
        coupon: {
          discountLabel: '-15% sui consumabili',
          description: 'Valido fino al {{coupon.expiresAt}} su toner, cartucce e nastri compatibili.',
          codePrefix: 'STAMP-',
          ctaLabel: 'Applica il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Scopri i consumabili compatibili', href: consumabiliUrl },
        closing: 'Il coupon è nominale, utilizzabile una sola volta e scade il {{coupon.expiresAt}}.',
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'coupon_stampante',
      trigger: {
        type: 'order_placed',
        productFamilies: ['stampanti'],
        skuPatterns: [],
        categoryPaths: [],
        minOrderTotal: null,
        inactivityDays: null,
      },
      steps: [step],
      // Chi compra due stampanti a distanza di pochi mesi (uffici, rivenditori)
      // non deve ricevere due volte lo stesso coupon.
      cooldownDays: 120,
      maxPerContactPerYear: 4,
      allowedWeekdays: WEEKDAYS_MON_SAT,
      maxSendsPerHour: 300,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// 2. Pagamento Abbandonato
// -----------------------------------------------------------------------------

function pagamentoAbbandonato(brand: Brand, now: string): DefaultAutomation {
  const cancelIf: AutomationStep['cancelIf'] = ['order_completed', 'cart_recovered', 'contact_unsubscribed'];
  const recoveryHref = '{{order.recoveryUrl}}';

  const primo = makeStep('promemoria-1h', {
    name: 'Promemoria immediato (1 ora)',
    delay: { value: 1, unit: 'hours' },
    subject: 'Manca solo il pagamento per l\'ordine {{order.number}}',
    preheader: 'Il tuo carrello è al sicuro: completa il pagamento quando vuoi.',
    cancelIf,
    document: buildEmailDocument(
      {
        eyebrow: 'Ordine in sospeso',
        title: 'Manca solo un passaggio, {{contact.firstName}}',
        paragraphs: [
          'Abbiamo ricevuto il tuo ordine <strong>{{order.number}}</strong> del {{order.date}}, ' +
            'ma il pagamento non risulta ancora completato. Nessun problema: i prodotti restano ' +
            'riservati per te e puoi concludere in un paio di clic.',
          'Ecco che cosa hai scelto:',
          '{{order.itemsList}}',
          '<strong>Totale ordine: {{order.total}}</strong>',
        ],
        cta: { label: 'Completa il pagamento', href: recoveryHref },
        closing: 'Se hai avuto un problema durante il pagamento, rispondi a questa email: ti aiutiamo noi.',
      },
      brand,
    ),
  });

  const secondo = makeStep('promemoria-24h', {
    name: 'Secondo promemoria (24 ore)',
    delay: { value: 24, unit: 'hours' },
    subject: 'Il tuo ordine {{order.number}} ti aspetta ancora',
    preheader: 'Completa il pagamento e ricevi tutto in 24/48 ore.',
    cancelIf,
    document: buildEmailDocument(
      {
        eyebrow: 'Ancora in attesa',
        title: 'I prodotti sono ancora riservati per te',
        paragraphs: [
          'Ciao {{contact.firstName}}, l\'ordine <strong>{{order.number}}</strong> da {{order.total}} ' +
            'è rimasto in attesa di pagamento. Lo teniamo da parte ancora per poco.',
          '{{order.itemsList}}',
        ],
        bullets: [
          'Pagamento sicuro con carta, PayPal o bonifico',
          'Spedizione tracciata in 24/48 ore',
          'Reso gratuito entro 14 giorni',
        ],
        cta: { label: 'Riprendi l\'ordine', href: recoveryHref },
        closing: 'Hai cambiato idea? Ignora pure questa email: l\'ordine si annullerà da solo.',
      },
      brand,
    ),
  });

  const terzo = makeStep('ultimo-avviso-72h', {
    name: 'Ultimo promemoria con sconto (72 ore)',
    delay: { value: 72, unit: 'hours' },
    subject: 'Un 5% in più per concludere l\'ordine {{order.number}}',
    preheader: 'Ultimo promemoria: dopo di questo l\'ordine viene archiviato.',
    cancelIf,
    // Lo sconto arriva solo all'ultimo passaggio: offrirlo subito insegnerebbe
    // ai clienti ad abbandonare il checkout per ottenerlo.
    coupon: percentCoupon({ prefix: 'RIPRENDI', percent: 5, validForDays: 7 }),
    document: buildEmailDocument(
      {
        eyebrow: 'Ultimo promemoria',
        title: 'Concludiamo? Ci mettiamo un 5% in più',
        paragraphs: [
          'Ciao {{contact.firstName}}, l\'ordine <strong>{{order.number}}</strong> è ancora in sospeso. ' +
            'Per darti una mano ti lasciamo un piccolo sconto extra da usare subito.',
          '{{order.itemsList}}',
        ],
        coupon: {
          discountLabel: '-5% sul tuo ordine',
          description: 'Valido fino al {{coupon.expiresAt}} su tutto il catalogo.',
          codePrefix: 'RIPRENDI-',
          ctaLabel: 'Usa il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Completa l\'ordine', href: recoveryHref, color: brand.secondary },
        closing: 'Dopo questa email non ti scriveremo più a proposito di questo ordine.',
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'pagamento_abbandonato',
      trigger: {
        type: 'payment_abandoned',
        productFamilies: [],
        skuPatterns: [],
        categoryPaths: [],
        // Sotto i 10 € il recupero costa più del margine.
        minOrderTotal: 10,
        inactivityDays: null,
      },
      steps: [primo, secondo, terzo],
      cooldownDays: 3,
      maxPerContactPerYear: 24,
      allowedWeekdays: WEEKDAYS_ALL,
      maxSendsPerHour: 500,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// 3. Riacquisto Carta
// -----------------------------------------------------------------------------

function riacquistoCarta(brand: Brand, now: string): DefaultAutomation {
  const cancelIf: AutomationStep['cancelIf'] = ['repurchased', 'contact_unsubscribed'];
  const cartaUrl = searchUrl(brand, 'carta');

  const primo = makeStep('promemoria-carta', {
    name: 'Promemoria risme (45 giorni)',
    // 45 giorni dall'ultimo acquisto di carta: ciclo medio di una risma in ufficio.
    delay: { value: 45, unit: 'days' },
    subject: 'La carta sta per finire, {{contact.firstName}}?',
    preheader: 'Rifornisci l\'ufficio prima di restare a secco: consegna in 24/48 ore.',
    cancelIf,
    document: buildEmailDocument(
      {
        eyebrow: 'Promemoria rifornimento',
        title: 'È il momento di rifare scorta di carta',
        paragraphs: [
          'Ciao {{contact.firstName}}, dal tuo ultimo ordine di carta ({{contact.lastOrderDate}}) ' +
            'sono passate circa sei settimane: nella media di un ufficio è il momento in cui la risma finisce.',
          'Ordina adesso e ricevi tutto in 24/48 ore, senza interrompere il lavoro.',
        ],
        bullets: [
          'Risme A4 e A3 delle migliori marche, anche in cartoni da 5',
          'Carta riciclata e certificata FSC per chi cerca soluzioni sostenibili',
          'Prezzi a scalare sulle quantità: più prendi, meno paghi',
        ],
        cta: { label: 'Ordina la carta', href: cartaUrl },
        closing: 'Hai già rifornito il magazzino? Ignora pure questo promemoria.',
      },
      brand,
    ),
  });

  const secondo = makeStep('recupero-carta', {
    name: 'Recupero con sconto (60 giorni)',
    delay: { value: 60, unit: 'days' },
    subject: 'Un 5% sulla carta, solo per questa settimana',
    preheader: 'Ultimo promemoria sul rifornimento di carta.',
    cancelIf,
    coupon: percentCoupon({ prefix: 'CARTA', percent: 5, validForDays: 14, families: ['carta'] }),
    document: buildEmailDocument(
      {
        eyebrow: 'Ultimo promemoria',
        title: 'Un piccolo sconto sul tuo prossimo ordine di carta',
        paragraphs: [
          'Ciao {{contact.firstName}}, non vorremmo lasciarti senza carta proprio nel momento sbagliato. ' +
            'Ecco un 5% da usare sulle risme entro il {{coupon.expiresAt}}.',
        ],
        coupon: {
          discountLabel: '-5% su tutta la carta',
          description: 'Valido fino al {{coupon.expiresAt}} su risme e cartoni.',
          codePrefix: 'CARTA-',
          ctaLabel: 'Usa il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Scegli le risme', href: cartaUrl },
        closing: 'Il codice è personale e utilizzabile una sola volta.',
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'riacquisto_carta',
      trigger: {
        type: 'repurchase_due',
        productFamilies: ['carta'],
        skuPatterns: [],
        categoryPaths: [],
        minOrderTotal: null,
        inactivityDays: null,
      },
      steps: [primo, secondo],
      cooldownDays: 30,
      maxPerContactPerYear: 8,
      allowedWeekdays: WEEKDAYS_MON_SAT,
      maxSendsPerHour: 300,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// 4. Riacquisto Toner e Cartucce
// -----------------------------------------------------------------------------

function riacquistoTonerCartucce(brand: Brand, now: string): DefaultAutomation {
  const cancelIf: AutomationStep['cancelIf'] = ['repurchased', 'contact_unsubscribed'];
  const consumabiliUrl = searchUrl(brand, 'toner cartucce');

  const primo = makeStep('promemoria-consumabili', {
    name: 'Promemoria consumabili (1440 ore)',
    /**
     * 1440 ore = 60 giorni: è il "1440" indicato dal cliente, tradotto in ore
     * per poterlo affinare dalla UI (es. 1200 ore per chi stampa molto).
     */
    delay: { value: 1440, unit: 'hours' },
    subject: 'Il toner sta per finire, {{contact.firstName}}?',
    preheader: 'Rifornisci {{contact.printerBrand}} {{contact.printerModel}} prima che si fermi.',
    cancelIf,
    document: buildEmailDocument(
      {
        eyebrow: 'Promemoria rifornimento',
        title: 'È il momento di ricaricare la stampante',
        paragraphs: [
          'Ciao {{contact.firstName}}, dal tuo ultimo ordine di consumabili ({{contact.lastOrderDate}}) ' +
            'sono passati circa 60 giorni: è il ciclo medio di un toner o di una cartuccia.',
          'Ordina adesso il ricambio compatibile con <strong>{{contact.printerBrand}} {{contact.printerModel}}</strong> ' +
            'e non rischi di trovarti la stampante ferma nel giorno peggiore.',
        ],
        bullets: [
          'Originali e compatibili garantiti, con resa dichiarata in pagine',
          'Spedizione tracciata in 24/48 ore',
          'Ritiro gratuito delle cartucce esauste',
        ],
        cta: { label: 'Ordina toner e cartucce', href: consumabiliUrl },
        closing: 'Hai già fatto scorta? Ignora pure questo promemoria.',
      },
      brand,
    ),
  });

  const secondo = makeStep('recupero-consumabili', {
    name: 'Recupero con sconto (1560 ore)',
    // 1560 ore = 65 giorni: cinque giorni dopo il primo promemoria.
    delay: { value: 1560, unit: 'hours' },
    subject: 'Un 10% su toner e cartucce, fino al {{coupon.expiresAt}}',
    preheader: 'Ultimo promemoria sul rifornimento dei consumabili.',
    cancelIf,
    coupon: percentCoupon({
      prefix: 'RICARICA',
      percent: 10,
      validForDays: 14,
      families: ['toner', 'cartucce'],
      compatibleOnly: true,
    }),
    document: buildEmailDocument(
      {
        eyebrow: 'Ultimo promemoria',
        title: 'Un 10% sul tuo prossimo toner',
        paragraphs: [
          'Ciao {{contact.firstName}}, ti lasciamo uno sconto dedicato sui consumabili compatibili con ' +
            '<strong>{{contact.printerBrand}} {{contact.printerModel}}</strong>. Valido fino al {{coupon.expiresAt}}.',
        ],
        coupon: {
          discountLabel: '-10% su toner e cartucce',
          description: 'Valido fino al {{coupon.expiresAt}} sui consumabili compatibili.',
          codePrefix: 'RICARICA-',
          ctaLabel: 'Usa il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Scegli il consumabile', href: consumabiliUrl },
        closing: 'Il codice è personale e utilizzabile una sola volta.',
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'riacquisto_toner_cartucce',
      trigger: {
        type: 'repurchase_due',
        productFamilies: ['toner', 'cartucce'],
        skuPatterns: [],
        categoryPaths: [],
        minOrderTotal: null,
        inactivityDays: null,
      },
      steps: [primo, secondo],
      cooldownDays: 30,
      maxPerContactPerYear: 8,
      allowedWeekdays: WEEKDAYS_MON_SAT,
      maxSendsPerHour: 300,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// 5. Benvenuto
// -----------------------------------------------------------------------------

function benvenuto(brand: Brand, now: string): DefaultAutomation {
  const primo = makeStep('benvenuto-subito', {
    name: 'Email di benvenuto',
    delay: { value: 15, unit: 'minutes' },
    subject: 'Benvenuto in {{company.name}}, ecco il tuo 10%',
    preheader: 'Un codice sconto per il tuo primo ordine.',
    cancelIf: ['contact_unsubscribed'],
    coupon: percentCoupon({ prefix: 'BENVENUTO', percent: 10, validForDays: 30, minOrderTotal: 25 }),
    document: buildEmailDocument(
      {
        eyebrow: 'Benvenuto',
        title: 'Grazie per esserti iscritto, {{contact.firstName}}',
        paragraphs: [
          'Da oggi ricevi consigli pratici su stampa, consumabili e risparmio, senza inondarti di email: ' +
            'scriviamo solo quando abbiamo qualcosa di utile da dirti.',
          'Per iniziare, ecco un 10% sul tuo primo ordine sopra i 25 €.',
        ],
        coupon: {
          discountLabel: '-10% sul primo ordine',
          description: 'Spesa minima 25 €. Valido fino al {{coupon.expiresAt}}.',
          codePrefix: 'BENVENUTO-',
          ctaLabel: 'Usa il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Scopri il catalogo', href: brand.websiteUrl },
        closing: 'Cerchi un consumabile per un modello preciso? Rispondi a questa email e lo troviamo per te.',
      },
      brand,
    ),
  });

  const secondo = makeStep('benvenuto-guida', {
    name: 'Guida alla scelta (7 giorni)',
    delay: { value: 7, unit: 'days' },
    subject: 'Originale o compatibile? La guida in 2 minuti',
    preheader: 'Come scegliere il consumabile giusto senza rovinare la stampante.',
    cancelIf: ['contact_unsubscribed'],
    document: buildEmailDocument(
      {
        eyebrow: 'Guida pratica',
        title: 'Originale o compatibile: come scegliere',
        paragraphs: [
          'Ciao {{contact.firstName}}, la domanda che ci fanno più spesso è se un consumabile compatibile ' +
            'possa danneggiare la stampante. La risposta breve è no, se è certificato e con chip aggiornato.',
          'Ecco i tre criteri che usiamo per selezionare i prodotti a catalogo:',
        ],
        bullets: [
          '<strong>Resa dichiarata</strong>: il numero di pagine è misurato secondo la norma ISO/IEC',
          '<strong>Chip aggiornato</strong>: il livello di inchiostro viene letto correttamente dalla stampante',
          '<strong>Garanzia</strong>: se il prodotto non funziona, lo sostituiamo senza discutere',
        ],
        cta: { label: 'Trova il consumabile per la tua stampante', href: searchUrl(brand, 'consumabili') },
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'benvenuto',
      trigger: {
        type: 'contact_subscribed',
        productFamilies: [],
        skuPatterns: [],
        categoryPaths: [],
        minOrderTotal: null,
        inactivityDays: null,
      },
      steps: [primo, secondo],
      cooldownDays: 365,
      maxPerContactPerYear: 2,
      allowedWeekdays: WEEKDAYS_ALL,
      maxSendsPerHour: 500,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// 6. Win-back
// -----------------------------------------------------------------------------

function winBack(brand: Brand, now: string): DefaultAutomation {
  const cancelIf: AutomationStep['cancelIf'] = ['contact_purchased_any', 'contact_unsubscribed'];

  const primo = makeStep('winback-promemoria', {
    name: 'Ci manchi',
    delay: { value: 0, unit: 'days' },
    subject: 'Ci manchi, {{contact.firstName}}',
    preheader: 'Sei mesi senza ordini: c\'è qualcosa che possiamo fare meglio?',
    cancelIf,
    document: buildEmailDocument(
      {
        eyebrow: 'Da un po\' non ci vediamo',
        title: 'Tutto bene con la tua stampante?',
        paragraphs: [
          'Ciao {{contact.firstName}}, il tuo ultimo ordine risale al {{contact.lastOrderDate}}. ' +
            'Se hai trovato di meglio ci dispiace, ma ci farebbe piacere sapere perché: rispondi pure a questa email.',
          'Nel frattempo abbiamo ampliato il catalogo e ridotto i tempi di consegna a 24/48 ore.',
        ],
        cta: { label: 'Dai un\'occhiata alle novità', href: brand.websiteUrl },
      },
      brand,
    ),
  });

  const secondo = makeStep('winback-sconto', {
    name: 'Offerta di rientro (10 giorni)',
    delay: { value: 10, unit: 'days' },
    subject: 'Un 10% per tornare a stampare con noi',
    preheader: 'Codice valido fino al {{coupon.expiresAt}}.',
    cancelIf,
    coupon: percentCoupon({ prefix: 'RITORNO', percent: 10, validForDays: 21, minOrderTotal: 30 }),
    document: buildEmailDocument(
      {
        eyebrow: 'Bentornato',
        title: 'Un 10% per il tuo rientro',
        paragraphs: [
          'Ciao {{contact.firstName}}, ci proviamo con un incentivo concreto: 10% su tutto il catalogo, ' +
            'spesa minima 30 €, valido fino al {{coupon.expiresAt}}.',
        ],
        coupon: {
          discountLabel: '-10% su tutto',
          description: 'Spesa minima 30 €. Valido fino al {{coupon.expiresAt}}.',
          codePrefix: 'RITORNO-',
          ctaLabel: 'Usa il coupon',
          ctaHref: '{{coupon.url}}',
        },
        cta: { label: 'Torna a fare scorta', href: brand.websiteUrl, color: brand.secondary },
        closing: 'Se preferisci non ricevere più queste email puoi disiscriverti qui sotto: nessun rancore.',
      },
      brand,
    ),
  });

  return makeAutomation(
    {
      key: 'win_back',
      trigger: {
        type: 'inactivity',
        productFamilies: [],
        skuPatterns: [],
        categoryPaths: [],
        minOrderTotal: null,
        inactivityDays: 180,
      },
      steps: [primo, secondo],
      cooldownDays: 365,
      maxPerContactPerYear: 2,
      allowedWeekdays: WEEKDAYS_MON_SAT,
      maxSendsPerHour: 200,
    },
    brand,
    now,
  );
}

// -----------------------------------------------------------------------------
// API pubblica
// -----------------------------------------------------------------------------

/**
 * Costruisce le automazioni predefinite con l'identità visiva corrente.
 *
 * L'ordine è quello mostrato in UI: prima le quattro obbligatorie richieste da
 * AlphaInk, poi benvenuto e win-back.
 */
export function buildDefaultAutomations(branding?: BrandingInput): DefaultAutomation[] {
  const brand = resolveBrand(branding);
  const now = new Date().toISOString();
  return [
    couponStampante(brand, now),
    pagamentoAbbandonato(brand, now),
    riacquistoCarta(brand, now),
    riacquistoTonerCartucce(brand, now),
    benvenuto(brand, now),
    winBack(brand, now),
  ];
}

/** Automazione predefinita di una singola chiave, o `null` se non prevista. */
export function buildDefaultAutomation(
  key: AutomationKey,
  branding?: BrandingInput,
): DefaultAutomation | null {
  return buildDefaultAutomations(branding).find((automation) => automation.key === key) ?? null;
}

/** Chiavi coperte dai default (`compleanno_cliente` non ha ancora un contenuto). */
export const DEFAULT_AUTOMATION_KEYS: AutomationKey[] = [
  'coupon_stampante',
  'pagamento_abbandonato',
  'riacquisto_carta',
  'riacquisto_toner_cartucce',
  'benvenuto',
  'win_back',
];
