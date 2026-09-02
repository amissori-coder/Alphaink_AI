import { DEFAULT_CURRENCY, formatCurrency, formatNumber, formatPercent } from '@alphaink/shared';

/** Unità di misura di una serie: decide assi, etichette e tooltip. */
export type ValueFormat = 'number' | 'percent' | 'currency';

/** Formatta un valore secondo l'unità della serie. */
export function formatValue(
  value: number,
  format: ValueFormat = 'number',
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(value)) return '—';
  if (format === 'percent') return formatPercent(value, 1);
  if (format === 'currency') return formatCurrency(value, currency);
  return formatNumber(value);
}

const COMPACT = new Intl.NumberFormat('it-IT', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Etichetta breve per gli assi: "12,4 Mln" invece di "12.400.000". */
export function formatAxisValue(
  value: number,
  format: ValueFormat = 'number',
  currency: string = DEFAULT_CURRENCY,
): string {
  if (!Number.isFinite(value)) return '';
  if (format === 'percent') return formatPercent(value, 0);
  if (format === 'currency') {
    return `${COMPACT.format(value)} ${currency === 'EUR' ? '€' : currency}`;
  }
  return Math.abs(value) >= 10_000 ? COMPACT.format(value) : formatNumber(value);
}

/** Percentuale di variazione con segno, per le etichette di confronto. */
export function formatDelta(value: number): string {
  const capped = Math.min(Math.abs(value), 9.99);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const suffix = Math.abs(value) > 9.99 ? ' oltre' : '';
  return `${sign}${formatPercent(capped, 1)}${suffix}`;
}
