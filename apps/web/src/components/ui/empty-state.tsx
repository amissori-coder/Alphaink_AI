import { Inbox } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icona mostrata nel cerchio. Default: una casella vuota. */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Call to action principale (di solito un `<Button>`). */
  action?: React.ReactNode;
  /** Azione secondaria, es. link alla documentazione. */
  secondaryAction?: React.ReactNode;
  /** Riduce spaziature e dimensioni, per pannelli stretti. */
  compact?: boolean;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { className, icon, title, description, action, secondaryAction, compact = false, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 text-center',
        compact ? 'gap-2 p-6' : 'gap-3 p-10',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-muted text-muted-foreground',
          compact ? 'size-9 [&_svg]:size-4' : 'size-12 [&_svg]:size-6',
        )}
        aria-hidden="true"
      >
        {icon ?? <Inbox />}
      </div>
      <h3 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-base')}>{title}</h3>
      {description ? (
        <p className="max-w-md text-balance text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  ),
);
EmptyState.displayName = 'EmptyState';

export { EmptyState };
