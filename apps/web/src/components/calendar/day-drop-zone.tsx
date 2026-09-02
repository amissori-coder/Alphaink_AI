'use client';

import { useDroppable } from '@dnd-kit/core';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { DROPPABLE_PREFIX } from './constants';

export interface DayDropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Giorno di destinazione nel formato `YYYY-MM-DD`. */
  dayId: string;
  /** Disattiva il rilascio (giorno passato o permessi mancanti). */
  disabled?: boolean;
}

/**
 * Contenitore di un giorno che accetta il rilascio di una newsletter.
 *
 * Espone tre attributi dati per lo stile, attivi solo durante un trascinamento:
 * `data-droppable` sulle zone valide, `data-blocked` su quelle non ammesse
 * (giorni passati) e `data-over` sulla zona sotto il puntatore.
 */
export function DayDropZone({
  dayId,
  disabled = false,
  className,
  children,
  ...props
}: DayDropZoneProps) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `${DROPPABLE_PREFIX}${dayId}`,
    disabled,
    data: { dayId },
  });

  const dragging = Boolean(active);

  return (
    <div
      ref={setNodeRef}
      data-day={dayId}
      data-droppable={dragging && !disabled ? 'true' : undefined}
      data-blocked={dragging && disabled ? 'true' : undefined}
      data-over={isOver && !disabled ? 'true' : undefined}
      className={cn('transition-colors', className)}
      {...props}
    >
      {children}
    </div>
  );
}
