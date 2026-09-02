'use client';

import { useDraggable } from '@dnd-kit/core';
import { Repeat2, Users } from 'lucide-react';

import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import type { CalendarItem } from './types';
import { categoryLabel, recipientsLabel, statusColor, statusLabel } from './utils';

export interface EntryChipProps {
  item: CalendarItem;
  /** `compact` per le celle del mese, `detailed` per le colonne della settimana. */
  variant?: 'compact' | 'detailed';
  onOpen?: (item: CalendarItem) => void;
  /** Abilita il trascinamento (permesso di pianificazione + vista che lo supporta). */
  dragEnabled?: boolean;
  /** True mentre la voce è trascinata: usata anche nel livello di trascinamento. */
  overlay?: boolean;
  className?: string;
}

/** Descrizione completa della voce, usata nei tooltip e per i lettori di schermo. */
export function describeItem(item: CalendarItem): string {
  const parts: string[] = [`${item.time} · ${item.title}`];
  if (item.type === 'automation') {
    parts.push(
      item.occurrences === 1 ? '1 invio previsto' : `${formatNumber(item.occurrences)} invii previsti`,
    );
    return parts.join(' — ');
  }
  parts.push(statusLabel(item.status));
  const category = categoryLabel(item.category);
  if (category) parts.push(category);
  if (item.recipients > 0) parts.push(recipientsLabel(item.recipients));
  if (item.openRate !== null) parts.push(`aperture ${formatPercent(item.openRate, 1)}`);
  return parts.join(' — ');
}

/** Pallino del colore di stato. */
export function StatusDot({
  item,
  className,
}: {
  item: CalendarItem;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-2 shrink-0 rounded-full ring-2 ring-card', className)}
      style={{ backgroundColor: item.type === 'automation' ? '#8b5cf6' : statusColor(item.status) }}
    />
  );
}

/** Contenuto visivo della voce, condiviso fra chip e livello di trascinamento. */
function ChipContent({ item, variant }: { item: CalendarItem; variant: 'compact' | 'detailed' }) {
  const category = categoryLabel(item.category);
  const isAutomation = item.type === 'automation';

  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {isAutomation ? (
          <Repeat2 className="size-3 shrink-0 text-[#8b5cf6]" aria-hidden="true" />
        ) : (
          <StatusDot item={item} />
        )}
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {item.time}
        </span>
        <span
          className={cn(
            'truncate font-medium',
            item.status === 'cancelled' && 'line-through opacity-70',
          )}
        >
          {item.title}
        </span>

        {/* Nella vista compatta resta spazio solo per il dato più utile:
            il tasso di apertura se inviata, il numero di occorrenze se ricorrente.
            Il resto è nel tooltip e nel pannello di dettaglio. */}
        {variant === 'compact' && isAutomation ? (
          <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-[#8b5cf6]">
            ×{formatNumber(item.occurrences)}
          </span>
        ) : null}
        {variant === 'compact' && !isAutomation && item.openRate !== null ? (
          <span className="ml-auto shrink-0 text-[10px] font-medium tabular-nums text-success">
            {formatPercent(item.openRate, 0)}
          </span>
        ) : null}
      </span>

      {variant === 'detailed' ? (
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {isAutomation ? (
            <span>
              {item.occurrences === 1
                ? '1 invio previsto'
                : `${formatNumber(item.occurrences)} invii previsti`}
            </span>
          ) : (
            <>
              {category ? <span className="truncate">{category}</span> : null}
              {item.recipients > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" aria-hidden="true" />
                  {formatNumber(item.recipients)}
                </span>
              ) : null}
              {item.openRate !== null ? (
                <span className="font-medium text-success">
                  {formatPercent(item.openRate, 1)} aperture
                </span>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </>
  );
}

/**
 * Voce del calendario nelle viste a griglia.
 *
 * Il trascinamento è volutamente solo con il puntatore: da tastiera il tasto
 * Invio apre il pannello di dettaglio, dal quale si ripianifica con il dialogo
 * dedicato (percorso equivalente e completamente accessibile).
 */
export function EntryChip({
  item,
  variant = 'compact',
  onOpen,
  dragEnabled = false,
  overlay = false,
  className,
}: EntryChipProps) {
  const canDrag = dragEnabled && item.draggable && !overlay;

  // Il livello di trascinamento monta una seconda copia della voce: senza un id
  // distinto sovrascriverebbe il nodo registrato per l'originale.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: overlay ? `${item.id}:overlay` : item.id,
    disabled: !canDrag,
    data: { item },
  });

  const chip = (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen?.(item)}
      aria-label={describeItem(item)}
      data-status={item.status}
      className={cn(
        'flex w-full flex-col rounded-md border px-1.5 py-1 text-left text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        item.type === 'automation'
          ? 'border-dashed border-[#8b5cf6]/40 bg-[#8b5cf6]/5 text-foreground hover:bg-[#8b5cf6]/10'
          : 'border-border/60 bg-card shadow-soft hover:border-border hover:bg-muted',
        item.past && item.type === 'newsletter' && item.status !== 'sent' && 'opacity-70',
        canDrag && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
        overlay && 'w-[15rem] cursor-grabbing border-primary/40 shadow-popover',
        className,
      )}
      style={item.color ? { borderLeftColor: item.color, borderLeftWidth: 3 } : undefined}
      {...(canDrag ? attributes : {})}
      {...(canDrag ? listeners : {})}
    >
      <ChipContent item={item} variant={variant} />
    </button>
  );

  if (overlay || variant === 'detailed') return chip;

  return (
    <SimpleTooltip content={describeItem(item)} side="top">
      {chip}
    </SimpleTooltip>
  );
}

/** Versione statica mostrata sotto il puntatore durante il trascinamento. */
export function EntryChipOverlay({ item }: { item: CalendarItem }) {
  return <EntryChip item={item} variant="detailed" overlay />;
}
