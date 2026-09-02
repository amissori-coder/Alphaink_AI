'use client';

import { PRODUCT_FAMILY_LABELS, SITE_SOURCE_LABELS } from '@alphaink/shared';
import type { Order, OrderStatus, ProductFamily } from '@alphaink/shared';
import { Package, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn, formatCurrency, formatDateIt, formatNumber } from '@/lib/utils';

import { ROUTES } from './constants';

/** Etichette in italiano degli stati ordine normalizzati. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'In attesa',
  processing: 'In preparazione',
  awaiting_payment: 'Attesa pagamento',
  paid: 'Pagato',
  shipped: 'Spedito',
  completed: 'Completato',
  cancelled: 'Annullato',
  refunded: 'Rimborsato',
  failed: 'Fallito',
};

const ORDER_STATUS_VARIANT: Record<
  OrderStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'outline',
  processing: 'default',
  awaiting_payment: 'warning',
  paid: 'success',
  shipped: 'success',
  completed: 'success',
  cancelled: 'secondary',
  refunded: 'warning',
  failed: 'destructive',
};

export interface ContactOrdersProps {
  orders: Order[];
  loading?: boolean;
  error?: Error | null;
  /** Nomi delle newsletter, per mostrare l'attribuzione del fatturato. */
  newsletterNames?: Map<string, string>;
  className?: string;
}

/** Elenco degli ordini del contatto, con famiglie acquistate e attribuzione. */
export function ContactOrders({
  orders,
  loading = false,
  error = null,
  newsletterNames,
  className,
}: ContactOrdersProps) {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  if (loading) {
    return (
      <div className={className} aria-busy="true">
        <SkeletonTable />
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn('rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive', className)}>
        {error.message}
      </p>
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        compact
        icon={<ShoppingCart />}
        title="Nessun ordine"
        description="Questo contatto non ha ancora acquistato su alphaink.net né su b2b.alphaink.net."
        className={className}
      />
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-md border border-border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ordine</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Famiglie</TableHead>
            <TableHead className="text-right">Totale</TableHead>
            <TableHead>Attribuzione</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => {
            const open = expanded === order.id;
            const attributedTo = order.attribution?.newsletterId
              ? (newsletterNames?.get(order.attribution.newsletterId) ?? 'Newsletter')
              : null;

            return (
              <React.Fragment key={order.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setExpanded(open ? null : order.id)}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={open}
                    >
                      {order.orderNumber || order.externalId}
                    </button>
                    <span className="block text-[11px] text-muted-foreground">
                      {SITE_SOURCE_LABELS[order.source]}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateIt(order.placedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ORDER_STATUS_VARIANT[order.status]}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {(order.families ?? []).slice(0, 3).map((family) => (
                        <Badge key={family} variant="secondary">
                          {PRODUCT_FAMILY_LABELS[family as ProductFamily] ?? family}
                        </Badge>
                      ))}
                      {(order.families ?? []).length > 3 ? (
                        <span className="text-[11px] text-muted-foreground">
                          +{(order.families ?? []).length - 3}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(order.total, order.currency || 'EUR')}
                  </TableCell>
                  <TableCell>
                    {attributedTo && order.attribution?.newsletterId ? (
                      <Link
                        href={ROUTES.newsletterDetail(order.attribution.newsletterId)}
                        className="text-sm text-primary hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {attributedTo}
                      </Link>
                    ) : order.couponCode ? (
                      <span className="text-sm text-muted-foreground">
                        Coupon {order.couponCode}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>

                {open ? (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={6} className="py-3">
                      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Package className="size-3.5" aria-hidden="true" />
                        {formatNumber(order.items.length)}{' '}
                        {order.items.length === 1 ? 'articolo' : 'articoli'}
                      </p>
                      <ul className="space-y-1">
                        {order.items.map((item, index) => (
                          <li
                            key={`${order.id}-${item.sku}-${index}`}
                            className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="text-foreground">{item.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {item.sku}
                                {item.family
                                  ? ` · ${PRODUCT_FAMILY_LABELS[item.family] ?? item.family}`
                                  : ''}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {item.quantity} ×{' '}
                              {formatCurrency(item.unitPrice, order.currency || 'EUR')} ={' '}
                              <span className="font-medium text-foreground">
                                {formatCurrency(item.total, order.currency || 'EUR')}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
