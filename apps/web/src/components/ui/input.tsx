'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icona decorativa a sinistra del campo. */
  startIcon?: React.ReactNode;
  /** Contenuto a destra del campo (icona, unità di misura, bottone). */
  endIcon?: React.ReactNode;
  /** Evidenzia il campo come non valido. */
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', startIcon, endIcon, invalid, ...props }, ref) => {
    const field = (
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-soft transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          invalid && 'border-destructive focus-visible:ring-destructive',
          startIcon && 'pl-9',
          endIcon && 'pr-9',
          className,
        )}
        {...props}
      />
    );

    if (!startIcon && !endIcon) return field;

    return (
      <div className="relative w-full">
        {startIcon ? (
          <span
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {startIcon}
          </span>
        ) : null}
        {field}
        {endIcon ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
            {endIcon}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };
