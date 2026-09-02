import {
  DEFAULT_TIMEZONE,
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_LABELS,
} from '@alphaink/shared';
import type { NewsletterCategory, NewsletterStatus, RecipientStatus } from '@alphaink/shared';

import type { AudienceExclusionReason } from './types';

/** Fuso orario commerciale predefinito per le pianificazioni. */
export const BUSINESS_TIMEZONE = DEFAULT_TIMEZONE;

/** Rotte dell'area newsletter: unica fonte di verità per i link interni. */
export const ROUTES = {
  list: '/newsletter',
  create: '/newsletter/nuova',
  detail: (id: string): string => `/newsletter/${id}`,
  editor: (id: string): string => `/newsletter/${id}/editor`,
  calendar: '/calendario',
  clusters: '/cluster',
  settings: '/impostazioni',
} as const;

/** Stati nell'ordine del ciclo di vita. */
export const ALL_STATUSES: NewsletterStatus[] = [
  'draft',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'paused',
  'failed',
  'cancelled',
];

export const ALL_CATEGORIES: NewsletterCategory[] = [
  'promozione',
  'novita',
  'saldi',
  'informativa',
  'stagionale',
  'b2b',
  'automazione',
  'altro',
];

export const STATUS_OPTIONS = ALL_STATUSES.map((status) => ({
  value: status,
  label: NEWSLETTER_STATUS_LABELS[status],
}));

export const CATEGORY_OPTIONS = ALL_CATEGORIES.map((category) => ({
  value: category,
  label: NEWSLETTER_CATEGORY_LABELS[category],
}));

/** Stati in cui il contenuto è ancora modificabile (allineato al backend). */
export const EDITABLE_STATUSES: NewsletterStatus[] = [
  'draft',
  'scheduled',
  'paused',
  'failed',
  'cancelled',
];

/** Stati in cui l'eliminazione definitiva è consentita. */
export const DELETABLE_STATUSES: NewsletterStatus[] = ['draft', 'cancelled', 'failed'];

/** Stati in cui si può annullare la programmazione. */
export const CANCELLABLE_STATUSES: NewsletterStatus[] = ['scheduled', 'queued', 'paused', 'failed'];

/** Stati in cui si può pianificare (o ripianificare) l'invio. */
export const SCHEDULABLE_STATUSES: NewsletterStatus[] = [
  'draft',
  'scheduled',
  'paused',
  'failed',
  'cancelled',
];

/** Stati in cui è possibile spedire subito. */
export const SEND_NOW_STATUSES: NewsletterStatus[] = ['draft', 'scheduled', 'paused', 'failed'];

/** Stati in cui la spedizione può essere messa in pausa. */
export const PAUSABLE_STATUSES: NewsletterStatus[] = ['scheduled', 'queued', 'sending'];

/** Stati che indicano una spedizione conclusa o in corso: mostrano il report. */
export const REPORTABLE_STATUSES: NewsletterStatus[] = ['sending', 'sent', 'paused'];

/** Etichette in italiano degli stati per singolo destinatario. */
export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'In coda',
  sent: 'Inviata',
  delivered: 'Consegnata',
  opened: 'Aperta',
  clicked: 'Cliccata',
  converted: 'Ha generato un ordine',
  soft_bounced: 'Bounce temporaneo',
  hard_bounced: 'Bounce permanente',
  blocked: 'Bloccata',
  unsubscribed: 'Disiscritto',
  spam: 'Segnalata come spam',
  failed: 'Non inviata',
};

/** Tono del badge per lo stato del destinatario. */
export const RECIPIENT_STATUS_TONES: Record<
  RecipientStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'outline',
  sent: 'secondary',
  delivered: 'default',
  opened: 'default',
  clicked: 'success',
  converted: 'success',
  soft_bounced: 'warning',
  hard_bounced: 'destructive',
  blocked: 'destructive',
  unsubscribed: 'warning',
  spam: 'destructive',
  failed: 'destructive',
};

export const RECIPIENT_STATUS_OPTIONS = (
  Object.keys(RECIPIENT_STATUS_LABELS) as RecipientStatus[]
).map((status) => ({ value: status, label: RECIPIENT_STATUS_LABELS[status] }));

/** Motivi di esclusione dal pubblico, spiegati all'operatore. */
export const AUDIENCE_REASON_LABELS: Record<AudienceExclusionReason, string> = {
  not_found: 'Contatti non più presenti in rubrica',
  not_sendable: 'Contatti non contattabili (disiscritti, bounce o bloccati)',
  invalid_email: 'Indirizzi email non validi',
  duplicate_email: 'Indirizzi duplicati fra più cluster',
  excluded_cluster: 'Esclusi da un cluster in sottrazione',
  excluded_contact: 'Esclusi singolarmente',
  suppressed_recently_contacted: 'Già contattati di recente',
  suppressed_recently_purchased: 'Hanno acquistato di recente',
};

/** Fusi orari proposti nella pianificazione. */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Europe/Rome', label: 'Italia (Europe/Rome)' },
  { value: 'Europe/London', label: 'Regno Unito (Europe/London)' },
  { value: 'Europe/Madrid', label: 'Spagna (Europe/Madrid)' },
  { value: 'Europe/Berlin', label: 'Germania (Europe/Berlin)' },
  { value: 'Europe/Lisbon', label: 'Portogallo (Europe/Lisbon)' },
  { value: 'UTC', label: 'UTC (orario coordinato)' },
];

/** Preset dell'invio scaglionato. */
export const THROTTLE_PRESETS: Array<{ batchSize: number; intervalMinutes: number; label: string }> = [
  { batchSize: 1000, intervalMinutes: 10, label: '1.000 ogni 10 minuti' },
  { batchSize: 2000, intervalMinutes: 15, label: '2.000 ogni 15 minuti' },
  { batchSize: 5000, intervalMinutes: 30, label: '5.000 ogni 30 minuti' },
  { batchSize: 10000, intervalMinutes: 60, label: '10.000 ogni ora' },
];

/** Orario predefinito quando si pianifica senza indicazioni. */
export const DEFAULT_SEND_TIME = '09:00';

/** Fascia di silenzio suggerita. */
export const DEFAULT_QUIET_HOURS = { start: '21:00', end: '08:00' } as const;

/** Ritardo del salvataggio automatico dell'editor. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** Ritardo prima di ricalcolare la stima del pubblico. */
export const ESTIMATE_DEBOUNCE_MS = 700;

/** Tetto ai documenti letti dalle sottoscrizioni in tempo reale. */
export const NEWSLETTER_FETCH_LIMIT = 500;
export const CLUSTER_FETCH_LIMIT = 200;
export const TEMPLATE_FETCH_LIMIT = 100;

/** Destinatari caricati per pagina nel report. */
export const REPORT_PAGE_SIZE = 50;

/** Mittente di ripiego quando le impostazioni Brevo non sono ancora compilate. */
export const FALLBACK_SENDER_NAME = 'AlphaInk';
export const FALLBACK_SENDER_EMAIL = 'info@alphaink.net';

/** Radice delle chiavi React Query dell'area newsletter. */
export const NEWSLETTER_QUERY_ROOT = ['newsletter'] as const;

export function previewQueryKey(newsletterId: string, sampleContactId?: string | null): readonly unknown[] {
  return [...NEWSLETTER_QUERY_ROOT, 'anteprima', newsletterId, sampleContactId ?? 'campione'];
}

export function reportQueryKey(
  newsletterId: string,
  status: RecipientStatus | 'all',
): readonly unknown[] {
  return [...NEWSLETTER_QUERY_ROOT, 'report', newsletterId, status];
}

export function estimateQueryKey(signature: string): readonly unknown[] {
  return [...NEWSLETTER_QUERY_ROOT, 'stima', signature];
}

export const CONTACT_QUERY_ROOT = [...NEWSLETTER_QUERY_ROOT, 'contatti'] as const;
