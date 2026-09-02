import {
  BREVO_EVENT_LABELS,
  ENGAGEMENT_TIER_LABELS,
  PRODUCT_FAMILIES,
  PRODUCT_FAMILY_LABELS,
  SITE_SOURCES,
  SITE_SOURCE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '@alphaink/shared';
import type {
  BrevoEventType,
  EngagementTier,
  SiteSource,
  SubscriptionStatus,
} from '@alphaink/shared';

import type { ContactCsvField, TimelineKind } from './types';

/** Rotte dell'area contatti: unica fonte di verità per i link interni. */
export const ROUTES = {
  list: '/contatti',
  detail: (id: string): string => `/contatti/${id}`,
  clusters: '/cluster',
  clusterDetail: (id: string): string => `/cluster/${id}`,
  newsletter: '/newsletter',
  newsletterDetail: (id: string): string => `/newsletter/${id}`,
  settings: '/impostazioni',
} as const;

/** Contatti caricati in tempo reale al primo accesso. */
export const CONTACTS_PAGE_SIZE = 1000;

/** Incremento del tetto quando si chiede di caricarne altri. */
export const CONTACTS_PAGE_STEP = 1000;

/** Tetto massimo della sottoscrizione in tempo reale. */
export const CONTACTS_MAX_LIMIT = 10_000;

/** Righe per pagina nella tabella. */
export const TABLE_PAGE_SIZE = 50;

/** Ordini, eventi ed email caricati nella scheda del contatto. */
export const DETAIL_ORDERS_LIMIT = 100;
export const DETAIL_EVENTS_LIMIT = 300;
export const DETAIL_EMAILS_LIMIT = 100;

/** Righe inviate a `importContacts` per ogni chiamata. */
export const IMPORT_CHUNK_SIZE = 500;

/** Righe mostrate nell'anteprima del terzo passo dell'import. */
export const IMPORT_PREVIEW_ROWS = 10;

/** Tetto di sicurezza sulle righe di un singolo file CSV. */
export const IMPORT_MAX_ROWS = 100_000;

/** Dimensione massima del file CSV accettato. */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'subscribed',
  'unsubscribed',
  'pending',
  'bounced',
  'blocked',
  'never_subscribed',
];

export const STATUS_OPTIONS = SUBSCRIPTION_STATUSES.map((status) => ({
  value: status,
  label: SUBSCRIPTION_STATUS_LABELS[status],
}));

export const SEGMENT_OPTIONS = [
  { value: 'b2c', label: 'B2C — privati' },
  { value: 'b2b', label: 'B2B — rivenditori' },
];

export const SOURCE_OPTIONS = SITE_SOURCES.map((source) => ({
  value: source,
  label: SITE_SOURCE_LABELS[source],
}));

export const ENGAGEMENT_TIERS: EngagementTier[] = ['hot', 'warm', 'cold', 'dormant', 'unknown'];

export const TIER_OPTIONS = ENGAGEMENT_TIERS.map((tier) => ({
  value: tier,
  label: ENGAGEMENT_TIER_LABELS[tier],
}));

export const FAMILY_OPTIONS = PRODUCT_FAMILIES.map((family) => ({
  value: family,
  label: PRODUCT_FAMILY_LABELS[family],
}));

/** Colore del badge per ciascuno stato di iscrizione. */
export const STATUS_BADGE_VARIANT: Record<
  SubscriptionStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  subscribed: 'success',
  unsubscribed: 'secondary',
  pending: 'warning',
  bounced: 'warning',
  blocked: 'destructive',
  never_subscribed: 'outline',
};

/** Soglie del punteggio di engagement, allineate a `engagementTierFromScore`. */
export const TIER_TONE: Record<EngagementTier, 'primary' | 'success' | 'warning' | 'destructive'> = {
  hot: 'success',
  warm: 'primary',
  cold: 'warning',
  dormant: 'destructive',
  unknown: 'warning',
};

// -----------------------------------------------------------------------------
// Timeline
// -----------------------------------------------------------------------------

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  invio: 'Invii',
  apertura: 'Aperture',
  click: 'Click',
  ordine: 'Ordini',
  consenso: 'Consensi',
  problema: 'Problemi di recapito',
};

export const TIMELINE_KIND_OPTIONS = (
  ['invio', 'apertura', 'click', 'ordine', 'consenso', 'problema'] as TimelineKind[]
).map((kind) => ({ value: kind, label: TIMELINE_KIND_LABELS[kind] }));

/** Classifica un evento Brevo in una delle categorie della timeline. */
export function timelineKindForEvent(type: BrevoEventType): TimelineKind {
  switch (type) {
    case 'request':
    case 'delivered':
    case 'deferred':
      return 'invio';
    case 'opened':
    case 'unique_opened':
    case 'proxy_open':
      return 'apertura';
    case 'click':
      return 'click';
    case 'unsubscribed':
    case 'list_addition':
    case 'contact_updated':
    case 'contact_deleted':
      return 'consenso';
    default:
      return 'problema';
  }
}

export const EVENT_LABELS = BREVO_EVENT_LABELS;

// -----------------------------------------------------------------------------
// Import CSV
// -----------------------------------------------------------------------------

export interface CsvFieldDefinition {
  field: ContactCsvField;
  label: string;
  /** Il campo è obbligatorio per poter importare. */
  required?: boolean;
  hint?: string;
  /** Intestazioni riconosciute in automatico (già normalizzate). */
  aliases: string[];
}

/** Normalizza un'intestazione CSV per il confronto con gli alias. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Campi di destinazione dell'import, con gli alias usati dal riconoscimento
 * automatico delle colonne. Gli alias coprono le intestazioni tipiche degli
 * export PrestaShop, Brevo ed Excel in italiano e in inglese.
 */
export const CSV_FIELDS: CsvFieldDefinition[] = [
  {
    field: 'email',
    label: 'Email',
    required: true,
    hint: 'Colonna obbligatoria: è la chiave di deduplica dei contatti.',
    aliases: ['email', 'mail', 'indirizzoemail', 'emailaddress', 'posta', 'postaelettronica', 'eMail'],
  },
  {
    field: 'firstName',
    label: 'Nome',
    aliases: ['nome', 'firstname', 'givenname', 'name', 'nomecliente'],
  },
  {
    field: 'lastName',
    label: 'Cognome',
    aliases: ['cognome', 'lastname', 'surname', 'familyname'],
  },
  {
    field: 'company',
    label: 'Azienda',
    aliases: ['azienda', 'company', 'ragionesociale', 'societa', 'business', 'companyname'],
  },
  {
    field: 'vatNumber',
    label: 'Partita IVA',
    aliases: ['partitaiva', 'piva', 'vat', 'vatnumber', 'ivanumber', 'codicefiscale'],
  },
  {
    field: 'phone',
    label: 'Telefono',
    aliases: ['telefono', 'phone', 'cellulare', 'mobile', 'tel', 'phonenumber'],
  },
  {
    field: 'segment',
    label: 'Segmento (b2c/b2b)',
    hint: 'Valori accettati: b2c, b2b, privato, azienda, rivenditore.',
    aliases: ['segmento', 'segment', 'tipologia', 'tipocliente', 'customertype'],
  },
  {
    field: 'status',
    label: 'Stato di iscrizione',
    hint: 'Valori accettati: iscritto/subscribed, disiscritto/unsubscribed, in attesa/pending, bounce, bloccato.',
    aliases: ['stato', 'status', 'iscrizione', 'subscription', 'newsletter', 'optin', 'subscribed'],
  },
  {
    field: 'language',
    label: 'Lingua',
    aliases: ['lingua', 'language', 'lang', 'locale', 'idioma'],
  },
  {
    field: 'tags',
    label: 'Etichette',
    hint: 'Più etichette nella stessa cella vanno separate da virgola, punto e virgola o barra verticale.',
    aliases: ['etichette', 'tag', 'tags', 'label', 'labels', 'categorie'],
  },
  {
    field: 'notes',
    label: 'Note',
    aliases: ['note', 'notes', 'annotazioni', 'commenti', 'comment', 'comments'],
  },
];

export const CSV_FIELD_BY_NAME = new Map<ContactCsvField, CsvFieldDefinition>(
  CSV_FIELDS.map((definition) => [definition.field, definition]),
);

/** Valore usato nel selettore per "non importare questa colonna". */
export const CSV_IGNORE = '__ignora__';

/** Riconosce a quale campo corrisponde un'intestazione CSV. */
export function guessField(header: string): ContactCsvField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const definition of CSV_FIELDS) {
    if (definition.aliases.some((alias) => normalizeHeader(alias) === normalized)) {
      return definition.field;
    }
  }
  // Riconoscimento morbido: "email di contatto" contiene comunque "email".
  for (const definition of CSV_FIELDS) {
    if (definition.aliases.some((alias) => normalized.includes(normalizeHeader(alias)))) {
      return definition.field;
    }
  }
  return null;
}

/** Interpreta la colonna del segmento con i sinonimi più comuni. */
export function parseSegment(value: string): 'b2c' | 'b2b' | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (['b2b', 'azienda', 'aziende', 'rivenditore', 'rivenditori', 'business', 'reseller'].includes(normalized)) {
    return 'b2b';
  }
  if (['b2c', 'privato', 'privati', 'consumer', 'retail', 'cliente'].includes(normalized)) {
    return 'b2c';
  }
  return null;
}

/** Interpreta la colonna dello stato con i sinonimi più comuni. */
export function parseStatus(value: string): SubscriptionStatus | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  const map: Record<string, SubscriptionStatus> = {
    subscribed: 'subscribed',
    iscritto: 'subscribed',
    iscritta: 'subscribed',
    attivo: 'subscribed',
    si: 'subscribed',
    yes: 'subscribed',
    true: 'subscribed',
    '1': 'subscribed',
    unsubscribed: 'unsubscribed',
    disiscritto: 'unsubscribed',
    cancellato: 'unsubscribed',
    no: 'unsubscribed',
    false: 'unsubscribed',
    '0': 'unsubscribed',
    pending: 'pending',
    inattesa: 'pending',
    daconfermare: 'pending',
    bounced: 'bounced',
    bounce: 'bounced',
    blocked: 'blocked',
    bloccato: 'blocked',
    spam: 'blocked',
    neversubscribed: 'never_subscribed',
    maiiscritto: 'never_subscribed',
  };
  return map[normalized] ?? null;
}

/** Divide una cella di etichette usando i separatori più comuni. */
export function parseTags(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Sorgenti che corrispondono a un negozio sincronizzabile. */
export const STORE_SOURCE_OPTIONS: Array<{ value: SiteSource; label: string }> = [
  { value: 'prestashop_b2c', label: SITE_SOURCE_LABELS.prestashop_b2c },
  { value: 'prestashop_b2b', label: SITE_SOURCE_LABELS.prestashop_b2b },
];
