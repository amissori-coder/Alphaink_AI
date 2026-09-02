'use client';

import { CircleAlert, Info, Monitor, RefreshCw, Smartphone, TriangleAlert, Type } from 'lucide-react';
import * as React from 'react';

import { sanitizePreviewHtml } from '@/components/editor';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { usePreviewStep } from './use-automation-actions';
import type { AutomationStepPayload, RenderWarning } from './types';

const MOBILE_WIDTH = 375;

function severityTone(severity: string): 'destructive' | 'warning' | 'info' {
  if (severity === 'errore') return 'destructive';
  if (severity === 'avviso') return 'warning';
  return 'info';
}

function WarningList({ warnings }: { warnings: RenderWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-2">
      {warnings.map((warning, index) => {
        const tone = severityTone(String(warning.severity));
        const Icon = tone === 'destructive' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info;
        return (
          <li key={`${warning.code}-${index}`}>
            <Alert variant={tone}>
              <Icon aria-hidden="true" />
              <AlertTitle className="text-xs uppercase tracking-wide">
                {tone === 'destructive' ? 'Errore' : tone === 'warning' ? 'Avviso' : 'Nota'}
              </AlertTitle>
              <AlertDescription className="text-sm">{warning.message}</AlertDescription>
            </Alert>
          </li>
        );
      })}
    </ul>
  );
}

export interface StepPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
  step: AutomationStepPayload | null;
  /** Vero quando ci sono modifiche non salvate: l'anteprima usa la versione salvata. */
  dirty?: boolean;
  /** Contatto usato per risolvere i merge tag. */
  sampleContactId?: string | null;
}

/**
 * Anteprima di uno step.
 *
 * L'HTML lo produce la callable `previewAutomationStep`, cioè lo stesso motore
 * che compone l'email spedita: l'anteprima non può divergere dall'invio reale.
 * Il coupon mostrato è fittizio, nessun codice viene emesso.
 */
export function StepPreviewDialog({
  open,
  onOpenChange,
  automationId,
  step,
  dirty = false,
  sampleContactId = null,
}: StepPreviewDialogProps) {
  const preview = usePreviewStep();
  const { mutate, reset } = preview;
  const stepId = step?.id ?? null;

  React.useEffect(() => {
    if (!open || !stepId) return;
    mutate({ automationId, stepId, sampleContactId });
    return () => reset();
  }, [open, stepId, automationId, sampleContactId, mutate, reset]);

  const result = preview.data;
  const html = React.useMemo(() => sanitizePreviewHtml(result?.html ?? ''), [result?.html]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="max-h-[92vh]">
        <DialogHeader className="text-left">
          <DialogTitle>Anteprima · {step?.name ?? 'Step'}</DialogTitle>
          <DialogDescription>
            {result?.subject
              ? `Oggetto: ${result.subject}`
              : 'Composizione dell’email con dati di esempio.'}
          </DialogDescription>
        </DialogHeader>

        {dirty ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Modifiche non salvate</AlertTitle>
            <AlertDescription>
              L’anteprima mostra l’ultima versione salvata dello step: salva per vedere le
              modifiche in corso.
            </AlertDescription>
          </Alert>
        ) : null}

        {result?.couponCode ? (
          <p className="text-sm text-muted-foreground">
            Coupon di esempio:{' '}
            <Badge variant="default" className="font-mono">
              {result.couponCode}
            </Badge>
          </p>
        ) : null}

        {preview.isPending ? (
          <Skeleton className="h-[52vh] w-full" />
        ) : preview.isError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">{preview.error?.message}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => stepId && preview.mutate({ automationId, stepId, sampleContactId })}
            >
              <RefreshCw aria-hidden="true" />
              Riprova
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="desktop">
            <TabsList>
              <TabsTrigger value="desktop">
                <Monitor aria-hidden="true" />
                Desktop
              </TabsTrigger>
              <TabsTrigger value="mobile">
                <Smartphone aria-hidden="true" />
                Mobile
              </TabsTrigger>
              <TabsTrigger value="testo">
                <Type aria-hidden="true" />
                Testo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="desktop" className="h-[52vh]">
              <iframe
                title="Anteprima desktop dello step"
                sandbox=""
                srcDoc={html}
                className="size-full rounded-md border border-border bg-white"
              />
            </TabsContent>

            <TabsContent value="mobile" className="h-[52vh]">
              <div className="flex h-full items-start justify-center overflow-auto py-4">
                <div
                  className="overflow-hidden rounded-[1.75rem] border-8 border-slate-800 bg-white shadow-popover"
                  style={{ width: MOBILE_WIDTH + 16 }}
                >
                  <iframe
                    title="Anteprima mobile dello step"
                    sandbox=""
                    srcDoc={html}
                    style={{ width: MOBILE_WIDTH, height: '46vh' }}
                    className="border-0 bg-white"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="testo" className="h-[52vh] overflow-auto">
              <pre
                className={cn(
                  'whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground',
                )}
              >
                {result?.text ?? ''}
              </pre>
            </TabsContent>
          </Tabs>
        )}

        {result && result.warnings.length > 0 ? (
          <WarningList warnings={result.warnings} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
