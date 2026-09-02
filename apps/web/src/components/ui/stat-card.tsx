'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import * as React from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Etichetta della metrica, es. "Tasso di apertura". */
  label: string;
  /** Valore già formattato, oppure un numero che viene formattato in italiano. */
  value: React.ReactNode;
  /** Testo secondario sotto il valore. */
  hint?: React.ReactNode;
  /** Variazione rispetto al periodo precedente, come rapporto (0.12 = +12%). */
  change?: number | null;
  /** Etichetta del periodo di confronto, es. "vs 30 giorni prima". */
  changeLabel?: string;
  /** Con `true` una variazione negativa è considerata positiva (es. disiscrizioni). */
  invertChange?: boolean;
  /** Serie di valori per la sparkline (in ordine cronologico). */
  sparkline?: number[];
  /** Icona decorativa in alto a destra. */
  icon?: React.ReactNode;
  /** Mostra lo scheletro di caricamento. */
  loading?: boolean;
  /** Suggerimento sull'etichetta. */
  tooltip?: React.ReactNode;
}

function toneFor(change: number, invert: boolean): 'up' | 'down' | 'flat' {
  if (Math.abs(change) < 0.0005) return 'flat';
  const positive = invert ? change < 0 : change > 0;
  return positive ? 'up' : 'down';
}

const TONE_CLASSES = {
  up: 'text-success',
  down: 'text-destructive',
  flat: 'text-muted-foreground',
} as const;

const TONE_ICONS = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const;

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    {
      className,
      label,
      value,
      hint,
      change,
      changeLabel,
      invertChange = false,
      sparkline,
      icon,
      loading = false,
      tooltip,
      ...props
    },
    ref,
  ) => {
    const gradientId = React.useId();
    const hasChange = typeof change === 'number' && Number.isFinite(change);
    const tone = hasChange ? toneFor(change, invertChange) : 'flat';
    const ToneIcon = TONE_ICONS[tone];
    const chartColor = tone === 'down' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))';

    const series = React.useMemo(
      () => (sparkline ?? []).map((point, index) => ({ index, value: point })),
      [sparkline],
    );

    return (
      <div
        ref={ref}
        className={cn(
          'relative flex flex-col justify-between gap-3 overflow-hidden rounded-lg border border-border bg-card p-4 shadow-card',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <SimpleTooltip content={tooltip ?? ''}>
            <span
              className={cn(
                'text-xs font-medium uppercase tracking-wide text-muted-foreground',
                tooltip && 'cursor-help underline decoration-dotted underline-offset-4',
              )}
            >
              {label}
            </span>
          </SimpleTooltip>
          {icon ? (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4"
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : null}
        </div>

        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {typeof value === 'number' ? formatNumber(value) : value}
            </span>
            {hasChange ? (
              <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', TONE_CLASSES[tone])}>
                <ToneIcon className="size-3" aria-hidden="true" />
                {formatPercent(Math.abs(change), 1)}
              </span>
            ) : null}
          </div>
        )}

        {hint || changeLabel ? (
          <p className="text-xs text-muted-foreground">{hint ?? changeLabel}</p>
        ) : null}

        {series.length > 1 && !loading ? (
          <div className="-mx-4 -mb-4 h-12" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={1.75}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    );
  },
);
StatCard.displayName = 'StatCard';

export { StatCard };
