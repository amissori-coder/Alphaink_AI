'use client';

import { LineChart, Table2 } from 'lucide-react';
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

import {
  formatDayLabel,
  formatDayLabelLong,
  useChartPalette,
} from '@/components/dashboard/chart-theme';
import { DashboardPanel } from '@/components/dashboard/panel';
import type { DashboardSeriesPoint } from '@/components/dashboard/types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/lib/utils';

/** Serie del grafico, in ordine fisso: il colore segue la serie, mai il valore. */
const SERIES = [
  { key: 'sent', label: 'Invii' },
  { key: 'uniqueOpened', label: 'Aperture' },
  { key: 'uniqueClicked', label: 'Click' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadEntry[];
  partialDays: Set<string>;
}

/** Tooltip in italiano, con i tre valori del giorno puntato. */
function ChartTooltip({ active, label, payload, partialDays }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const day = String(label ?? '');

  return (
    <div className="min-w-[11rem] rounded-md border border-border bg-popover p-3 text-xs shadow-popover">
      <p className="mb-2 font-medium capitalize text-foreground">{formatDayLabelLong(day)}</p>
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
      {partialDays.has(day) ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Giorno ancora in corso.</p>
      ) : null}
    </div>
  );
}

export interface PerformanceChartProps {
  series: DashboardSeriesPoint[];
  loading: boolean;
  className?: string;
}

/** Andamento giornaliero di invii, aperture e click. */
export function PerformanceChart({ series, loading, className }: PerformanceChartProps) {
  const palette = useChartPalette();
  const [view, setView] = React.useState<'chart' | 'table'>('chart');

  const partialDays = React.useMemo(
    () => new Set(series.filter((point) => point.partial).map((point) => point.day)),
    [series],
  );

  const hasData = series.some(
    (point) => point.sent > 0 || point.uniqueOpened > 0 || point.uniqueClicked > 0,
  );

  // Con molti giorni si diradano le etichette dell'asse orizzontale.
  const tickInterval = Math.max(0, Math.ceil(series.length / 8) - 1);

  return (
    <DashboardPanel
      className={className}
      icon={<LineChart />}
      title="Performance nel tempo"
      description="Invii, aperture e click giorno per giorno."
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView((current) => (current === 'chart' ? 'table' : 'chart'))}
          aria-pressed={view === 'table'}
        >
          {view === 'chart' ? <Table2 aria-hidden="true" /> : <LineChart aria-hidden="true" />}
          {view === 'chart' ? 'Tabella' : 'Grafico'}
        </Button>
      }
    >
      {loading ? (
        <Skeleton className="h-[288px] w-full" />
      ) : !hasData ? (
        <EmptyState
          compact
          className="h-[288px] justify-center"
          icon={<LineChart />}
          title="Nessun invio nel periodo"
          description="Quando le newsletter e le automazioni inizieranno a spedire, qui comparirà l’andamento giornaliero."
        />
      ) : view === 'table' ? (
        <div className="max-h-[288px] overflow-auto scrollbar-thin">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Giorno</TableHead>
                <TableHead className="text-right">Invii</TableHead>
                <TableHead className="text-right">Aperture</TableHead>
                <TableHead className="text-right">Click</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((point) => (
                <TableRow key={point.day}>
                  <TableCell className="whitespace-nowrap capitalize">
                    {formatDayLabelLong(point.day)}
                    {point.partial ? (
                      <span className="ml-1 text-xs text-muted-foreground">(in corso)</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(point.sent)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(point.uniqueOpened)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(point.uniqueClicked)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {SERIES.map((entry, index) => (
              <li key={entry.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: palette.series[index] }}
                  aria-hidden="true"
                />
                {entry.label}
              </li>
            ))}
          </ul>
          <div className="h-[248px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={palette.grid} strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  interval={tickInterval}
                  tickMargin={8}
                  tick={{ fill: palette.axis, fontSize: 11 }}
                  tickFormatter={formatDayLabel}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  allowDecimals={false}
                  tick={{ fill: palette.axis, fontSize: 11 }}
                  tickFormatter={(value: number) => formatNumber(value)}
                />
                <Tooltip
                  cursor={{ stroke: palette.axis, strokeWidth: 1, strokeOpacity: 0.4 }}
                  content={<ChartTooltip partialDays={partialDays} />}
                />
                {SERIES.map((entry, index) => (
                  <Area
                    key={entry.key}
                    type="monotone"
                    dataKey={entry.key satisfies SeriesKey}
                    name={entry.label}
                    stroke={palette.series[index]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill={palette.series[index]}
                    fillOpacity={0.1}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: palette.series[index],
                      stroke: palette.surface,
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </DashboardPanel>
  );
}
