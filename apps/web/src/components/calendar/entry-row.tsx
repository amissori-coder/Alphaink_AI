'use client';

import { Repeat2, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import { StatusDot, describeItem } from './entry-chip';
import type { CalendarItem } from './types';
import { categoryLabel, formatFullDay, parseDayId, statusBadgeVariant, statusLabel } from './utils';

export interface EntryRowProps {
  item: CalendarItem;
  onOpen?: (item: CalendarItem) => void;
  /** Mostra anche il giorno, utile negli elenchi non raggruppati. */
  showDay?: boolean;
  className?: string;
}

/**
 * Riga estesa di una voce: usata nella vista agenda e nell'elenco completo di
 * un giorno della vista mese.
 */
export function EntryRow({ item, onOpen, showDay = false, className }: EntryRowProps) {
  const category = categoryLabel(item.category);
  const isAutomation = item.type === 'automation';

  return (
    <button
      type="button"
      onClick={() => onOpen?.(item)}
      aria-label={describeItem(item)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors',
        'hover:border-border hover:bg-muted/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      style={item.color ? { borderLeftColor: item.color, borderLeftWidth: 3 } : undefined}
    >
      <span className="flex w-14 shrink-0 flex-col items-start pt-0.5">
        <span className="font-mono text-xs font-medium tabular-nums text-foreground">{item.time}</span>
        {showDay ? (
          <span className="text-[11px] text-muted-foreground">
            {formatFullDay(parseDayId(item.dayId)).split(' ').slice(0, 2).join(' ')}
          </span>
        ) : null}
      </span>

      <span className="pt-1.5">
        {isAutomation ? (
          <Repeat2 className="size-3.5 text-[#8b5cf6]" aria-hidden="true" />
        ) : (
          <StatusDot item={item} className="size-2.5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'truncate text-sm font-medium text-foreground',
              item.status === 'cancelled' && 'line-through opacity-70',
            )}
          >
            {item.title}
          </span>
          {category ? (
            <Badge variant="outline" className="shrink-0 font-normal">
              {category}
            </Badge>
          ) : null}
          {item.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="shrink-0 font-normal">
              {tag}
            </Badge>
          ))}
        </span>
        {item.subject ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.subject}</span>
        ) : null}
        {isAutomation ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Automazione ricorrente ·{' '}
            {item.occurrences === 1
              ? '1 invio previsto'
              : `${formatNumber(item.occurrences)} invii previsti`}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-3 pt-0.5">
        {item.recipients > 0 ? (
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            <Users className="size-3.5" aria-hidden="true" />
            {formatNumber(item.recipients)}
          </span>
        ) : null}
        {item.openRate !== null ? (
          <span className="hidden text-xs font-medium text-success sm:inline">
            {formatPercent(item.openRate, 1)}
          </span>
        ) : null}
        {isAutomation ? (
          <Badge variant="secondary" className="font-normal">
            Sempre attiva
          </Badge>
        ) : (
          <Badge variant={statusBadgeVariant(item.status)} className="font-normal">
            {statusLabel(item.status)}
          </Badge>
        )}
      </span>
    </button>
  );
}
