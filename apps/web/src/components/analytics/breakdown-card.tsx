'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import type { BreakdownEntry } from './types';

export interface BreakdownCardProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  entries: BreakdownEntry[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Ripartizione percentuale di una dimensione (dispositivi, client di posta).
 * La barra è un rinforzo visivo: il valore resta sempre scritto accanto.
 */
export function BreakdownCard({
  title,
  description,
  icon,
  entries,
  loading = false,
  emptyTitle = 'Dato non disponibile',
  emptyDescription = 'La ripartizione compare quando arrivano le prime aperture tracciate.',
  className,
}: BreakdownCardProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon ? (
            <span className="text-primary [&_svg]:size-4" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>

      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState compact icon={icon} title={emptyTitle} description={emptyDescription} />
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.label} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm capitalize text-foreground">
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatPercent(entry.share)}{' '}
                    <span className="text-foreground">({formatNumber(entry.count)})</span>
                  </span>
                </div>
                <Progress
                  value={entry.share * 100}
                  size="sm"
                  aria-label={`${entry.label}: ${formatPercent(entry.share)}`}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
