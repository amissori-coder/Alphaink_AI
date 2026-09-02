'use client';

import { Wallet } from 'lucide-react';
import * as React from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { useChartPalette } from '@/components/dashboard/chart-theme';
import { DashboardPanel } from '@/components/dashboard/panel';
import type { ChannelMetrics } from '@/components/dashboard/types';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

export interface ChannelRevenueChartProps {
  newsletter?: ChannelMetrics;
  automation?: ChannelMetrics;
  /** Fatturato complessivo del negozio nel periodo. */
  storeRevenue: number;
  /** Quota del fatturato del negozio attribuita alle email (0-1). */
  emailRevenueShare: number;
  currency: string;
  loading: boolean;
  className?: string;
}

/** Fatturato attribuito, confrontato fra newsletter e automazioni. */
export function ChannelRevenueChart({
  newsletter,
  automation,
  storeRevenue,
  emailRevenueShare,
  currency,
  loading,
  className,
}: ChannelRevenueChartProps) {
  const palette = useChartPalette();

  const data = React.useMemo(
    () => [
      {
        key: 'newsletter',
        label: 'Newsletter',
        revenue: newsletter?.revenue ?? 0,
        orders: newsletter?.orders ?? 0,
        color: palette.series[0],
      },
      {
        key: 'automation',
        label: 'Automazioni',
        revenue: automation?.revenue ?? 0,
        orders: automation?.orders ?? 0,
        color: palette.series[1],
      },
    ],
    [automation, newsletter, palette.series],
  );

  const total = data.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <DashboardPanel
      className={className}
      icon={<Wallet />}
      title="Fatturato per canale"
      description="Ordini attribuiti alle email nel periodo selezionato."
    >
      {loading ? (
        <Skeleton className="h-[288px] w-full" />
      ) : total <= 0 ? (
        <EmptyState
          compact
          className="h-[288px] justify-center"
          icon={<Wallet />}
          title="Nessun ordine attribuito"
          description="Appena un cliente acquisterà dopo aver aperto una email, il fatturato comparirà qui."
        />
      ) : (
        <div className="flex h-[288px] flex-col">
          <div className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data}
                barCategoryGap={16}
                margin={{ top: 4, right: 76, bottom: 0, left: 0 }}
              >
                <XAxis type="number" hide domain={[0, (max: number) => max * 1.25]} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={92}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: palette.axis, fontSize: 12 }}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
                  {data.map((row) => (
                    <Cell key={row.key} fill={row.color} />
                  ))}
                  <LabelList
                    dataKey="revenue"
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

          <dl className="mt-auto space-y-2 border-t border-border pt-4 text-sm">
            {data.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="ml-auto tabular-nums text-foreground">
                  {formatNumber(row.orders)} ordini
                </dd>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <dt className="text-muted-foreground">Quota sul fatturato del negozio</dt>
              <dd className="ml-auto font-medium tabular-nums text-foreground">
                {formatPercent(emailRevenueShare, 1)}
              </dd>
            </div>
            <div className="pt-1 text-xs text-muted-foreground">
              Negozio: {formatCurrency(storeRevenue, currency)} nel periodo.
            </div>
          </dl>
        </div>
      )}
    </DashboardPanel>
  );
}
