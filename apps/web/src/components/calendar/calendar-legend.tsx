'use client';

import { MousePointerClick, Repeat2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { LEGEND_STATUSES } from './constants';
import { statusColor, statusLabel } from './utils';

export interface CalendarLegendProps {
  /** Nasconde il suggerimento sul trascinamento (es. in sola lettura). */
  showDragHint?: boolean;
  className?: string;
}

/** Legenda dei colori di stato e delle voci ricorrenti. */
export function CalendarLegend({ showDragHint = true, className }: CalendarLegendProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="font-medium uppercase tracking-wide text-foreground/70">Legenda</span>

      {LEGEND_STATUSES.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: statusColor(status) }}
          />
          {statusLabel(status)}
        </span>
      ))}

      <span className="inline-flex items-center gap-1.5">
        <Repeat2 className="size-3 text-[#8b5cf6]" aria-hidden="true" />
        Automazione ricorrente
      </span>

      {showDragHint ? (
        <span className="inline-flex items-center gap-1.5 border-l border-border pl-4">
          <MousePointerClick className="size-3" aria-hidden="true" />
          Trascina bozze e newsletter pianificate su un altro giorno per spostarle; da tastiera usa
          Ripianifica nel pannello di dettaglio.
        </span>
      ) : null}
    </div>
  );
}
