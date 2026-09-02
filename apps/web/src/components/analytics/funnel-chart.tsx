'use client';

import { safeRate } from '@alphaink/shared';
import { Filter } from 'lucide-react';
import * as React from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import { useAnalyticsPalette } from './palette';

export interface FunnelStageInput {
  key: string;
  label: string;
  value: number;
}

export interface FunnelStage extends FunnelStageInput {
  /** Conversione rispetto allo stadio precedente. */
  stepRate: number;
  /** Quota sul totale di partenza. */
  totalRate: number;
}

/** Calcola i tassi di passaggio a partire dagli stadi e dalla base. */
export function buildFunnel(base: number, stages: FunnelStageInput[]): FunnelStage[] {
  let previous = base;
  return stages.map((stage) => {
    const row: FunnelStage = {
      ...stage,
      stepRate: safeRate(stage.value, previous),
      totalRate: safeRate(stage.value, base),
    };
    previous = stage.value;
    return row;
  });
}

export interface FunnelChartProps {
  /** Destinatari di partenza: è il fondo scala delle barre. */
  base: number;
  stages: FunnelStageInput[];
  loading?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  baseLabel?: string;
  height?: number;
  className?: string;
}

/**
 * Imbuto di conversione.
 *
 * Una sola tonalità per tutte le barre: gli stadi sono la stessa misura in
 * momenti diversi, quindi il colore non deve distinguerli. Il binario dietro
 * ogni barra rappresenta la base e rende immediato il calo.
 */
export function FunnelChart({
  base,
  stages,
  loading = false,
  title = 'Imbuto di conversione',
  description = 'Dal recapito all’ordine: quanti destinatari superano ogni passaggio.',
  baseLabel = 'Destinatari di partenza',
  height = 220,
  className,
}: FunnelChartProps) {
  const palette = useAnalyticsPalette();
  const rows = React.useMemo(() => buildFunnel(base, stages), [base, stages]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton style={{ height }} className="w-full" />
        ) : base <= 0 ? (
          <EmptyState
            compact
            className="justify-center"
            style={{ minHeight: height }}
            icon={<Filter />}
            title="Imbuto non ancora disponibile"
            description="I passaggi compaiono appena partono i primi invii e arrivano gli eventi da Brevo."
          />
        ) : (
          <>
            <div style={{ height }} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={rows}
                  barCategoryGap={14}
                  margin={{ top: 4, right: 84, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide domain={[0, base]} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={96}
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
                    background={{ fill: palette.track, radius: 4 }}
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
                <dt className="text-muted-foreground">{baseLabel}</dt>
                <dd className="ml-auto font-medium tabular-nums text-foreground">
                  {formatNumber(base)}
                </dd>
              </div>
              {rows.map((stage) => (
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
