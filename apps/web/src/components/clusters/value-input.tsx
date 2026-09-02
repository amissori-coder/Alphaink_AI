'use client';

import type { FilterOperator, FilterValue } from '@alphaink/shared';
import { X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { DAY_OPERATORS, MULTI_VALUE_OPERATORS, RANGE_OPERATORS, VALUELESS_OPERATORS } from './constants';
import type { FieldDefinition } from './types';

/** Converte un valore di filtro in testo per gli input a riga singola. */
function toText(value: FilterValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Converte un valore di filtro in numero; `null` quando il campo è vuoto. */
function toNumber(value: FilterValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Converte un valore di filtro in elenco di stringhe. */
function toList(value: FilterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number') return [String(value)];
  return [];
}

// -----------------------------------------------------------------------------
// Elenco di valori liberi (chip)
// -----------------------------------------------------------------------------

interface ChipsInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
}

/**
 * Campo a "chip": si digita un valore e lo si conferma con Invio o virgola.
 * Serve per gli elenchi liberi (SKU, marche, modelli di stampante) dove non
 * esiste un insieme chiuso di opzioni.
 */
function ChipsInput({ values, onChange, placeholder, disabled, ariaLabel }: ChipsInputProps) {
  const [draft, setDraft] = React.useState('');

  const commit = (raw: string) => {
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) return;
    const merged = Array.from(new Set([...values, ...entries]));
    onChange(merged);
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, position) => position !== index));
  };

  return (
    <div className="w-full space-y-1.5">
      <Input
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder ?? 'Scrivi un valore e premi Invio'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit(draft);
            return;
          }
          if (event.key === 'Backspace' && draft === '' && values.length > 0) {
            removeAt(values.length - 1);
          }
        }}
        onBlur={() => commit(draft)}
      />
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>
              <Badge variant="secondary" className="gap-1 pr-1">
                <span className="max-w-[12rem] truncate">{value}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Rimuovi ${value}`}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Input del valore della condizione
// -----------------------------------------------------------------------------

export interface ConditionValueInputProps {
  definition: FieldDefinition;
  operator: FilterOperator;
  value: FilterValue | undefined;
  value2: FilterValue | undefined;
  onChange: (value: FilterValue, value2?: FilterValue) => void;
  /** Opzioni dinamiche per i campi che le ricavano dai dati (es. cluster). */
  dynamicOptions?: ComboboxOption[];
  disabled?: boolean;
  className?: string;
}

/**
 * Controllo del valore di una condizione: la forma dipende insieme dal tipo del
 * campo e dall'operatore scelto. Gli operatori `è vuoto` / `non è vuoto` non
 * mostrano alcun controllo, `compreso fra` ne mostra due.
 */
export function ConditionValueInput({
  definition,
  operator,
  value,
  value2,
  onChange,
  dynamicOptions,
  disabled,
  className,
}: ConditionValueInputProps) {
  const options: ComboboxOption[] = React.useMemo(() => {
    if (dynamicOptions) return dynamicOptions;
    return (definition.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }, [definition.options, dynamicOptions]);

  if (VALUELESS_OPERATORS.includes(operator)) {
    return (
      <p className={cn('self-center text-xs text-muted-foreground', className)}>
        Nessun valore richiesto.
      </p>
    );
  }

  // "negli ultimi / da più di" → sempre un numero di giorni, qualunque sia il campo.
  if (DAY_OPERATORS.includes(operator)) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={3650}
          step={1}
          disabled={disabled}
          aria-label={`Giorni per ${definition.label}`}
          value={toNumber(value) ?? ''}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="w-28"
        />
        <span className="whitespace-nowrap text-sm text-muted-foreground">giorni</span>
      </div>
    );
  }

  const isRange = RANGE_OPERATORS.includes(operator);
  const isMulti = MULTI_VALUE_OPERATORS.includes(operator);

  // Elenco chiuso di opzioni (enum, cluster, famiglie prodotto).
  if (options.length > 0 && (isMulti || definition.kind === 'enum' || definition.kind === 'cluster')) {
    if (isMulti) {
      return (
        <Combobox
          multiple
          options={options}
          value={toList(value)}
          onChange={(next) => onChange(next as string[])}
          disabled={disabled}
          placeholder="Scegli uno o più valori"
          searchPlaceholder="Cerca…"
          emptyMessage="Nessun valore disponibile."
          className={cn('h-9 w-full', className)}
          contentClassName="min-w-[16rem]"
        />
      );
    }
    return (
      <Combobox
        options={options}
        value={toText(value)}
        onChange={(next) => onChange(next as string)}
        disabled={disabled}
        placeholder="Scegli un valore"
        searchPlaceholder="Cerca…"
        emptyMessage="Nessun valore disponibile."
        className={cn('h-9 w-full', className)}
        contentClassName="min-w-[16rem]"
      />
    );
  }

  // Elenco libero di valori: qui ci si arriva solo quando il campo non ha
  // un insieme chiuso di opzioni (SKU, marche, modelli di stampante).
  if (isMulti) {
    return (
      <ChipsInput
        values={toList(value)}
        onChange={(next) => onChange(next)}
        placeholder={definition.placeholder}
        disabled={disabled}
        ariaLabel={`Valori per ${definition.label}`}
      />
    );
  }

  if (definition.kind === 'date') {
    if (isRange) {
      return (
        <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', className)}>
          <DatePicker
            value={typeof value === 'string' ? value : null}
            onChange={(iso) => onChange(iso, value2 ?? null)}
            disabled={disabled}
            placeholder="Dal"
            className="sm:w-44"
          />
          <span className="text-xs text-muted-foreground">e</span>
          <DatePicker
            value={typeof value2 === 'string' ? value2 : null}
            onChange={(iso) => onChange(value ?? null, iso)}
            disabled={disabled}
            placeholder="Al"
            className="sm:w-44"
          />
        </div>
      );
    }
    return (
      <DatePicker
        value={typeof value === 'string' ? value : null}
        onChange={(iso) => onChange(iso)}
        disabled={disabled}
        className={cn('sm:w-52', className)}
      />
    );
  }

  if (definition.kind === 'number' || definition.kind === 'currency') {
    const step = definition.kind === 'currency' ? 0.01 : 1;
    if (isRange) {
      return (
        <div className={cn('flex items-center gap-2', className)}>
          <Input
            type="number"
            inputMode="decimal"
            step={step}
            disabled={disabled}
            aria-label={`${definition.label}: valore minimo`}
            value={toNumber(value) ?? ''}
            onChange={(event) => onChange(Number(event.target.value) || 0, value2 ?? 0)}
            className="w-28"
          />
          <span className="text-xs text-muted-foreground">e</span>
          <Input
            type="number"
            inputMode="decimal"
            step={step}
            disabled={disabled}
            aria-label={`${definition.label}: valore massimo`}
            value={toNumber(value2) ?? ''}
            onChange={(event) => onChange(value ?? 0, Number(event.target.value) || 0)}
            className="w-28"
          />
          {definition.unit ? (
            <span className="whitespace-nowrap text-sm text-muted-foreground">{definition.unit}</span>
          ) : null}
        </div>
      );
    }
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          disabled={disabled}
          aria-label={definition.label}
          value={toNumber(value) ?? ''}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          className="w-32"
        />
        {definition.unit ? (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{definition.unit}</span>
        ) : null}
      </div>
    );
  }

  // Testo libero (anche per gli elenchi con operatori "contiene").
  return (
    <Input
      type="text"
      disabled={disabled}
      aria-label={definition.label}
      placeholder={definition.placeholder ?? 'Valore'}
      value={toText(value)}
      onChange={(event) => onChange(event.target.value)}
      className={cn('w-full', className)}
    />
  );
}

export { ChipsInput };
