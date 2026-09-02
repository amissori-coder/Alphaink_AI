import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Breadcrumb o badge sopra il titolo. */
  eyebrow?: React.ReactNode;
  /** Azioni allineate a destra. */
  actions?: React.ReactNode;
  /** Contenuto sotto l'intestazione (tab, filtri). */
  children?: React.ReactNode;
  /** Rimuove il bordo inferiore. */
  borderless?: boolean;
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ className, title, description, eyebrow, actions, children, borderless, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-4 pb-4', !borderless && 'border-b border-border', className)}
      {...props}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div> : null}
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  ),
);
PageHeader.displayName = 'PageHeader';

export { PageHeader };
