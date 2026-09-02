'use client';

import type { RecipientStatus } from '@alphaink/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isFirebaseConfigured } from '@/lib/firebase/client';
import { cn, formatCurrency, formatDateTimeIt, formatNumber } from '@/lib/utils';

import { getNewsletterReport } from './api';
import { RECIPIENT_STATUS_OPTIONS, REPORT_PAGE_SIZE, reportQueryKey } from './constants';
import { RecipientStatusBadge } from './status-badge';
import type { NewsletterReportResult, RecipientRow } from './types';

type StatusFilter = RecipientStatus | 'all';

export interface RecipientsTableProps {
  newsletterId: string;
  /** Valuta usata per il fatturato attribuito. */
  currency?: string;
  className?: string;
}

/**
 * Elenco dei destinatari con filtro per stato e caricamento a pagine.
 * Il cursore è l'id dell'ultimo documento ricevuto: stabile anche mentre i
 * webhook aggiornano gli stati.
 */
export function RecipientsTable({
  newsletterId,
  currency = 'EUR',
  className,
}: RecipientsTableProps) {
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [search, setSearch] = React.useState('');

  const query = useInfiniteQuery<NewsletterReportResult, Error>({
    queryKey: reportQueryKey(newsletterId, status),
    queryFn: ({ pageParam }) =>
      getNewsletterReport({
        newsletterId,
        cursor: (pageParam as string | null) ?? null,
        limit: REPORT_PAGE_SIZE,
        status: status === 'all' ? null : status,
        recipientsOnly: true,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.recipients.nextCursor ?? undefined,
    enabled: Boolean(newsletterId) && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });

  const rows: RecipientRow[] = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.recipients.items),
    [query.data],
  );

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => row.email.toLowerCase().includes(term));
  }, [rows, search]);

  const total = query.data?.pages?.[0]?.recipients.total ?? null;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" aria-hidden="true" />
          Destinatari
        </CardTitle>
        <CardDescription>
          Stato di consegna, aperture, click e ordini per singolo indirizzo.
          {total !== null ? ` ${formatNumber(total)} in totale.` : ''}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filtra gli indirizzi caricati…"
            startIcon={<Search />}
            aria-label="Filtra gli indirizzi caricati"
            className="h-9 w-full max-w-xs"
          />
          <Select
            value={status}
            onValueChange={(next) => setStatus(next as StatusFilter)}
          >
            <SelectTrigger className="h-9 w-[13rem]" aria-label="Filtra per stato">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              {RECIPIENT_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          {query.isLoading ? (
            <div className="p-4">
              <SkeletonTable rows={6} columns={5} />
            </div>
          ) : query.error ? (
            <div className="space-y-3 p-6 text-center">
              <p className="text-sm text-destructive">{query.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Riprova
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              className="border-0 bg-transparent"
              icon={<Users />}
              title={
                search.trim()
                  ? 'Nessun indirizzo corrisponde alla ricerca'
                  : 'Nessun destinatario con questo stato'
              }
              description={
                search.trim()
                  ? 'La ricerca lavora sugli indirizzi già caricati: carica altre pagine per estenderla.'
                  : 'Cambia il filtro per vedere gli altri destinatari della spedizione.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="hidden md:table-cell">Inviata</TableHead>
                  <TableHead className="text-right">Aperture</TableHead>
                  <TableHead className="text-right">Click</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Ordine</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[18rem]">
                      <span className="block truncate font-medium text-foreground">{row.email}</span>
                      {row.bounceReason ? (
                        <span className="block truncate text-xs text-destructive" title={row.bounceReason}>
                          {row.bounceReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <RecipientStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                      {row.sentAt ? formatDateTimeIt(row.sentAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.openCount > 0 ? (
                        <span title={row.firstOpenedAt ? formatDateTimeIt(row.firstOpenedAt) : undefined}>
                          {formatNumber(row.openCount)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.clickCount > 0 ? (
                        <span title={row.firstClickedAt ? formatDateTimeIt(row.firstClickedAt) : undefined}>
                          {formatNumber(row.clickCount)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      {row.convertedOrderId ? (
                        <span className="font-medium text-success">
                          {formatCurrency(row.revenue ?? 0, currency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            {formatNumber(filtered.length)}{' '}
            {filtered.length === 1 ? 'destinatario mostrato' : 'destinatari mostrati'}
          </span>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              disabled={query.isFetchingNextPage}
            >
              Carica altri
            </Button>
          ) : rows.length > 0 ? (
            <span>Elenco completo</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
