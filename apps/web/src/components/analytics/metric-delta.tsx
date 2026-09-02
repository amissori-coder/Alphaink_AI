'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { formatDelta } from './format';

type Tone = 'up' | 'down' | 'flat';

const TONE_CLASSES: Record<Tone, string> = {
  up: 'text-success',
  down: 'text-destructive',
  flat: 'text-muted-foreground',
};

const TONE_ICONS: Record<Tone, typeof ArrowUpRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
};

function toneFor(change: number, invert: boolean): Tone {
  if (Math.abs(change) < 0.0005) return 'flat';
  const positive = invert ? change < 0 : change > 0;
  return positive ? 'up' : 'down';
}

export interface MetricDeltaProps {
  /** Variazione relativa rispetto al periodo precedente (0.12 = +12%). */
  value: number | null | undefined;
  /** Testo del confronto, es. "rispetto ai 30 giorni precedenti". */
  label?: string;
  /** Con `true` una variazione negativa è considerata positiva (bounce, disiscrizioni). */
  invert?: boolean;
  className?: string;
}

/**
 * Variazione rispetto al periodo precedente.
 *
 * Il colore non è l'unico segnale: la freccia e il segno raccontano la
 * direzione anche a chi non distingue verde e rosso.
 */
export function MetricDelta({ value, label, invert = false, className }: MetricDeltaProps) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        {label ? `Nessun confronto ${label}` : 'Confronto non disponibile'}
      </span>
    );
  }

  const tone = toneFor(value, invert);
  const Icon = TONE_ICONS[tone];

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', TONE_CLASSES[tone], className)}>
      <Icon className="size-3" aria-hidden="true" />
      <span className="tabular-nums">{formatDelta(value)}</span>
      {label ? <span className="font-normal text-muted-foreground">{label}</span> : null}
    </span>
  );
}
