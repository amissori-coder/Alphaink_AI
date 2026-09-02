'use client';

import { Mail, MousePointerClick } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

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
import { cn, formatCurrency, formatDateTimeIt, formatNumber } from '@/lib/utils';

import { ROUTES } from './constants';
import { RecipientStatusBadge } from './status-badge';
import type { ReceivedEmail } from './types';

export interface ContactEmailsProps {
  emails: ReceivedEmail[];
  loading?: boolean;
  error?: Error | null;
  /** Nomi delle newsletter, risolti al render per non congelarli nella cache. */
  newsletterNames?: Map<string, string>;
  className?: string;
}

/**
 * Elenco delle email ricevute dal contatto con il relativo esito.
 *
 * I dati provengono dai documenti `recipients` di ciascuna newsletter: sono la
 * fonte più precisa perché registrano anche aperture e click ripetuti, che gli
 * aggregati sul contatto non distinguono per singolo invio.
 */
export function ContactEmails({
  emails,
  loading = false,
  error = null,
  newsletterNames,
  className,
}: ContactEmailsProps) {
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

  if (emails.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Mail />}
        title="Nessuna email inviata"
        description="Questo contatto non ha ancora ricevuto newsletter. Comparirà qui dal primo invio in cui rientra nel pubblico."
        className={className}
      />
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-md border border-border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Newsletter</TableHead>
            <TableHead>Inviata</TableHead>
            <TableHead>Esito</TableHead>
            <TableHead className="text-right">Aperture</TableHead>
            <TableHead className="text-right">Click</TableHead>
            <TableHead className="text-right">Fatturato</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((email) => {
            const name =
              (email.newsletterId ? newsletterNames?.get(email.newsletterId) : null) ||
              email.newsletterName ||
              'Newsletter rimossa';
            return (
            <TableRow key={email.id}>
              <TableCell>
                {email.newsletterId ? (
                  <Link
                    href={ROUTES.newsletterDetail(email.newsletterId)}
                    className="font-medium text-foreground hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="font-medium text-muted-foreground">{name}</span>
                )}
                {email.bounceReason || email.error ? (
                  <span className="block max-w-[18rem] truncate text-[11px] text-destructive">
                    {email.bounceReason ?? email.error}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {email.sentAt ? formatDateTimeIt(email.sentAt) : '—'}
              </TableCell>
              <TableCell>
                <RecipientStatusBadge status={email.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {email.openCount > 0 ? (
                  <span
                    className="font-medium text-foreground"
                    title={
                      email.firstOpenedAt
                        ? `Prima apertura: ${formatDateTimeIt(email.firstOpenedAt)}`
                        : undefined
                    }
                  >
                    {formatNumber(email.openCount)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {email.clickCount > 0 ? (
                  <span
                    className="inline-flex items-center gap-1 font-medium text-foreground"
                    title={
                      email.firstClickedAt
                        ? `Primo click: ${formatDateTimeIt(email.firstClickedAt)}`
                        : undefined
                    }
                  >
                    <MousePointerClick className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {formatNumber(email.clickCount)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {email.revenue && email.revenue > 0 ? (
                  <span className="font-medium text-success">
                    {formatCurrency(email.revenue, 'EUR')}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
