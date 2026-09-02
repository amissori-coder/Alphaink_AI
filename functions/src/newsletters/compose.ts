/**
 * Composizione dell'email di una newsletter per un singolo destinatario.
 *
 * `composeNewsletterEmail` è l'unico punto in cui si mettono insieme:
 *  - il documento dell'editor (o quello della variante A/B),
 *  - il contesto dei merge tag costruito sui dati del contatto,
 *  - i link di sistema firmati (disiscrizione, preferenze, vedi nel browser),
 *  - il riferimento d'invio `n:<newsletterId>[:<variantId>]` che lega click,
 *    aperture e conversioni a questa spedizione,
 *  - i parametri UTM presi da `settings/tracking`.
 *
 * ## Perché i link di sistema si costruiscono qui
 * Il token di disiscrizione contiene l'id del contatto ed è firmato in HMAC:
 * può quindi esistere solo **dopo** aver scelto il destinatario. Per questo il
 * documento salva i merge tag `{{system.*}}` e non gli URL veri, e il valore
 * definitivo viene iniettato in questo punto, destinatario per destinatario.
 *
 * Il formato del riferimento d'invio è quello letto da `parseSendRef` del
 * modulo di tracciamento: cambiarlo qui significa perdere la correlazione fra
 * i webhook Brevo e i destinatari.
 */

import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  slugify,
} from '@alphaink/shared';
import type {
  BrandingSettings,
  Contact,
  DocId,
  EmailDocument,
  Locale,
  Newsletter,
  NewsletterVariant,
  TrackingSettings,
  UtmParams,
} from '@alphaink/shared';

import { APP_URL, LINK_SIGNING_KEY } from '../lib/config';
import { AppError } from '../lib/errors';
import { buildEmail, buildMergeContext, decodeBasicEntities, resolveMergeTags } from '../render';
import type { MergeContactInput, RenderWarning } from '../render';
import { readBrandingSettings, readTrackingSettings } from '../tracking/settings';
import { createUnsubscribeToken } from '../tracking/unsubscribe';
import { buildWebviewUrl } from '../tracking/webview';

/** URL pubblico usato quando il parametro non è risolvibile (test, shell). */
const FALLBACK_APP_URL = 'https://newsletter.alphaink.net';

/** Validità dei token di disiscrizione inseriti nelle newsletter. */
export const UNSUBSCRIBE_TOKEN_DAYS = 365;

// -----------------------------------------------------------------------------
// Ambiente di composizione
// -----------------------------------------------------------------------------

/**
 * Tutto ciò che serve a comporre un'email e che si legge una volta sola per
 * spedizione: impostazioni, identità visiva e parametri di runtime.
 */
export interface NewsletterEnvironment {
  appUrl: string;
  /** Chiave HMAC dei link firmati; stringa vuota se il secret non è associato. */
  signingKey: string;
  branding: BrandingSettings;
  tracking: TrackingSettings;
  locale: Locale;
  timezone: string;
  currency: string;
}

/** Parametro stringa con fallback: fuori dal runtime Functions non è risolvibile. */
function readParam(read: () => string, fallback: string): string {
  try {
    return read() || fallback;
  } catch {
    return fallback;
  }
}

/** Legge la chiave di firma senza far fallire l'esecuzione se manca. */
export function readSigningKey(): string {
  try {
    return (LINK_SIGNING_KEY.value() ?? '').trim();
  } catch {
    return '';
  }
}

/** Carica l'ambiente di composizione (impostazioni + parametri di runtime). */
export async function loadNewsletterEnvironment(
  overrides: Partial<NewsletterEnvironment> = {},
): Promise<NewsletterEnvironment> {
  const [branding, tracking] = await Promise.all([
    overrides.branding ? Promise.resolve(overrides.branding) : readBrandingSettings(),
    overrides.tracking ? Promise.resolve(overrides.tracking) : readTrackingSettings(),
  ]);

  return {
    appUrl: (overrides.appUrl ?? readParam(() => APP_URL.value(), FALLBACK_APP_URL)).replace(/\/+$/, ''),
    signingKey: overrides.signingKey ?? readSigningKey(),
    branding,
    tracking,
    locale: overrides.locale ?? DEFAULT_LOCALE,
    timezone: overrides.timezone ?? DEFAULT_TIMEZONE,
    currency: overrides.currency ?? DEFAULT_CURRENCY,
  };
}

// -----------------------------------------------------------------------------
// Riferimento d'invio e UTM
// -----------------------------------------------------------------------------

/**
 * Riferimento d'invio di una newsletter: `n:<newsletterId>[:<variantId>]`.
 * È il formato riconosciuto da `parseSendRef` (modulo tracciamento).
 */
export function newsletterSendRef(newsletterId: DocId, variantId?: string | null): string {
  return variantId ? `n:${newsletterId}:${variantId}` : `n:${newsletterId}`;
}

/** Riferimento degli invii di prova: `t:<newsletterId>`, escluso dalle statistiche. */
export function newsletterTestRef(newsletterId: DocId, variantId?: string | null): string {
  return variantId ? `t:${newsletterId}:${variantId}` : `t:${newsletterId}`;
}

/** Risolve il template di campagna UTM configurato in `settings/tracking`. */
export function resolveCampaignName(template: string, newsletter: Newsletter): string {
  const slug = slugify(newsletter.name || newsletter.subject || newsletter.id);
  const replacements: Record<string, string> = {
    'newsletter.slug': slug,
    'newsletter.id': newsletter.id,
    'newsletter.name': newsletter.name ?? '',
    'newsletter.category': newsletter.category ?? '',
  };
  const resolved = String(template || '{{newsletter.slug}}').replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_match, key: string) => replacements[key] ?? '',
  );
  return resolved.trim() || slug;
}

/** Parametri UTM da applicare ai link, oppure `null` se disattivati. */
export function newsletterUtm(
  newsletter: Newsletter,
  tracking: TrackingSettings,
  variantId?: string | null,
): UtmParams | null {
  if (!tracking.autoUtm) return null;
  return {
    source: tracking.utmSource || 'newsletter',
    medium: tracking.utmMedium || 'email',
    campaign: resolveCampaignName(tracking.utmCampaignTemplate, newsletter),
    content: variantId ?? null,
    term: null,
  };
}

// -----------------------------------------------------------------------------
// Destinatario
// -----------------------------------------------------------------------------

/**
 * Dati minimi del destinatario necessari alla composizione: un `Contact` vero
 * li soddisfa, ma anche il contatto fittizio usato nelle anteprime.
 */
export interface ComposeContact extends MergeContactInput {
  id: DocId;
  email: string;
}

/** Riduce un `Contact` ai soli campi usati dai merge tag. */
export function toComposeContact(contact: Contact): ComposeContact {
  return {
    id: contact.id,
    email: contact.emailNormalized || contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    company: contact.company,
    city: contact.city,
    stats: contact.stats,
    printers: contact.printers,
    customAttributes: contact.customAttributes,
  };
}

/** Contatto di esempio per anteprime e invii di prova. */
export function sampleComposeContact(email = 'anteprima@alphaink.net'): ComposeContact {
  return {
    id: 'anteprima',
    email,
    firstName: 'Mario',
    lastName: 'Rossi',
    displayName: 'Mario Rossi',
    company: 'Studio Rossi',
    city: 'Milano',
    stats: {
      ordersCount: 6,
      totalSpent: 742.5,
      averageOrderValue: 123.75,
      firstOrderAt: null,
      lastOrderAt: new Date(Date.now() - 21 * 86_400_000).toISOString(),
    },
    printers: [
      {
        brand: 'HP',
        model: 'LaserJet Pro M404dn',
        detectedFrom: 'order',
        detectedAt: new Date(Date.now() - 120 * 86_400_000).toISOString(),
      },
    ],
    customAttributes: {},
  };
}

// -----------------------------------------------------------------------------
// URL di sistema
// -----------------------------------------------------------------------------

export interface NewsletterUrls {
  unsubscribeUrl: string;
  preferencesUrl: string;
  webviewUrl: string;
}

/** Link generici alle pagine pubbliche: chiedono l'indirizzo al visitatore. */
export function genericSystemUrls(appUrl: string): NewsletterUrls {
  const base = appUrl.replace(/\/+$/, '');
  return {
    unsubscribeUrl: `${base}/u`,
    preferencesUrl: `${base}/p`,
    webviewUrl: `${base}/w`,
  };
}

/**
 * Link firmati verso le pagine pubbliche.
 *
 * Senza chiave di firma si ripiega sulle pagine generiche `/u` e `/p`, che
 * chiedono l'indirizzo al visitatore: meglio un passaggio in più che un link
 * falsificabile con cui disiscrivere il cliente di qualcun altro.
 */
export function buildNewsletterUrls(
  newsletter: Pick<Newsletter, 'id'>,
  contact: ComposeContact,
  env: NewsletterEnvironment,
  variantId?: string | null,
): NewsletterUrls {
  const base = env.appUrl.replace(/\/+$/, '');
  if (!env.signingKey) return genericSystemUrls(base);

  const token = createUnsubscribeToken(
    {
      email: contact.email,
      contactId: contact.id,
      newsletterId: newsletter.id,
      variantId: variantId ?? null,
    },
    { secret: env.signingKey, ttlDays: UNSUBSCRIBE_TOKEN_DAYS },
  );

  return {
    unsubscribeUrl: `${base}/u/${token}`,
    preferencesUrl: `${base}/p/${token}`,
    webviewUrl: buildWebviewUrl(base, newsletter.id, contact.id, {
      secret: env.signingKey,
      variantId: variantId ?? null,
    }),
  };
}

// -----------------------------------------------------------------------------
// Varianti A/B
// -----------------------------------------------------------------------------

export interface NewsletterContent {
  variantId: string | null;
  subject: string;
  preheader: string;
  document: EmailDocument;
}

/**
 * Contenuto da spedire: quello della variante indicata, con ricaduta sul
 * contenuto base per i campi che la variante non sovrascrive.
 */
export function resolveNewsletterContent(
  newsletter: Newsletter,
  variantId?: string | null,
): NewsletterContent {
  const variant: NewsletterVariant | undefined = variantId
    ? (newsletter.variants ?? []).find((item) => item.id === variantId)
    : undefined;

  const document = (variant?.document ?? newsletter.document) as EmailDocument | undefined;
  if (!document) {
    throw new AppError('failed_precondition', 'La newsletter non ha un contenuto da inviare.');
  }

  return {
    variantId: variant?.id ?? null,
    subject: variant?.subject || newsletter.subject,
    preheader: variant?.preheader ?? newsletter.preheader ?? '',
    document,
  };
}

// -----------------------------------------------------------------------------
// Composizione
// -----------------------------------------------------------------------------

export interface ComposeOptions {
  env: NewsletterEnvironment;
  /** Variante A/B assegnata al destinatario. */
  variantId?: string | null;
  /** Invio di prova: riferimento `t:` e nessun pixel di apertura. */
  isTest?: boolean;
  /** Anteprima in editor: i dati mancanti usano i fallback dei merge tag. */
  isPreview?: boolean;
  /** Disattiva pixel e riscrittura dei link (anteprima). */
  disableTracking?: boolean;
}

export interface ComposedEmail {
  /** Riferimento d'invio da propagare in header e link. */
  ref: string;
  variantId: string | null;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
  urls: NewsletterUrls;
}

/**
 * Costruisce l'email pronta per Brevo.
 *
 * Il risultato porta con sé gli avvisi del renderer: sta al chiamante decidere
 * se fermarsi (`blocking === true`, che significa contenuto non spedibile per
 * legge o per errore di configurazione) o procedere.
 */
export function composeNewsletterEmail(
  newsletter: Newsletter,
  contact: ComposeContact,
  options: ComposeOptions,
): ComposedEmail {
  const { env } = options;
  const content = resolveNewsletterContent(newsletter, options.variantId);
  const ref = options.isTest
    ? newsletterTestRef(newsletter.id, content.variantId)
    : newsletterSendRef(newsletter.id, content.variantId);

  // In anteprima non si firmano token per un contatto che non esiste: si usano
  // le pagine generiche, che chiedono l'indirizzo a chi le apre.
  const urls = options.isPreview
    ? genericSystemUrls(env.appUrl)
    : buildNewsletterUrls(newsletter, contact, env, content.variantId);

  const merge = buildMergeContext({
    contact,
    branding: env.branding,
    urls,
    locale: env.locale,
    timezone: newsletter.schedule?.timezone || env.timezone,
    currency: env.currency,
  });

  // Nell'oggetto e nel preheader le entità HTML non hanno senso: il client di
  // posta mostrerebbe letteralmente "&amp;".
  const subject = decodeBasicEntities(resolveMergeTags(content.subject, merge));
  const preheader = decodeBasicEntities(resolveMergeTags(content.preheader, merge));

  const trackingEnabled = !options.disableTracking && Boolean(env.signingKey);
  const email = buildEmail({
    document: content.document,
    context: {
      subject,
      preheader,
      merge,
      urls,
      branding: env.branding,
      contact,
      isPreview: options.isPreview ?? false,
    },
    branding: env.branding,
    tracking: trackingEnabled
      ? {
          // Il redirector proprietario è opzionale: se disattivato restano i
          // soli click tracciati da Brevo, ma gli UTM vengono comunque aggiunti.
          clickTracking: env.tracking.useOwnClickTracking,
          openTracking: !options.isTest && !options.isPreview,
          ref,
          contactId: contact.id,
          secret: env.signingKey,
          appUrl: env.appUrl,
          utm: newsletterUtm(newsletter, env.tracking, content.variantId),
        }
      : null,
  });

  return {
    ref,
    variantId: content.variantId,
    subject,
    preheader,
    html: email.html,
    text: email.text,
    warnings: email.warnings,
    blocking: email.blocking,
    urls,
  };
}

// -----------------------------------------------------------------------------
// Render "master"
// -----------------------------------------------------------------------------

export interface MasterRender {
  variantId: string | null;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
}

/**
 * Render non personalizzato, salvato su `newsletter.html`.
 *
 * I merge tag del contatto usano i propri fallback ("Cliente"), mentre i token
 * `{{system.*}}` restano **intatti**: la pagina "vedi nel browser" li risolve
 * con i dati di chi sta guardando, e nessun link firmato viene congelato in un
 * HTML che vale per tutti.
 */
export function renderNewsletterMaster(
  newsletter: Newsletter,
  env: NewsletterEnvironment,
  options: { variantId?: string | null } = {},
): MasterRender {
  const content = resolveNewsletterContent(newsletter, options.variantId);

  // Nessun `urls`: il contesto conserva i token di sistema e `deferredTokens`
  // li riconosce come volutamente non risolti (niente falso avviso).
  const merge = buildMergeContext({
    branding: env.branding,
    locale: env.locale,
    timezone: newsletter.schedule?.timezone || env.timezone,
    currency: env.currency,
  });

  const subject = decodeBasicEntities(resolveMergeTags(content.subject, merge));
  const preheader = decodeBasicEntities(resolveMergeTags(content.preheader, merge));

  const email = buildEmail({
    document: content.document,
    context: { subject, preheader, merge, branding: env.branding, isPreview: true },
    branding: env.branding,
    tracking: null,
  });

  return {
    variantId: content.variantId,
    subject,
    preheader,
    html: email.html,
    text: email.text,
    warnings: email.warnings,
    blocking: email.blocking,
  };
}

/**
 * Header `X-Mailin-custom`: Brevo lo restituisce nei webhook ed è il filo che
 * lega consegne, aperture e click a questa newsletter e a questo contatto.
 */
export function customHeaderFor(options: {
  ref: string;
  newsletterId: DocId;
  variantId?: string | null;
  contactId: DocId;
  recipientId?: DocId | null;
  isTest?: boolean;
}): string {
  return JSON.stringify({
    ref: options.ref,
    source: options.isTest ? 'test' : 'newsletter',
    newsletterId: options.newsletterId,
    variantId: options.variantId ?? null,
    contactId: options.contactId,
    recipientId: options.recipientId ?? options.contactId,
  });
}
