'use client';

import { SITE_SOURCE_LABELS, SUBSCRIPTION_STATUS_LABELS } from '@alphaink/shared';
import type { RecipientStatus, SiteSource, SubscriptionStatus } from '@alphaink/shared';
import {
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  MailWarning,
  MailX,
  MinusCircle,
  User,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { STATUS_BADGE_VARIANT } from './constants';

const STATUS_ICONS: Record<SubscriptionStatus, React.ComponentType<{ className?: string }>> = {
  subscribed: CheckCircle2,
  unsubscribed: MailX,
  pending: Clock,
  bounced: MailWarning,
  blocked: Ban,
  never_subscribed: MinusCircle,
};

export interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  /** Nasconde l'etichetta testuale lasciando la sola icona. */
  iconOnly?: boolean;
  className?: string;
}

/** Badge dello stato di iscrizione, con icona coerente al significato. */
export function SubscriptionStatusBadge({
  status,
  iconOnly = false,
  className,
}: SubscriptionStatusBadgeProps) {
  const Icon = STATUS_ICONS[status];
  const label = SUBSCRIPTION_STATUS_LABELS[status];

  return (
    <Badge variant={STATUS_BADGE_VARIANT[status]} className={cn('whitespace-nowrap', className)}>
      <Icon aria-hidden="true" />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </Badge>
  );
}

export interface SegmentBadgeProps {
  segment: 'b2c' | 'b2b';
  className?: string;
}

/** Badge del segmento commerciale. */
export function SegmentBadge({ segment, className }: SegmentBadgeProps) {
  const isB2b = segment === 'b2b';
  return (
    <Badge
      variant={isB2b ? 'default' : 'secondary'}
      className={cn('whitespace-nowrap uppercase', className)}
    >
      {isB2b ? <Building2 aria-hidden="true" /> : <User aria-hidden="true" />}
      {isB2b ? 'B2B' : 'B2C'}
    </Badge>
  );
}

export interface SourceBadgeProps {
  source: SiteSource;
  className?: string;
}

/** Etichette compatte delle sorgenti: il nome esteso resta nel `title`. */
const SHORT_SOURCE_LABELS: Record<SiteSource, string> = {
  prestashop_b2c: 'alphaink.net',
  prestashop_b2b: 'b2b.alphaink.net',
  csv: 'CSV',
  manual: 'Manuale',
  brevo: 'Brevo',
};

/** Badge della sorgente di provenienza del contatto. */
export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn('whitespace-nowrap font-normal', className)}
      title={SITE_SOURCE_LABELS[source]}
    >
      {SHORT_SOURCE_LABELS[source]}
    </Badge>
  );
}

/** Etichette in italiano dello stato di un singolo invio. */
export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'In coda',
  sent: 'Inviata',
  delivered: 'Consegnata',
  opened: 'Aperta',
  clicked: 'Cliccata',
  converted: 'Ha generato un ordine',
  soft_bounced: 'Soft bounce',
  hard_bounced: 'Hard bounce',
  blocked: 'Bloccata',
  unsubscribed: 'Disiscrizione',
  spam: 'Segnalata come spam',
  failed: 'Invio fallito',
};

const RECIPIENT_STATUS_VARIANT: Record<
  RecipientStatus,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'
> = {
  pending: 'outline',
  sent: 'secondary',
  delivered: 'secondary',
  opened: 'default',
  clicked: 'default',
  converted: 'success',
  soft_bounced: 'warning',
  hard_bounced: 'destructive',
  blocked: 'destructive',
  unsubscribed: 'warning',
  spam: 'destructive',
  failed: 'destructive',
};

export interface RecipientStatusBadgeProps {
  status: RecipientStatus;
  className?: string;
}

/** Badge dell'esito di una singola email ricevuta dal contatto. */
export function RecipientStatusBadge({ status, className }: RecipientStatusBadgeProps) {
  return (
    <Badge variant={RECIPIENT_STATUS_VARIANT[status]} className={cn('whitespace-nowrap', className)}>
      {RECIPIENT_STATUS_LABELS[status]}
    </Badge>
  );
}
