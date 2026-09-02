'use client';

import { EMPTY_STATS, safeRate } from '@alphaink/shared';
import type { NewsletterStats } from '@alphaink/shared';
import { Filter } from 'lucide-react';
import * as React from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { useChartPalette } from '@/components/dashboard/chart-theme';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** Conversione rispetto allo stadio precedente. */
  stepRate: number;
  /** Quota sul totale dei destinatari. */
  totalRate: number;
}

/** Ricava gli stadi dell'imbuto dalle statistiche consolidate. */
export function funnelStages(stats: NewsletterStats): FunnelStage[] {
  const base = stats.recipients || stats.requested || stats.delivered;
  const rows: Array<{ key: string; label: string; value: number }> = [
    { key: 'delivered', label: 'Consegnate', value: stats.delivered },
    { key: 'opened', label: 'Aperte', value: stats.uniqueOpened },
    { key: 'clicked', label: 'Cliccate', value: stats.uniqueClicked },
    { key: 'orders', label: 'Ordini', value: stats.orders },
  ];

  let previous = base;
  return rows.map((row) => {
    const stage: FunnelStage = {
      ...row,
      stepRate: safeRate(row.value, previous),
      totalRate: safeRate(row.value, base),
    };
    previous = row.value;
    return stage;
  });
}

export interface FunnelChartProps {
  stats?: NewsletterStats | null;
  loading?: boolean;
  className?: string;
  title?: string;
  description?: string;
}

/**
 * Imbuto consegna → apertura → click → ordine.
 *
 * Una sola tonalità per tutte le barre: gli stadi sono la stessa misura in
 * momenti diversi, quindi il colore non deve distinguerli. Il binario grigio
 * dietro ogni barra rappresenta i destinatari totali e rende immediato il calo.
 */
export function FunnelChart({
  stats,
  loading = false,
  className,
  title = 'Imbuto di conversione',
  description = 'Dal recapito all’ordine: quanti destinatari superano ogni passaggio.',
}: FunnelChartProps) {
  const palette = useChartPalette();
  const data = stats ?? EMPTY_STATS;
  const base = data.recipients || data.requested || data.delivered;
  const stages = React.useMemo(() => funnelStages(data), [data]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : base <= 0 ? (
          <EmptyState
            compact
            className="min-h-[200px] justify-center"
            icon={<Filter />}
            title="Imbuto non ancora disponibile"
            description="I passaggi compaiono appena la spedizione parte e Brevo restituisce i primi eventi."
          />
        ) : (
          <>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={stages}
                  barCategoryGap={14}
                  margin={{ top: 4, right: 84, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide domain={[0, base]} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={92}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: palette.axis, fontSize: 12 }}
                  />
                  <Bar
                    dataKey="value"
                    fill={palette.series[0]}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={26}
                    isAnimationActive={false}
                    background={{ fill: palette.grid, radius: 4 }}
                  >
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={10}
                      fill={palette.text}
                      fontSize={12}
                      formatter={(value: number) => formatNumber(value)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <dl className="mt-auto space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Destinatari di partenza</dt>
                <dd className="ml-auto font-medium tabular-nums text-foreground">
                  {formatNumber(base)}
                </dd>
              </div>
              {stages.map((stage) => (
                <div key={stage.key} className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: palette.series[0] }}
                    aria-hidden="true"
                  />
                  <dt className="text-muted-foreground">{stage.label}</dt>
                  <dd className="ml-auto tabular-nums text-foreground">
                    {formatPercent(stage.totalRate)} del totale
                    <span className="ml-2 text-muted-foreground">
                      ({formatPercent(stage.stepRate)} dal passaggio precedente)
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
