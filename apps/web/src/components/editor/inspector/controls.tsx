'use client';

/**
 * Controlli riutilizzabili del pannello proprietà.
 *
 * Sono deliberatamente compatti: l'ispettore è largo poco più di 300 px e deve
 * contenere decine di impostazioni senza costringere a scorrere per ogni
 * modifica. Ogni controllo è etichettato e collegato al proprio campo, così
 * resta utilizzabile con la sola tastiera e con gli screen reader.
 */

import type { BorderStyle, Spacing, TextAlign, TypographyStyle } from '@alphaink/shared';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Link as LinkIcon,
  Unlink,
} from 'lucide-react';
import * as React from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ColorPicker } from '@/components/ui/color-picker';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TimePicker, timeFromIso, withTime } from '@/components/ui/time-picker';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { MergeTagMenu } from '../merge-tag-menu';
import { clampNumber } from '../utils';

// -----------------------------------------------------------------------------
// Struttura
// -----------------------------------------------------------------------------

export interface InspectorSectionProps {
  value: string;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

/** Gruppo di impostazioni richiudibile. Va usato dentro `<InspectorGroups>`. */
export function InspectorSection({ value, title, icon, children }: InspectorSectionProps) {
  return (
    <AccordionItem value={value} className="border-border/70 px-3 last:border-b-0">
      <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline">
        <span className="flex items-center gap-2 [&_svg]:size-3.5">
          {icon}
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3.5 pb-4 text-foreground">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** Contenitore dei gruppi: apre di default quelli indicati. */
export function InspectorGroups({
  defaultValue,
  children,
}: {
  defaultValue: string[];
  children: React.ReactNode;
}) {
  return (
    <Accordion type="multiple" defaultValue={defaultValue} className="w-full">
      {children}
    </Accordion>
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** Etichetta e controllo sulla stessa riga (interruttori, allineamenti). */
  inline?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, inline, action, children }: FieldProps) {
  if (inline) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={htmlFor} className="text-xs font-medium">
            {label}
          </Label>
          {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </Label>
        {action}
      </div>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Testo
// -----------------------------------------------------------------------------

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  /** Mostra il menu dei merge tag accanto all'etichetta. */
  mergeTags?: boolean;
  type?: 'text' | 'url' | 'number';
  id?: string;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mergeTags,
  type = 'text',
  id,
}: TextFieldProps) {
  const fieldId = React.useId();
  const inputId = id ?? fieldId;
  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint={hint}
      action={
        mergeTags ? (
          <MergeTagMenu
            onInsert={(token) => onChange(`${value}${token}`)}
            trigger={
              <button
                type="button"
                className="rounded px-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                + campo
              </button>
            }
          />
        ) : null
      }
    >
      <Input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-sm"
      />
    </Field>
  );
}

export interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
  mono?: boolean;
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 4,
  mono,
}: TextAreaFieldProps) {
  const id = React.useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn('text-sm', mono && 'font-mono text-xs')}
      />
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Numeri
// -----------------------------------------------------------------------------

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
  /** Aggiunge un cursore sotto al campo numerico. */
  slider?: boolean;
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 200,
  step = 1,
  suffix = 'px',
  hint,
  slider,
}: NumberFieldProps) {
  const id = React.useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className={cn('flex items-center gap-2', slider && 'flex-col items-stretch gap-2')}>
        <Input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max, min))}
          endIcon={suffix ? <span className="text-[11px]">{suffix}</span> : undefined}
          className="h-8 text-sm"
        />
        {slider ? (
          <Slider
            value={[clampNumber(value, min, max, min)]}
            min={min}
            max={max}
            step={step}
            onValueChange={([next]) => onChange(next ?? min)}
            aria-label={label}
          />
        ) : null}
      </div>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Colori
// -----------------------------------------------------------------------------

export interface ColorFieldProps {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Consente il valore "trasparente" (nessun colore). */
  allowEmpty?: boolean;
  /** Colore mostrato quando il valore è vuoto. */
  fallback?: string;
  hint?: string;
}

export function ColorField({
  label,
  value,
  onChange,
  allowEmpty,
  fallback = '#FFFFFF',
  hint,
}: ColorFieldProps) {
  const empty = !value;
  return (
    <Field label={label} hint={hint} inline>
      <div className="flex items-center gap-1.5">
        {allowEmpty ? (
          <SimpleTooltip content={empty ? 'Applica un colore' : 'Rendi trasparente'}>
            <button
              type="button"
              onClick={() => onChange(empty ? fallback : null)}
              aria-pressed={empty}
              className={cn(
                'rounded-md border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                empty
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              Auto
            </button>
          </SimpleTooltip>
        ) : null}
        <ColorPicker
          hideInput
          align="end"
          label={label}
          value={value || fallback}
          onChange={(color) => onChange(color)}
        />
      </div>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Interruttori e scelte
// -----------------------------------------------------------------------------

export function SwitchField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = React.useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} inline>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}

export interface SelectFieldOption<T extends string> {
  value: T;
  label: string;
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  inline,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<SelectFieldOption<T>>;
  hint?: string;
  inline?: boolean;
}) {
  const id = React.useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} inline={inline}>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id} className={cn('h-8 text-sm', inline && 'w-40')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Allineamento
// -----------------------------------------------------------------------------

const ALIGN_OPTIONS: Array<{ value: TextAlign; label: string; icon: React.ReactNode }> = [
  { value: 'left', label: 'Sinistra', icon: <AlignLeft /> },
  { value: 'center', label: 'Centro', icon: <AlignCenter /> },
  { value: 'right', label: 'Destra', icon: <AlignRight /> },
  { value: 'justify', label: 'Giustificato', icon: <AlignJustify /> },
];

export function AlignField({
  label = 'Allineamento',
  value,
  onChange,
  withJustify = false,
}: {
  label?: string;
  value: TextAlign;
  onChange: (value: TextAlign) => void;
  withJustify?: boolean;
}) {
  const options = withJustify ? ALIGN_OPTIONS : ALIGN_OPTIONS.slice(0, 3);
  return (
    <Field label={label} inline>
      <div role="group" aria-label={label} className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
        {options.map((option) => (
          <SimpleTooltip key={option.value} content={option.label}>
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded transition-colors [&_svg]:size-3.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === option.value
                  ? 'bg-card text-foreground shadow-soft'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.icon}
            </button>
          </SimpleTooltip>
        ))}
      </div>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Spaziatura
// -----------------------------------------------------------------------------

const SPACING_SIDES: Array<{ key: keyof Spacing; label: string; short: string }> = [
  { key: 'top', label: 'Sopra', short: 'S' },
  { key: 'right', label: 'Destra', short: 'D' },
  { key: 'bottom', label: 'Sotto', short: 'G' },
  { key: 'left', label: 'Sinistra', short: 'X' },
];

export interface SpacingFieldProps {
  label: string;
  value: Spacing;
  onChange: (value: Spacing) => void;
  max?: number;
  hint?: string;
}

/**
 * Controllo a quattro valori con collegamento: quando il lucchetto è chiuso,
 * modificare un lato aggiorna tutti gli altri.
 */
export function SpacingField({ label, value, onChange, max = 120, hint }: SpacingFieldProps) {
  const uniform =
    value.top === value.right && value.right === value.bottom && value.bottom === value.left;
  const [linked, setLinked] = React.useState(uniform);

  const update = (side: keyof Spacing, raw: number) => {
    const next = clampNumber(raw, 0, max, 0);
    onChange(linked ? { top: next, right: next, bottom: next, left: next } : { ...value, [side]: next });
  };

  return (
    <Field
      label={label}
      hint={hint}
      action={
        <SimpleTooltip content={linked ? 'Valori collegati' : 'Valori indipendenti'}>
          <button
            type="button"
            aria-pressed={linked}
            aria-label={linked ? 'Scollega i valori' : 'Collega i valori'}
            onClick={() => setLinked((current) => !current)}
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-md transition-colors [&_svg]:size-3.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              linked ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {linked ? <LinkIcon /> : <Unlink />}
          </button>
        </SimpleTooltip>
      }
    >
      <div className="grid grid-cols-4 gap-1.5">
        {SPACING_SIDES.map((side) => (
          <div key={side.key} className="space-y-1">
            <input
              type="number"
              min={0}
              max={max}
              value={value[side.key]}
              aria-label={`${label} — ${side.label}`}
              onChange={(event) => update(side.key, Number(event.target.value))}
              className={cn(
                'h-8 w-full rounded-md border border-input bg-card px-1.5 text-center text-xs shadow-soft transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}
            />
            <span className="block text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              {side.label}
            </span>
          </div>
        ))}
      </div>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Data e ora
// -----------------------------------------------------------------------------

export function DateTimeField({
  label,
  value,
  onChange,
  hint,
  clearable = true,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  hint?: string;
  clearable?: boolean;
}) {
  const id = React.useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <DatePicker
          id={id}
          value={value ?? null}
          onChange={onChange}
          clearable={clearable}
          className="h-8 text-xs"
          align="end"
        />
        <TimePicker
          value={timeFromIso(value)}
          onChange={(time) => onChange(withTime(value ?? new Date().toISOString(), time))}
          step={30}
          disabled={!value}
          className="h-8 w-24 text-xs"
        />
      </div>
    </Field>
  );
}

// -----------------------------------------------------------------------------
// Bordo
// -----------------------------------------------------------------------------

export const DEFAULT_BORDER: BorderStyle = {
  width: 1,
  style: 'solid',
  color: '#E2E8F0',
  radius: 8,
};

export function BorderField({
  value,
  onChange,
  label = 'Bordo',
}: {
  value: BorderStyle | null | undefined;
  onChange: (value: BorderStyle | null) => void;
  label?: string;
}) {
  const border = value ?? null;
  const enabled = Boolean(border && border.style !== 'none');

  return (
    <div className="space-y-3">
      <SwitchField
        label={label}
        checked={enabled}
        onChange={(checked) => onChange(checked ? (border ?? DEFAULT_BORDER) : null)}
      />
      {enabled && border ? (
        <div className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Spessore"
              value={border.width}
              min={0}
              max={20}
              onChange={(width) => onChange({ ...border, width })}
            />
            <NumberField
              label="Raggio"
              value={border.radius}
              min={0}
              max={64}
              onChange={(radius) => onChange({ ...border, radius })}
            />
          </div>
          <SelectField
            label="Stile"
            inline
            value={border.style}
            onChange={(style) => onChange({ ...border, style })}
            options={[
              { value: 'solid', label: 'Continuo' },
              { value: 'dashed', label: 'Tratteggiato' },
              { value: 'dotted', label: 'Punteggiato' },
              { value: 'none', label: 'Nessuno' },
            ]}
          />
          <ColorField
            label="Colore bordo"
            value={border.color}
            onChange={(color) => onChange({ ...border, color: color ?? DEFAULT_BORDER.color })}
          />
        </div>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tipografia
// -----------------------------------------------------------------------------

export function TypographyFields({
  value,
  onChange,
  withAlign = true,
}: {
  value: TypographyStyle;
  onChange: (value: TypographyStyle) => void;
  withAlign?: boolean;
}) {
  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Dimensione"
          value={value.fontSize}
          min={8}
          max={96}
          onChange={(fontSize) => onChange({ ...value, fontSize })}
        />
        <SelectField
          label="Peso"
          value={String(value.fontWeight) as '400' | '500' | '600' | '700' | '800' | '900'}
          onChange={(weight) =>
            onChange({ ...value, fontWeight: Number(weight) as TypographyStyle['fontWeight'] })
          }
          options={[
            { value: '400', label: 'Normale' },
            { value: '500', label: 'Medio' },
            { value: '600', label: 'Semi-grassetto' },
            { value: '700', label: 'Grassetto' },
            { value: '800', label: 'Extra' },
            { value: '900', label: 'Nero' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Interlinea"
          value={value.lineHeight}
          min={0.8}
          max={3}
          step={0.05}
          suffix="×"
          onChange={(lineHeight) => onChange({ ...value, lineHeight })}
        />
        <NumberField
          label="Spaziatura"
          value={value.letterSpacing}
          min={-5}
          max={20}
          step={0.1}
          onChange={(letterSpacing) => onChange({ ...value, letterSpacing })}
        />
      </div>

      <ColorField
        label="Colore testo"
        value={value.color}
        onChange={(color) => onChange({ ...value, color: color ?? '#0F172A' })}
      />

      <SelectField
        label="Maiuscole"
        inline
        value={value.textTransform ?? 'none'}
        onChange={(textTransform) => onChange({ ...value, textTransform })}
        options={[
          { value: 'none', label: 'Come scritto' },
          { value: 'uppercase', label: 'TUTTO MAIUSCOLO' },
          { value: 'capitalize', label: 'Iniziali Maiuscole' },
        ]}
      />

      {withAlign ? (
        <AlignField withJustify value={value.align} onChange={(align) => onChange({ ...value, align })} />
      ) : null}
    </div>
  );
}
