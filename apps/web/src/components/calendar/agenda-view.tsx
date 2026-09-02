'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { EntryRow } from './entry-row';
import type { CalendarItem, CalendarRange } from './types';
import { capitalize, dayId, formatFullDay, isPastDay, isToday } from './utils';

export interface AgendaViewProps {
  range: CalendarRange;
  byDay: Map<string, CalendarItem[]>;
  onOpenEntry: (item: CalendarItem) => void;
  onCreateAt: (day: Date) => void;
  canCreate: boolean;
}

/** Elenco cronologico dei soli giorni che contengono voci. */
export function AgendaView({ range, byDay, onOpenEntry, onCreateAt, canCreate }: AgendaViewProps) {
  const today = React.useMemo(() => new Date(), []);

  const groups = React.useMemo(
    () =>
      range.days
        .map((day) => ({ day, id: dayId(day), items: byDay.get(dayId(day)) ?? [] }))
        .filter((group) => group.items.length > 0),
    [range.days, byDay],
  );

  if (groups.length === 0) return null;

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-card">
      {groups.map(({ day, id, items }) => {
        const current = isToday(day, today);
        const past = isPastDay(day, today);

        return (
          <section key={id} aria-label={formatFullDay(day)}>
            <header
              className={cn(
                'sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2 backdrop-blur',
                current && 'bg-primary/5',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <h3
                  className={cn(
                    'truncate text-sm font-semibold',
                    current ? 'text-primary' : past ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {capitalize(formatFullDay(day))}
                </h3>
                {current ? (
                  <Badge variant="default" className="shrink-0">
                    Oggi
                  </Badge>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {items.length === 1 ? '1 voce' : `${items.length} voci`}
                </span>
              </div>

              {canCreate && !past ? (
                <button
                  type="button"
                  onClick={() => onCreateAt(day)}
                  aria-label={`Nuova newsletter il ${formatFullDay(day)}`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Aggiungi
                </button>
              ) : null}
            </header>

            <div className="space-y-0.5 p-1.5">
              {items.map((item) => (
                <EntryRow key={item.id} item={item} onOpen={onOpenEntry} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
