'use client';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { clamp } from '@/lib/utils';

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** Colore della barra. */
  tone?: 'primary' | 'success' | 'warning' | 'destructive';
  /** Altezza della barra. */
  size?: 'sm' | 'default';
}

const TONES: Record<NonNullable<ProgressProps['tone']>, string> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, tone = 'primary', size = 'default', ...props }, ref) => {
    const percent = clamp(value ?? 0, 0, 100);
    return (
      <ProgressPrimitive.Root
        ref={ref}
        value={percent}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
          className,
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full w-full flex-1 transition-transform duration-500 ease-out', TONES[tone])}
          style={{ transform: `translateX(-${100 - percent}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
