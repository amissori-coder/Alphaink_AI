import {
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_COLORS,
  NEWSLETTER_STATUS_LABELS,
  safeRate,
} from '@alphaink/shared';
import type { Newsletter, NewsletterCategory, NewsletterStatus } from '@alphaink/shared';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { it } from 'date-fns/locale';

import { BUSINESS_TIMEZONE, DRAGGABLE_STATUSES } from './constants';
import type {
  CalendarEntry,
  CalendarFilters,
  CalendarItem,
  CalendarRange,
  CalendarView,
} from './types';

/** Opzioni comuni a tutte le funzioni date-fns: italiano, settimana da lunedì. */
export const DATE_OPTIONS = { locale: it, weekStartsOn: 1 } as const;

/** Numero di celle della griglia mensile: 6 righe da 7 giorni. */
const MONTH_GRID_CELLS = 42;

/**
 * Fuso usato per interrogare il backend.
 * Il raggruppamento per giorno deve coincidere con quello della griglia, che è
 * disegnata con l'orario locale del browser; la pianificazione degli invii usa
 * invece sempre il fuso commerciale (`BUSINESS_TIMEZONE`).
 */
export function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || BUSINESS_TIMEZONE;
  } catch {
    return BUSINESS_TIMEZONE;
  }
}

/** Chiave `YYYY-MM-DD` di un giorno, calcolata nell'orario locale. */
export function dayId(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return format(date, 'yyyy-MM-dd');
}

/** Converte `YYYY-MM-DD` in una data locale a mezzanotte. */
export function parseDayId(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return startOfDay(new Date());
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** Orario locale `HH:mm`. */
export function formatTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return format(date, 'HH:mm');
}

/** Etichetta lunga di un giorno, es. "lunedì 7 settembre 2026". */
export function formatFullDay(value: Date): string {
  return format(value, 'EEEE d MMMM yyyy', DATE_OPTIONS);
}

/** Intestazioni dei giorni della settimana, da lunedì a domenica. */
export function weekdayLabels(pattern: 'EEEEE' | 'EEE' = 'EEE'): string[] {
  const reference = startOfWeek(new Date(2024, 0, 1), DATE_OPTIONS);
  return eachDayOfInterval({ start: reference, end: endOfWeek(reference, DATE_OPTIONS) }).map((day) =>
    format(day, pattern, DATE_OPTIONS),
  );
}

/** Intervallo visualizzato e giorni della griglia per la vista corrente. */
export function buildRange(view: CalendarView, anchor: Date): CalendarRange {
  if (view === 'settimana') {
    const from = startOfWeek(anchor, DATE_OPTIONS);
    const days = Array.from({ length: 7 }, (_, index) => addDaysLocal(from, index));
    const to = endOfDayLocal(days[6]);
    return { from, to, fromIso: from.toISOString(), toIso: to.toISOString(), days };
  }

  // Mese e agenda condividono l'intervallo: sei settimane a partire dal lunedì
  // che precede il primo del mese, così la griglia è sempre 7×6.
  const gridStart = startOfWeek(startOfMonth(anchor), DATE_OPTIONS);
  const days = Array.from({ length: MONTH_GRID_CELLS }, (_, index) => addDaysLocal(gridStart, index));
  const to = endOfDayLocal(days[MONTH_GRID_CELLS - 1]);
  return { from: gridStart, to, fromIso: gridStart.toISOString(), toIso: to.toISOString(), days };
}

/** Titolo dell'intervallo mostrato nella barra di navigazione. */
export function rangeTitle(view: CalendarView, anchor: Date): string {
  if (view !== 'settimana') {
    return capitalize(format(anchor, 'LLLL yyyy', DATE_OPTIONS));
  }
  const from = startOfWeek(anchor, DATE_OPTIONS);
  const to = endOfWeek(anchor, DATE_OPTIONS);
  if (isSameMonth(from, to)) {
    return `${format(from, 'd', DATE_OPTIONS)} – ${format(to, 'd MMMM yyyy', DATE_OPTIONS)}`;
  }
  if (isSameYear(from, to)) {
    return `${format(from, 'd MMM', DATE_OPTIONS)} – ${format(to, 'd MMM yyyy', DATE_OPTIONS)}`;
  }
  return `${format(from, 'd MMM yyyy', DATE_OPTIONS)} – ${format(to, 'd MMM yyyy', DATE_OPTIONS)}`;
}

/** Sposta l'ancora di un periodo avanti (+1) o indietro (-1). */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  return view === 'settimana' ? addWeeks(anchor, direction) : addMonths(anchor, direction);
}

/** Somma giorni conservando l'orario locale (niente scivolamenti da fuso). */
export function addDaysLocal(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function endOfDayLocal(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

/** Applica a `day` l'orario (ore e minuti) di `source`. */
export function combineDayWithTime(day: Date, source: Date | string): Date {
  const reference = source instanceof Date ? source : new Date(source);
  const next = new Date(day);
  const valid = !Number.isNaN(reference.getTime());
  next.setHours(valid ? reference.getHours() : 9, valid ? reference.getMinutes() : 0, 0, 0);
  return next;
}

/** True se il giorno è precedente a oggi. */
export function isPastDay(day: Date, now: Date = new Date()): boolean {
  return startOfDay(day).getTime() < startOfDay(now).getTime();
}

export function isToday(day: Date, now: Date = new Date()): boolean {
  return isSameDay(day, now);
}

export function statusColor(status: NewsletterStatus): string {
  return NEWSLETTER_STATUS_COLORS[status] ?? NEWSLETTER_STATUS_COLORS.draft;
}

export function statusLabel(status: NewsletterStatus): string {
  return NEWSLETTER_STATUS_LABELS[status] ?? status;
}

export function categoryLabel(category: NewsletterCategory | null): string | null {
  return category ? NEWSLETTER_CATEGORY_LABELS[category] ?? category : null;
}

/** Tasso di apertura unico calcolato sulle consegnate. */
export function openRateOf(entry: CalendarEntry, newsletter?: Newsletter | null): number | null {
  if (entry.type !== 'newsletter') return null;
  if (newsletter?.stats) {
    const { delivered, uniqueOpened, recipients } = newsletter.stats;
    const base = delivered || recipients;
    if (!base) return null;
    return safeRate(uniqueOpened, base);
  }
  if (!entry.stats || !entry.stats.delivered) return null;
  return safeRate(entry.stats.opened, entry.stats.delivered);
}

/**
 * Fonde la voce del backend con il documento newsletter letto in tempo reale.
 * Il documento, quando disponibile, ha la precedenza: così spostamenti e cambi
 * di stato si riflettono subito nella griglia senza attendere il refetch.
 */
export function toCalendarItem(
  entry: CalendarEntry,
  newsletter: Newsletter | null | undefined,
  now: Date = new Date(),
): CalendarItem {
  const date = resolveEntryDate(entry, newsletter);
  const parsed = new Date(date);
  const timestamp = Number.isNaN(parsed.getTime()) ? Date.parse(entry.date) : parsed.getTime();
  const status = newsletter?.status ?? entry.status;
  const recipients = newsletter
    ? newsletter.stats?.recipients || newsletter.audience?.estimatedRecipients || 0
    : entry.recipients;

  return {
    ...entry,
    title: newsletter?.name || entry.title,
    date,
    status,
    category: newsletter ? newsletter.category ?? null : entry.category,
    color: newsletter ? newsletter.color ?? null : entry.color,
    recipients,
    dayId: dayId(timestamp),
    time: formatTime(timestamp),
    timestamp,
    subject: newsletter?.subject ?? null,
    tags: newsletter?.tags ?? [],
    clusterIds: newsletter?.audience?.clusterIds ?? [],
    openRate: openRateOf(entry, newsletter),
    draggable: entry.type === 'newsletter' && DRAGGABLE_STATUSES.includes(status),
    past: timestamp < now.getTime(),
  };
}

/** Data effettiva della voce: invio reale, altrimenti pianificazione. */
function resolveEntryDate(entry: CalendarEntry, newsletter: Newsletter | null | undefined): string {
  if (entry.type !== 'newsletter' || !newsletter) return entry.date;
  if (newsletter.sentAt) return newsletter.sentAt;
  return newsletter.schedule?.sendAt ?? entry.date;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** True se la voce supera tutti i filtri attivi. */
export function matchesFilters(item: CalendarItem, filters: CalendarFilters): boolean {
  if (item.type === 'automation') {
    // Le automazioni sono ricorrenti: rispondono solo all'interruttore dedicato
    // e alla ricerca testuale, non ai filtri riservati alle newsletter.
    if (!filters.showAutomations) return false;
    if (filters.statuses.length || filters.categories.length || filters.clusterIds.length || filters.tags.length) {
      return false;
    }
    return matchesSearch(item, filters.search);
  }

  if (filters.statuses.length && !filters.statuses.includes(item.status)) return false;
  if (filters.categories.length && !(item.category && filters.categories.includes(item.category))) {
    return false;
  }
  if (filters.clusterIds.length && !item.clusterIds.some((id) => filters.clusterIds.includes(id))) {
    return false;
  }
  if (filters.tags.length && !item.tags.some((tag) => filters.tags.includes(tag))) return false;
  return matchesSearch(item, filters.search);
}

function matchesSearch(item: CalendarItem, search: string): boolean {
  const term = normalizeText(search.trim());
  if (!term) return true;
  const haystack = normalizeText(
    [item.title, item.subject ?? '', item.tags.join(' '), categoryLabel(item.category) ?? ''].join(' '),
  );
  return haystack.includes(term);
}

/** Numero di filtri attivi, mostrato accanto al pulsante di azzeramento. */
export function countActiveFilters(filters: CalendarFilters): number {
  return (
    (filters.search.trim() ? 1 : 0) +
    (filters.statuses.length ? 1 : 0) +
    (filters.categories.length ? 1 : 0) +
    (filters.clusterIds.length ? 1 : 0) +
    (filters.tags.length ? 1 : 0) +
    (filters.showAutomations ? 0 : 1)
  );
}

/** Raggruppa le voci per giorno locale, ordinandole per orario. */
export function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const bucket = grouped.get(item.dayId);
    if (bucket) bucket.push(item);
    else grouped.set(item.dayId, [item]);
  }
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.timestamp - b.timestamp || a.title.localeCompare(b.title, 'it'));
  }
  return grouped;
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Testo compatto dei destinatari, es. "1.240 destinatari". */
export function recipientsLabel(count: number): string {
  return count === 1 ? '1 destinatario' : `${new Intl.NumberFormat('it-IT').format(count)} destinatari`;
}

/**
 * Costruisce una voce di calendario a partire dal solo documento newsletter.
 * Serve per le newsletter comparse dopo l'ultima risposta della callable (ad
 * esempio una bozza appena creata): la sottoscrizione in tempo reale le mostra
 * immediatamente, senza attendere il refetch.
 */
export function entryFromNewsletter(newsletter: Newsletter): CalendarEntry | null {
  const date = newsletter.sentAt ?? newsletter.schedule?.sendAt ?? null;
  if (!date) return null;
  return {
    id: `newsletter:${newsletter.id}`,
    type: 'newsletter',
    title: newsletter.name || newsletter.subject,
    date,
    day: dayId(date),
    status: newsletter.status,
    category: newsletter.category ?? null,
    color: newsletter.color ?? null,
    recipients: newsletter.stats?.recipients || newsletter.audience?.estimatedRecipients || 0,
    newsletterId: newsletter.id,
    automationId: null,
    automationKey: null,
    occurrences: 1,
    stats: {
      delivered: newsletter.stats?.delivered ?? 0,
      opened: newsletter.stats?.uniqueOpened ?? 0,
      clicked: newsletter.stats?.uniqueClicked ?? 0,
      revenue: newsletter.stats?.revenue ?? 0,
    },
  };
}

/** Variante del badge coerente con il colore di stato. */
export function statusBadgeVariant(
  status: NewsletterStatus,
): 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' {
  switch (status) {
    case 'sent':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'sending':
    case 'queued':
    case 'paused':
      return 'warning';
    case 'scheduled':
      return 'default';
    case 'cancelled':
      return 'outline';
    default:
      return 'secondary';
  }
}
