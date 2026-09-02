'use client';

import { DEFAULT_CURRENCY, EMPTY_AUTOMATION_STATS } from '@alphaink/shared';
import {
  Activity,
  BadgePercent,
  CircleAlert,
  MailOpen,
  Send,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { FunnelChart } from '@/components/analytics/funnel-chart';
import { TimeSeriesChart, type TimeSeriesDatum } from '@/components/analytics/time-series-chart';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { StatCard } from '@/components/ui/stat-card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  cn,
  formatCurrency,
  formatDateTimeIt,
  formatNumber,
  formatPercent,
} from '@/lib/utils';

import { RECENT_SENDS_LIMIT } from './constants';
import { humanizeDelay } from './delay-input';
import type { AutomationRecentSend } from './types';
import { useAutomationReport } from './use-automations-data';

const PERIODS = [7, 30, 90] as const;
type StatsPeriod = (typeof PERIODS)[number];

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  7: '7 giorni',
  30: '30 giorni',
  90: '90 giorni',
};

export interface StatsTabProps {
  automationId: string;
  className?: string;
}

/**
 * Scheda "Statistiche": imbuto per step, andamento nel tempo, risultati
 * commerciali e ultimi invii.
 *
 * Serie storica e ultimi invii vengono dalle esecuzioni del periodo; l'imbuto
 * per step usa i contatori progressivi che il motore aggiorna a ogni evento.
 */
export function StatsTab({ automationId, className }: StatsTabProps) {
  const [period, setPeriod] = React.useState<StatsPeriod>(30);
  const report = useAutomationReport({
    automationId,
    days: period,
    recentLimit: RECENT_SENDS_LIMIT,
  });
  const data = report.data;
  const loading = report.isLoading;

  const stats = { ...EMPTY_AUTOMATION_STATS, ...(data?.stats ?? {}) };
  const currency = stats.currency || DEFAULT_CURRENCY;

  const totals = React.useMemo(
    () =>
      (data?.timeseries ?? []).reduce(
        (acc, point) => ({
          sent: acc.sent + point.sent,
          orders: acc.orders + point.converted,
          revenue: acc.revenue + point.revenue,
        }),
        { sent: 0, orders: 0, revenue: 0 },
      ),
    [data],
  );

  const series: TimeSeriesDatum[] = React.useMemo(
    () =>
      (data?.timeseries ?? []).map((point) => ({
        day: point.day,
        sent: point.sent,
        converted: point.converted,
      })),
    [data],
  );

  const revenueSeries: TimeSeriesDatum[] = React.useMemo(
    () => (data?.timeseries ?? []).map((point) => ({ day: point.day, revenue: point.revenue })),
    [data],
  );

  const recentColumns: DataTableColumn<AutomationRecentSend>[] = React.useMemo(
    () => [
      {
        id: 'email',
        header: 'Destinatario',
        sortValue: (row) => row.email,
        searchValue: (row) => row.email,
        cell: (row) => <span className="truncate font-medium text-foreground">{row.email}</span>,
      },
      {
        id: 'step',
        header: 'Step',
        hideOnMobile: true,
        sortValue: (row) => row.stepId,
        cell: (row) => {
          const step = data?.steps.find((item) => item.id === row.stepId);
          return <span className="text-muted-foreground">{step?.name ?? row.stepId}</span>;
        },
      },
      {
        id: 'sentAt',
        header: 'Inviata il',
        sortValue: (row) => (row.sentAt ? Date.parse(row.sentAt) : 0),
        cell: (row) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {row.sentAt ? formatDateTimeIt(row.sentAt) : '—'}
          </span>
        ),
      },
      {
        id: 'coupon',
        header: 'Coupon',
        hideOnMobile: true,
        sortValue: (row) => row.couponCode ?? '',
        cell: (row) =>
          row.couponCode ? (
            <Badge variant="secondary" className="font-mono text-[11px]">
              {row.couponCode}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'order',
        header: 'Esito',
        align: 'right',
        sortValue: (row) => row.revenue ?? 0,
        cell: (row) =>
          row.convertedOrderId ? (
            <span className="whitespace-nowrap font-medium tabular-nums text-success">
              {formatCurrency(row.revenue ?? 0, currency)}
            </span>
          ) : (
            <span className="text-muted-foreground">Nessun ordine</span>
          ),
      },
    ],
    [data, currency],
  );

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Statistiche calcolate sulle esecuzioni degli ultimi {period} giorni.
        </p>
        <ToggleGroup
          type="single"
          size="sm"
          value={String(period)}
          aria-label="Periodo delle statistiche"
          onValueChange={(next: string) => {
            if (!next) return;
            setPeriod(Number(next) as StatsPeriod);
          }}
        >
          {PERIODS.map((option) => (
            <ToggleGroupItem key={option} value={String(option)} className="px-3">
              {PERIOD_LABELS[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {report.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Statistiche non disponibili</AlertTitle>
          <AlertDescription>{report.error?.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Inviate · ${period} gg`}
          value={formatNumber(totals.sent)}
          icon={<Send />}
          loading={loading}
          sparkline={(data?.timeseries ?? []).map((point) => point.sent)}
        />
        <StatCard
          label={`Ordini · ${period} gg`}
          value={formatNumber(totals.orders)}
          icon={<ShoppingBag />}
          loading={loading}
          sparkline={(data?.timeseries ?? []).map((point) => point.converted)}
        />
        <StatCard
          label={`Fatturato · ${period} gg`}
          value={formatCurrency(totals.revenue, currency)}
          icon={<Wallet />}
          loading={loading}
          sparkline={(data?.timeseries ?? []).map((point) => point.revenue)}
        />
        <StatCard
          label="Tasso di apertura"
          value={formatPercent(data?.rates.openRate ?? 0)}
          hint="Progressivo dall’attivazione del flusso"
          icon={<MailOpen />}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TimeSeriesChart
          title="Invii e conversioni"
          description="Email partite e ordini attribuiti, giorno per giorno."
          icon={<Activity />}
          data={series}
          loading={loading}
          height={260}
          series={[
            { key: 'sent', label: 'Inviate' },
            { key: 'converted', label: 'Ordini attribuiti' },
          ]}
        />
        <TimeSeriesChart
          title="Fatturato attribuito"
          description="Ricavo degli ordini ricondotti a questa automazione."
          icon={<Wallet />}
          data={revenueSeries}
          loading={loading}
          kind="bar"
          format="currency"
          currency={currency}
          height={260}
          series={[{ key: 'revenue', label: 'Fatturato' }]}
        />
      </div>

      <section className="space-y-3" aria-labelledby="imbuto-step">
        <h3 id="imbuto-step" className="text-base font-semibold text-foreground">
          Imbuto per step
        </h3>
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelChart base={0} stages={[]} loading />
            <FunnelChart base={0} stages={[]} loading />
          </div>
        ) : (data?.steps.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Nessuno step configurato.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(data?.steps ?? []).map((step) => (
              <FunnelChart
                key={step.id}
                title={step.name}
                baseLabel="Esecuzioni programmate"
                description={`Invio ${
                  humanizeDelay(step.delay) === 'subito'
                    ? 'immediato'
                    : `dopo ${humanizeDelay(step.delay)}`
                } · annullate ${formatPercent(step.rates.cancelRate)}`}
                base={step.stats.scheduled || step.stats.sent}
                stages={[
                  { key: 'sent', label: 'Inviate', value: step.stats.sent },
                  { key: 'delivered', label: 'Consegnate', value: step.stats.delivered },
                  { key: 'opened', label: 'Aperte', value: step.stats.opened },
                  { key: 'clicked', label: 'Cliccate', value: step.stats.clicked },
                  { key: 'orders', label: 'Ordini', value: step.stats.orders },
                ]}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgePercent className="size-4 text-primary" aria-hidden="true" />
            Ultimi invii
          </CardTitle>
          <CardDescription>
            Le {RECENT_SENDS_LIMIT} esecuzioni più recenti con esito ed eventuale coupon emesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={data?.recent ?? []}
            columns={recentColumns}
            getRowId={(row) => row.runId}
            loading={loading}
            searchable
            searchPlaceholder="Cerca un destinatario…"
            pageSize={10}
            defaultSort={{ columnId: 'sentAt', direction: 'desc' }}
            emptyTitle="Nessun invio registrato"
            emptyDescription="Le esecuzioni compaiono qui appena l’automazione recapita la prima email."
            emptyIcon={<Send />}
          />
        </CardContent>
      </Card>

      {data ? (
        <p className="text-xs text-muted-foreground">
          Arruolati dall’attivazione: {formatNumber(stats.enrolled)} · annullate{' '}
          {formatNumber(stats.cancelled)} · consegnate {formatNumber(stats.delivered)}. Il dettaglio
          delle singole newsletter è nella{' '}
          <Link href="/analytics" className="text-primary hover:underline">
            sezione Analytics
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
