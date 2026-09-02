/**
 * Validazione dei moduli dell'area Impostazioni.
 *
 * Dove esiste uno schema condiviso lo si riusa tale e quale
 * (`brevoSettingsInputSchema`, `trackingSettingsInputSchema`): così il client
 * rifiuta esattamente ciò che rifiuterebbe la Cloud Function, senza
 * duplicazioni che possono divergere. Per sito e brand — che non hanno uno
 * schema condiviso — le regole qui sotto rispecchiano quelle delle Functions.
 */

import { brevoSettingsInputSchema, trackingSettingsInputSchema } from '@alphaink/shared';
import { z } from 'zod';

import type { FieldErrors } from './types';

export { brevoSettingsInputSchema, trackingSettingsInputSchema };

// -----------------------------------------------------------------------------
// Sito AlphaInk
// -----------------------------------------------------------------------------

const orderStatusSchema = z.enum([
  'pending',
  'processing',
  'awaiting_payment',
  'paid',
  'shipped',
  'completed',
  'cancelled',
  'refunded',
  'failed',
]);

const syncEntitySchema = z.enum([
  'customers',
  'orders',
  'carts',
  'products',
  'categories',
  'coupons',
  'customer_groups',
]);

export const storeSettingsFormSchema = z.object({
  enabled: z.boolean(),
  label: z.string().min(1, 'Indica un nome per il negozio.').max(120),
  baseUrl: z.string().url('Indica un URL completo, es. https://alphaink.net'),
  mode: z.enum(['webservice', 'mysql']),
  multistoreShopId: z
    .number({ invalid_type_error: 'Indica un numero intero o lascia vuoto.' })
    .int()
    .positive('L’id dello shop deve essere maggiore di zero.')
    .nullable(),
  tablePrefix: z
    .string()
    .regex(/^[A-Za-z0-9_]{0,16}$/, 'Solo lettere, cifre e underscore (massimo 16 caratteri).'),
  defaultSegment: z.enum(['b2c', 'b2b']),
  languageId: z
    .number({ invalid_type_error: 'Indica l’id numerico della lingua.' })
    .int()
    .positive('L’id lingua deve essere maggiore di zero.')
    .max(999, 'Id lingua non valido.'),
  customerGroupMapping: z.record(z.enum(['b2c', 'b2b'])),
  orderStateMapping: z.record(orderStatusSchema),
  /** Credenziali facoltative: presenti solo quando vengono (ri)inserite. */
  wsKey: z.string().min(8, 'La chiave Webservice è troppo corta.').max(200).optional(),
  dbPassword: z.string().min(1).max(500).optional(),
});

export type StoreSettingsFormValues = z.infer<typeof storeSettingsFormSchema>;

export const familyRuleSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1, 'Scegli una famiglia.'),
  categoryPatterns: z.array(z.string()).max(50),
  skuPatterns: z.array(z.string()).max(50),
  namePatterns: z.array(z.string()).max(50),
  priority: z
    .number({ invalid_type_error: 'La priorità deve essere un numero.' })
    .int()
    .min(0)
    .max(1000),
});

export const siteGeneralFormSchema = z.object({
  syncSchedule: z.object({
    enabled: z.boolean(),
    cron: z
      .string()
      .min(9, 'Indica un’espressione cron valida (5 campi).')
      .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, 'L’espressione cron deve avere 5 campi separati da spazi.'),
    timezone: z.string().min(1),
    entities: z.array(syncEntitySchema).min(1, 'Seleziona almeno un’entità da sincronizzare.'),
  }),
  familyRules: z.array(familyRuleSchema).max(100),
  repurchaseCycleDays: z.record(
    z
      .number({ invalid_type_error: 'Indica un numero di giorni.' })
      .int()
      .min(1, 'Almeno 1 giorno.')
      .max(3650, 'Al massimo 3650 giorni.'),
  ),
  abandonedPaymentAfterMinutes: z
    .number({ invalid_type_error: 'Indica i minuti di attesa.' })
    .int()
    .min(5, 'Almeno 5 minuti.')
    .max(10_080, 'Al massimo 7 giorni (10.080 minuti).'),
  abandonedCartAfterMinutes: z
    .number({ invalid_type_error: 'Indica i minuti di attesa.' })
    .int()
    .min(5, 'Almeno 5 minuti.')
    .max(10_080, 'Al massimo 7 giorni (10.080 minuti).'),
  defaultSource: z.enum(['prestashop_b2c', 'prestashop_b2b']),
});

export type SiteGeneralFormValues = z.infer<typeof siteGeneralFormSchema>;

// -----------------------------------------------------------------------------
// Brand
// -----------------------------------------------------------------------------

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Usa un colore esadecimale, es. #00AEEF.');

const optionalUrl = z
  .string()
  .url('Indica un URL completo, es. https://alphaink.net')
  .max(500)
  .nullable();

export const brandingFormSchema = z.object({
  companyName: z.string().min(1, 'Il nome dell’azienda è obbligatorio.').max(120),
  legalName: z.string().max(160),
  address: z.string().max(300),
  vatNumber: z.string().max(30),
  supportEmail: z.string().email('Indirizzo email non valido.'),
  supportPhone: z.string().max(40).nullable(),
  websiteUrl: z.string().url('Indica un URL completo, es. https://alphaink.net').max(300),
  logoUrl: optionalUrl,
  logoDarkUrl: optionalUrl,
  faviconUrl: optionalUrl,
  palette: z.object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    background: hexColor,
    surface: hexColor,
    text: hexColor,
    muted: hexColor,
    success: hexColor,
    danger: hexColor,
  }),
  fonts: z.object({
    heading: z.string().min(1, 'Scegli un font per i titoli.').max(80),
    body: z.string().min(1, 'Scegli un font per il testo.').max(80),
  }),
  socialLinks: z
    .array(
      z.object({
        network: z.string().min(1),
        url: z.string().url('Indica un URL completo del profilo social.').max(300),
      }),
    )
    .max(12, 'Al massimo 12 collegamenti social.'),
  legalFooterHtml: z.string().max(4000),
  unsubscribeText: z.string().min(1, 'Il testo di disiscrizione non può essere vuoto.').max(300),
});

export type BrandingFormValues = z.infer<typeof brandingFormSchema>;

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: FieldErrors };

/**
 * Valida un valore restituendo gli errori indicizzati per percorso di campo
 * (`palette.primary`, `socialLinks.0.url`, …), pronti per la UI.
 */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): ValidationResult<z.infer<S>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };

  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || '_';
    // Il primo messaggio per campo è quello più specifico: gli altri sono rumore.
    if (!errors[key]) errors[key] = issue.message;
  }
  return { success: false, errors };
}

/** Primo messaggio d'errore disponibile, per il riepilogo in cima al modulo. */
export function firstError(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  return keys.length > 0 ? (errors[keys[0]!] ?? null) : null;
}
