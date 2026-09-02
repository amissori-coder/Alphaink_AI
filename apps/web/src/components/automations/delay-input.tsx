'use client';

import { DELAY_UNIT_LABELS, delayToMinutes } from '@alphaink/shared';
import type { Delay, DelayUnit } from '@alphaink/shared';
import { Clock } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const UNITS: DelayUnit[] = ['minutes', 'hours', 'days'];

const MINUTES_IN_HOUR = 60;
const MINUTES_IN_DAY = 60 * 24;

/** Concorda il sostantivo con il numero: "1 giorno", "2 giorni". */
function plural(value: number, singular: string, plural_: string): string {
  return `${value} ${value === 1 ? singular : plural_}`;
}

/**
 * Ritardo in forma discorsiva: "subito", "90 minuti", "2 giorni e 4 ore".
 * È la stessa lettura che fa il motore, quindi non mente sul momento d'invio.
 */
export function humanizeDelay(delay: Delay): string {
  const total = Math.max(0, Math.round(delayToMinutes(delay)));
  if (total === 0) return 'subito';

  const days = Math.floor(total / MINUTES_IN_DAY);
  const hours = Math.floor((total % MINUTES_IN_DAY) / MINUTES_IN_HOUR);
  const minutes = total % MINUTES_IN_HOUR;

  const parts: string[] = [];
  if (days > 0) parts.push(plural(days, 'giorno', 'giorni'));
  if (hours > 0) parts.push(plural(hours, 'ora', 'ore'));
  if (minutes > 0) parts.push(plural(minutes, 'minuto', 'minuti'));

  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/**
 * Conversione esplicita quando l'unità scelta è più fine di quella naturale:
 * "1440 ore = 60 giorni". Ritorna `null` quando non c'è nulla da chiarire.
 */
export function delayEquivalentLabel(delay: Delay): string | null {
  const total = Math.max(0, Math.round(delayToMinutes(delay)));
  if (total === 0) return null;

  const written = `${delay.value} ${DELAY_UNIT_LABELS[delay.unit]}`;

  if (delay.unit !== 'days' && total % MINUTES_IN_DAY === 0) {
    return `${written} = ${plural(total / MINUTES_IN_DAY, 'giorno', 'giorni')}`;
  }
  if (delay.unit === 'minutes' && total % MINUTES_IN_HOUR === 0) {
    return `${written} = ${plural(total / MINUTES_IN_HOUR, 'ora', 'ore')}`;
  }
  return null;
}

export interface DelayInputProps {
  value: Delay;
  onChange: (next: Delay) => void;
  disabled?: boolean;
  /** Etichetta sopra i campi; se assente il gruppo è etichettato via `aria-label`. */
  label?: string;
  /** Testo di aiuto sotto i campi; sostituisce quello predefinito. */
  hint?: React.ReactNode;
  id?: string;
  className?: string;
}

/**
 * Ritardo di uno step: valore numerico più unità di misura.
 *
 * Sotto ai campi compare sempre la lettura in chiaro ("60 giorni") e, quando
 * l'unità scelta è più fine di quella naturale, anche la conversione
 * ("1440 ore = 60 giorni"): è il caso del riacquisto toner, dove il valore
 * predefinito è espresso in ore.
 */
export function DelayInput({
  value,
  onChange,
  disabled = false,
  label,
  hint,
  id,
  className,
}: DelayInputProps) {
  const reactId = React.useId();
  const fieldId = id ?? `ritardo-${reactId}`;
  const hintId = `${fieldId}-hint`;

  const equivalent = delayEquivalentLabel(value);
  const readable = humanizeDelay(value);

  const handleValue = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100_000) : 0;
    onChange({ ...value, value: next });
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <Label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
          {label}
        </Label>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          step={1}
          value={String(value.value)}
          disabled={disabled}
          aria-describedby={hintId}
          aria-label={label ? undefined : 'Valore del ritardo'}
          onChange={(event) => handleValue(event.target.value)}
          className="w-24 tabular-nums"
        />
        <Select
          value={value.unit}
          disabled={disabled}
          onValueChange={(unit) => onChange({ ...value, unit: unit as DelayUnit })}
        >
          <SelectTrigger className="w-32" aria-label="Unità del ritardo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((unit) => (
              <SelectItem key={unit} value={unit}>
                {DELAY_UNIT_LABELS[unit]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p id={hintId} className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Clock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span>
          {hint ?? (
            <>
              Invio {readable === 'subito' ? 'immediato' : `dopo ${readable}`} dal momento del
              trigger.
              {equivalent ? <span className="ml-1 text-foreground">{equivalent}</span> : null}
            </>
          )}
        </span>
      </p>
    </div>
  );
}
