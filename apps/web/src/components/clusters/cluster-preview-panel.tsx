'use client';

import type { ClusterPreview } from '@alphaink/shared';
import { AlertTriangle, RefreshCw, Send, Users } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

import { PREVIEW_SAMPLE_SIZE, ROUTES } from './constants';

export interface ClusterPreviewPanelProps {
  preview: ClusterPreview | null;
  loading: boolean;
  error: Error | null;
  /** True quando le regole sono cambiate ma l'anteprima non è ancora ripartita. */
  stale: boolean;
  onRefresh: () => void;
  className?: string;
}

/** Riquadro di un singolo conteggio. */
function Metric({
  label,
  value,
  hint,
  tone = 'default',
  loading,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'success';
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : (
        <p
          className={cn(
            'mt-0.5 text-2xl font-semibold tabular-nums',
            tone === 'success' ? 'text-success' : 'text-foreground',
          )}
        >
          {formatNumber(value)}
        </p>
      )}
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Pannello di anteprima del cluster: conteggi, avvisi e campione di contatti.
 *
 * L'anteprima è sempre una stima calcolata al momento dal motore delle regole;
 * il conteggio definitivo viene scritto sul documento al primo ricalcolo dopo
 * il salvataggio.
 */
export function ClusterPreviewPanel({
  preview,
  loading,
  error,
  stale,
  onRefresh,
  className,
}: ClusterPreviewPanelProps) {
  const sendableRate =
    preview && preview.matchedCount > 0 ? preview.sendableCount / preview.matchedCount : 0;

  return (
    <Card className={cn('flex h-full flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Anteprima</CardTitle>
          <CardDescription>
            Conteggio calcolato sulle regole correnti, aggiornato mentre modifichi.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Ricalcola l’anteprima adesso"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Anteprima non disponibile</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Metric
            label="Contatti"
            value={preview?.matchedCount ?? 0}
            hint="soddisfano le regole"
            loading={loading && !preview}
          />
          <Metric
            label="Contattabili"
            value={preview?.sendableCount ?? 0}
            hint="iscritti e raggiungibili"
            tone="success"
            loading={loading && !preview}
          />
        </div>

        {preview && preview.matchedCount > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Quota contattabile</span>
              <span className="font-medium tabular-nums text-foreground">
                {formatPercent(sendableRate)}
              </span>
            </div>
            <Progress
              value={sendableRate * 100}
              tone={sendableRate >= 0.5 ? 'success' : sendableRate >= 0.2 ? 'warning' : 'destructive'}
              aria-label="Percentuale di contatti contattabili"
            />
          </div>
        ) : null}

        {stale && !loading ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            Le regole sono cambiate: l’anteprima si aggiorna fra un istante.
          </p>
        ) : null}

        {preview && preview.warnings.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>
              {preview.warnings.length === 1 ? 'Un avviso' : `${preview.warnings.length} avvisi`}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-inside list-disc space-y-1">
                {preview.warnings.map((warning, index) => (
                  <li key={`${index}-${warning.slice(0, 24)}`}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Campione ({PREVIEW_SAMPLE_SIZE} contatti)
          </p>

          {loading && !preview ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : preview && preview.sample.length > 0 ? (
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
              <ul className="divide-y divide-border">
                {preview.sample.map((contact) => (
                  <li key={contact.id} className="px-3 py-2">
                    <Link
                      href={`${ROUTES.contacts}/${contact.id}`}
                      className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block truncate text-sm font-medium text-foreground hover:underline">
                        {contact.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {contact.email}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
              <Users className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Nessun contatto corrispondente</p>
              <p className="text-xs text-muted-foreground">
                Allarga le regole: prova a togliere una condizione oppure a passare da “tutte” ad
                “almeno una”.
              </p>
            </div>
          )}
        </div>

        {preview && preview.sendableCount > 0 ? (
          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Send className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Una newsletter inviata a questo cluster raggiungerebbe{' '}
              <strong className="font-medium text-foreground">
                {formatNumber(preview.sendableCount)}
              </strong>{' '}
              destinatari, al netto di disiscritti e bounce.
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
