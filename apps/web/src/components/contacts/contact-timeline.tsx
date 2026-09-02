'use client';

import { BREVO_EVENT_LABELS, formatCurrency } from '@alphaink/shared';
import type { Contact, Order, TrackingEvent } from '@alphaink/shared';
import {
  ExternalLink,
  Eye,
  MailWarning,
  MailX,
  MousePointerClick,
  Send,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDateTimeIt, relativeTimeIt } from '@/lib/utils';

import { ROUTES, TIMELINE_KIND_OPTIONS, timelineKindForEvent } from './constants';
import type { TimelineEntry, TimelineKind } from './types';

const KIND_ICONS: Record<TimelineKind, React.ComponentType<{ className?: string }>> = {
  invio: Send,
  apertura: Eye,
  click: MousePointerClick,
  ordine: ShoppingCart,
  consenso: ShieldCheck,
  problema: MailWarning,
};

const KIND_STYLES: Record<TimelineKind, string> = {
  invio: 'bg-muted text-muted-foreground',
  apertura: 'bg-primary/10 text-primary',
  click: 'bg-ink-magenta/10 text-ink-magenta',
  ordine: 'bg-success/10 text-success',
  consenso: 'bg-ink-yellow/20 text-warning-foreground',
  problema: 'bg-destructive/10 text-destructive',
};

/**
 * Costruisce la timeline unificata del contatto.
 *
 * Le tre sorgenti (eventi Brevo, ordini del sito, date di consenso registrate
 * sul contatto) vengono normalizzate nella stessa forma e ordinate dalla più
 * recente: è l'unico punto in cui la cronologia del cliente si legge per intero.
 */
export function buildTimeline(
  contact: Contact,
  events: TrackingEvent[],
  orders: Order[],
  newsletterNames: Map<string, string>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const event of events) {
    const kind = timelineKindForEvent(event.type);
    const newsletterName = event.newsletterId ? newsletterNames.get(event.newsletterId) : null;
    const origin =
      newsletterName ??
      (event.automationId
        ? 'Automazione'
        : event.source === 'test'
          ? 'Email di prova'
          : event.source === 'transactional'
            ? 'Email transazionale'
            : 'Invio');

    entries.push({
      id: `evento-${event.id}`,
      kind,
      occurredAt: event.occurredAt,
      title: BREVO_EVENT_LABELS[event.type] ?? event.type,
      description: event.reason ?? null,
      badge: origin,
      href: event.newsletterId ? ROUTES.newsletterDetail(event.newsletterId) : null,
      url: event.url ?? null,
    });
  }

  for (const order of orders) {
    const label = order.orderNumber ? `Ordine ${order.orderNumber}` : 'Ordine';
    entries.push({
      id: `ordine-${order.id}`,
      kind: 'ordine',
      occurredAt: order.placedAt,
      title: `${label} · ${formatCurrency(order.total, order.currency || 'EUR')}`,
      description:
        order.items.length > 0
          ? order.items
              .slice(0, 3)
              .map((item) => `${item.quantity}× ${item.name}`)
              .join(', ') + (order.items.length > 3 ? ` e altri ${order.items.length - 3}` : '')
          : null,
      badge: order.attribution?.newsletterId
        ? (newsletterNames.get(order.attribution.newsletterId) ?? 'Attribuito a una newsletter')
        : null,
      href: order.attribution?.newsletterId
        ? ROUTES.newsletterDetail(order.attribution.newsletterId)
        : null,
    });
  }

  if (contact.optInAt) {
    entries.push({
      id: 'consenso-optin',
      kind: 'consenso',
      occurredAt: contact.optInAt,
      title: 'Consenso all’invio raccolto',
      description: contact.consentSource ?? 'Origine del consenso non registrata.',
    });
  }
  if (contact.optOutAt) {
    entries.push({
      id: 'consenso-optout',
      kind: 'consenso',
      occurredAt: contact.optOutAt,
      title: 'Revoca del consenso',
      description: 'Il contatto è stato rimosso dagli invii promozionali.',
    });
  }

  return entries.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

export interface ContactTimelineProps {
  entries: TimelineEntry[];
  loading?: boolean;
  className?: string;
}

/** Cronologia unificata del contatto, con filtro per tipo di evento. */
export function ContactTimeline({ entries, loading = false, className }: ContactTimelineProps) {
  const [kinds, setKinds] = React.useState<TimelineKind[]>([]);

  const counts = React.useMemo(() => {
    const map = new Map<TimelineKind, number>();
    for (const entry of entries) map.set(entry.kind, (map.get(entry.kind) ?? 0) + 1);
    return map;
  }, [entries]);

  const options = React.useMemo(
    () =>
      TIMELINE_KIND_OPTIONS.map((option) => ({
        ...option,
        description: `${counts.get(option.value) ?? 0} voci`,
      })),
    [counts],
  );

  const visible = React.useMemo(
    () => (kinds.length === 0 ? entries : entries.filter((entry) => kinds.includes(entry.kind))),
    [entries, kinds],
  );

  if (loading) {
    return (
      <div className={cn('space-y-3', className)} aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          multiple
          options={options}
          value={kinds}
          onChange={(next) => setKinds(next as TimelineKind[])}
          placeholder="Tutti i tipi di evento"
          searchPlaceholder="Cerca un tipo…"
          emptyMessage="Nessun tipo."
          className="h-9 w-[16rem]"
          contentClassName="min-w-[18rem]"
        />
        <span className="text-sm text-muted-foreground">
          {visible.length === entries.length
            ? `${entries.length} voci`
            : `${visible.length} di ${entries.length} voci`}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          compact
          icon={<MailX />}
          title={entries.length === 0 ? 'Nessuna attività registrata' : 'Nessuna voce con questo filtro'}
          description={
            entries.length === 0
              ? 'Qui compariranno invii, aperture, click, ordini e cambi di consenso appena il contatto interagirà con le comunicazioni.'
              : 'Togli qualche tipo di evento dal filtro per vedere il resto della cronologia.'
          }
        />
      ) : (
        <ol className="relative space-y-1 border-l border-border pl-0">
          {visible.map((entry) => {
            const Icon = KIND_ICONS[entry.kind];
            return (
              <li key={entry.id} className="relative flex gap-3 pb-4 pl-6">
                <span
                  className={cn(
                    'absolute -left-4 top-0 flex size-8 items-center justify-center rounded-full ring-4 ring-background',
                    KIND_STYLES[entry.kind],
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-sm font-medium text-foreground">{entry.title}</p>
                    {entry.badge ? (
                      entry.href ? (
                        <Link href={entry.href}>
                          <Badge variant="outline" className="hover:bg-muted">
                            {entry.badge}
                          </Badge>
                        </Link>
                      ) : (
                        <Badge variant="outline">{entry.badge}</Badge>
                      )
                    ) : null}
                    <time
                      dateTime={entry.occurredAt}
                      className="ml-auto shrink-0 text-xs text-muted-foreground"
                      title={formatDateTimeIt(entry.occurredAt)}
                    >
                      {relativeTimeIt(entry.occurredAt)}
                    </time>
                  </div>

                  {entry.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
                  ) : null}

                  {entry.url ? (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{entry.url}</span>
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
