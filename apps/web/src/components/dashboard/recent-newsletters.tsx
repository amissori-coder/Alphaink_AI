'use client';

import { COLLECTIONS, EMPTY_STATS, type Newsletter } from '@alphaink/shared';
import { limit, orderBy, where } from 'firebase/firestore';
import { Mail, Send } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { DashboardPanel } from '@/components/dashboard/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { formatCurrency, formatNumber, formatPercent, relativeTimeIt } from '@/lib/utils';

export interface RecentNewslettersProps {
  className?: string;
  max?: number;
}

/** Ultime newsletter inviate con le statistiche essenziali. */
export function RecentNewsletters({ className, max = 5 }: RecentNewslettersProps) {
  const { can } = useAuth();
  const canRead = can('newsletter:read');

  const { data, loading, error } = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [where('status', '==', 'sent'), orderBy('sentAt', 'desc'), limit(max)],
    { enabled: canRead, key: 'dashboard-ultime-inviate' },
  );

  return (
    <DashboardPanel
      className={className}
      icon={<Send />}
      title="Ultime newsletter inviate"
      description="Risultati delle campagne più recenti."
      actions={
        canRead ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/newsletter">Tutte</Link>
          </Button>
        ) : null
      }
    >
      {!canRead ? (
        <p className="text-sm text-muted-foreground">Non hai i permessi per vedere le newsletter.</p>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : data.length === 0 ? (
        <EmptyState
          compact
          icon={<Mail />}
          title="Nessuna newsletter inviata"
          description="Le campagne concluse compariranno qui con aperture, click e fatturato."
        />
      ) : (
        <ul className="divide-y divide-border">
          {data.map((newsletter) => {
            const stats = { ...EMPTY_STATS, ...(newsletter.stats ?? {}) };
            return (
              <li key={newsletter.id} className="py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/newsletter/${newsletter.id}`}
                  className="group block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {newsletter.name || newsletter.subject || 'Senza titolo'}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {relativeTimeIt(newsletter.sentAt)}
                    </span>
                  </div>
                  <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <dt>Destinatari</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatNumber(stats.recipients)}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <dt>Aperture</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatPercent(stats.openRate, 1)}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <dt>Click</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatPercent(stats.clickRate, 1)}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1">
                      <dt>Fatturato</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {formatCurrency(stats.revenue, stats.currency || 'EUR')}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
