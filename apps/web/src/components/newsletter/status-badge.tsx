import {
  NEWSLETTER_STATUS_COLORS,
  NEWSLETTER_STATUS_LABELS,
} from '@alphaink/shared';
import type { NewsletterStatus, RecipientStatus } from '@alphaink/shared';
import * as React from 'react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { RECIPIENT_STATUS_LABELS, RECIPIENT_STATUS_TONES } from './constants';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

/** Tono semantico del badge per ciascuno stato della newsletter. */
export const STATUS_VARIANTS: Record<NewsletterStatus, BadgeVariant> = {
  draft: 'outline',
  scheduled: 'default',
  queued: 'default',
  sending: 'warning',
  sent: 'success',
  paused: 'warning',
  failed: 'destructive',
  cancelled: 'secondary',
};

export function statusBadgeVariant(status: NewsletterStatus): BadgeVariant {
  return STATUS_VARIANTS[status] ?? 'secondary';
}

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'children'> {
  status: NewsletterStatus;
  /** Nasconde il pallino colorato a sinistra. */
  hideDot?: boolean;
  /** Testo aggiuntivo mostrato dopo l'etichetta (es. la data). */
  suffix?: React.ReactNode;
}

/**
 * Badge dello stato di una newsletter: colore semantico più il pallino della
 * palette condivisa, così l'elenco e il calendario si leggono allo stesso modo.
 */
export function StatusBadge({ status, hideDot, suffix, className, ...props }: StatusBadgeProps) {
  const label = NEWSLETTER_STATUS_LABELS[status] ?? status;
  return (
    <Badge variant={statusBadgeVariant(status)} className={cn('gap-1.5', className)} {...props}>
      {hideDot ? null : (
        <span
          className={cn('size-1.5 shrink-0 rounded-full', status === 'sending' && 'animate-pulse')}
          style={{ backgroundColor: NEWSLETTER_STATUS_COLORS[status] }}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
      {suffix ? <span className="font-normal opacity-80">{suffix}</span> : null}
    </Badge>
  );
}

export interface RecipientStatusBadgeProps extends Omit<BadgeProps, 'variant' | 'children'> {
  status: RecipientStatus;
}

/** Badge dello stato di un singolo destinatario, usato nel report. */
export function RecipientStatusBadge({ status, className, ...props }: RecipientStatusBadgeProps) {
  return (
    <Badge
      variant={RECIPIENT_STATUS_TONES[status] ?? 'secondary'}
      className={cn('whitespace-nowrap', className)}
      {...props}
    >
      {RECIPIENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
