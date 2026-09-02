'use client';

import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Testo secondario mostrato sotto l'etichetta. */
  description?: string;
  /** Icona o pallino colore a sinistra. */
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Gruppo di appartenenza, usato per le intestazioni. */
  group?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** Valore selezionato (modalità singola) oppure elenco (modalità multipla). */
  value?: string | string[] | null;
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  invalid?: boolean;
  /** Consente di svuotare la selezione singola. */
  clearable?: boolean;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Campo di selezione con ricerca testuale.
 * Supporta selezione singola o multipla e non richiede librerie esterne.
 */
const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      options,
      value,
      onChange,
      multiple = false,
      placeholder = 'Seleziona…',
      searchPlaceholder = 'Cerca…',
      emptyMessage = 'Nessun risultato.',
      disabled,
      className,
      contentClassName,
      id,
      invalid,
      clearable = false,
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);
    const listRef = React.useRef<HTMLDivElement>(null);
    const listboxId = React.useId();

    const selectedValues = React.useMemo<string[]>(() => {
      if (multiple) return Array.isArray(value) ? value : [];
      return typeof value === 'string' && value ? [value] : [];
    }, [value, multiple]);

    const filtered = React.useMemo(() => {
      const query = normalize(search.trim());
      if (!query) return options;
      return options.filter(
        (option) =>
          normalize(option.label).includes(query) ||
          normalize(option.description ?? '').includes(query) ||
          normalize(option.value).includes(query),
      );
    }, [options, search]);

    // Riporta l'evidenziazione in cima quando cambia la ricerca.
    React.useEffect(() => setActiveIndex(0), [search, open]);

    const toggle = (option: ComboboxOption) => {
      if (option.disabled) return;
      if (multiple) {
        const next = selectedValues.includes(option.value)
          ? selectedValues.filter((item) => item !== option.value)
          : [...selectedValues, option.value];
        onChange(next);
        return;
      }
      onChange(option.value);
      setOpen(false);
      setSearch('');
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const option = filtered[activeIndex];
        if (option) toggle(option);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const selectedOptions = options.filter((option) => selectedValues.includes(option.value));
    const triggerLabel =
      selectedOptions.length === 0
        ? placeholder
        : multiple
          ? `${selectedOptions.length} selezionati`
          : selectedOptions[0]!.label;

    // Raggruppa mantenendo l'ordine originale dei gruppi.
    const groups = React.useMemo(() => {
      const map = new Map<string, ComboboxOption[]>();
      for (const option of filtered) {
        const key = option.group ?? '';
        const bucket = map.get(key);
        if (bucket) bucket.push(option);
        else map.set(key, [option]);
      }
      return Array.from(map.entries());
    }, [filtered]);

    let flatIndex = -1;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-soft transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              invalid && 'border-destructive',
              selectedOptions.length === 0 && 'text-muted-foreground',
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              {!multiple && selectedOptions[0]?.icon ? (
                <span className="shrink-0 [&_svg]:size-4">{selectedOptions[0].icon}</span>
              ) : null}
              <span className="truncate">{triggerLabel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {clearable && !multiple && selectedOptions.length > 0 ? (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Svuota selezione"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange('');
                  }}
                  className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </span>
              ) : null}
              <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div ref={listRef} id={listboxId} role="listbox" className="max-h-64 overflow-y-auto scrollbar-thin p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              groups.map(([group, items]) => (
                <div key={group || 'default'}>
                  {group ? (
                    <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group}
                    </div>
                  ) : null}
                  {items.map((option) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const selected = selectedValues.includes(option.value);
                    return (
                      <div
                        key={option.value}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={option.disabled || undefined}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => toggle(option)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors',
                          index === activeIndex && 'bg-muted',
                          option.disabled && 'pointer-events-none opacity-50',
                        )}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center">
                          {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                        </span>
                        {option.icon ? <span className="shrink-0 [&_svg]:size-4">{option.icon}</span> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{option.label}</span>
                          {option.description ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {multiple && selectedOptions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 border-t border-border p-2">
              {selectedOptions.slice(0, 6).map((option) => (
                <Badge key={option.value} variant="secondary" className="gap-1">
                  {option.label}
                  <button
                    type="button"
                    aria-label={`Rimuovi ${option.label}`}
                    onClick={() => toggle(option)}
                    className="rounded-full hover:text-destructive"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
              {selectedOptions.length > 6 ? (
                <Badge variant="outline">+{selectedOptions.length - 6}</Badge>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7"
                onClick={() => onChange([])}
              >
                Svuota
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  },
);
Combobox.displayName = 'Combobox';

export { Combobox };
