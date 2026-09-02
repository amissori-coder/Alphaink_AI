import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'default' | 'lg';
  /** Testo mostrato accanto allo spinner. */
  label?: string;
}

const SIZES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'size-4',
  default: 'size-5',
  lg: 'size-8',
};

const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = 'default', label, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}
      {...props}
    >
      <Loader2 className={cn('animate-spin', SIZES[size])} aria-hidden="true" />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Caricamento…</span>}
    </div>
  ),
);
Spinner.displayName = 'Spinner';

export { Spinner };
