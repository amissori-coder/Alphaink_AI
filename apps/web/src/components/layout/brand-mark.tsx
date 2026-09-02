import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Segno grafico AlphaInk: tre gocce d'inchiostro CMYK sovrapposte.
 * Puro SVG, così resta nitido a ogni dimensione e non richiede immagini.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="AlphaInk"
      className={cn('size-8 shrink-0', className)}
    >
      <rect x="0" y="0" width="32" height="32" rx="9" fill="#0F172A" />
      <circle cx="12.5" cy="13" r="6.5" fill="#00AEEF" fillOpacity="0.92" />
      <circle cx="19.5" cy="13" r="6.5" fill="#EC008C" fillOpacity="0.82" />
      <circle cx="16" cy="19.5" r="6.5" fill="#FFC400" fillOpacity="0.78" />
    </svg>
  );
}

export interface BrandLockupProps {
  /** Nasconde il testo, lasciando solo il simbolo. */
  compact?: boolean;
  className?: string;
  /** Classi del testo, per adattarlo a fondi chiari o scuri. */
  textClassName?: string;
}

/** Simbolo + logotipo, usato nella barra laterale e nella schermata di accesso. */
export function BrandLockup({ compact = false, className, textClassName }: BrandLockupProps) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      {compact ? null : (
        <span className={cn('flex min-w-0 flex-col leading-tight', textClassName)}>
          <span className="truncate text-sm font-semibold tracking-tight">AlphaInk</span>
          <span className="truncate text-[11px] font-medium uppercase tracking-wider opacity-60">
            Newsletter
          </span>
        </span>
      )}
    </span>
  );
}
