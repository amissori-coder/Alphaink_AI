'use client';

import { Users } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import { TimeSeriesChart, type TimeSeriesDatum } from './time-series-chart';
import type { DashboardAudience, DashboardSeriesPoint } from './types';

export interface ListHealthCardProps {
  audience: DashboardAudience | undefined;
  series: DashboardSeriesPoint[];
  loading?: boolean;
  className?: string;
}

/**
 * Andamento della lista: composizione della rubrica e uscite del periodo.
 *
 * Le disiscrizioni e i recapiti falliti sono misurati giorno per giorno; le
 * nuove iscrizioni arrivano invece dalla sincronizzazione del negozio e non
 * hanno una serie giornaliera, perciò la variazione mostrata è la sola perdita
 * netta del periodo — ed è dichiarata come tale.
 */
export function ListHealthCard({
  audience,
  series,
  loading = false,
  className,
}: ListHealthCardProps) {
  const data: TimeSeriesDatum[] = React.useMemo(
    () =>
      series.map((point) => ({
        day: point.day,
        unsubscribed: point.unsubscribed,
        bounced: point.softBounces + point.hardBounces + point.blocked,
      })),
    [series],
  );

  const totals = React.useMemo(
    () =>
      series.reduce(
        (acc, point) => ({
          unsubscribed: acc.unsubscribed + point.unsubscribed,
          bounced: acc.bounced + point.softBounces + point.hardBounces + point.blocked,
        }),
        { unsubscribed: 0, bounced: 0 },
      ),
    [series],
  );

  const total = audience?.total ?? 0;
  const rows = [
    { label: 'Contatti in rubrica', value: formatNumber(total) },
    {
      label: 'Iscritti contattabili',
      value: `${formatNumber(audience?.subscribed ?? 0)}${
        total > 0 ? ` · ${formatPercent((audience?.subscribed ?? 0) / total)}` : ''
      }`,
    },
    { label: 'Disiscritti', value: formatNumber(audience?.unsubscribed ?? 0) },
    { label: 'Non contattabili', value: formatNumber(audience?.notSendable ?? 0) },
    { label: 'Disiscrizioni nel periodo', value: `− ${formatNumber(totals.unsubscribed)}` },
    { label: 'Recapiti falliti nel periodo', value: `− ${formatNumber(totals.bounced)}` },
  ];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" aria-hidden="true" />
          Andamento della lista
        </CardTitle>
        <CardDescription>
          Composizione della rubrica e uscite registrate nel periodo osservato.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <dl className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="bg-card px-3 py-2">
                <dt className="truncate text-xs text-muted-foreground">{row.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <TimeSeriesChart
          data={data}
          kind="bar"
          height={200}
          loading={loading}
          series={[
            { key: 'unsubscribed', label: 'Disiscrizioni' },
            { key: 'bounced', label: 'Recapiti falliti' },
          ]}
          emptyTitle="Nessuna uscita nel periodo"
          emptyDescription="Nessuna disiscrizione né recapito fallito: la lista è stabile."
        />
      </CardContent>
    </Card>
  );
}
