'use client';

/**
 * Cronologia delle sincronizzazioni di un negozio.
 *
 * Mostra gli ultimi job della collezione `syncJobs` con esito, conteggi per
 * entità e durata; da qui si può anche chiedere l'interruzione di un job
 * ancora in corso.
 */

import { formatNumber, type SyncCounts, type SyncJob, type SyncJobStatus } from '@alphaink/shared';
import { CircleSlash, History, Loader2, XCircle } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { formatDateTimeIt, relativeTimeIt } from '@/lib/utils';

import { SYNC_ENTITY_LABELS } from './constants';

const STATUS_LABELS: Record<SyncJobStatus, string> = {
  queued: 'In coda',
  running: 'In corso',
  success: 'Completato',
  partial: 'Parziale',
  failed: 'Fallito',
  cancelled: 'Annullato',
};

const STATUS_VARIANTS: Record<SyncJobStatus, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  queued: 'outline',
  running: 'default',
  success: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'outline',
};

const TRIGGER_LABELS: Record<SyncJob['trigger'], string> = {
  manual: 'Manuale',
  schedule: 'Pianificata',
  webhook: 'Webhook',
  backfill: 'Ricarico completo',
};

/** Somma i conteggi di tutte le entità di un job. */
function totalCounts(counts: SyncJob['counts']): SyncCounts {
  return Object.values(counts ?? {}).reduce<SyncCounts>(
    (total, entry) => ({
      fetched: total.fetched + (entry?.fetched ?? 0),
      created: total.created + (entry?.created ?? 0),
      updated: total.updated + (entry?.updated ?? 0),
      skipped: total.skipped + (entry?.skipped ?? 0),
      failed: total.failed + (entry?.failed ?? 0),
    }),
    { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
  );
}

/** Durata leggibile: "1 m 12 s" oppure "820 ms". */
function formatDuration(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs < 0) return '—';
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${seconds % 60} s`;
}

export interface SyncHistoryProps {
  jobs: SyncJob[];
  loading?: boolean;
  /** Chiede l'interruzione di un job in corso. */
  onCancel?: (jobId: string) => void;
  cancellingJobId?: string | null;
  canCancel?: boolean;
}

export function SyncHistory({
  jobs,
  loading = false,
  onCancel,
  cancellingJobId,
  canCancel = false,
}: SyncHistoryProps) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        compact
        icon={<History />}
        title="Nessuna sincronizzazione registrata"
        description="Avvia una sincronizzazione manuale oppure attendi la prossima esecuzione pianificata."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">Avvio</TableHead>
            <TableHead className="w-28">Stato</TableHead>
            <TableHead className="w-32">Origine</TableHead>
            <TableHead>Entità</TableHead>
            <TableHead className="w-40 text-right">Record</TableHead>
            <TableHead className="w-24 text-right">Durata</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const totals = totalCounts(job.counts);
            const running = job.status === 'running' || job.status === 'queued';
            return (
              <TableRow key={job.id}>
                <TableCell>
                  <SimpleTooltip content={formatDateTimeIt(job.startedAt)}>
                    <span className="text-sm">{relativeTimeIt(job.startedAt)}</span>
                  </SimpleTooltip>
                  {job.error ? (
                    <p className="mt-0.5 max-w-[16rem] truncate text-xs text-destructive" title={job.error}>
                      {job.error}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[job.status]}>
                    {running ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    {STATUS_LABELS[job.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {TRIGGER_LABELS[job.trigger] ?? job.trigger}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {job.entities?.map((entity) => SYNC_ENTITY_LABELS[entity] ?? entity).join(', ') || '—'}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <span className="font-medium text-foreground">{formatNumber(totals.fetched)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    letti · {formatNumber(totals.created)} nuovi · {formatNumber(totals.updated)} agg.
                  </span>
                  {totals.failed > 0 ? (
                    <span className="ml-1 text-xs text-destructive">
                      · {formatNumber(totals.failed)} errori
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {formatDuration(job.durationMs)}
                </TableCell>
                <TableCell>
                  {running && onCancel && canCancel ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onCancel(job.id)}
                      disabled={cancellingJobId === job.id}
                      aria-label="Interrompi la sincronizzazione"
                    >
                      {cancellingJobId === job.id ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <XCircle aria-hidden="true" />
                      )}
                    </Button>
                  ) : job.status === 'cancelled' ? (
                    <CircleSlash className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
