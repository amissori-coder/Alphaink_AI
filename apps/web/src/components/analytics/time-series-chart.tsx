'use client';

import { DEFAULT_CURRENCY } from '@alphaink/shared';
import { LineChart as LineChartIcon } from 'lucide-react';
import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { formatAxisValue, formatValue, type ValueFormat } from './format';
import { formatDayLabel, formatDayLabelLong, useAnalyticsPalette } from './palette';

export interface TimeSeriesDatum {
  /** Chiave giorno `YYYY-MM-DD`: è anche l'etichetta dell'asse. */
  day: string;
  [metric: string]: number | string | boolean;
}

export interface TimeSeriesSeries {
  key: string;
  label: string;
}

export interface TimeSeriesChartProps {
  data: TimeSeriesDatum[];
  /** Al massimo cinque serie: oltre, il colore smette di identificare. */
  series: TimeSeriesSeries[];
  kind?: 'area' | 'line' | 'bar';
  format?: ValueFormat;
  currency?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Contenuto a destra dell'intestazione (selettori, interruttori). */
  headerExtra?: React.ReactNode;
  loading?: boolean;
  height?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Nota a piè di grafico, es. sui giorni non consolidati. */
  footnote?: React.ReactNode;
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  series: TimeSeriesSeries[];
  colors: string[];
  format: ValueFormat;
  currency: string;
}

function ChartTooltip({
  active,
  label,
  payload,
  series,
  colors,
  format,
  currency,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="min-w-[13rem] rounded-md border border-border bg-popover p-3 text-xs shadow-popover">
      <p className="mb-2 font-medium capitalize text-popover-foreground">
        {formatDayLabelLong(String(label ?? ''))}
      </p>
      <ul className="space-y-1">
        {series.map((item, index) => {
          const entry = payload.find((row) => row.dataKey === item.key);
          if (!entry) return null;
          return (
            <li key={item.key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colors[index] }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{item.label}</span>
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
 * Serie temporale multi-metrica.
 *
 * Un solo asse dei valori: le metriche mostrate insieme devono condividere
 * l'unità di misura. Il colore segue la serie in ordine fisso, la legenda è
 * sempre presente quando le serie sono più di una.
 */
export function TimeSeriesChart({
  data,
  series,
  kind = 'area',
  format = 'number',
  currency = DEFAULT_CURRENCY,
  title,
  description,
  icon,
  headerExtra,
  loading = false,
  height = 300,
  emptyTitle = 'Nessun dato nel periodo',
  emptyDescription = 'I valori compaiono appena vengono registrati i primi invii.',
  className,
  footnote,
}: TimeSeriesChartProps) {
  const palette = useAnalyticsPalette();
  const colors = React.useMemo(
    () => series.map((_, index) => palette.series[index % palette.series.length] as string),
    [series, palette],
  );
  const gradientId = React.useId();

  const hasValues = data.some((point) =>
    series.some((item) => Number(point[item.key] ?? 0) > 0),
  );

  const axisProps = {
    stroke: palette.axis,
    tick: { fill: palette.axis, fontSize: 12 },
    tickLine: false,
    axisLine: false,
  } as const;

  const renderChart = () => {
    const common = {
      data,
      margin: { top: 8, right: 8, bottom: 0, left: 0 },
    };

    const shared = (
      <>
        <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tickFormatter={formatDayLabel} minTickGap={24} {...axisProps} />
        <YAxis
          width={64}
          tickFormatter={(value: number) => formatAxisValue(value, format, currency)}
          {...axisProps}
        />
        <Tooltip
          cursor={{ stroke: palette.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
          content={
            <ChartTooltip series={series} colors={colors} format={format} currency={currency} />
          }
        />
      </>
    );

    if (kind === 'bar') {
      return (
        <BarChart {...common} barCategoryGap={4}>
          {shared}
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              name={item.label}
              fill={colors[index]}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              maxBarSize={28}
            />
          ))}
        </BarChart>
      );
    }

    if (kind === 'line') {
      return (
        <LineChart {...common}>
          {shared}
          {series.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={colors[index]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      );
    }

    return (
      <AreaChart {...common}>
        <defs>
          {series.map((item, index) => (
            <linearGradient
              key={item.key}
              id={`${gradientId}-${item.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={colors[index]} stopOpacity={0.24} />
              <stop offset="100%" stopColor={colors[index]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {shared}
        {series.map((item, index) => (
          <Area
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={colors[index]}
            strokeWidth={2}
            fill={`url(#${gradientId}-${item.key})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  };

  const body = loading ? (
    <Skeleton style={{ height }} className="w-full" />
  ) : data.length === 0 || !hasValues ? (
    <EmptyState
      compact
      className="justify-center"
      style={{ minHeight: height }}
      icon={<LineChartIcon />}
      title={emptyTitle}
      description={emptyDescription}
    />
  ) : (
    <>
      {series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {series.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: colors[index] }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
      {footnote ? <p className="mt-3 text-xs text-muted-foreground">{footnote}</p> : null}
    </>
  );

  if (!title && !description) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            {icon ? (
              <span className="text-primary [&_svg]:size-4" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            {title}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {headerExtra ? <div className="shrink-0">{headerExtra}</div> : null}
      </CardHeader>
      <CardContent className="flex-1">{body}</CardContent>
    </Card>
  );
}
