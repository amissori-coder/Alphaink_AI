'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface DashboardPanelProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Azioni allineate a destra nell'intestazione. */
  actions?: React.ReactNode;
  /** Icona decorativa accanto al titolo. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/** Card standard dei pannelli della dashboard: intestazione + contenuto. */
export function DashboardPanel({
  title,
  description,
  actions,
  icon,
  children,
  className,
  contentClassName,
}: DashboardPanelProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2">
            {icon ? (
              <span className="text-muted-foreground [&_svg]:size-4" aria-hidden="true">
                {icon}
              </span>
            ) : null}
            <span className="truncate">{title}</span>
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </CardHeader>
      <CardContent className={cn('flex-1', contentClassName)}>{children}</CardContent>
    </Card>
  );
}
