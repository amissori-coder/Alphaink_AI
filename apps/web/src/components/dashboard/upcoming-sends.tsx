'use client';

import {
  COLLECTIONS,
  NEWSLETTER_STATUS_LABELS,
  type Newsletter,
  type NewsletterStatus,
} from '@alphaink/shared';
import { limit, orderBy, where } from 'firebase/firestore';
import { CalendarClock, CalendarPlus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { DashboardPanel } from '@/components/dashboard/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { formatDateTimeIt, formatNumber } from '@/lib/utils';

/** Stati che rappresentano un invio ancora da eseguire. */
const PENDING_STATUSES: NewsletterStatus[] = ['scheduled', 'queued'];

/**
 * Conto alla rovescia in italiano: "fra 3 g 4 h", "fra 12 min", "in partenza".
 * Sopra le 48 ore si usano giorni e ore, sotto l'ora solo i minuti.
 */
export function formatCountdown(targetIso: string | null | undefined, now: number): string {
  if (!targetIso) return '—';
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return '—';

  const diff = target - now;
  if (diff <= 0) return 'in partenza';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'fra meno di 1 min';
  if (minutes < 60) return `fra ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const restMinutes = minutes % 60;
    return restMinutes > 0 ? `fra ${hours} h ${restMinutes} min` : `fra ${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `fra ${days} g ${restHours} h` : `fra ${days} g`;
}

/** Timer condiviso: aggiorna i conti alla rovescia una volta al minuto. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface UpcomingSendsProps {
  className?: string;
  /** Quante newsletter mostrare. */
  max?: number;
}

/** Prossimi invii pianificati, con conto alla rovescia. */
export function UpcomingSends({ className, max = 5 }: UpcomingSendsProps) {
  const { can } = useAuth();
  const now = useNow();
  const canRead = can('newsletter:read');

  const { data, loading, error } = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [where('status', 'in', PENDING_STATUSES), orderBy('schedule.sendAt', 'asc'), limit(max)],
    { enabled: canRead, key: 'dashboard-prossimi-invii' },
  );

  return (
    <DashboardPanel
      className={className}
      icon={<CalendarClock />}
      title="Prossimi invii pianificati"
      description="Newsletter in attesa di partire."
      actions={
        can('newsletter:read') ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/calendario">Calendario</Link>
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
          icon={<CalendarPlus />}
          title="Nessun invio in programma"
          description="Pianifica una newsletter per vederla comparire qui."
          action={
            can('newsletter:schedule') ? (
              <Button size="sm" asChild>
                <Link href="/newsletter">Pianifica una newsletter</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {data.map((newsletter) => {
            const sendAt = newsletter.schedule?.sendAt ?? null;
            return (
              <li key={newsletter.id} className="py-3 first:pt-0 last:pb-0">
                <Link
                  href={`/newsletter/${newsletter.id}`}
                  className="group flex items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {newsletter.name || newsletter.subject || 'Senza titolo'}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {formatDateTimeIt(sendAt)} ·{' '}
                      {formatNumber(newsletter.audience?.estimatedRecipients ?? 0)} destinatari
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-primary">
                      {formatCountdown(sendAt, now)}
                    </span>
                    <Badge variant={newsletter.status === 'queued' ? 'warning' : 'secondary'}>
                      {NEWSLETTER_STATUS_LABELS[newsletter.status]}
                    </Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
