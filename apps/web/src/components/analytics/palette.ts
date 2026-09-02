'use client';

import { useTheme } from '@/components/layout/theme-provider';

/**
 * Palette dei grafici analitici.
 *
 * I cinque colori categoriali sono stati verificati con il validatore delle
 * palette in entrambi i temi (banda di luminosità, soglia di croma, separazione
 * per daltonismo su coppie adiacenti con ΔE OKLab ≥ 8, contrasto ≥ 3:1 sulla
 * superficie della card). L'ordine è fisso: il colore segue la serie, non il
 * valore, e non viene mai riciclato oltre il quinto posto.
 *
 * La rampa sequenziale è a tinta unica (ciano di brand) dal chiaro allo scuro:
 * serve alla mappa di calore, dove il passo più chiaro significa "quasi zero".
 */
export interface AnalyticsPalette {
  /** Serie categoriali, in ordine fisso. */
  series: [string, string, string, string, string];
  /** Rampa sequenziale a tinta unica, dal valore più basso al più alto. */
  sequential: [string, string, string, string, string, string, string];
  /** Griglia del grafico: una tacca sopra la superficie. */
  grid: string;
  /** Testo degli assi. */
  axis: string;
  /** Testo delle etichette diritte sui marcatori. */
  text: string;
  /** Superficie della card: anelli e distacchi fra marcatori. */
  surface: string;
  /** Binario grigio dietro le barre e celle a valore nullo. */
  track: string;
}

const LIGHT: AnalyticsPalette = {
  series: ['#0086BC', '#EC008C', '#B07800', '#5B21B6', '#2E7D32'],
  sequential: ['#E3F3FB', '#C0E4F5', '#8FD2EE', '#57BCE4', '#1FA2D5', '#0086BC', '#00648D'],
  grid: '#E2E8F0',
  axis: '#64748B',
  text: '#0F172A',
  surface: '#FFFFFF',
  track: '#F1F5F9',
};

const DARK: AnalyticsPalette = {
  series: ['#0099D2', '#EC008C', '#C08A00', '#8B72E8', '#2E9E5B'],
  sequential: ['#16233A', '#123C58', '#0E5273', '#0A6D97', '#0989BD', '#22A2D6', '#57BCE4'],
  grid: '#233149',
  axis: '#94A3B8',
  text: '#E2E8F0',
  surface: '#101728',
  track: '#1A2438',
};

/** Palette coerente con il tema attivo. */
export function useAnalyticsPalette(): AnalyticsPalette {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? DARK : LIGHT;
}

/**
 * Colore della cella di una mappa di calore.
 * `intensity` è normalizzata fra 0 e 1; zero resta sul binario neutro.
 */
export function sequentialColor(palette: AnalyticsPalette, intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) return palette.track;
  const steps = palette.sequential;
  const index = Math.min(steps.length - 1, Math.max(0, Math.round(intensity * (steps.length - 1))));
  return steps[index] as string;
}

/** Testo leggibile sopra una cella della rampa: chiaro solo sui passi scuri. */
export function sequentialTextColor(palette: AnalyticsPalette, intensity: number): string {
  const dark = intensity >= 0.6;
  return dark ? '#FFFFFF' : palette.text;
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
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parsed);
}
