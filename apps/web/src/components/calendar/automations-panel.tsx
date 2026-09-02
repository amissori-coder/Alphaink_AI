'use client';

import { AUTOMATION_DESCRIPTIONS, COLLECTIONS, addDays, toIso } from '@alphaink/shared';
import type { Automation, AutomationRun } from '@alphaink/shared';
import { limit, orderBy, where } from 'firebase/firestore';
import { CircleSlash, Clock, Repeat2, Send, Settings2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { cn, formatCurrency, formatNumber, relativeTimeIt } from '@/lib/utils';

import { AUTOMATION_RUNS_FETCH_LIMIT, AUTOMATION_WINDOW_DAYS, ROUTES } from './constants';

export interface AutomationsStripProps {
  automations: Automation[];
  /** Invii delle automazioni già programmati nel periodo visualizzato. */
  plannedInRange: number;
  onOpen: () => void;
  className?: string;
}

/**
 * Fascia informativa sopra il calendario: le automazioni non hanno una data
 * singola, quindi vivono fuori dalla griglia.
 */
export function AutomationsStrip({
  automations,
  plannedInRange,
  onOpen,
  className,
}: AutomationsStripProps) {
  if (automations.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-[#8b5cf6]/40 bg-[#8b5cf6]/5 px-3 py-2',
        className,
      )}
    >
      <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
        <Repeat2 className="size-4 text-[#8b5cf6]" aria-hidden="true" />
        {automations.length === 1
          ? '1 automazione sempre attiva'
          : `${automations.length} automazioni sempre attive`}
      </span>

      <span className="flex flex-wrap items-center gap-1">
        {automations.slice(0, 4).map((automation) => (
          <Badge key={automation.id} variant="secondary" className="font-normal">
            {automation.name}
          </Badge>
        ))}
        {automations.length > 4 ? (
          <Badge variant="outline" className="font-normal">
            +{automations.length - 4}
          </Badge>
        ) : null}
      </span>

      <span className="text-xs text-muted-foreground">
        {plannedInRange > 0
          ? `${formatNumber(plannedInRange)} invii già programmati nel periodo`
          : 'Nessun invio programmato nel periodo'}
      </span>

      <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpen}>
        <Settings2 aria-hidden="true" />
        Dettagli
      </Button>
    </div>
  );
}

export interface AutomationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automations: Automation[];
}

/** Pannello laterale con lo stato di tutte le automazioni. */
export function AutomationsSheet({ open, onOpenChange, automations }: AutomationsSheetProps) {
  const active = automations.filter((automation) => automation.enabled);
  const paused = automations.filter((automation) => !automation.enabled);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Repeat2 className="size-4 text-[#8b5cf6]" aria-hidden="true" />
            Automazioni sempre attive
          </SheetTitle>
          <SheetDescription>
            Sono flussi ricorrenti: partono da un comportamento del cliente e non da una data del
            calendario. Qui trovi gli invii previsti e quelli degli ultimi {AUTOMATION_WINDOW_DAYS}{' '}
            giorni.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-3">
          {automations.length === 0 ? (
            <EmptyState
              compact
              icon={<Repeat2 />}
              title="Nessuna automazione configurata"
              description="Crea le automazioni comportamentali per accompagnare i clienti dopo l’acquisto."
              action={
                <Button asChild size="sm">
                  <Link href={ROUTES.automations}>Configura automazioni</Link>
                </Button>
              }
            />
          ) : (
            <>
              {active.map((automation) => (
                <AutomationCard key={automation.id} automation={automation} enabled={open} />
              ))}

              {paused.length > 0 ? (
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    In pausa
                  </h3>
                  {paused.map((automation) => (
                    <AutomationCard key={automation.id} automation={automation} enabled={open} />
                  ))}
                </div>
              ) : null}

              <Button asChild variant="outline" className="w-full">
                <Link href={ROUTES.automations}>
                  <Settings2 aria-hidden="true" />
                  Gestisci tutte le automazioni
                </Link>
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface AutomationCardProps {
  automation: Automation;
  /** Le esecuzioni si leggono solo a pannello aperto, per non pesare sul calendario. */
  enabled: boolean;
}

function AutomationCard({ automation, enabled }: AutomationCardProps) {
  const runsWindow = React.useMemo(() => {
    const now = toIso(new Date());
    return { from: addDays(now, -AUTOMATION_WINDOW_DAYS), to: addDays(now, AUTOMATION_WINDOW_DAYS), now };
  }, []);

  const runsQuery = useCollectionQuery<AutomationRun>(
    `${COLLECTIONS.automations}/${automation.id}/${COLLECTIONS.automationRuns}`,
    [
      where('scheduledFor', '>=', runsWindow.from),
      where('scheduledFor', '<=', runsWindow.to),
      orderBy('scheduledFor', 'asc'),
      limit(AUTOMATION_RUNS_FETCH_LIMIT),
    ],
    { enabled, key: `automazione-esecuzioni:${automation.id}` },
  );

  const runs = runsQuery.data;
  const capped = runs.length >= AUTOMATION_RUNS_FETCH_LIMIT;

  const planned = runs.filter((run) => run.status === 'scheduled').length;
  const sent = runs.filter((run) => run.status === 'sent' && run.scheduledFor <= runsWindow.now).length;
  const cancelled = runs.filter((run) => run.status === 'cancelled').length;

  const suffix = capped ? '+' : '';

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-soft">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">{automation.name}</h4>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {automation.description || AUTOMATION_DESCRIPTIONS[automation.key] || ''}
          </p>
        </div>
        <Badge variant={automation.enabled ? 'success' : 'secondary'} className="shrink-0">
          {automation.enabled ? 'Attiva' : 'In pausa'}
        </Badge>
      </header>

      {runsQuery.loading ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              Previsti
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{`${formatNumber(planned)}${suffix}`}</dd>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <Send className="size-3" aria-hidden="true" />
              Ultimi {AUTOMATION_WINDOW_DAYS} gg
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{`${formatNumber(sent)}${suffix}`}</dd>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5">
            <dt className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
              <CircleSlash className="size-3" aria-hidden="true" />
              Annullati
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{`${formatNumber(cancelled)}${suffix}`}</dd>
          </div>
        </dl>
      )}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Totali: {formatNumber(automation.stats?.sent ?? 0)} invii ·{' '}
          {formatCurrency(automation.stats?.revenue ?? 0, automation.stats?.currency ?? 'EUR')}
          {automation.lastRunAt ? ` · ultimo ${relativeTimeIt(automation.lastRunAt)}` : ''}
        </span>
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href={ROUTES.automation(automation.id)}>Configura</Link>
        </Button>
      </footer>
    </article>
  );
}
