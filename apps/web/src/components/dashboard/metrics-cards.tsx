'use client';

import { safeRate } from '@alphaink/shared';
import { Euro, MailOpen, MousePointerClick, Send } from 'lucide-react';
import * as React from 'react';

import type { DashboardMetricsResult } from '@/components/dashboard/types';
import {
  type DashboardPeriod,
  PERIOD_COMPARE_LABELS,
} from '@/components/dashboard/use-dashboard-metrics';
import { StatCard } from '@/components/ui/stat-card';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

export interface MetricsCardsProps {
  data?: DashboardMetricsResult;
  loading: boolean;
  period: DashboardPeriod;
}

/**
 * Variazione relativa fra due valori.
 * Restituisce `null` quando il confronto non è significativo (entrambi a zero),
 * così la scheda non mostra una freccia priva di senso.
 */
function relativeChange(current: number, previous: number | undefined): number | null {
  if (previous === undefined || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? null : 1;
  return (current - previous) / previous;
}

/** Riga di indicatori principali del periodo selezionato. */
export function MetricsCards({ data, loading, period }: MetricsCardsProps) {
  const compare = PERIOD_COMPARE_LABELS[period];
  const totals = data?.totals;
  const previous = data?.previous?.totals;
  const rates = data?.rates;
  const series = data?.series ?? [];
  const currency = data?.store.currency || 'EUR';

  const previousOpenRate = previous ? safeRate(previous.uniqueOpened, previous.delivered) : undefined;
  const previousClickRate = previous ? safeRate(previous.uniqueClicked, previous.delivered) : undefined;

  const cards = [
    {
      key: 'inviate',
      label: 'Email inviate',
      icon: <Send />,
      value: totals ? formatNumber(totals.sent) : '—',
      hint: totals ? `${formatNumber(totals.delivered)} consegnate` : null,
      change: totals ? relativeChange(totals.sent, previous?.sent) : null,
      sparkline: series.map((point) => point.sent),
      tooltip: `Email accettate da Brevo nel periodo. Confronto ${compare}.`,
      invertChange: false,
    },
    {
      key: 'aperture',
      label: 'Tasso di apertura',
      icon: <MailOpen />,
      value: rates ? formatPercent(rates.openRate, 1) : '—',
      hint: totals ? `${formatNumber(totals.uniqueOpened)} aperture uniche` : null,
      change: rates ? relativeChange(rates.openRate, previousOpenRate) : null,
      sparkline: series.map((point) => point.uniqueOpened),
      tooltip: `Aperture uniche sulle email consegnate. Confronto ${compare}.`,
      invertChange: false,
    },
    {
      key: 'click',
      label: 'Tasso di click',
      icon: <MousePointerClick />,
      value: rates ? formatPercent(rates.clickRate, 1) : '—',
      hint: totals ? `${formatNumber(totals.uniqueClicked)} click unici` : null,
      change: rates ? relativeChange(rates.clickRate, previousClickRate) : null,
      sparkline: series.map((point) => point.uniqueClicked),
      tooltip: `Click unici sulle email consegnate. Confronto ${compare}.`,
      invertChange: false,
    },
    {
      key: 'fatturato',
      label: 'Fatturato attribuito',
      icon: <Euro />,
      value: totals ? formatCurrency(totals.revenue, currency) : '—',
      hint: totals ? `${formatNumber(totals.orders)} ordini attribuiti` : null,
      change: totals ? relativeChange(totals.revenue, previous?.revenue) : null,
      sparkline: series.map((point) => point.revenue),
      tooltip: `Ordini collegati a newsletter e automazioni. Confronto ${compare}.`,
      invertChange: false,
    },
  ] as const;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <StatCard
          key={card.key}
          label={card.label}
          value={card.value}
          hint={card.hint ?? undefined}
          change={card.change}
          invertChange={card.invertChange}
          sparkline={card.sparkline}
          icon={card.icon}
          loading={loading}
          tooltip={card.tooltip}
        />
      ))}
    </div>
  );
}
