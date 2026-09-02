'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  Laptop,
  Link2,
  MailWarning,
  RefreshCw,
  Server,
  TriangleAlert,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { isFirebaseConfigured } from '@/lib/firebase/client';
import { cn, formatDateTimeIt, formatNumber, formatPercent, relativeTimeIt } from '@/lib/utils';

import { getNewsletterReport } from './api';
import { REPORT_PAGE_SIZE, reportQueryKey } from './constants';
import { FunnelChart } from './funnel-chart';
import { RecipientsTable } from './recipients-table';
import { StatsGrid } from './stats-grid';
import { TimelineChart } from './timeline-chart';
import type { BreakdownEntry, NewsletterReportResult, TopLink } from './types';

/** Dominio leggibile di un URL, per accorciare i link nella classifica. */
function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    return `${parsed.host}${path.length > 42 ? `${path.slice(0, 42)}…` : path}`;
  } catch {
    return url.length > 60 ? `${url.slice(0, 60)}…` : url;
  }
}

function TopLinksCard({ links, loading }: { links: TopLink[]; loading: boolean }) {
  const max = links.reduce((best, link) => Math.max(best, link.uniqueClicks), 0);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          Link più cliccati
        </CardTitle>
        <CardDescription>Ordinati per numero di contatti distinti che hanno cliccato.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : links.length === 0 ? (
          <EmptyState
            compact
            icon={<Link2 />}
            title="Nessun click registrato"
            description="Appena qualcuno cliccherà un link dell’email, comparirà in questa classifica."
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

function BreakdownCard({
  title,
  description,
  icon,
  entries,
  loading,
  emptyMessage,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  entries: BreakdownEntry[];
  loading: boolean;
  emptyMessage: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li key={entry.label} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{entry.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatNumber(entry.count)} · {formatPercent(entry.share)}
                  </span>
                </div>
                <Progress value={entry.share * 100} size="sm" aria-label={entry.label} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface NewsletterReportProps {
  newsletterId: string;
  className?: string;
}

/**
 * Report completo di una newsletter inviata: metriche, imbuto, andamento,
 * link cliccati, ripartizione per dispositivo e client, elenco destinatari.
 */
export function NewsletterReport({ newsletterId, className }: NewsletterReportProps) {
  const report = useQuery<NewsletterReportResult, Error>({
    queryKey: [...reportQueryKey(newsletterId, 'all'), 'completo'],
    queryFn: () =>
      getNewsletterReport({ newsletterId, limit: REPORT_PAGE_SIZE, recipientsOnly: false }),
    enabled: Boolean(newsletterId) && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });

  const data = report.data;
  const loading = report.isLoading;
  const currency = data?.stats.currency || 'EUR';

  if (report.error) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 p-6 text-center">
          <MailWarning className="mx-auto size-6 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{report.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void report.refetch()}>
            Riprova
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {data?.newsletter.sentAt ? (
            <>
              Spedizione avviata il{' '}
              <strong className="text-foreground">{formatDateTimeIt(data.newsletter.sentAt)}</strong>
              {data.newsletter.completedAt
                ? ` e conclusa ${relativeTimeIt(data.newsletter.completedAt)}.`
                : ' e ancora in corso.'}
            </>
          ) : (
            'Spedizione non ancora conclusa: i dati si aggiornano man mano che Brevo li notifica.'
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void report.refetch()}
          disabled={report.isFetching}
        >
          <RefreshCw className={cn(report.isFetching && 'animate-spin')} aria-hidden="true" />
          Aggiorna
        </Button>
      </div>

      {data?.eventsTruncated ? (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Sono stati analizzati i primi {formatNumber(data.eventsScanned)} eventi: le ripartizioni
            per dispositivo, client e link sono un campione rappresentativo, non il totale esatto.
          </span>
        </p>
      ) : null}

      <StatsGrid stats={data?.stats} loading={loading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelChart stats={data?.stats} loading={loading} />
        <TimelineChart
          points={data?.timeline ?? []}
          granularity={data?.timelineGranularity ?? 'day'}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopLinksCard links={data?.topLinks ?? []} loading={loading} />
        <BreakdownCard
          title="Dispositivi"
          description="Da dove è stata aperta l’email."
          icon={<Laptop className="size-4 text-primary" aria-hidden="true" />}
          entries={data?.devices ?? []}
          loading={loading}
          emptyMessage="Nessuna apertura tracciata: i dati compaiono con i primi eventi."
        />
        <BreakdownCard
          title="Client email"
          description="Programmi e webmail usati dai destinatari."
          icon={<Server className="size-4 text-primary" aria-hidden="true" />}
          entries={data?.clients ?? []}
          loading={loading}
          emptyMessage="Nessun client rilevato per ora."
        />
      </div>

      {data && data.topDomains.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recapito per dominio</CardTitle>
            <CardDescription>
              Utile a riconoscere problemi di consegna concentrati su un provider.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Dominio</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Consegnate</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Aperture</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Click</th>
                    <th scope="col" className="py-2 px-3 text-right font-medium">Bounce</th>
                    <th scope="col" className="py-2 pl-3 text-right font-medium">Tasso apertura</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDomains.map((domain) => (
                    <tr key={domain.domain} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground">{domain.domain}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(domain.delivered)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(domain.opened)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(domain.clicked)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          domain.bounced > 0 && 'text-destructive',
                        )}
                      >
                        {formatNumber(domain.bounced)}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums font-medium text-foreground">
                        {formatPercent(domain.openRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <RecipientsTable newsletterId={newsletterId} currency={currency} />
    </div>
  );
}
