import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '../types/common';

const LOCALE_TAG: Record<string, string> = { it: 'it-IT', en: 'en-GB' };

export function formatCurrency(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? 'it-IT', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(value: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? 'it-IT').format(value);
}

/** Formatta un tasso 0-1 come percentuale. */
export function formatPercent(rate: number, decimals = 1, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? 'it-IT', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(rate) ? rate : 0);
}

/** Divisione protetta: evita `NaN`/`Infinity` nei tassi. */
export function safeRate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  const rate = numerator / denominator;
  return Number.isFinite(rate) ? rate : 0;
}

/** Slug URL-safe usato nei parametri UTM e negli id leggibili. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
