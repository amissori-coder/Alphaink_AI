import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// I formattatori numerici/valuta vivono nel pacchetto condiviso: qui li
// ri-esportiamo così i componenti importano tutto da '@/lib/utils'.
export { formatCurrency, formatNumber, formatPercent } from '@alphaink/shared';

/** Unisce classi condizionali risolvendo i conflitti Tailwind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const IT_LOCALE = 'it-IT';

/** Converte input eterogenei in `Date`; ritorna `null` se non valido. */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
};

/**
 * Formatta una data ISO in italiano (es. "12 mar 2026").
 * Ritorna una stringa vuota se la data non è valida, così la UI non mostra "Invalid Date".
 */
export function formatDateIt(
  iso: string | number | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(IT_LOCALE, { ...DEFAULT_DATE_OPTIONS, ...opts }).format(date);
}

/** Formatta data e ora in italiano (es. "12 mar 2026, 09:30"). */
export function formatDateTimeIt(iso: string | number | Date | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(IT_LOCALE, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Formatta solo l'orario (es. "09:30"). */
export function formatTimeIt(iso: string | number | Date | null | undefined): string {
  const date = toDate(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(IT_LOCALE, { hour: '2-digit', minute: '2-digit' }).format(date);
}

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat(IT_LOCALE, { numeric: 'auto' });

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * Tempo relativo in italiano: "3 minuti fa", "tra 2 giorni", "ieri".
 * `now` è iniettabile per rendere i test deterministici.
 */
export function relativeTimeIt(
  iso: string | number | Date | null | undefined,
  now: Date | number = Date.now(),
): string {
  const date = toDate(iso);
  if (!date) return '';
  const reference = typeof now === 'number' ? now : now.getTime();
  const diff = date.getTime() - reference;
  const abs = Math.abs(diff);

  if (abs < 45 * 1000) return 'adesso';

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) {
      return RELATIVE_FORMATTER.format(Math.round(diff / ms), unit);
    }
  }
  return RELATIVE_FORMATTER.format(Math.round(diff / 1000), 'second');
}

/** Iniziali per gli avatar: "Mario Rossi" → "MR". */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Dimensione file leggibile (es. "1,4 MB"). */
export function bytesToSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return '0 B';
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** index;
  const decimals = index === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(IT_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)} ${SIZE_UNITS[index]}`;
}

/** Vincola un numero all'intervallo [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
