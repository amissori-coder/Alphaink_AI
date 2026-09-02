'use client';

import {
  AUTOMATION_DESCRIPTIONS,
  EMPTY_AUTOMATION_STATS,
  formatCurrency,
  formatNumber,
} from '@alphaink/shared';
import type { Automation } from '@alphaink/shared';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn, relativeTimeIt } from '@/lib/utils';

import { ROUTES, automationIcon, automationLabel } from './constants';
import type { AutomationReport } from './types';

/** Somma della serie storica: è l'unico dato realmente riferito al periodo. */
export function periodTotals(report: AutomationReport | undefined): {
  sent: number;
  orders: number;
  revenue: number;
} {
  const empty = { sent: 0, orders: 0, revenue: 0 };
  if (!report) return empty;
  return report.timeseries.reduce(
    (acc, point) => ({
      sent: acc.sent + point.sent,
      orders: acc.orders + point.converted,
      revenue: acc.revenue + point.revenue,
    }),
    empty,
  );
}

interface MetricGridProps {
  caption: string;
  hint?: string;
  loading?: boolean;
  items: Array<{ label: string; value: string }>;
}

function MetricGrid({ caption, hint, loading, items }: MetricGridProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {hint ? (
          <SimpleTooltip content={hint}>
            <span className="cursor-help underline decoration-dotted underline-offset-4">
              {caption}
            </span>
          </SimpleTooltip>
        ) : (
          caption
        )}
      </p>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
        {items.map((item) => (
          <div key={item.label} className="bg-card px-2.5 py-2">
            <dt className="truncate text-[11px] text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {loading ? <Skeleton className="h-4 w-12" /> : item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface AutomationCardProps {
  automation: Automation;
  report?: AutomationReport;
  reportLoading?: boolean;
  reportError?: Error | null;
  canToggle?: boolean;
  toggling?: boolean;
  onToggle: (enabled: boolean) => void;
  /** Giorni osservati dalle metriche di periodo. */
  periodDays: number;
  className?: string;
}

/**
 * Scheda di un'automazione in elenco: identità, stato, metriche e accesso alla
 * configurazione. Le metriche di periodo (inviate, ordini, fatturato) arrivano
 * dalle esecuzioni; arruolati, aperture e click sono contatori progressivi.
 */
export function AutomationCard({
  automation,
  report,
  reportLoading = false,
  reportError = null,
  canToggle = false,
  toggling = false,
  onToggle,
  periodDays,
  className,
}: AutomationCardProps) {
  const Icon = automationIcon(automation.key);
  const label = automationLabel(automation);
  const description =
    automation.description || AUTOMATION_DESCRIPTIONS[automation.key] || 'Flusso automatico.';
  const stats = { ...EMPTY_AUTOMATION_STATS, ...(report?.stats ?? automation.stats ?? {}) };
  const period = periodTotals(report);
  const currency = stats.currency || 'EUR';

  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-popover',
        !automation.enabled && 'border-dashed',
        className,
      )}
    >
      <header className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5',
            automation.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden="true"
        >
          <Icon />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
            {automation.isCore ? <Badge variant="outline">Principale</Badge> : null}
            {automation.testMode ? <Badge variant="warning">Modalità test</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <Switch
            checked={automation.enabled}
            disabled={!canToggle || toggling}
            aria-label={`${automation.enabled ? 'Disattiva' : 'Attiva'} ${label}`}
            onCheckedChange={onToggle}
          />
          <span className="text-[11px] text-muted-foreground">
            {automation.enabled ? 'Attiva' : 'Spenta'}
          </span>
        </div>
      </header>

      {automation.lastError ? (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{automation.lastError}</span>
        </p>
      ) : null}

      <div className="space-y-3">
        <MetricGrid
          caption={`Ultimi ${periodDays} giorni`}
          loading={reportLoading}
          items={[
            { label: 'Inviate', value: formatNumber(period.sent) },
            { label: 'Ordini', value: formatNumber(period.orders) },
            { label: 'Fatturato', value: formatCurrency(period.revenue, currency) },
          ]}
        />
        <MetricGrid
          caption="Dall’attivazione"
          hint="Contatori progressivi dell’automazione: non sono limitati al periodo osservato."
          loading={reportLoading}
          items={[
            { label: 'Arruolati', value: formatNumber(stats.enrolled) },
            { label: 'Aperture', value: formatNumber(stats.opened) },
            { label: 'Click', value: formatNumber(stats.clicked) },
          ]}
        />
      </div>

      {reportError ? (
        <p className="text-xs text-destructive">
          Statistiche non disponibili: {reportError.message}
        </p>
      ) : null}

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="truncate text-xs text-muted-foreground">
          {automation.lastRunAt
            ? `Ultima esecuzione ${relativeTimeIt(automation.lastRunAt)}`
            : 'Nessuna esecuzione registrata'}
        </span>
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.detail(automation.id)}>
            Configura
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </footer>
    </article>
  );
}
