'use client';

import { useQuery } from '@tanstack/react-query';
import { Monitor, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { isFirebaseConfigured } from '@/lib/firebase/client';
import { cn } from '@/lib/utils';

import { renderNewsletterPreview } from './api';
import { previewQueryKey } from './constants';
import { ContactSingleSelect } from './contact-search';
import type { NewsletterPreviewResult } from './types';

type PreviewDevice = 'desktop' | 'mobile';

const DEVICE_WIDTH: Record<PreviewDevice, number> = { desktop: 680, mobile: 380 };

export interface NewsletterPreviewProps {
  newsletterId: string;
  /** Altezza del riquadro in pixel. */
  height?: number;
  /** Nasconde la barra dei controlli. */
  hideControls?: boolean;
  className?: string;
}

/**
 * Anteprima dell'email così come la vedrà il destinatario.
 *
 * L'HTML arriva già compilato dal renderer delle Cloud Functions e viene
 * mostrato in un iframe isolato (`sandbox` vuoto: nessuno script, nessun
 * accesso al documento ospitante).
 */
export function NewsletterPreview({
  newsletterId,
  height = 560,
  hideControls = false,
  className,
}: NewsletterPreviewProps) {
  const [device, setDevice] = React.useState<PreviewDevice>('desktop');
  const [sampleContactId, setSampleContactId] = React.useState<string | null>(null);

  const preview = useQuery<NewsletterPreviewResult, Error>({
    queryKey: previewQueryKey(newsletterId, sampleContactId),
    queryFn: () => renderNewsletterPreview({ newsletterId, sampleContactId }),
    enabled: Boolean(newsletterId) && isFirebaseConfigured(),
    staleTime: 2 * 60_000,
    retry: false,
  });

  const data = preview.data;
  const blockingWarnings = (data?.warnings ?? []).filter(
    (warning) => warning.severity === 'errore' || warning.severity === 'avviso',
  );

  return (
    <div className={cn('space-y-3', className)}>
      {hideControls ? null : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="anteprima-campione" className="text-xs">
              Contatto campione
            </Label>
            <ContactSingleSelect
              id="anteprima-campione"
              value={sampleContactId}
              onChange={setSampleContactId}
              placeholder="Contatto fittizio"
              className="w-[min(22rem,80vw)]"
            />
          </div>

          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={device}
              onValueChange={(next) => next && setDevice(next as PreviewDevice)}
              aria-label="Larghezza dell’anteprima"
            >
              <ToggleGroupItem value="desktop" aria-label="Anteprima da computer">
                <Monitor aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="mobile" aria-label="Anteprima da telefono">
                <Smartphone aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void preview.refetch()}
              disabled={preview.isFetching}
              aria-label="Aggiorna l’anteprima"
            >
              <RefreshCw className={cn(preview.isFetching && 'animate-spin')} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {data ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <p className="truncate text-sm font-medium text-foreground">
            {data.subject || 'Oggetto non impostato'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {data.preheader || 'Nessun testo di anteprima'}
          </p>
        </div>
      ) : null}

      {blockingWarnings.length > 0 ? (
        <ul className="space-y-1.5">
          {blockingWarnings.map((warning, index) => (
            <li
              key={`${warning.code}-${index}`}
              className={cn(
                'flex items-start gap-2 rounded-md px-3 py-2 text-xs',
                warning.severity === 'errore'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-warning/10 text-warning-foreground',
              )}
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="flex justify-center overflow-auto rounded-lg border border-border bg-muted/40 p-4"
        style={{ height }}
      >
        {preview.isLoading ? (
          <Skeleton className="h-full w-full max-w-[680px]" />
        ) : preview.error ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">{preview.error.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void preview.refetch()}>
              Riprova
            </Button>
          </div>
        ) : (
          <iframe
            title="Anteprima della newsletter"
            srcDoc={data?.html ?? ''}
            sandbox=""
            className="h-full w-full rounded-md border border-border bg-white shadow-card"
            style={{ maxWidth: DEVICE_WIDTH[device] }}
          />
        )}
      </div>
    </div>
  );
}

export interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newsletterId: string | null;
  newsletterName?: string;
}

/** Anteprima a tutta finestra, richiamata dall'elenco delle newsletter. */
export function PreviewDialog({
  open,
  onOpenChange,
  newsletterId,
  newsletterName,
}: PreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Anteprima</DialogTitle>
          <DialogDescription>
            {newsletterName
              ? `Contenuto di “${newsletterName}” come apparirà nella casella del destinatario.`
              : 'Contenuto dell’email come apparirà nella casella del destinatario.'}
          </DialogDescription>
        </DialogHeader>
        {newsletterId ? (
          <NewsletterPreview newsletterId={newsletterId} height={520} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nessuna newsletter selezionata.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
