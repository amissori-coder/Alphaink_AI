'use client';

import { CalendarClock } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { formatValue, type ValueFormat } from './format';
import { sequentialColor, useAnalyticsPalette } from './palette';

/** Righe della mappa: la settimana italiana comincia di lunedì. */
const WEEKDAYS: Array<{ index: number; label: string; short: string }> = [
  { index: 1, label: 'Lunedì', short: 'Lun' },
  { index: 2, label: 'Martedì', short: 'Mar' },
  { index: 3, label: 'Mercoledì', short: 'Mer' },
  { index: 4, label: 'Giovedì', short: 'Gio' },
  { index: 5, label: 'Venerdì', short: 'Ven' },
  { index: 6, label: 'Sabato', short: 'Sab' },
  { index: 0, label: 'Domenica', short: 'Dom' },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Matrice vuota 7×24, indicizzata per giorno della settimana (0 = domenica). */
export function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

export interface HeatmapChartProps {
  /** Matrice 7×24: `values[giornoSettimana][ora]`, con 0 = domenica. */
  values: number[][];
  loading?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Nome dell'unità misurata, usato nei tooltip ("aperture"). */
  unitLabel?: string;
  format?: ValueFormat;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Nota esplicativa sotto la mappa. */
  footnote?: React.ReactNode;
  className?: string;
}

/**
 * Mappa di calore giorno × ora.
 *
 * Costruita con una tabella e celle colorate — non con un grafico — così ogni
 * cella resta leggibile dagli screen reader e la griglia non dipende da un
 * canvas. La scala è sequenziale a tinta unica: più scuro significa più alto,
 * e il valore nullo resta sul grigio del binario.
 */
export function HeatmapChart({
  values,
  loading = false,
  title = 'Aperture per giorno e ora',
  description = 'Quando i contatti aprono le email: utile per scegliere il momento di invio.',
  unitLabel = 'aperture',
  format = 'number',
  emptyTitle = 'Nessuna apertura registrata',
  emptyDescription = 'La mappa si popola con gli eventi orari delle newsletter inviate nel periodo.',
  footnote,
  className,
}: HeatmapChartProps) {
  const palette = useAnalyticsPalette();

  const max = React.useMemo(
    () => values.reduce((best, row) => Math.max(best, ...row.map((value) => value || 0)), 0),
    [values],
  );

  const best = React.useMemo(() => {
    let peak: { weekday: number; hour: number; value: number } | null = null;
    values.forEach((row, weekday) => {
      row.forEach((value, hour) => {
        if (!peak || value > peak.value) peak = { weekday, hour, value };
      });
    });
    return peak as { weekday: number; hour: number; value: number } | null;
  }, [values]);

  const bestLabel =
    best && best.value > 0
      ? `${WEEKDAYS.find((day) => day.index === best.weekday)?.label ?? ''} alle ${String(
          best.hour,
        ).padStart(2, '0')}:00`
      : null;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : max <= 0 ? (
          <EmptyState
            compact
            className="min-h-56 justify-center"
            icon={<CalendarClock />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] border-separate border-spacing-[2px]">
                <caption className="sr-only">
                  Distribuzione delle {unitLabel} per giorno della settimana e ora del giorno.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-10">
                      <span className="sr-only">Giorno</span>
                    </th>
                    {HOURS.map((hour) => (
                      <th
                        key={hour}
                        scope="col"
                        className="text-center text-[10px] font-normal text-muted-foreground"
                      >
                        <span aria-hidden="true">{hour % 3 === 0 ? hour : ''}</span>
                        <span className="sr-only">Ore {String(hour).padStart(2, '0')}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map((day) => (
                    <tr key={day.index}>
                      <th
                        scope="row"
                        className="pr-2 text-right text-[11px] font-normal text-muted-foreground"
                      >
                        <span aria-hidden="true">{day.short}</span>
                        <span className="sr-only">{day.label}</span>
                      </th>
                      {HOURS.map((hour) => {
                        const value = values[day.index]?.[hour] ?? 0;
                        const intensity = max > 0 ? value / max : 0;
                        const readable = `${day.label} ore ${String(hour).padStart(2, '0')}: ${formatValue(
                          value,
                          format,
                        )} ${unitLabel}`;
                        return (
                          <td key={hour} className="p-0">
                            <div
                              className="h-6 w-full rounded-[3px]"
                              style={{ backgroundColor: sequentialColor(palette, intensity) }}
                              title={readable}
                              aria-label={readable}
                              role="img"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>0</span>
                <span className="flex overflow-hidden rounded" aria-hidden="true">
                  {palette.sequential.map((step) => (
                    <span key={step} className="size-4" style={{ backgroundColor: step }} />
                  ))}
                </span>
                <span>{formatValue(max, format)}</span>
                <span className="hidden sm:inline">{unitLabel}</span>
              </div>
              {bestLabel ? (
                <p className="text-xs text-muted-foreground">
                  Picco: <span className="font-medium text-foreground">{bestLabel}</span>
                </p>
              ) : null}
            </div>
          </>
        )}

        {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
      </CardContent>
    </Card>
  );
}
