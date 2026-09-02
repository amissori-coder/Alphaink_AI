'use client';

/**
 * Menu di inserimento dei merge tag.
 *
 * I token sono raggruppati per ambito (`MergeTag.group`), filtrabili con una
 * ricerca che guarda etichetta e token, e mostrano il valore di esempio usato
 * nell'anteprima: chi scrive la newsletter capisce subito cosa vedrà il cliente.
 */

import { MERGE_TAGS } from '@alphaink/shared';
import type { MergeTag } from '@alphaink/shared';
import { Braces, Search } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export type MergeTagGroup = MergeTag['group'];

/** Ordine e titoli dei gruppi nel menu. */
export const MERGE_TAG_GROUP_ORDER: MergeTagGroup[] = [
  'contatto',
  'ordine',
  'coupon',
  'prodotto',
  'azienda',
  'sistema',
];

export const MERGE_TAG_GROUP_LABELS: Record<MergeTagGroup, string> = {
  contatto: 'Contatto',
  ordine: 'Ordine',
  coupon: 'Coupon',
  prodotto: 'Prodotto',
  azienda: 'Azienda',
  sistema: 'Sistema',
};

export interface MergeTagMenuProps {
  /** Riceve il token completo, es. `{{contact.firstName}}`. */
  onInsert: (token: string) => void;
  /** Elemento che apre il menu; se assente si usa un pulsante compatto. */
  trigger?: React.ReactNode;
  /** Limita i gruppi proposti (es. solo `contatto` nelle newsletter manuali). */
  groups?: MergeTagGroup[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  disabled?: boolean;
  className?: string;
}

/** Menu a comparsa con ricerca per inserire un merge tag. */
export function MergeTagMenu({
  onInsert,
  trigger,
  groups,
  align = 'end',
  side = 'bottom',
  disabled,
  className,
}: MergeTagMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const visible = React.useMemo(() => {
    const allowed = groups?.length ? new Set(groups) : null;
    const needle = query.trim().toLowerCase();
    return MERGE_TAGS.filter((tag) => {
      if (allowed && !allowed.has(tag.group)) return false;
      if (!needle) return true;
      return (
        tag.label.toLowerCase().includes(needle) ||
        tag.token.toLowerCase().includes(needle) ||
        MERGE_TAG_GROUP_LABELS[tag.group].toLowerCase().includes(needle)
      );
    });
  }, [groups, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<MergeTagGroup, MergeTag[]>();
    for (const tag of visible) {
      const list = map.get(tag.group) ?? [];
      list.push(tag);
      map.set(tag.group, list);
    }
    return MERGE_TAG_GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({
      group,
      tags: map.get(group)!,
    }));
  }, [visible]);

  const handleInsert = (token: string) => {
    onInsert(token);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('gap-1.5 text-xs', className)}
            disabled={disabled}
          >
            <Braces aria-hidden="true" />
            Merge tag
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent align={align} side={side} className="w-80 p-0">
        <div className="border-b border-border p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca un campo…"
            aria-label="Cerca un merge tag"
            startIcon={<Search />}
            className="h-8 text-sm"
          />
        </div>

        <ScrollArea className="h-72">
          <div className="p-1.5">
            {grouped.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nessun campo corrisponde a «{query}».
              </p>
            ) : (
              grouped.map(({ group, tags }) => (
                <div key={group} className="mb-1.5 last:mb-0">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {MERGE_TAG_GROUP_LABELS[group]}
                  </p>
                  {tags.map((tag) => (
                    <button
                      key={tag.token}
                      type="button"
                      onClick={() => handleInsert(tag.token)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
                        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{tag.label}</span>
                        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {tag.token}
                        </code>
                      </span>
                      {tag.fallback ? (
                        <span className="text-xs text-muted-foreground">
                          Esempio: {tag.fallback}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          I campi vengono sostituiti al momento dell’invio. Se il dato manca, viene usato il valore
          di esempio.
        </p>
      </PopoverContent>
    </Popover>
  );
}
