import { z } from 'zod';

// -----------------------------------------------------------------------------
// Schemi di validazione condivisi. Usati dai form della web app (react-hook-form)
// e dalle Cloud Functions per validare gli input delle callable.
// -----------------------------------------------------------------------------

export const isoDateSchema = z.string().datetime({ offset: true });
export const emailSchema = z.string().trim().toLowerCase().email('Indirizzo email non valido');
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Colore non valido');

export const spacingSchema = z.object({
  top: z.number().min(0).max(200),
  right: z.number().min(0).max(200),
  bottom: z.number().min(0).max(200),
  left: z.number().min(0).max(200),
});

export const delayUnitSchema = z.enum(['minutes', 'hours', 'days']);
export const delaySchema = z.object({
  value: z.number().int().min(0).max(100_000),
  unit: delayUnitSchema,
});

export const quietHoursSchema = z
  .object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato orario HH:mm'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato orario HH:mm'),
  })
  .nullable();

// --- Cluster ----------------------------------------------------------------

export const filterOperatorSchema = z.enum([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains',
  'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty',
  'within_last_days', 'before_last_days', 'between',
]);

export const filterValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.null(),
  z.array(z.union([z.string(), z.number()])),
]);

export const filterConditionSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: filterValueSchema,
  value2: filterValueSchema.optional(),
  attributeKey: z.string().optional(),
});

export type FilterGroupInput = {
  id: string;
  combinator: 'and' | 'or';
  conditions: z.infer<typeof filterConditionSchema>[];
  groups: FilterGroupInput[];
  negate?: boolean;
};

export const filterGroupSchema: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    combinator: z.enum(['and', 'or']),
    conditions: z.array(filterConditionSchema).max(50),
    groups: z.array(filterGroupSchema).max(10),
    negate: z.boolean().optional(),
  }),
);

export const clusterInputSchema = z.object({
  name: z.string().trim().min(2, 'Il nome deve avere almeno 2 caratteri').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  type: z.enum(['dynamic', 'static', 'site_group', 'brevo_list']),
  color: hexColorSchema,
  icon: z.string().max(64).nullable().optional(),
  rules: filterGroupSchema.nullable().optional(),
  contactIds: z.array(z.string()).max(100_000).optional(),
  siteGroupName: z.string().max(120).nullable().optional(),
  brevoListId: z.number().int().positive().nullable().optional(),
  autoRefresh: z.boolean().default(true),
  syncToBrevo: z.boolean().default(false),
});

export type ClusterInput = z.infer<typeof clusterInputSchema>;

// --- Editor email -----------------------------------------------------------

export const typographySchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().min(8).max(96),
  fontWeight: z.union([
    z.literal(400), z.literal(500), z.literal(600),
    z.literal(700), z.literal(800), z.literal(900),
  ]),
  lineHeight: z.number().min(0.8).max(3),
  letterSpacing: z.number().min(-5).max(20),
  color: hexColorSchema,
  align: z.enum(['left', 'center', 'right', 'justify']),
  textTransform: z.enum(['none', 'uppercase', 'capitalize']).optional(),
});

export const blockStyleSchema = z.object({
  padding: spacingSchema,
  backgroundColor: hexColorSchema.nullable().optional(),
  border: z
    .object({
      width: z.number().min(0).max(20),
      style: z.enum(['none', 'solid', 'dashed', 'dotted']),
      color: hexColorSchema,
      radius: z.number().min(0).max(64),
    })
    .nullable()
    .optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  hideOnMobile: z.boolean().optional(),
  hideOnDesktop: z.boolean().optional(),
});

/**
 * Il contenuto dei blocchi è validato in modo permissivo: l'editor è la fonte
 * di verità sulla forma esatta e i tipi TypeScript la vincolano a compile-time.
 * Qui blindiamo solo la struttura che il renderer deve poter attraversare.
 */
export const emailBlockSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  content: z.record(z.unknown()),
  style: blockStyleSchema,
  visibilityRule: z
    .object({
      field: z.string(),
      operator: z.enum(['eq', 'neq', 'gt', 'lt', 'is_empty', 'is_not_empty']),
      value: z.union([z.string(), z.number(), z.null()]).optional(),
    })
    .nullable()
    .optional(),
  locked: z.boolean().optional(),
});

export const emailColumnSchema = z.object({
  id: z.string().min(1),
  span: z.number().int().min(1).max(12),
  blocks: z.array(emailBlockSchema).max(200),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  backgroundColor: hexColorSchema.nullable().optional(),
  padding: spacingSchema,
});

export const emailSectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80).optional(),
  columns: z.array(emailColumnSchema).min(1).max(4),
  fullWidthBackgroundColor: hexColorSchema.nullable().optional(),
  backgroundColor: hexColorSchema.nullable().optional(),
  backgroundImage: z
    .object({
      src: z.string().url(),
      size: z.enum(['cover', 'contain', 'auto']),
      repeat: z.boolean(),
    })
    .nullable()
    .optional(),
  padding: spacingSchema,
  stackOnMobile: z.boolean(),
  reverseOnMobile: z.boolean().optional(),
  border: blockStyleSchema.shape.border,
});

export const emailGlobalStylesSchema = z.object({
  contentWidth: z.number().int().min(320).max(900),
  backgroundColor: hexColorSchema,
  contentBackgroundColor: hexColorSchema,
  fontFamily: z.string().min(1),
  textColor: hexColorSchema,
  linkColor: hexColorSchema,
  headingColor: hexColorSchema,
  baseFontSize: z.number().min(10).max(24),
  baseLineHeight: z.number().min(1).max(2.5),
  borderRadius: z.number().min(0).max(48),
  webFonts: z.array(z.string()).max(4),
  darkModeSupport: z.boolean(),
  darkBackgroundColor: hexColorSchema.optional(),
  darkContentBackgroundColor: hexColorSchema.optional(),
  darkTextColor: hexColorSchema.optional(),
});

export const emailDocumentSchema = z.object({
  version: z.literal(1),
  sections: z.array(emailSectionSchema).min(1).max(100),
  globalStyles: emailGlobalStylesSchema,
});

// --- Newsletter -------------------------------------------------------------

export const newsletterAudienceSchema = z.object({
  clusterIds: z.array(z.string()).max(200).default([]),
  excludeClusterIds: z.array(z.string()).max(200).default([]),
  includeContactIds: z.array(z.string()).max(10_000).default([]),
  excludeContactIds: z.array(z.string()).max(10_000).default([]),
  suppressIfContactedWithinDays: z.number().int().min(0).max(365).nullable().optional(),
  suppressIfPurchasedWithinDays: z.number().int().min(0).max(365).nullable().optional(),
});

export const newsletterScheduleSchema = z.object({
  sendAt: isoDateSchema,
  timezone: z.string().min(1).default('Europe/Rome'),
  throttle: z
    .object({
      batchSize: z.number().int().min(50).max(50_000),
      intervalMinutes: z.number().int().min(1).max(1440),
    })
    .nullable()
    .optional(),
  optimizeSendTime: z.boolean().optional(),
  quietHours: quietHoursSchema.optional(),
});

export const newsletterInputSchema = z.object({
  name: z.string().trim().min(2, 'Assegna un nome alla newsletter').max(160),
  subject: z.string().trim().min(1, 'L\'oggetto è obbligatorio').max(200),
  preheader: z.string().trim().max(150).nullable().optional(),
  fromName: z.string().trim().min(1).max(80),
  fromEmail: emailSchema,
  replyTo: emailSchema.nullable().optional(),
  document: emailDocumentSchema,
  audience: newsletterAudienceSchema,
  schedule: newsletterScheduleSchema.nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  color: hexColorSchema.nullable().optional(),
  category: z
    .enum(['promozione', 'novita', 'saldi', 'informativa', 'stagionale', 'b2b', 'automazione', 'altro'])
    .nullable()
    .optional(),
});

export type NewsletterInput = z.infer<typeof newsletterInputSchema>;

export const scheduleNewsletterSchema = z.object({
  newsletterId: z.string().min(1),
  sendAt: isoDateSchema,
  timezone: z.string().min(1),
});

export const sendTestSchema = z.object({
  newsletterId: z.string().min(1),
  recipients: z.array(emailSchema).min(1).max(10),
  /** Contatto usato per risolvere i merge tag nell'anteprima. */
  sampleContactId: z.string().nullable().optional(),
});

// --- Automazioni ------------------------------------------------------------

export const couponPolicySchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['unique_per_contact', 'shared']),
  sharedCode: z.string().max(40).nullable().optional(),
  prefix: z.string().max(12).default('ALPHA'),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().min(0).max(100_000),
  minOrderTotal: z.number().min(0).nullable().optional(),
  validForDays: z.number().int().min(1).max(365),
  restrictToFamilies: z.array(z.string()).optional(),
  restrictToCompatibleSkus: z.boolean().optional(),
  createOnSite: z.boolean().default(false),
});

export const automationStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  delay: delaySchema,
  subject: z.string().trim().min(1).max(200),
  preheader: z.string().max(150).nullable().optional(),
  document: emailDocumentSchema.nullable().optional(),
  templateId: z.string().nullable().optional(),
  cancelIf: z.array(
    z.enum([
      'order_completed', 'cart_recovered', 'repurchased',
      'contact_unsubscribed', 'contact_purchased_any',
    ]),
  ),
  coupon: couponPolicySchema.nullable().optional(),
});

export const automationInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(600).nullable().optional(),
  enabled: z.boolean(),
  testMode: z.boolean().default(false),
  testRecipients: z.array(emailSchema).max(10).default([]),
  trigger: z.object({
    type: z.enum([
      'order_placed', 'payment_abandoned', 'cart_abandoned', 'repurchase_due',
      'contact_subscribed', 'order_anniversary', 'inactivity',
    ]),
    productFamilies: z.array(z.string()).optional(),
    skuPatterns: z.array(z.string().max(60)).max(200).optional(),
    categoryPaths: z.array(z.string().max(200)).max(100).optional(),
    minOrderTotal: z.number().min(0).nullable().optional(),
    inactivityDays: z.number().int().min(1).max(3650).nullable().optional(),
  }),
  steps: z.array(automationStepSchema).min(1).max(10),
  audienceFilter: filterGroupSchema.nullable().optional(),
  excludeClusterIds: z.array(z.string()).max(100).default([]),
  cooldownDays: z.number().int().min(0).max(3650),
  maxPerContactPerYear: z.number().int().min(1).max(365).nullable().optional(),
  quietHours: quietHoursSchema.optional(),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  maxSendsPerHour: z.number().int().min(1).max(100_000).nullable().optional(),
  timezone: z.string().min(1),
  fromName: z.string().min(1).max(80),
  fromEmail: emailSchema,
  replyTo: emailSchema.nullable().optional(),
});

export type AutomationInput = z.infer<typeof automationInputSchema>;

// --- Contatti ---------------------------------------------------------------

export const contactInputSchema = z.object({
  email: emailSchema,
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  company: z.string().max(160).nullable().optional(),
  vatNumber: z.string().max(30).nullable().optional(),
  language: z.string().min(2).max(5).default('it'),
  segment: z.enum(['b2c', 'b2b']).default('b2c'),
  tags: z.array(z.string().max(40)).max(50).default([]),
  clusterIds: z.array(z.string()).max(200).default([]),
  status: z
    .enum(['subscribed', 'unsubscribed', 'pending', 'bounced', 'blocked', 'never_subscribed'])
    .default('subscribed'),
  notes: z.string().max(2000).nullable().optional(),
});

export const importContactsSchema = z.object({
  /** Righe già normalizzate dal parser CSV lato client. */
  rows: z.array(contactInputSchema).min(1).max(5000),
  addToClusterIds: z.array(z.string()).max(20).default([]),
  /** Aggiorna i contatti già presenti invece di saltarli. */
  updateExisting: z.boolean().default(true),
  source: z.enum(['csv', 'manual']).default('csv'),
});

// --- Sincronizzazione sito --------------------------------------------------

export const syncRequestSchema = z.object({
  source: z.enum(['prestashop_b2c', 'prestashop_b2b']),
  entities: z
    .array(z.enum(['customers', 'orders', 'carts', 'products', 'categories', 'coupons', 'customer_groups']))
    .min(1),
  /** Se assente, la sincronizzazione riparte dall'ultimo cursore salvato. */
  since: isoDateSchema.nullable().optional(),
  fullResync: z.boolean().default(false),
});

// --- Impostazioni -----------------------------------------------------------

export const brevoSettingsInputSchema = z.object({
  apiKey: z.string().min(20).optional(),
  defaultSenderEmail: emailSchema,
  defaultReplyTo: emailSchema.nullable().optional(),
  syncContacts: z.boolean(),
  defaultListId: z.number().int().positive().nullable().optional(),
  maxSendsPerHour: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

export const trackingSettingsInputSchema = z.object({
  attribution: z.object({
    model: z.enum(['last_click', 'last_open', 'first_click', 'linear', 'coupon']),
    clickWindowDays: z.number().int().min(1).max(90),
    openWindowDays: z.number().int().min(0).max(90),
    couponOverridesModel: z.boolean(),
    countStatuses: z.array(z.string()).min(1),
    subtractRefunds: z.boolean(),
  }),
  autoUtm: z.boolean(),
  utmSource: z.string().min(1).max(60),
  utmMedium: z.string().min(1).max(60),
  utmCampaignTemplate: z.string().min(1).max(120),
  useOwnClickTracking: z.boolean(),
  clickTrackingDomain: z.string().max(200),
  excludeProxyOpens: z.boolean(),
});

export const mediaUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().regex(/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/, 'Formato immagine non supportato'),
  size: z.number().int().min(1).max(8 * 1024 * 1024),
  folder: z.string().max(80).default('media'),
});
