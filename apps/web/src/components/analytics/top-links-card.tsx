'use client';

import { ExternalLink, Link2 } from 'lucide-react';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber } from '@/lib/utils';

import type { TopLink } from './types';

/** Forma breve di un URL, per non spezzare il layout della classifica. */
export function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    return `${parsed.host}${path.length > 42 ? `${path.slice(0, 42)}…` : path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 60)}…` : url;
  }
}

export interface TopLinksCardProps {
  links: TopLink[];
  loading?: boolean;
  title?: string;
  description?: string;
  className?: string;
}

/** Classifica dei link più cliccati nel periodo, su tutte le newsletter analizzate. */
export function TopLinksCard({
  links,
  loading = false,
  title = 'Link più cliccati',
  description = 'Ordinati per contatti distinti che hanno cliccato, su tutte le newsletter del periodo.',
  className,
}: TopLinksCardProps) {
  const max = links.reduce((best, link) => Math.max(best, link.uniqueClicks), 0);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : links.length === 0 ? (
          <EmptyState
            compact
            icon={<Link2 />}
            title="Nessun click registrato"
            description="Appena qualcuno cliccherà un link delle email, comparirà in questa classifica."
          />
        ) : (
          <ol className="space-y-3">
            {links.map((link, index) => (
              <li key={`${link.url}-${index}`} className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground hover:underline"
                    title={link.url}
                  >
                    <span className="truncate">{shortenUrl(link.url)}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </a>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {formatNumber(link.uniqueClicks)}
                  </span>
                </div>
                <Progress
                  value={max > 0 ? (link.uniqueClicks / max) * 100 : 0}
                  size="sm"
                  aria-label={`Click unici su ${shortenUrl(link.url)}`}
                />
                <p className="text-[11px] text-muted-foreground">
                  {formatNumber(link.clicks)} click totali
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
