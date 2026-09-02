'use client';

import * as React from 'react';

import {
  DASHBOARD_PERIODS,
  type DashboardPeriod,
  PERIOD_LABELS,
} from '@/components/dashboard/use-dashboard-metrics';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export interface PeriodSelectorProps {
  value: DashboardPeriod;
  onChange: (value: DashboardPeriod) => void;
  disabled?: boolean;
  className?: string;
}

/** Selettore del periodo osservato: ultimi 7, 30 o 90 giorni. */
export function PeriodSelector({ value, onChange, disabled, className }: PeriodSelectorProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={String(value)}
      aria-label="Periodo di osservazione"
      onValueChange={(next) => {
        if (!next) return;
        const parsed = Number(next) as DashboardPeriod;
        if (DASHBOARD_PERIODS.includes(parsed)) onChange(parsed);
      }}
      className={cn('shrink-0', className)}
      disabled={disabled}
    >
      {DASHBOARD_PERIODS.map((period) => (
        <ToggleGroupItem key={period} value={String(period)} className="px-3">
          {PERIOD_LABELS[period]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
