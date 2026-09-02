'use client';

import { CalendarRange } from 'lucide-react';
import * as React from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { ANALYTICS_PERIODS, PERIOD_LABELS, type AnalyticsPeriod } from './use-analytics-data';

export interface PeriodPickerProps {
  value: AnalyticsPeriod;
  onChange: (value: AnalyticsPeriod) => void;
  disabled?: boolean;
  className?: string;
}

/** Selettore del periodo osservato dal cruscotto analitico. */
export function PeriodPicker({ value, onChange, disabled, className }: PeriodPickerProps) {
  const id = React.useId();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Label htmlFor={id} className="sr-only">
        Periodo osservato
      </Label>
      <Select
        value={String(value)}
        disabled={disabled}
        onValueChange={(next) => onChange(Number(next) as AnalyticsPeriod)}
      >
        <SelectTrigger id={id} className="w-[11.5rem]">
          <CalendarRange className="size-4 text-muted-foreground" aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ANALYTICS_PERIODS.map((period) => (
            <SelectItem key={period} value={String(period)}>
              {PERIOD_LABELS[period]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
