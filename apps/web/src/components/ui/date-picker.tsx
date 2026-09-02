'use client';

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  isValid,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { it } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// Calendario mensile costruito con date-fns (nessuna libreria di calendario).
// -----------------------------------------------------------------------------

export interface CalendarProps {
  /** Giorno selezionato. */
  selected?: Date | null;
  onSelect?: (date: Date) => void;
  /** Mese visualizzato (controllato). */
  month?: Date;
  onMonthChange?: (month: Date) => void;
  minDate?: Date;
  maxDate?: Date;
  /** Predicato aggiuntivo per disabilitare giorni. */
  isDateDisabled?: (date: Date) => boolean;
  /** Contenuto extra sotto il numero del giorno (es. pallini eventi). */
  renderDayBadge?: (date: Date) => React.ReactNode;
  className?: string;
}

/** Intestazioni dei giorni: lunedì → domenica, in italiano. */
const WEEKDAY_LABELS = eachDayOfInterval({
  start: startOfWeek(new Date(2024, 0, 1), { locale: it, weekStartsOn: 1 }),
  end: endOfWeek(new Date(2024, 0, 1), { locale: it, weekStartsOn: 1 }),
}).map((day) => format(day, 'EEEEE', { locale: it }));

function Calendar({
  selected,
  onSelect,
  month,
  onMonthChange,
  minDate,
  maxDate,
  isDateDisabled,
  renderDayBadge,
  className,
}: CalendarProps) {
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    () => startOfMonth(month ?? selected ?? new Date()),
  );
  const visibleMonth = month ? startOfMonth(month) : internalMonth;

  const changeMonth = (next: Date) => {
    if (onMonthChange) onMonthChange(next);
    else setInternalMonth(next);
  };

  const days = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(visibleMonth), { locale: it, weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(visibleMonth), { locale: it, weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [visibleMonth]);

  const disabled = React.useCallback(
    (day: Date) => {
      if (minDate && isBefore(startOfDay(day), startOfDay(minDate))) return true;
      if (maxDate && isAfter(startOfDay(day), startOfDay(maxDate))) return true;
      return isDateDisabled?.(day) ?? false;
    },
    [minDate, maxDate, isDateDisabled],
  );

  return (
    <div className={cn('w-[17.5rem] select-none', className)}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => changeMonth(subMonths(visibleMonth, 1))}
          aria-label="Mese precedente"
        >
          <ChevronLeft />
        </Button>
        <span className="text-sm font-medium capitalize" aria-live="polite">
          {format(visibleMonth, 'LLLL yyyy', { locale: it })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => changeMonth(addMonths(visibleMonth, 1))}
          aria-label="Mese successivo"
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" role="grid">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="flex h-7 items-center justify-center text-[0.7rem] font-semibold uppercase text-muted-foreground"
            role="columnheader"
            aria-label={label}
          >
            {label}
          </div>
        ))}

        {days.map((day) => {
          const outside = !isSameMonth(day, visibleMonth);
          const isSelected = selected ? isSameDay(day, selected) : false;
          const isDisabled = disabled(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              role="gridcell"
              disabled={isDisabled}
              aria-selected={isSelected}
              aria-label={format(day, 'd MMMM yyyy', { locale: it })}
              onClick={() => onSelect?.(day)}
              className={cn(
                'relative flex h-9 flex-col items-center justify-center rounded-md text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
                outside && 'text-muted-foreground/60',
                isToday(day) && !isSelected && 'font-semibold text-primary',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              <span className="tabular-nums leading-none">{format(day, 'd')}</span>
              {renderDayBadge ? <span className="mt-0.5 leading-none">{renderDayBadge(day)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
Calendar.displayName = 'Calendar';

// -----------------------------------------------------------------------------
// Campo con popover
// -----------------------------------------------------------------------------

export interface DatePickerProps {
  /** Data selezionata come stringa ISO, oppure `null`. */
  value?: string | null;
  onChange: (isoDate: string | null) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  /** Mostra il pulsante "Cancella". */
  clearable?: boolean;
  className?: string;
  id?: string;
  invalid?: boolean;
  align?: 'start' | 'center' | 'end';
}

/** Selettore di data in italiano; il valore scambiato è sempre una stringa ISO. */
const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Seleziona una data',
      minDate,
      maxDate,
      disabled,
      clearable = true,
      className,
      id,
      invalid,
      align = 'start',
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const parsed = React.useMemo(() => {
      if (!value) return null;
      const date = new Date(value);
      return isValid(date) ? date : null;
    }, [value]);

    const handleSelect = (day: Date) => {
      // Conserva l'orario già impostato, se presente.
      const next = new Date(day);
      if (parsed) {
        next.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
      } else {
        next.setHours(9, 0, 0, 0);
      }
      onChange(next.toISOString());
      setOpen(false);
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            id={id}
            type="button"
            disabled={disabled}
            data-invalid={invalid || undefined}
            className={cn(
              'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-soft transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              invalid && 'border-destructive',
              !parsed && 'text-muted-foreground',
              className,
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {parsed ? format(parsed, 'd MMMM yyyy', { locale: it }) : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align={align} className="w-auto p-3">
          <Calendar
            selected={parsed}
            onSelect={handleSelect}
            minDate={minDate}
            maxDate={maxDate}
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleSelect(new Date())}
            >
              Oggi
            </Button>
            {clearable && parsed ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Cancella
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    );
  },
);
DatePicker.displayName = 'DatePicker';

/** Converte "12/03/2026" in `Date`; ritorna `null` se il formato non è valido. */
function parseItalianDate(input: string): Date | null {
  const date = parse(input.trim(), 'dd/MM/yyyy', new Date(), { locale: it });
  return isValid(date) ? date : null;
}

export { Calendar, DatePicker, parseItalianDate };
