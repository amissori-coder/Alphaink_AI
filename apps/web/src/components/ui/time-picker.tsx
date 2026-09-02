'use client';

import { Clock } from 'lucide-react';
import * as React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Costruisce l'elenco degli orari con il passo indicato. */
function buildOptions(step: number, min?: string, max?: string): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mins = String(minutes % 60).padStart(2, '0');
    const label = `${hours}:${mins}`;
    if (min && label < min) continue;
    if (max && label > max) continue;
    options.push(label);
  }
  return options;
}

export interface TimePickerProps {
  /** Orario nel formato "HH:mm". */
  value?: string | null;
  onChange: (time: string) => void;
  /** Passo in minuti fra un'opzione e l'altra (default 15). */
  step?: number;
  /** Limiti nel formato "HH:mm". */
  minTime?: string;
  maxTime?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
}

/** Selettore di orario a passi fissi, senza dipendenze esterne. */
const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(
  (
    {
      value,
      onChange,
      step = 15,
      minTime,
      maxTime,
      disabled,
      className,
      id,
      placeholder = 'Orario',
      invalid,
    },
    ref,
  ) => {
    const options = React.useMemo(() => buildOptions(step, minTime, maxTime), [step, minTime, maxTime]);

    // Un orario fuori griglia (es. "09:07") resta selezionabile.
    const items = React.useMemo(() => {
      if (value && TIME_PATTERN.test(value) && !options.includes(value)) {
        return [...options, value].sort();
      }
      return options;
    }, [options, value]);

    return (
      <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger ref={ref} id={id} invalid={invalid} className={cn('w-[8.5rem]', className)}>
          <span className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <SelectValue placeholder={placeholder} />
          </span>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {items.map((option) => (
            <SelectItem key={option} value={option} className="font-mono tabular-nums">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
);
TimePicker.displayName = 'TimePicker';

/** Estrae "HH:mm" da una data ISO. */
function timeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Applica "HH:mm" a una data ISO restituendo una nuova stringa ISO. */
function withTime(iso: string | null | undefined, time: string): string | null {
  const match = TIME_PATTERN.exec(time);
  if (!match) return iso ?? null;
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return iso ?? null;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.toISOString();
}

export { TimePicker, timeFromIso, withTime };
