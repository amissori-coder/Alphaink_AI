'use client';

import { CORE_AUTOMATION_KEYS, safeRate } from '@alphaink/shared';
import {
  Activity,
  CircleAlert,
  GitCompareArrows,
  Info,
  Laptop,
  MailCheck,
  MailOpen,
  MousePointerClick,
  RefreshCw,
  Send,
  Server,
  ShoppingBag,
  UserMinus,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { automationLabel, sortAutomations } from '@/components/automations/constants';
import {
  useAutomationReports,
  useAutomations,
} from '@/components/automations/use-automations-data';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useAuth } from '@/lib/auth-context';
import {
  formatCurrency,
  formatDateIt,
  formatDateTimeIt,
  formatNumber,
  formatPercent,
} from '@/lib/utils';

import { buildOpenHeatmap, mergeBreakdown, mergeTopLinks } from './aggregate';
import { AutomationsTable, type AutomationTableRow } from './automations-table';
import { BreakdownCard } from './breakdown-card';
import { FunnelChart } from './funnel-chart';
import { HeatmapChart } from './heatmap-chart';
import { ListHealthCard } from './list-health-card';
import { NewsletterTable } from './newsletter-table';
import { PeriodComparison } from './period-comparison';
import { PeriodPicker } from './period-picker';
import { RevenueByChannel } from './revenue-by-channel';
import { TimeSeriesChart, type TimeSeriesDatum } from './time-series-chart';
import { TopLinksCard } from './top-links-card';
import {
  DETAIL_REPORT_LIMIT,
  PERIOD_COMPARE_LABELS,
  type AnalyticsPeriod,
  useAnalyticsMetrics,
  useNewsletterReports,
  useTrackingSettings,
} from './use-analytics-data';

/** Variazione relativa fra due tassi, protetta dalla divisione per zero. */
function rateDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

/** Cruscotto analitico completo: metriche del periodo e confronto col precedente. */
export function AnalyticsView() {
  const { can } = useAuth();
  const canRead = can('analytics:read');
  const canReadAutomations = can('automations:read');

  const [period, setPeriod] = React.useState<AnalyticsPeriod>(30);
  const metrics = useAnalyticsMetrics({ days: period, enabled: canRead });
  const data = metrics.data;
  const tracking = useTrackingSettings(canRead);
  const currency = data?.store.currency || 'EUR';
  const compareLabel = PERIOD_COMPARE_LABELS[period];

  // --- Automazioni -----------------------------------------------------------
  const { data: automations, loading: automationsLoading } = useAutomations(canReadAutomations);
  const automationIds = React.useMemo(
    () => sortAutomations(automations).map((automation) => automation.id),
    [automations],
  );
  const automationReports = useAutomationReports(automationIds, {
    days: period,
    recentLimit: 1,
    enabled: canReadAutomations && automationIds.length > 0,
  });
  const automationRows: AutomationTableRow[] = React.useMemo(() => {
    const reportById = new Map(automationReports.map((entry) => [entry.automationId, entry.data]));
    return sortAutomations(automations).map((automation) => {
      const report = reportById.get(automation.id);
      const totals = (report?.timeseries ?? []).reduce(
        (acc, point) => ({
          sent: acc.sent + point.sent,
          orders: acc.orders + point.converted,
          revenue: acc.revenue + point.revenue,
        }),
        { sent: 0, orders: 0, revenue: 0 },
      );
      return {
        id: automation.id,
        name: automationLabel(automation),
        enabled: automation.enabled,
        testMode: automation.testMode,
        isCore: automation.isCore || CORE_AUTOMATION_KEYS.includes(automation.key),
        sent: totals.sent,
        orders: totals.orders,
        revenue: totals.revenue,
        enrolled: report?.stats.enrolled ?? automation.stats?.enrolled ?? 0,
        openRate: report?.rates.openRate ?? 0,
        clickRate: report?.rates.clickRate ?? 0,
      };
    });
  }, [automations, automationReports]);
  const automationsBusy = automationsLoading || automationReports.some((entry) => entry.loading);

  // --- Analisi degli eventi delle newsletter del periodo ----------------------
  const detailIds = React.useMemo(
    () => (data?.topNewsletters ?? []).slice(0, DETAIL_REPORT_LIMIT).map((row) => row.id),
    [data],
  );
  const detailReports = useNewsletterReports(detailIds, {
    enabled: canRead && detailIds.length > 0,
  });
  const detailData = React.useMemo(
    () => detailReports.map((entry) => entry.data),
    [detailReports],
  );
  const detailsBusy = detailReports.some((entry) => entry.loading);

  const heatmap = React.useMemo(
    () => buildOpenHeatmap(detailData, data?.timezone),
    [detailData, data?.timezone],
  );
  const topLinks = React.useMemo(() => mergeTopLinks(detailData, 10), [detailData]);
  const devices = React.useMemo(() => mergeBreakdown(detailData, 'devices'), [detailData]);
  const clients = React.useMemo(() => mergeBreakdown(detailData, 'clients'), [detailData]);

  // --- Serie principale ------------------------------------------------------
  const series: TimeSeriesDatum[] = React.useMemo(
    () =>
      (data?.series ?? []).map((point) => ({
        day: point.day,
        sent: point.sent,
        delivered: point.delivered,
        uniqueOpened: point.uniqueOpened,
        uniqueClicked: point.uniqueClicked,
      })),
    [data],
  );

  const totals = data?.totals;
  const previous = data?.previous?.totals;
  const deltas = data?.deltas ?? null;
  const loading = metrics.isLoading && canRead;

  const rangeLabel = data
    ? `${formatDateIt(data.range.from)} – ${formatDateIt(data.range.to)}`
    : '—';

  const previousRates = previous
    ? {
        openRate: safeRate(previous.uniqueOpened, previous.delivered),
        clickRate: safeRate(previous.uniqueClicked, previous.delivered),
        clickToOpenRate: safeRate(previous.uniqueClicked, previous.uniqueOpened),
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Periodo osservato · ${rangeLabel}`}
        title="Analytics"
        description="Consegne, aperture, click e fatturato attribuito: come stanno rendendo newsletter e automazioni."
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} disabled={!canRead} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Aggiorna i dati"
              disabled={!canRead || metrics.isFetching}
              onClick={() => void metrics.refetch()}
            >
              <RefreshCw
                className={metrics.isFetching ? 'animate-spin' : undefined}
                aria-hidden="true"
              />
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <Link href="/analytics/newsletter">
                <GitCompareArrows aria-hidden="true" />
                Confronta newsletter
              </Link>
            </Button>
          </>
        }
      />

      {!canRead ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Statistiche non disponibili</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di consultare i report di invio.
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
              loading={metrics.isFetching}
              onClick={() => void metrics.refetch()}
            >
              Riprova
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {canRead ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Email inviate"
              value={formatNumber(totals?.sent ?? 0)}
              icon={<Send />}
              loading={loading}
              change={deltas?.sent ?? null}
              changeLabel={compareLabel}
              sparkline={(data?.series ?? []).map((point) => point.sent)}
            />
            <StatCard
              label="Consegnate"
              value={formatNumber(totals?.delivered ?? 0)}
              hint={`Recapito ${formatPercent(data?.rates.deliveryRate ?? 0)}`}
              icon={<MailCheck />}
              loading={loading}
              change={deltas?.delivered ?? null}
              sparkline={(data?.series ?? []).map((point) => point.delivered)}
            />
            <StatCard
              label="Aperture uniche"
              value={formatNumber(totals?.uniqueOpened ?? 0)}
              hint={`Tasso ${formatPercent(data?.rates.openRate ?? 0)}`}
              icon={<MailOpen />}
              loading={loading}
              change={deltas?.uniqueOpened ?? null}
              sparkline={(data?.series ?? []).map((point) => point.uniqueOpened)}
            />
            <StatCard
              label="Click unici"
              value={formatNumber(totals?.uniqueClicked ?? 0)}
              hint={`Tasso ${formatPercent(data?.rates.clickRate ?? 0)}`}
              icon={<MousePointerClick />}
              loading={loading}
              change={deltas?.uniqueClicked ?? null}
              sparkline={(data?.series ?? []).map((point) => point.uniqueClicked)}
            />

            <StatCard
              label="Ordini attribuiti"
              value={formatNumber(totals?.orders ?? 0)}
              icon={<ShoppingBag />}
              loading={loading}
              change={deltas?.orders ?? null}
              changeLabel={compareLabel}
              sparkline={(data?.series ?? []).map((point) => point.orders)}
            />
            <StatCard
              label="Fatturato attribuito"
              value={formatCurrency(totals?.revenue ?? 0, currency)}
              hint={`${formatPercent(data?.emailRevenueShare ?? 0)} del fatturato del negozio`}
              icon={<Wallet />}
              loading={loading}
              change={deltas?.revenue ?? null}
              sparkline={(data?.series ?? []).map((point) => point.revenue)}
            />
            <StatCard
              label="Da apertura a click"
              value={formatPercent(data?.rates.clickToOpenRate ?? 0)}
              hint="Quanti fra chi apre poi clicca"
              icon={<Activity />}
              loading={loading}
              change={
                previousRates
                  ? rateDelta(data?.rates.clickToOpenRate ?? 0, previousRates.clickToOpenRate)
                  : null
              }
              changeLabel={compareLabel}
            />
            <StatCard
              label="Disiscrizioni"
              value={formatNumber(totals?.unsubscribed ?? 0)}
              hint={`Tasso ${formatPercent(data?.rates.unsubscribeRate ?? 0)}`}
              icon={<UserMinus />}
              loading={loading}
              invertChange
              change={deltas?.unsubscribed ?? null}
              changeLabel={compareLabel}
            />
          </div>

          {data && data.missingDays.length > 0 ? (
            <Alert variant="info">
              <Info aria-hidden="true" />
              <AlertTitle>Alcuni giorni non sono consolidati</AlertTitle>
              <AlertDescription>
                {data.missingDays.length}{' '}
                {data.missingDays.length === 1 ? 'giorno del periodo non è' : 'giorni del periodo non sono'}{' '}
                ancora {data.missingDays.length === 1 ? 'stato calcolato' : 'stati calcolati'} dal
                job notturno e {data.missingDays.length === 1 ? 'vale' : 'valgono'} zero nei totali.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <TimeSeriesChart
              className="lg:col-span-2"
              title="Andamento degli invii"
              description="Invii, recapiti, aperture e click giorno per giorno, su tutti i canali email."
              icon={<Activity />}
              data={series}
              loading={loading}
              height={320}
              series={[
                { key: 'sent', label: 'Inviate' },
                { key: 'delivered', label: 'Consegnate' },
                { key: 'uniqueOpened', label: 'Aperture uniche' },
                { key: 'uniqueClicked', label: 'Click unici' },
              ]}
              footnote="L’ultimo giorno può essere ancora parziale: i valori si assestano quando Brevo completa l’invio degli eventi."
            />

            <PeriodComparison
              current={totals}
              previous={previous}
              previousRange={data?.previous?.range ?? null}
              compareLabel={compareLabel}
              currency={currency}
              loading={loading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelChart
              base={totals?.sent ?? 0}
              baseLabel="Email inviate"
              loading={loading}
              description="Dall’invio all’ordine, sull’insieme di newsletter e automazioni del periodo."
              stages={[
                { key: 'delivered', label: 'Consegnate', value: totals?.delivered ?? 0 },
                { key: 'opened', label: 'Aperte', value: totals?.uniqueOpened ?? 0 },
                { key: 'clicked', label: 'Cliccate', value: totals?.uniqueClicked ?? 0 },
                { key: 'orders', label: 'Ordini', value: totals?.orders ?? 0 },
              ]}
            />
            <RevenueByChannel
              loading={loading}
              currency={currency}
              storeRevenue={data?.store.revenue ?? 0}
              newsletterRevenue={data?.channels.newsletter.revenue ?? 0}
              automationRevenue={data?.channels.automation.revenue ?? 0}
              attribution={tracking?.attribution ?? null}
            />
          </div>

          <NewsletterTable
            rows={data?.topNewsletters ?? []}
            loading={loading}
            currency={currency}
          />

          {canReadAutomations ? (
            <AutomationsTable
              rows={automationRows}
              loading={automationsBusy}
              periodDays={period}
              currency={currency}
            />
          ) : null}

          <HeatmapChart
            values={heatmap.values}
            loading={loading || detailsBusy}
            unitLabel="aperture"
            footnote={
              heatmap.contributing > 0
                ? `Calcolata sulle ${heatmap.contributing} newsletter del periodo con serie oraria disponibile${
                    heatmap.skipped > 0
                      ? `; ${heatmap.skipped} con serie aggregata per giorno non sono collocabili in una fascia oraria.`
                      : '.'
                  }`
                : 'La mappa usa le serie orarie dei report: sono disponibili per le newsletter i cui eventi si concentrano nelle 72 ore successive all’invio.'
            }
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <TopLinksCard links={topLinks} loading={detailsBusy} />
            <BreakdownCard
              title="Dispositivi"
              description="Su quali apparecchi vengono aperte le email."
              icon={<Laptop />}
              entries={devices}
              loading={detailsBusy}
            />
            <BreakdownCard
              title="Client di posta"
              description="Le applicazioni con cui i contatti leggono."
              icon={<Server />}
              entries={clients}
              loading={detailsBusy}
            />
          </div>

          <ListHealthCard
            audience={data?.audience}
            series={data?.series ?? []}
            loading={loading}
          />

          <p className="text-xs text-muted-foreground">
            Link, dispositivi, client di posta e mappa oraria sono calcolati sulle prime{' '}
            {DETAIL_REPORT_LIMIT} newsletter del periodo per fatturato attribuito
            {detailIds.length > 0 ? ` (${detailIds.length} analizzate)` : ''}. Ultimo aggiornamento:{' '}
            {data ? formatDateTimeIt(data.computedAt) : '—'}.
          </p>
        </>
      ) : null}
    </div>
  );
}
