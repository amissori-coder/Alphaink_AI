import type { IsoDate } from '../types/common';
import { DEFAULT_TIMEZONE } from '../types/common';

const DAY_MS = 86_400_000;

export function toIso(value: Date | number | string): IsoDate {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return new Date(value).toISOString();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

export function addMinutes(iso: IsoDate, minutes: number): IsoDate {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/** Restituisce `YYYY-MM-DD` nel fuso indicato: chiave dei documenti giornalieri. */
export function dayKey(value: Date | IsoDate, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `YYYY-MM` per le viste mensili del calendario. */
export function monthKey(value: Date | IsoDate, timeZone: string = DEFAULT_TIMEZONE): string {
  return dayKey(value, timeZone).slice(0, 7);
}

/** Ora locale `HH:mm` nel fuso indicato. */
export function localTime(value: Date | IsoDate, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('it-IT', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/** Giorno della settimana locale (0 = domenica). */
export function localWeekday(value: Date | IsoDate, timeZone: string = DEFAULT_TIMEZONE): number {
  const date = typeof value === 'string' ? new Date(value) : value;
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/**
 * Vero se l'orario locale ricade nella fascia di silenzio.
 * Supporta fasce che scavalcano la mezzanotte (es. 21:00 → 08:00).
 */
export function isWithinQuietHours(
  value: Date | IsoDate,
  quietHours: { start: string; end: string },
  timeZone: string = DEFAULT_TIMEZONE,
): boolean {
  const now = localTime(value, timeZone);
  const { start, end } = quietHours;
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Sposta un istante fuori dalla fascia di silenzio, portandolo al primo minuto
 * utile dopo `quietHours.end` nel fuso indicato.
 */
export function shiftOutOfQuietHours(
  iso: IsoDate,
  quietHours: { start: string; end: string },
  timeZone: string = DEFAULT_TIMEZONE,
): IsoDate {
  if (!isWithinQuietHours(iso, quietHours, timeZone)) return iso;
  let candidate = Date.parse(iso);
  // Avanza a passi di 15 minuti fino a uscire dalla fascia (max 24 h).
  for (let i = 0; i < 96; i += 1) {
    candidate += 15 * 60_000;
    if (!isWithinQuietHours(new Date(candidate), quietHours, timeZone)) break;
  }
  return new Date(candidate).toISOString();
}

/** Intervallo [inizio, fine] del mese indicato, in UTC. */
export function monthRange(year: number, month: number): { from: IsoDate; to: IsoDate } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 1, 0, 0, 0) - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
