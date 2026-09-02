'use client';

import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { CALENDAR_VIEWS } from './constants';
import type { CalendarView } from './types';

export interface CalendarToolbarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /** Periodo visualizzato, es. "Settembre 2026". */
  title: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  className?: string;
}

const PERIOD_LABEL: Record<CalendarView, { previous: string; next: string }> = {
  mese: { previous: 'Mese precedente', next: 'Mese successivo' },
  settimana: { previous: 'Settimana precedente', next: 'Settimana successiva' },
  agenda: { previous: 'Mese precedente', next: 'Mese successivo' },
};

/** Navigazione temporale, selettore di vista e ricerca testuale. */
export function CalendarToolbar({
  view,
  onViewChange,
  title,
  onPrevious,
  onNext,
  onToday,
  search,
  onSearchChange,
  onRefresh,
  refreshing = false,
  className,
}: CalendarToolbarProps) {
  const labels = PERIOD_LABEL[view];

  return (
    <div className={cn('flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-input bg-card shadow-soft">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-r-none"
            onClick={onPrevious}
            aria-label={labels.previous}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-l-none"
            onClick={onNext}
            aria-label={labels.next}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={onToday}>
          <CalendarDays aria-hidden="true" />
          Oggi
        </Button>

        <h2 className="ml-1 text-base font-semibold tracking-tight text-foreground" aria-live="polite">
          {title}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Cerca nome, oggetto o tag…"
            aria-label="Cerca nel calendario"
            className="h-8 w-full pl-8 sm:w-64"
          />
        </div>

        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={view}
          onValueChange={(value) => {
            if (value) onViewChange(value as CalendarView);
          }}
          aria-label="Vista del calendario"
          className="rounded-md"
        >
          {CALENDAR_VIEWS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} aria-label={`Vista ${option.label}`}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <SimpleTooltip content="Aggiorna il calendario">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRefresh}
            aria-label="Aggiorna il calendario"
          >
            <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
          </Button>
        </SimpleTooltip>
      </div>
    </div>
  );
}
