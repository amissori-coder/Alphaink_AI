'use client';

import { ALPHAINK_PALETTE } from '@alphaink/shared';
import { Check, Pipette } from 'lucide-react';
import * as React from 'react';
import { HexColorPicker } from 'react-colorful';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Colori di brand proposti come scorciatoia. */
export const BRAND_SWATCHES: string[] = [
  ALPHAINK_PALETTE.cyan,
  ALPHAINK_PALETTE.cyanDark,
  ALPHAINK_PALETTE.magenta,
  ALPHAINK_PALETTE.yellow,
  ALPHAINK_PALETTE.key,
  ALPHAINK_PALETTE.slate,
  ALPHAINK_PALETTE.muted,
  ALPHAINK_PALETTE.border,
  ALPHAINK_PALETTE.background,
  ALPHAINK_PALETTE.surface,
  ALPHAINK_PALETTE.success,
  ALPHAINK_PALETTE.danger,
];

const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(input: string): string | null {
  const value = input.trim().startsWith('#') ? input.trim() : `#${input.trim()}`;
  if (!HEX_PATTERN.test(value)) return null;
  if (value.length === 4) {
    // Espande #abc in #aabbcc.
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  return value.toLowerCase();
}

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Colori aggiuntivi mostrati sotto la palette di brand. */
  swatches?: string[];
  /** Etichetta accessibile del pulsante. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Nasconde il campo di testo con il valore esadecimale. */
  hideInput?: boolean;
  align?: 'start' | 'center' | 'end';
}

/** Selettore di colore: anteprima, palette AlphaInk, ruota e campo esadecimale. */
const ColorPicker = React.forwardRef<HTMLButtonElement, ColorPickerProps>(
  (
    { value, onChange, swatches = BRAND_SWATCHES, label = 'Scegli un colore', disabled, className, hideInput, align = 'start' },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [draft, setDraft] = React.useState(value);

    // Allinea il campo di testo quando il valore cambia dall'esterno.
    React.useEffect(() => setDraft(value), [value]);

    const commit = (next: string) => {
      const normalized = normalizeHex(next);
      if (normalized) onChange(normalized);
      else setDraft(value);
    };

    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={ref}
              type="button"
              disabled={disabled}
              aria-label={`${label} (attuale: ${value})`}
              className={cn(
                'relative size-9 shrink-0 rounded-md border border-input shadow-soft transition-shadow',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
              style={{ backgroundColor: value }}
            >
              <span className="sr-only">{label}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align={align} className="w-64 space-y-3">
            <HexColorPicker
              color={value}
              onChange={onChange}
              style={{ width: '100%', height: 160 }}
            />

            <div className="grid grid-cols-6 gap-1.5">
              {swatches.map((swatch) => {
                const active = swatch.toLowerCase() === value.toLowerCase();
                return (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => onChange(swatch.toLowerCase())}
                    aria-label={swatch}
                    aria-pressed={active}
                    className={cn(
                      'relative flex size-7 items-center justify-center rounded-md border border-border transition-transform',
                      'hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    style={{ backgroundColor: swatch }}
                  >
                    {active ? (
                      <Check className="size-3.5 text-white mix-blend-difference" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={(event) => commit(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit(draft);
                  }
                }}
                aria-label="Codice esadecimale"
                className="font-mono text-xs uppercase"
                startIcon={<Pipette />}
                maxLength={7}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                Fatto
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {hideInput ? null : (
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            disabled={disabled}
            aria-label="Codice esadecimale"
            className="h-9 w-28 font-mono text-xs uppercase"
            maxLength={7}
          />
        )}
      </div>
    );
  },
);
ColorPicker.displayName = 'ColorPicker';

export { ColorPicker, normalizeHex };
