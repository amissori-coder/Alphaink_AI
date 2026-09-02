'use client';

import { DEFAULT_CURRENCY } from '@alphaink/shared';
import { Mail } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { cn, formatCurrency, formatDateIt, formatNumber, formatPercent } from '@/lib/utils';

import type { TopNewsletter } from './types';

export interface NewsletterTableProps {
  rows: TopNewsletter[];
  loading?: boolean;
  currency?: string;
  className?: string;
}

/**
 * Confronto fra le newsletter del periodo.
 * Ogni colonna è ordinabile: il click sull'intestazione cambia il criterio.
 */
export function NewsletterTable({
  rows,
  loading = false,
  currency = DEFAULT_CURRENCY,
  className,
}: NewsletterTableProps) {
  const columns: DataTableColumn<TopNewsletter>[] = React.useMemo(
    () => [
      {
        id: 'name',
        header: 'Newsletter',
        sortValue: (row) => row.name.toLowerCase(),
        searchValue: (row) => `${row.name} ${row.subject}`,
        cell: (row) => (
          <div className="min-w-0">
            <Link
              href={`/newsletter/${row.id}`}
              className="block truncate font-medium text-foreground hover:underline"
            >
              {row.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{row.subject}</p>
          </div>
        ),
        className: 'max-w-[22rem]',
      },
      {
        id: 'sentAt',
        header: 'Inviata il',
        align: 'left',
        hideOnMobile: true,
        sortValue: (row) => (row.sentAt ? Date.parse(row.sentAt) : 0),
        cell: (row) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {row.sentAt ? formatDateIt(row.sentAt) : '—'}
          </span>
        ),
      },
      {
        id: 'recipients',
        header: 'Destinatari',
        align: 'right',
        sortValue: (row) => row.recipients,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.recipients)}</span>,
      },
      {
        id: 'delivered',
        header: 'Consegnate',
        align: 'right',
        hideOnMobile: true,
        sortValue: (row) => row.delivered,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.delivered)}</span>,
      },
      {
        id: 'openRate',
        header: 'Apertura',
        align: 'right',
        sortValue: (row) => row.openRate,
        cell: (row) => <span className="tabular-nums">{formatPercent(row.openRate)}</span>,
      },
      {
        id: 'clickRate',
        header: 'Click',
        align: 'right',
        sortValue: (row) => row.clickRate,
        cell: (row) => <span className="tabular-nums">{formatPercent(row.clickRate)}</span>,
      },
      {
        id: 'orders',
        header: 'Ordini',
        align: 'right',
        sortValue: (row) => row.orders,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.orders)}</span>,
      },
      {
        id: 'revenue',
        header: 'Fatturato',
        align: 'right',
        sortValue: (row) => row.revenue,
        cell: (row) => (
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(row.revenue, currency)}
          </span>
        ),
      },
    ],
    [currency],
  );

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4 text-primary" aria-hidden="true" />
          Newsletter del periodo
        </CardTitle>
        <CardDescription>
          Ordina per qualsiasi metrica facendo click sull’intestazione della colonna.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={loading}
          searchable
          searchPlaceholder="Cerca una newsletter…"
          pageSize={10}
          defaultSort={{ columnId: 'revenue', direction: 'desc' }}
          emptyTitle="Nessuna newsletter inviata nel periodo"
          emptyDescription="Cambia il periodo osservato oppure pianifica un nuovo invio."
          emptyIcon={<Mail />}
        />
      </CardContent>
    </Card>
  );
}
