'use client';

import { useTheme } from '@/components/layout/theme-provider';

/**
 * Palette dei grafici.
 *
 * I colori di brand puri (#00AEEF, #EC008C, #FFC400) non superano i controlli
 * di leggibilità su fondo chiaro (contrasto < 3:1 e, per il giallo, banda di
 * luminosità fuori scala). Qui sono usati gli stessi toni "agganciati" al passo
 * più vicino che rispetta banda di luminosità, soglia di croma, separazione per
 * daltonismo (ΔE OKLab ≥ 8 su protanopia/deuteranopia) e contrasto ≥ 3:1
 * rispetto alla superficie della card, in entrambi i temi.
 */
export interface ChartPalette {
  /** Serie categoriali, in ordine fisso: non vanno mai riciclate. */
  series: [string, string, string];
  /** Colore della griglia (una tacca sopra la superficie). */
  grid: string;
  /** Testo degli assi e delle etichette secondarie. */
  axis: string;
  /** Testo delle etichette dirette sui marcatori. */
  text: string;
  /** Superficie della card: usata per gli anelli e i distacchi fra marcatori. */
  surface: string;
}

const LIGHT: ChartPalette = {
  series: ['#0086BC', '#EC008C', '#B07800'],
  grid: '#E2E8F0',
  axis: '#64748B',
  text: '#0F172A',
  surface: '#FFFFFF',
};

const DARK: ChartPalette = {
  series: ['#0099D2', '#EC008C', '#C08A00'],
  grid: '#233149',
  axis: '#94A3B8',
  text: '#E2E8F0',
  surface: '#101728',
};

/** Palette dei grafici coerente con il tema attivo. */
export function useChartPalette(): ChartPalette {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? DARK : LIGHT;
}

/** Etichetta compatta di un giorno `YYYY-MM-DD` (es. "12 mar"). */
export function formatDayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(parsed);
}

/** Etichetta estesa di un giorno, usata nei tooltip. */
export function formatDayLabelLong(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(parsed);
}
