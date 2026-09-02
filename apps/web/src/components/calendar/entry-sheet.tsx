'use client';

import { AUTOMATION_DESCRIPTIONS } from '@alphaink/shared';
import type { Automation, Newsletter } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  Copy,
  ExternalLink,
  Eye,
  MousePointerClick,
  Pencil,
  Repeat2,
  Send,
  TriangleAlert,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useConfirm } from '@/components/ui/confirm-dialog';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatCurrency, formatDateTimeIt, formatNumber, formatPercent } from '@/lib/utils';

import { CANCELLABLE_STATUSES, newsletterPreviewKey } from './constants';
import { renderNewsletterPreview } from './use-calendar-actions';
import type { CalendarItem } from './types';
import { categoryLabel, statusBadgeVariant, statusLabel } from './utils';

export interface EntryDetailSheetProps {
  item: CalendarItem | null;
  /** Documento completo, quando già disponibile nella cache in tempo reale. */
  newsletter: Newsletter | null;
  /** Automazione collegata, per le voci ricorrenti. */
  automation: Automation | null;
  clusterNameById: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (item: CalendarItem) => void;
  onDuplicate: (item: CalendarItem) => void;
  onReschedule: (item: CalendarItem) => void;
  onCancelSchedule: (item: CalendarItem) => void | Promise<unknown>;
  onOpenAutomations: () => void;
  canWrite: boolean;
  canSchedule: boolean;
  pending?: boolean;
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', accent && 'text-success')}>{value}</p>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** Pannello laterale con anteprima, statistiche e azioni della voce selezionata. */
export function EntryDetailSheet({
  item,
  newsletter,
  automation,
  clusterNameById,
  open,
  onOpenChange,
  onEdit,
  onDuplicate,
  onReschedule,
  onCancelSchedule,
  onOpenAutomations,
  canWrite,
  canSchedule,
  pending = false,
}: EntryDetailSheetProps) {
  const cancelConfirm = useConfirm();
  const isAutomation = item?.type === 'automation';
  const newsletterId = item?.newsletterId ?? null;

  const preview = useQuery({
    queryKey: newsletterPreviewKey(newsletterId ?? 'nessuna'),
    queryFn: () => renderNewsletterPreview({ newsletterId: newsletterId as string }),
    enabled: open && Boolean(newsletterId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const stats = newsletter?.stats ?? null;
  const showStats = Boolean(
    item &&
      !isAutomation &&
      (stats?.recipients || item.stats?.delivered || ['sent', 'sending', 'paused', 'failed'].includes(item.status)),
  );

  const clusterNames = (newsletter?.audience?.clusterIds ?? item?.clusterIds ?? [])
    .map((id) => clusterNameById.get(id) ?? id)
    .filter(Boolean);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {item ? (
            <>
              <SheetHeader className="border-b border-border p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {isAutomation ? (
                    <Badge variant="secondary" className="gap-1">
                      <Repeat2 aria-hidden="true" />
                      Automazione
                    </Badge>
                  ) : (
                    <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item.status)}</Badge>
                  )}
                  {categoryLabel(item.category) ? (
                    <Badge variant="outline">{categoryLabel(item.category)}</Badge>
                  ) : null}
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="font-normal">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <SheetTitle className="mt-2 text-balance">{item.title}</SheetTitle>
                <SheetDescription>
                  {isAutomation
                    ? item.automationKey
                      ? AUTOMATION_DESCRIPTIONS[item.automationKey]
                      : 'Automazione sempre attiva.'
                    : newsletter?.subject || item.subject || 'Oggetto non ancora definito.'}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin">
                <dl className="divide-y divide-border">
                  <InfoRow label={isAutomation ? 'Prossima esecuzione' : 'Invio'}>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {formatDateTimeIt(item.date)}
                    </span>
                  </InfoRow>

                  {isAutomation ? (
                    <InfoRow label="Invii previsti nel giorno">
                      {formatNumber(item.occurrences)}
                    </InfoRow>
                  ) : (
                    <InfoRow label="Destinatari stimati">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        {formatNumber(item.recipients)}
                      </span>
                    </InfoRow>
                  )}

                  {clusterNames.length > 0 ? (
                    <InfoRow label="Cluster">
                      <span className="flex flex-wrap justify-end gap-1">
                        {clusterNames.map((name) => (
                          <Badge key={name} variant="outline" className="font-normal">
                            {name}
                          </Badge>
                        ))}
                      </span>
                    </InfoRow>
                  ) : null}

                  {newsletter ? (
                    <InfoRow label="Mittente">
                      <span className="truncate">
                        {newsletter.fromName}{' '}
                        <span className="text-muted-foreground">&lt;{newsletter.fromEmail}&gt;</span>
                      </span>
                    </InfoRow>
                  ) : null}

                  {automation ? (
                    <InfoRow label="Stato automazione">
                      <Badge variant={automation.enabled ? 'success' : 'secondary'}>
                        {automation.enabled ? 'Attiva' : 'In pausa'}
                      </Badge>
                    </InfoRow>
                  ) : null}

                  {newsletter?.failureReason ? (
                    <InfoRow label="Errore">
                      <span className="text-destructive">{newsletter.failureReason}</span>
                    </InfoRow>
                  ) : null}
                </dl>

                {showStats ? (
                  <section aria-label="Statistiche di invio" className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Statistiche
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <StatTile
                        icon={<Send className="size-3" aria-hidden="true" />}
                        label="Consegnate"
                        value={formatNumber(stats?.delivered ?? item.stats?.delivered ?? 0)}
                      />
                      <StatTile
                        icon={<Eye className="size-3" aria-hidden="true" />}
                        label="Aperture uniche"
                        value={formatNumber(stats?.uniqueOpened ?? item.stats?.opened ?? 0)}
                        accent
                      />
                      <StatTile
                        icon={<MousePointerClick className="size-3" aria-hidden="true" />}
                        label="Click unici"
                        value={formatNumber(stats?.uniqueClicked ?? item.stats?.clicked ?? 0)}
                      />
                      <StatTile
                        icon={<Wallet className="size-3" aria-hidden="true" />}
                        label="Ricavi attribuiti"
                        value={formatCurrency(
                          stats?.revenue ?? item.stats?.revenue ?? 0,
                          stats?.currency ?? 'EUR',
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">
                        <p className="text-muted-foreground">Apertura</p>
                        <p className="font-semibold tabular-nums">
                          {formatPercent(item.openRate ?? stats?.openRate ?? 0, 1)}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">
                        <p className="text-muted-foreground">Click</p>
                        <p className="font-semibold tabular-nums">{formatPercent(stats?.clickRate ?? 0, 1)}</p>
                      </div>
                      <div className="rounded-md bg-muted/40 px-2 py-1.5">
                        <p className="text-muted-foreground">Conversione</p>
                        <p className="font-semibold tabular-nums">
                          {formatPercent(stats?.conversionRate ?? 0, 1)}
                        </p>
                      </div>
                    </div>
                  </section>
                ) : null}

                {isAutomation ? (
                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Automazione ricorrente
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Le automazioni non hanno una data unica: le occorrenze mostrate nel calendario sono
                      gli invii già programmati per quel giorno.
                    </p>
                    <Button variant="outline" size="sm" onClick={onOpenAutomations}>
                      <Repeat2 aria-hidden="true" />
                      Vedi tutte le automazioni attive
                    </Button>
                  </section>
                ) : (
                  <section aria-label="Anteprima del contenuto" className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Anteprima
                    </h3>
                    {preview.isLoading ? (
                      <Skeleton className="h-64 w-full rounded-lg" />
                    ) : preview.isError ? (
                      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                        <span>
                          Anteprima non disponibile: {(preview.error as Error)?.message}
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto px-1 py-0"
                            onClick={() => void preview.refetch()}
                          >
                            Riprova
                          </Button>
                        </span>
                      </div>
                    ) : preview.data ? (
                      <iframe
                        title={`Anteprima di ${item.title}`}
                        srcDoc={preview.data.html}
                        sandbox=""
                        loading="lazy"
                        className="h-72 w-full rounded-lg border border-border bg-white"
                      />
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                        Nessun contenuto da mostrare.
                      </div>
                    )}
                  </section>
                )}
              </div>

              <SheetFooter className="flex-row flex-wrap gap-2 border-t border-border p-4">
                {isAutomation ? (
                  <Button onClick={onOpenAutomations}>
                    <ExternalLink aria-hidden="true" />
                    Apri automazioni
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => onEdit(item)} disabled={!canWrite}>
                      <Pencil aria-hidden="true" />
                      Modifica
                    </Button>
                    <Button variant="outline" onClick={() => onDuplicate(item)} disabled={!canWrite || pending}>
                      <Copy aria-hidden="true" />
                      Duplica
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onReschedule(item)}
                      disabled={!canSchedule || !item.draggable}
                    >
                      <CalendarClock aria-hidden="true" />
                      Ripianifica
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={cancelConfirm.confirm}
                      disabled={!canSchedule || !CANCELLABLE_STATUSES.includes(item.status)}
                    >
                      <XCircle aria-hidden="true" />
                      Annulla invio
                    </Button>
                  </>
                )}
              </SheetFooter>
            </>
          ) : (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        {...cancelConfirm.dialogProps}
        title="Annullare la programmazione?"
        description={
          item
            ? `“${item.title}” tornerà in bozza e non verrà inviata alla data prevista. Potrai ripianificarla in qualsiasi momento.`
            : undefined
        }
        confirmLabel="Annulla invio"
        cancelLabel="Mantieni"
        destructive
        onConfirm={() => (item ? onCancelSchedule(item) : undefined)}
      />
    </>
  );
}
