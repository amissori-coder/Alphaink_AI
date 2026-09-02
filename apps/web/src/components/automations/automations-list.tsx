'use client';

import { CORE_AUTOMATION_KEYS, formatCurrency, formatNumber } from '@alphaink/shared';
import type { Automation } from '@alphaink/shared';
import { CircleAlert, Info, RefreshCw, Settings, Workflow } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useAuth } from '@/lib/auth-context';
import { useQueryClient } from '@tanstack/react-query';

import { AutomationCard, periodTotals } from './automation-card';
import { LIST_RECENT_LIMIT, REPORT_RANGE_DAYS, sortAutomations } from './constants';
import { useAutomationReports, useAutomations } from './use-automations-data';
import { useToggleAutomation } from './use-automation-actions';

/** Divide le automazioni fra le quattro obbligatorie e le facoltative. */
function splitAutomations(rows: Automation[]): { core: Automation[]; optional: Automation[] } {
  const sorted = sortAutomations(rows);
  return {
    core: sorted.filter(
      (automation) => automation.isCore || CORE_AUTOMATION_KEYS.includes(automation.key),
    ),
    optional: sorted.filter(
      (automation) => !automation.isCore && !CORE_AUTOMATION_KEYS.includes(automation.key),
    ),
  };
}

function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-72 w-full" />
      ))}
    </div>
  );
}

/**
 * Elenco delle automazioni.
 *
 * Le quattro richieste dal cliente (coupon stampante, pagamento abbandonato,
 * riacquisto carta, riacquisto toner e cartucce) restano in evidenza e in
 * cima; le altre seguono in una sezione separata.
 */
export function AutomationsList() {
  const { can } = useAuth();
  const canRead = can('automations:read');
  const canToggle = can('automations:toggle');
  const queryClient = useQueryClient();

  const { data, loading, error } = useAutomations(canRead);
  const rows = React.useMemo(() => splitAutomations(data), [data]);
  const ids = React.useMemo(() => sortAutomations(data).map((row) => row.id), [data]);

  const reports = useAutomationReports(ids, {
    days: REPORT_RANGE_DAYS,
    recentLimit: LIST_RECENT_LIMIT,
    enabled: canRead && ids.length > 0,
  });
  const reportById = React.useMemo(
    () => new Map(reports.map((entry) => [entry.automationId, entry])),
    [reports],
  );

  const toggle = useToggleAutomation();
  const pendingId = toggle.isPending ? toggle.variables?.automationId : undefined;

  const totals = React.useMemo(() => {
    return reports.reduce(
      (acc, entry) => {
        const period = periodTotals(entry.data);
        return {
          sent: acc.sent + period.sent,
          orders: acc.orders + period.orders,
          revenue: acc.revenue + period.revenue,
        };
      },
      { sent: 0, orders: 0, revenue: 0 },
    );
  }, [reports]);

  const reportsLoading = reports.some((entry) => entry.loading);
  const activeCount = data.filter((automation) => automation.enabled).length;

  const renderCard = (automation: Automation) => {
    const entry = reportById.get(automation.id);
    return (
      <AutomationCard
        key={automation.id}
        automation={automation}
        report={entry?.data}
        reportLoading={entry?.loading ?? false}
        reportError={entry?.error ?? null}
        canToggle={canToggle}
        toggling={pendingId === automation.id}
        periodDays={REPORT_RANGE_DAYS}
        onToggle={(enabled) => toggle.mutate({ automationId: automation.id, enabled })}
      />
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Percorsi automatici"
        title="Automazioni"
        description="Flussi collegati al comportamento dei clienti: coupon per chi acquista una stampante, recupero dei pagamenti non conclusi e promemoria di riacquisto."
        actions={
          <Button
            variant="outline"
            size="icon"
            aria-label="Aggiorna le statistiche"
            disabled={!canRead || reportsLoading}
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: ['automations', 'report'] })
            }
          >
            <RefreshCw className={reportsLoading ? 'animate-spin' : undefined} aria-hidden="true" />
          </Button>
        }
      />

      {!canRead ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Automazioni non disponibili</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di consultare le automazioni.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Impossibile caricare le automazioni</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {canRead && !loading && data.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title="Nessuna automazione configurata"
          description="Esegui la configurazione iniziale per creare le quattro automazioni richieste: coupon stampante, pagamento abbandonato, riacquisto carta e riacquisto toner e cartucce."
          action={
            can('settings:write') ? (
              <Button asChild>
                <Link href="/impostazioni">
                  <Settings aria-hidden="true" />
                  Vai alle impostazioni
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {canRead && (loading || data.length > 0) ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Automazioni attive"
              value={loading ? '—' : `${activeCount} su ${data.length}`}
              hint="Flussi che possono arruolare contatti in questo momento."
              icon={<Workflow />}
              loading={loading}
            />
            <StatCard
              label={`Email inviate · ${REPORT_RANGE_DAYS} gg`}
              value={formatNumber(totals.sent)}
              hint="Somma delle esecuzioni completate nel periodo."
              loading={reportsLoading}
            />
            <StatCard
              label={`Ordini attribuiti · ${REPORT_RANGE_DAYS} gg`}
              value={formatNumber(totals.orders)}
              hint="Acquisti ricondotti a un invio automatico."
              loading={reportsLoading}
            />
            <StatCard
              label={`Fatturato · ${REPORT_RANGE_DAYS} gg`}
              value={formatCurrency(totals.revenue)}
              hint="Ricavo attribuito alle automazioni nel periodo."
              loading={reportsLoading}
            />
          </div>

          <section className="space-y-3" aria-labelledby="automazioni-principali">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="automazioni-principali" className="text-base font-semibold text-foreground">
                Automazioni principali
              </h2>
              <p className="text-xs text-muted-foreground">
                Non eliminabili: si possono solo attivare, spegnere e configurare.
              </p>
            </div>
            {loading ? <CardsSkeleton /> : null}
            {!loading && rows.core.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.core.map(renderCard)}
              </div>
            ) : null}
            {!loading && rows.core.length === 0 && data.length > 0 ? (
              <EmptyState
                compact
                icon={<Workflow />}
                title="Automazioni principali non installate"
                description="La configurazione iniziale crea i quattro flussi richiesti da AlphaInk."
              />
            ) : null}
          </section>

          {!loading && rows.optional.length > 0 ? (
            <section className="space-y-3" aria-labelledby="automazioni-opzionali">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="automazioni-opzionali" className="text-base font-semibold text-foreground">
                  Automazioni opzionali
                </h2>
                <p className="text-xs text-muted-foreground">
                  Flussi aggiuntivi: benvenuto, anniversario e riattivazione.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.optional.map(renderCard)}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
