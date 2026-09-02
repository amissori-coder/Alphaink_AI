'use client';

import { ATTRIBUTION_MODEL_LABELS, DEFAULT_CURRENCY, formatCurrency, safeRate } from '@alphaink/shared';
import type { AttributionSettings } from '@alphaink/shared';
import { Euro } from 'lucide-react';
import * as React from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatPercent } from '@/lib/utils';

import { useAnalyticsPalette } from './palette';

export interface RevenueByChannelProps {
  /** Fatturato del negozio nel periodo, indipendente dall'attribuzione. */
  storeRevenue: number;
  newsletterRevenue: number;
  automationRevenue: number;
  currency?: string;
  /** Configurazione di attribuzione attiva, per dichiarare come sono calcolati i numeri. */
  attribution?: AttributionSettings | null;
  loading?: boolean;
  className?: string;
}

/**
 * Ripartizione del fatturato fra i canali email e il resto del negozio.
 *
 * Il fatturato attribuito dipende dal modello di attribuzione attivo: il
 * modello e le sue finestre sono dichiarati sotto al grafico, perché cambiarli
 * cambia i numeri.
 */
export function RevenueByChannel({
  storeRevenue,
  newsletterRevenue,
  automationRevenue,
  currency = DEFAULT_CURRENCY,
  attribution = null,
  loading = false,
  className,
}: RevenueByChannelProps) {
  const palette = useAnalyticsPalette();

  const attributed = newsletterRevenue + automationRevenue;
  const remainder = Math.max(0, storeRevenue - attributed);

  const data = React.useMemo(
    () => [
      { key: 'newsletter', label: 'Newsletter', value: newsletterRevenue, color: palette.series[0] },
      { key: 'automation', label: 'Automazioni', value: automationRevenue, color: palette.series[1] },
      { key: 'other', label: 'Altri canali', value: remainder, color: palette.track },
    ],
    [newsletterRevenue, automationRevenue, remainder, palette],
  );

  const total = Math.max(storeRevenue, attributed);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Euro className="size-4 text-primary" aria-hidden="true" />
          Fatturato per canale
        </CardTitle>
        <CardDescription>
          Quanto del fatturato del negozio è riconducibile alle email inviate nel periodo.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="h-44 w-full" />
        ) : total <= 0 ? (
          <EmptyState
            compact
            className="min-h-44 justify-center"
            icon={<Euro />}
            title="Nessun fatturato nel periodo"
            description="I ricavi compaiono quando la sincronizzazione porta ordini nel periodo osservato."
          />
        ) : (
          <>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={data}
                  barCategoryGap={12}
                  margin={{ top: 4, right: 96, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" hide domain={[0, total]} />
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
                    radius={[0, 4, 4, 0]}
                    maxBarSize={26}
                    isAnimationActive={false}
                    background={{ fill: palette.track, radius: 4, fillOpacity: 0.5 }}
                  >
                    {data.map((row) => (
                      <Cell key={row.key} fill={row.color} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={10}
                      fill={palette.text}
                      fontSize={12}
                      formatter={(value: number) => formatCurrency(value, currency)}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <dl className="space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Fatturato del negozio</dt>
                <dd className="ml-auto font-medium tabular-nums text-foreground">
                  {formatCurrency(storeRevenue, currency)}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Attribuito alle email</dt>
                <dd className="ml-auto font-medium tabular-nums text-foreground">
                  {formatCurrency(attributed, currency)}{' '}
                  <span className="text-muted-foreground">
                    ({formatPercent(safeRate(attributed, storeRevenue))})
                  </span>
                </dd>
              </div>
            </dl>

            {attribution ? (
              <p className="text-xs text-muted-foreground">
                Modello di attribuzione:{' '}
                <span className="font-medium text-foreground">
                  {ATTRIBUTION_MODEL_LABELS[attribution.model]}
                </span>{' '}
                · finestra click {attribution.clickWindowDays}{' '}
                {attribution.clickWindowDays === 1 ? 'giorno' : 'giorni'} · finestra apertura{' '}
                {attribution.openWindowDays}{' '}
                {attribution.openWindowDays === 1 ? 'giorno' : 'giorni'}
                {attribution.couponOverridesModel
                  ? ' · il codice coupon ha sempre la precedenza'
                  : ''}
                .
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
