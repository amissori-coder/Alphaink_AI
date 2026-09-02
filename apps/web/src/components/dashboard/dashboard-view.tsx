'use client';

import { CircleAlert, Info, Plus, RefreshCw, Users } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { AutomationsStatus } from '@/components/dashboard/automations-status';
import { BrevoNotice } from '@/components/dashboard/brevo-notice';
import { ChannelRevenueChart } from '@/components/dashboard/channel-revenue-chart';
import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { PerformanceChart } from '@/components/dashboard/performance-chart';
import { RecentNewsletters } from '@/components/dashboard/recent-newsletters';
import { SyncStatus } from '@/components/dashboard/sync-status';
import { UpcomingSends } from '@/components/dashboard/upcoming-sends';
import {
  type DashboardPeriod,
  PERIOD_LABELS,
  useDashboardMetrics,
} from '@/components/dashboard/use-dashboard-metrics';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth-context';
import { formatDateIt, formatNumber, relativeTimeIt } from '@/lib/utils';

/** Primo nome dell'utente, per il saluto in intestazione. */
function firstName(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed.split('@')[0] ?? '';
  return trimmed.split(/\s+/)[0] ?? '';
}

/** Pannello di controllo: metriche del periodo, grafici e stato operativo. */
export function DashboardView() {
  const { appUser, user, can } = useAuth();
  const [period, setPeriod] = React.useState<DashboardPeriod>(30);

  const canReadAnalytics = can('analytics:read');
  const metrics = useDashboardMetrics({ days: period, enabled: canReadAnalytics });
  const data = metrics.data;

  const name = firstName(appUser?.displayName || user?.displayName || user?.email);
  const rangeLabel = data
    ? `${formatDateIt(data.range.from)} – ${formatDateIt(data.range.to)}`
    : PERIOD_LABELS[period];

  const emptyAudience = Boolean(data) && data!.audience.total === 0;
  const hasMissingDays = (data?.missingDays.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Periodo osservato · ${rangeLabel}`}
        title={name ? `Ciao ${name}` : 'Panoramica'}
        description="Andamento degli invii, dei click e del fatturato generato dalle email AlphaInk."
        actions={
          <>
            <PeriodSelector value={period} onChange={setPeriod} disabled={!canReadAnalytics} />
            <Button
              variant="outline"
              size="icon"
              onClick={() => void metrics.refetch()}
              disabled={!canReadAnalytics || metrics.isFetching}
              aria-label="Aggiorna le metriche"
            >
              <RefreshCw
                className={metrics.isFetching ? 'animate-spin' : undefined}
                aria-hidden="true"
              />
            </Button>
            {can('newsletter:write') ? (
              <Button size="sm" asChild>
                <Link href="/newsletter">
                  <Plus aria-hidden="true" />
                  Nuova newsletter
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <BrevoNotice />

      {!canReadAnalytics ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Metriche non disponibili</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di consultare le statistiche di invio.
          </AlertDescription>
        </Alert>
      ) : null}

      {metrics.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Impossibile caricare le metriche</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{metrics.error?.message ?? 'Si è verificato un errore imprevisto.'}</span>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => void metrics.refetch()}
              loading={metrics.isFetching}
            >
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {emptyAudience ? (
        <Alert variant="info">
          <Users aria-hidden="true" />
          <AlertTitle>Nessun contatto in rubrica</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Avvia una sincronizzazione con i negozi PrestaShop o importa un file CSV per popolare la
              rubrica e iniziare a inviare.
            </span>
            {can('contacts:read') ? (
              <Button size="sm" variant="outline" className="shrink-0" asChild>
                <Link href="/contatti">Vai ai contatti</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <MetricsCards data={data} loading={metrics.isLoading && canReadAnalytics} period={period} />

      <div className="grid gap-4 lg:grid-cols-3">
        <PerformanceChart
          className="lg:col-span-2"
          series={data?.series ?? []}
          loading={metrics.isLoading && canReadAnalytics}
        />
        <ChannelRevenueChart
          newsletter={data?.channels.newsletter}
          automation={data?.channels.automation}
          storeRevenue={data?.store.revenue ?? 0}
          emailRevenueShare={data?.emailRevenueShare ?? 0}
          currency={data?.store.currency || 'EUR'}
          loading={metrics.isLoading && canReadAnalytics}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <UpcomingSends />
        <RecentNewsletters />
        <AutomationsStatus />
      </div>

      <SyncStatus />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data
            ? `Metriche aggiornate ${relativeTimeIt(data.computedAt)} · fuso ${data.timezone}`
            : 'Metriche non ancora calcolate.'}
        </span>
        {hasMissingDays ? (
          <span>
            {formatNumber(data?.missingDays.length ?? 0)} giorni non ancora consolidati: i totali
            potrebbero salire.
          </span>
        ) : null}
      </div>
    </div>
  );
}
