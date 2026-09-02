'use client';

import { Activity } from 'lucide-react';
import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useChartPalette } from '@/components/dashboard/chart-theme';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber } from '@/lib/utils';

import type { TimelinePoint } from './types';

/** Serie del grafico, in ordine fisso: il colore segue la serie, mai il valore. */
const SERIES = [
  { key: 'delivered', label: 'Consegnate' },
  { key: 'opened', label: 'Aperture' },
  { key: 'clicked', label: 'Click' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

function labelFor(bucket: string, granularity: 'hour' | 'day'): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short',
    ...(granularity === 'hour' ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function longLabelFor(bucket: string, granularity: 'hour' | 'day'): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    ...(granularity === 'hour' ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  granularity: 'hour' | 'day';
}

function ChartTooltip({ active, label, payload, granularity }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-[12rem] rounded-md border border-border bg-popover p-3 text-xs shadow-popover">
      <p className="mb-2 font-medium capitalize text-foreground">
        {longLabelFor(String(label ?? ''), granularity)}
      </p>
      <ul className="space-y-1">
        {SERIES.map((series) => {
          const entry = payload.find((item) => item.dataKey === series.key);
          if (!entry) return null;
          return (
            <li key={series.key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{series.label}</span>
              <span className="ml-auto font-medium tabular-nums text-foreground">
                {formatNumber(Number(entry.value ?? 0))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface TimelineChartProps {
  points: TimelinePoint[];
  granularity: 'hour' | 'day';
  loading?: boolean;
  className?: string;
}

/**
 * Andamento nel tempo di consegne, aperture e click.
 * La granularità arriva dal backend: oraria nelle prime 72 ore, poi giornaliera.
 */
export function TimelineChart({
  points,
  granularity,
  loading = false,
  className,
}: TimelineChartProps) {
  const palette = useChartPalette();
  const hasData = points.some(
    (point) => point.delivered > 0 || point.opened > 0 || point.clicked > 0,
  );

  const colorFor = (key: SeriesKey): string => {
    const index = SERIES.findIndex((series) => series.key === key);
    return palette.series[Math.max(index, 0)] ?? palette.series[0];
  };

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-primary" aria-hidden="true" />
          Andamento nel tempo
        </CardTitle>
        <CardDescription>
          {granularity === 'hour'
            ? 'Eventi ora per ora dalle prime spedizioni.'
            : 'Eventi giorno per giorno dall’inizio della spedizione.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasData ? (
          <EmptyState
            compact
            className="min-h-[260px] justify-center"
            icon={<Activity />}
            title="Nessun evento registrato"
            description="Aperture e click compaiono qui appena Brevo comincia a notificarli."
          />
        ) : (
          <>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    {SERIES.map((series) => (
                      <linearGradient
                        key={series.key}
                        id={`gradiente-${series.key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor={colorFor(series.key)} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={colorFor(series.key)} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tick={{ fill: palette.axis, fontSize: 11 }}
                    tickFormatter={(value: string) => labelFor(value, granularity)}
                  />
                  <YAxis
                    width={44}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: palette.axis, fontSize: 11 }}
                    tickFormatter={(value: number) => formatNumber(value)}
                  />
                  <Tooltip
                    content={<ChartTooltip granularity={granularity} />}
                    cursor={{ stroke: palette.grid }}
                  />
                  {SERIES.map((series) => (
                    <Area
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      stroke={colorFor(series.key)}
                      strokeWidth={2}
                      fill={`url(#gradiente-${series.key})`}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <ul className="flex flex-wrap gap-4 border-t border-border pt-3 text-xs">
              {SERIES.map((series) => (
                <li key={series.key} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: colorFor(series.key) }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground">{series.label}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
