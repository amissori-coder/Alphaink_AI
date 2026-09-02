'use client';

import { DEFAULT_CURRENCY } from '@alphaink/shared';
import { BarChart3 } from 'lucide-react';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { formatAxisValue, formatValue, type ValueFormat } from './format';
import { useAnalyticsPalette } from './palette';

export interface ComparisonSeries {
  id: string;
  label: string;
}

export interface ComparisonCategory {
  key: string;
  label: string;
}

export interface ComparisonBarsProps {
  /** Gruppi sull'asse orizzontale: le metriche messe a confronto. */
  categories: ComparisonCategory[];
  /** Elementi confrontati (al massimo cinque): il colore segue la serie. */
  series: ComparisonSeries[];
  /** Valore di una serie per una categoria. */
  value: (categoryKey: string, seriesId: string) => number;
  /** Unità comune a tutte le categorie del grafico. */
  format?: ValueFormat;
  currency?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  loading?: boolean;
  height?: number;
  className?: string;
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
}

interface ComparisonTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  series: ComparisonSeries[];
  colors: string[];
  format: ValueFormat;
  currency: string;
}

function ComparisonTooltip({
  active,
  label,
  payload,
  series,
  colors,
  format,
  currency,
}: ComparisonTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-[14rem] rounded-md border border-border bg-popover p-3 text-xs shadow-popover">
      <p className="mb-2 font-medium text-popover-foreground">{String(label ?? '')}</p>
      <ul className="space-y-1">
        {series.map((item, index) => {
          const entry = payload.find((row) => row.dataKey === item.id);
          if (!entry) return null;
          return (
            <li key={item.id} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colors[index] }}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate text-muted-foreground">{item.label}</span>
              <span className="ml-auto font-medium tabular-nums text-popover-foreground">
                {formatValue(Number(entry.value ?? 0), format, currency)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Barre affiancate per confrontare più elementi sulle stesse metriche.
 *
 * Tutte le categorie del grafico devono condividere l'unità di misura: mettere
 * insieme conteggi e percentuali su un solo asse falserebbe il confronto. Per
 * unità diverse si usano più grafici.
 */
export function ComparisonBars({
  categories,
  series,
  value,
  format = 'number',
  currency = DEFAULT_CURRENCY,
  title,
  description,
  loading = false,
  height = 300,
  className,
}: ComparisonBarsProps) {
  const palette = useAnalyticsPalette();
  const colors = React.useMemo(
    () => series.map((_, index) => palette.series[index % palette.series.length] as string),
    [series, palette],
  );

  const data = React.useMemo(
    () =>
      categories.map((category) => {
        const row: Record<string, string | number> = { category: category.label };
        for (const item of series) row[item.id] = value(category.key, item.id);
        return row;
      }),
    [categories, series, value],
  );

  const hasValues = data.some((row) => series.some((item) => Number(row[item.id] ?? 0) > 0));

  const body = loading ? (
    <Skeleton style={{ height }} className="w-full" />
  ) : series.length === 0 || !hasValues ? (
    <EmptyState
      compact
      className="justify-center"
      style={{ minHeight: height }}
      icon={<BarChart3 />}
      title="Nessun dato da confrontare"
      description="Seleziona almeno un elemento con statistiche disponibili."
    />
  ) : (
    <>
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colors[index] }}
              aria-hidden="true"
            />
            <span className="max-w-[16rem] truncate">{item.label}</span>
          </li>
        ))}
      </ul>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="category"
              stroke={palette.axis}
              tick={{ fill: palette.axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={64}
              stroke={palette.axis}
              tick={{ fill: palette.axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(raw: number) => formatAxisValue(raw, format, currency)}
            />
            <Tooltip
              cursor={{ fill: palette.grid, fillOpacity: 0.35 }}
              content={
                <ComparisonTooltip
                  series={series}
                  colors={colors}
                  format={format}
                  currency={currency}
                />
              }
            />
            {series.map((item, index) => (
              <Bar
                key={item.id}
                dataKey={item.id}
                name={item.label}
                fill={colors[index]}
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );

  if (!title && !description) return <div className={className}>{body}</div>;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex-1">{body}</CardContent>
    </Card>
  );
}
