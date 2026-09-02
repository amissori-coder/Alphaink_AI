import {
  DEFAULT_TIMEZONE,
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_LABELS,
} from '@alphaink/shared';
import type { NewsletterCategory, NewsletterStatus } from '@alphaink/shared';

import type { CalendarFilters, CalendarView } from './types';

/** Fuso orario commerciale: usato per la pianificazione degli invii. */
export const BUSINESS_TIMEZONE = DEFAULT_TIMEZONE;

/** Viste disponibili, nell'ordine in cui compaiono nel selettore. */
export const CALENDAR_VIEWS: Array<{ value: CalendarView; label: string }> = [
  { value: 'mese', label: 'Mese' },
  { value: 'settimana', label: 'Settimana' },
  { value: 'agenda', label: 'Agenda' },
];

/** Tutti gli stati, nell'ordine del ciclo di vita di una newsletter. */
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

/** Stati mostrati nella legenda: gli altri restano comunque filtrabili. */
export const LEGEND_STATUSES: NewsletterStatus[] = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'failed',
  'cancelled',
];

/** Solo bozze e pianificate possono essere spostate trascinandole. */
export const DRAGGABLE_STATUSES: NewsletterStatus[] = ['draft', 'scheduled'];

/** Stati che consentono di annullare la programmazione. */
export const CANCELLABLE_STATUSES: NewsletterStatus[] = ['scheduled', 'queued', 'paused', 'failed'];

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

/** Filtri iniziali: nessuna restrizione, automazioni visibili. */
export const EMPTY_FILTERS: CalendarFilters = {
  search: '',
  statuses: [],
  categories: [],
  clusterIds: [],
  tags: [],
  showAutomations: true,
};

/** Quante voci mostrare in una cella della vista mese prima di comprimere. */
export const MONTH_CELL_VISIBLE_ENTRIES = 3;

/** Numero massimo di documenti letti per ciascuna sottoscrizione di supporto. */
export const NEWSLETTER_FETCH_LIMIT = 500;
export const CLUSTER_FETCH_LIMIT = 200;
export const AUTOMATION_FETCH_LIMIT = 50;
export const AUTOMATION_RUNS_FETCH_LIMIT = 200;

/** Giorni analizzati dal pannello delle automazioni (indietro e in avanti). */
export const AUTOMATION_WINDOW_DAYS = 7;

/**
 * Percorsi dell'applicazione usati dal calendario.
 * Sono centralizzati qui così un'eventuale rinomina delle rotte tocca un solo file.
 */
export const ROUTES = {
  newsletters: '/newsletter',
  newsletter: (id: string): string => `/newsletter/${id}`,
  automations: '/automazioni',
  /** La pagina automazioni è unica: l'id viaggia come parametro. */
  automation: (id: string): string => `/automazioni?automazione=${id}`,
  calendar: '/calendario',
} as const;

/** Chiavi React Query del calendario. */
export const CALENDAR_QUERY_ROOT = ['calendario'] as const;

export function calendarEntriesKey(from: string, to: string): readonly unknown[] {
  return [...CALENDAR_QUERY_ROOT, 'voci', from, to];
}

export function newsletterPreviewKey(newsletterId: string): readonly unknown[] {
  return [...CALENDAR_QUERY_ROOT, 'anteprima', newsletterId];
}

/** Prefisso degli id usati dalle zone di rilascio del drag and drop. */
export const DROPPABLE_PREFIX = 'giorno:';
