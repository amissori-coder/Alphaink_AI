'use client';

import { DEFAULT_CURRENCY } from '@alphaink/shared';
import { Workflow } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

export interface AutomationTableRow {
  id: string;
  name: string;
  enabled: boolean;
  testMode: boolean;
  isCore: boolean;
  /** Metriche del periodo osservato. */
  sent: number;
  orders: number;
  revenue: number;
  /** Contatori progressivi dell'automazione. */
  enrolled: number;
  openRate: number;
  clickRate: number;
}

export interface AutomationsTableProps {
  rows: AutomationTableRow[];
  loading?: boolean;
  periodDays: number;
  currency?: string;
  className?: string;
}

/**
 * Rendimento delle automazioni.
 *
 * Invii, ordini e fatturato sono riferiti al periodo osservato; apertura e
 * click sono tassi progressivi dell'automazione, perché il motore non conserva
 * gli eventi per giorno a livello di flusso.
 */
export function AutomationsTable({
  rows,
  loading = false,
  periodDays,
  currency = DEFAULT_CURRENCY,
  className,
}: AutomationsTableProps) {
  const columns: DataTableColumn<AutomationTableRow>[] = React.useMemo(
    () => [
      {
        id: 'name',
        header: 'Automazione',
        sortValue: (row) => row.name.toLowerCase(),
        searchValue: (row) => row.name,
        cell: (row) => (
          <div className="min-w-0">
            <Link
              href={`/automazioni/${row.id}`}
              className="block truncate font-medium text-foreground hover:underline"
            >
              {row.name}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <Badge variant={row.enabled ? 'success' : 'secondary'}>
                {row.enabled ? 'Attiva' : 'Spenta'}
              </Badge>
              {row.testMode ? <Badge variant="warning">Test</Badge> : null}
              {row.isCore ? <Badge variant="outline">Principale</Badge> : null}
            </div>
          </div>
        ),
        className: 'max-w-[20rem]',
      },
      {
        id: 'sent',
        header: `Inviate · ${periodDays} gg`,
        align: 'right',
        sortValue: (row) => row.sent,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.sent)}</span>,
      },
      {
        id: 'orders',
        header: `Ordini · ${periodDays} gg`,
        align: 'right',
        sortValue: (row) => row.orders,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.orders)}</span>,
      },
      {
        id: 'revenue',
        header: `Fatturato · ${periodDays} gg`,
        align: 'right',
        sortValue: (row) => row.revenue,
        cell: (row) => (
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(row.revenue, currency)}
          </span>
        ),
      },
      {
        id: 'enrolled',
        header: 'Arruolati',
        align: 'right',
        hideOnMobile: true,
        sortValue: (row) => row.enrolled,
        cell: (row) => <span className="tabular-nums">{formatNumber(row.enrolled)}</span>,
      },
      {
        id: 'openRate',
        header: 'Apertura',
        align: 'right',
        hideOnMobile: true,
        sortValue: (row) => row.openRate,
        cell: (row) => <span className="tabular-nums">{formatPercent(row.openRate)}</span>,
      },
      {
        id: 'clickRate',
        header: 'Click',
        align: 'right',
        hideOnMobile: true,
        sortValue: (row) => row.clickRate,
        cell: (row) => <span className="tabular-nums">{formatPercent(row.clickRate)}</span>,
      },
    ],
    [currency, periodDays],
  );

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Workflow className="size-4 text-primary" aria-hidden="true" />
          Rendimento delle automazioni
        </CardTitle>
        <CardDescription>
          Invii, ordini e fatturato del periodo; apertura e click sono tassi progressivi del flusso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          loading={loading}
          pageSize={10}
          defaultSort={{ columnId: 'revenue', direction: 'desc' }}
          emptyTitle="Nessuna automazione configurata"
          emptyDescription="Le automazioni compaiono qui appena vengono create e attivate."
          emptyIcon={<Workflow />}
        />
      </CardContent>
    </Card>
  );
}
