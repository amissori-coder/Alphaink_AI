'use client';

import { DEFAULT_CURRENCY, safeRate } from '@alphaink/shared';
import type { DateRange } from '@alphaink/shared';
import { GitCompareArrows } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatCurrency, formatDateIt, formatNumber, formatPercent } from '@/lib/utils';

import { MetricDelta } from './metric-delta';
import { EMPTY_CHANNEL_METRICS, type ChannelMetrics } from './types';

/** Riga della tabella di confronto: come si legge il valore e come si giudica. */
interface ComparisonRow {
  key: string;
  label: string;
  value: (metrics: ChannelMetrics) => number;
  format: 'number' | 'percent' | 'currency';
  /** Una diminuzione è un miglioramento (bounce, disiscrizioni). */
  invert?: boolean;
}

const ROWS: ComparisonRow[] = [
  { key: 'sent', label: 'Email inviate', value: (m) => m.sent, format: 'number' },
  { key: 'delivered', label: 'Consegnate', value: (m) => m.delivered, format: 'number' },
  {
    key: 'openRate',
    label: 'Tasso di apertura',
    value: (m) => safeRate(m.uniqueOpened, m.delivered),
    format: 'percent',
  },
  {
    key: 'clickRate',
    label: 'Tasso di click',
    value: (m) => safeRate(m.uniqueClicked, m.delivered),
    format: 'percent',
  },
  { key: 'orders', label: 'Ordini attribuiti', value: (m) => m.orders, format: 'number' },
  { key: 'revenue', label: 'Fatturato attribuito', value: (m) => m.revenue, format: 'currency' },
  {
    key: 'unsubscribed',
    label: 'Disiscrizioni',
    value: (m) => m.unsubscribed,
    format: 'number',
    invert: true,
  },
  {
    key: 'bounces',
    label: 'Recapiti falliti',
    value: (m) => m.softBounces + m.hardBounces + m.blocked,
    format: 'number',
    invert: true,
  },
];

export interface PeriodComparisonProps {
  current: ChannelMetrics | undefined;
  previous: ChannelMetrics | undefined;
  /** Intervallo del periodo precedente, mostrato in intestazione. */
  previousRange?: DateRange | null;
  compareLabel: string;
  currency?: string;
  loading?: boolean;
  className?: string;
}

/**
 * Confronto puntuale col periodo precedente.
 *
 * Le percentuali non sono confrontate come differenza di punti ma come
 * variazione relativa, la stessa lettura usata dalle schede in alto: così i
 * due blocchi non raccontano storie diverse.
 */
export function PeriodComparison({
  current,
  previous,
  previousRange = null,
  compareLabel,
  currency = DEFAULT_CURRENCY,
  loading = false,
  className,
}: PeriodComparisonProps) {
  const now = current ?? EMPTY_CHANNEL_METRICS;
  const before = previous ?? null;

  const format = (value: number, kind: ComparisonRow['format']) => {
    if (kind === 'percent') return formatPercent(value);
    if (kind === 'currency') return formatCurrency(value, currency);
    return formatNumber(value);
  };

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="size-4 text-primary" aria-hidden="true" />
          Confronto col periodo precedente
        </CardTitle>
        <CardDescription>
          {previousRange
            ? `Periodo di riferimento: ${formatDateIt(previousRange.from)} – ${formatDateIt(
                previousRange.to,
              )}.`
            : 'Variazione rispetto all’intervallo immediatamente precedente.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : !before ? (
          <EmptyState
            compact
            icon={<GitCompareArrows />}
            title="Confronto non disponibile"
            description="Il periodo precedente non ha dati consolidati con cui fare il paragone."
          />
        ) : (
          <dl className="divide-y divide-border">
            {ROWS.map((row) => {
              const currentValue = row.value(now);
              const previousValue = row.value(before);
              const change =
                previousValue === 0
                  ? currentValue === 0
                    ? 0
                    : null
                  : (currentValue - previousValue) / previousValue;

              return (
                <div key={row.key} className="flex items-baseline gap-3 py-2 first:pt-0">
                  <dt className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="flex shrink-0 items-baseline gap-3">
                    <span className="text-sm font-medium tabular-nums text-foreground">
                      {format(currentValue, row.format)}
                    </span>
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                      da {format(previousValue, row.format)}
                    </span>
                    <MetricDelta value={change} invert={row.invert} className="w-20 justify-end" />
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{`Variazioni ${compareLabel}.`}</p>
      </CardContent>
    </Card>
  );
}
