'use client';

import { format, isSameDay, isSameMonth } from 'date-fns';
import { Plus } from 'lucide-react';
import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { MONTH_CELL_VISIBLE_ENTRIES } from './constants';
import { DayDropZone } from './day-drop-zone';
import { EntryChip } from './entry-chip';
import { EntryRow } from './entry-row';
import type { CalendarItem, CalendarRange } from './types';
import { DATE_OPTIONS, dayId, formatFullDay, isPastDay, isToday, weekdayLabels } from './utils';

/**
 * "Oggi", aggiornato mentre la pagina resta aperta.
 *
 * Congelarlo al montaggio significherebbe che dopo la mezzanotte il giorno
 * appena concluso continua a evidenziarsi come oggi e ad accettare i rilasci,
 * pianificando un invio su una data già passata. Il ricalcolo scatta allo
 * scoccare del giorno nuovo e al rientro sulla scheda, perché il browser
 * rallenta o sospende i timer delle schede in secondo piano.
 */
function useToday(): Date {
  const [today, setToday] = React.useState(() => new Date());

  React.useEffect(() => {
    let timer = 0;

    const sync = () => {
      const now = new Date();
      // Il riferimento cambia solo a giorno nuovo: le celle non si ridisegnano
      // a ogni risveglio della scheda.
      setToday((previous) => (isSameDay(previous, now) ? previous : now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, midnight.getTime() - now.getTime() + 1_000);
    };

    const onWake = () => {
      if (!window.document.hidden) sync();
    };

    sync();
    window.document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearTimeout(timer);
      window.document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, []);

  return today;
}

/** Il doppio clic crea una newsletter solo sullo spazio vuoto della cella. */
function isEmptyAreaDoubleClick(event: React.MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  return !target?.closest('button, a, [role="dialog"]');
}

export interface MonthViewProps {
  range: CalendarRange;
  /** Mese di riferimento: i giorni fuori mese sono attenuati. */
  anchor: Date;
  byDay: Map<string, CalendarItem[]>;
  onOpenEntry: (item: CalendarItem) => void;
  onCreateAt: (day: Date) => void;
  dragEnabled: boolean;
  canCreate: boolean;
}

/** Griglia 7×6: sei settimane complete, senza scorrimento orizzontale. */
export function MonthView({
  range,
  anchor,
  byDay,
  onOpenEntry,
  onCreateAt,
  dragEnabled,
  canCreate,
}: MonthViewProps) {
  const labels = React.useMemo(() => weekdayLabels('EEE'), []);
  const today = useToday();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {labels.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.charAt(0)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {range.days.map((day) => (
          <MonthCell
            key={day.toISOString()}
            day={day}
            today={today}
            inMonth={isSameMonth(day, anchor)}
            items={byDay.get(dayId(day)) ?? []}
            onOpenEntry={onOpenEntry}
            onCreateAt={onCreateAt}
            dragEnabled={dragEnabled}
            canCreate={canCreate}
          />
        ))}
      </div>
    </div>
  );
}

interface MonthCellProps {
  day: Date;
  today: Date;
  inMonth: boolean;
  items: CalendarItem[];
  onOpenEntry: (item: CalendarItem) => void;
  onCreateAt: (day: Date) => void;
  dragEnabled: boolean;
  canCreate: boolean;
}

function MonthCell({
  day,
  today,
  inMonth,
  items,
  onOpenEntry,
  onCreateAt,
  dragEnabled,
  canCreate,
}: MonthCellProps) {
  const id = dayId(day);
  const past = isPastDay(day, today);
  const current = isToday(day, today);
  const visible = items.slice(0, MONTH_CELL_VISIBLE_ENTRIES);
  const hidden = items.length - visible.length;
  const creatable = canCreate && !past;

  return (
    <DayDropZone
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
        'group relative flex min-h-[6rem] flex-col gap-1 border-b border-r border-border p-1.5 sm:min-h-[7.5rem]',
        !inMonth && 'bg-muted/30',
        current && 'bg-primary/[0.04]',
        past && 'bg-muted/10',
        'data-[droppable=true]:bg-primary/[0.06]',
        'data-[blocked=true]:cursor-not-allowed data-[blocked=true]:opacity-60',
        'data-[over=true]:bg-primary/15 data-[over=true]:ring-2 data-[over=true]:ring-inset data-[over=true]:ring-primary',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
            current
              ? 'bg-primary text-primary-foreground shadow-soft'
              : inMonth
                ? 'text-foreground'
                : 'text-muted-foreground/60',
          )}
        >
          <span className="sr-only">{formatFullDay(day)}</span>
          <span aria-hidden="true">{format(day, 'd', DATE_OPTIONS)}</span>
        </span>

        {creatable ? (
          <button
            type="button"
            onClick={() => onCreateAt(day)}
            aria-label={`Nuova newsletter il ${formatFullDay(day)}`}
            className="rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {visible.map((item) => (
          <EntryChip
            key={item.id}
            item={item}
            onOpen={onOpenEntry}
            dragEnabled={dragEnabled}
          />
        ))}

        {hidden > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {hidden === 1 ? '+1 altra' : `+${hidden} altre`}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {formatFullDay(day)}
              </p>
              <div className="max-h-72 space-y-0.5 overflow-y-auto scrollbar-thin">
                {items.map((item) => (
                  <EntryRow key={item.id} item={item} onOpen={onOpenEntry} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </DayDropZone>
  );
}
