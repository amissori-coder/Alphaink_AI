'use client';

import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { DayDropZone } from './day-drop-zone';
import { EntryChip } from './entry-chip';
import type { CalendarItem, CalendarRange } from './types';
import { DATE_OPTIONS, capitalize, dayId, formatFullDay, isPastDay, isToday } from './utils';

/** Il doppio clic crea una newsletter solo sullo spazio vuoto della cella. */
function isEmptyAreaDoubleClick(event: React.MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  return !target?.closest('button, a, [role="dialog"]');
}

export interface WeekViewProps {
  range: CalendarRange;
  byDay: Map<string, CalendarItem[]>;
  onOpenEntry: (item: CalendarItem) => void;
  onCreateAt: (day: Date) => void;
  dragEnabled: boolean;
  canCreate: boolean;
}

/**
 * Settimana in sette colonne. Sotto i 1024px le colonne vanno a capo su più
 * righe, così la pagina non scorre mai in orizzontale.
 */
export function WeekView({
  range,
  byDay,
  onOpenEntry,
  onCreateAt,
  dragEnabled,
  canCreate,
}: WeekViewProps) {
  const today = React.useMemo(() => new Date(), []);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      {range.days.map((day) => {
        const id = dayId(day);
        const items = byDay.get(id) ?? [];
        const past = isPastDay(day, today);
        const current = isToday(day, today);
        const creatable = canCreate && !past;

        return (
          <DayDropZone
            key={id}
            dayId={id}
            disabled={!dragEnabled || past}
            onDoubleClick={
              creatable
                ? (event) => {
                    if (isEmptyAreaDoubleClick(event)) onCreateAt(day);
                  }
                : undefined
            }
            className={cn(
              'group flex min-h-[16rem] flex-col rounded-lg border border-border bg-card shadow-soft',
              current && 'border-primary/40 ring-1 ring-primary/20',
              past && 'bg-muted/20',
              'data-[droppable=true]:border-primary/30',
              'data-[blocked=true]:cursor-not-allowed data-[blocked=true]:opacity-60',
              'data-[over=true]:border-primary data-[over=true]:bg-primary/10 data-[over=true]:ring-2 data-[over=true]:ring-primary',
            )}
          >
            <div className="flex items-start justify-between gap-1 border-b border-border px-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {capitalize(format(day, 'EEEE', DATE_OPTIONS))}
                </p>
                <p
                  className={cn(
                    'text-sm font-semibold tabular-nums',
                    current ? 'text-primary' : 'text-foreground',
                  )}
                >
                  <span className="sr-only">{formatFullDay(day)}</span>
                  <span aria-hidden="true">{format(day, 'd MMM', DATE_OPTIONS)}</span>
                </p>
              </div>
              {creatable ? (
                <button
                  type="button"
                  onClick={() => onCreateAt(day)}
                  aria-label={`Nuova newsletter il ${formatFullDay(day)}`}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-1.5 p-1.5">
              {items.length > 0 ? (
                items.map((item) => (
                  <EntryChip
                    key={item.id}
                    item={item}
                    variant="detailed"
                    onOpen={onOpenEntry}
                    dragEnabled={dragEnabled}
                  />
                ))
              ) : (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">Nessun invio</p>
              )}
            </div>
          </DayDropZone>
        );
      })}
    </div>
  );
}
