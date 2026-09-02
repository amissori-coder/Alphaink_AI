'use client';

/**
 * Anteprima della newsletter.
 *
 * L'HTML non viene ricostruito nel browser: lo produce la callable
 * `renderNewsletterPreview`, cioè **lo stesso motore** che genera l'email
 * spedita. È l'unico modo per essere certi che l'anteprima non menta.
 *
 * Il risultato è mostrato in un `iframe` in sandbox: gli stili dell'email non
 * possono contaminare l'applicazione e nulla di ciò che arriva dal contenuto
 * viene eseguito.
 */

import { COLLECTIONS, LIMITS } from '@alphaink/shared';
import type { EmailDocument } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import {
  CircleAlert,
  Copy,
  Info,
  Monitor,
  RefreshCw,
  Smartphone,
  TriangleAlert,
  Type as TypeIcon,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { callable } from '@/lib/firebase/client';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { MOBILE_WIDTH } from './canvas';

// -----------------------------------------------------------------------------
// Tipi
// -----------------------------------------------------------------------------

export type PreviewWarningSeverity = 'errore' | 'avviso' | 'info';

export interface PreviewWarning {
  code: string;
  message: string;
  severity: PreviewWarningSeverity;
  blockId?: string;
  sectionId?: string;
}

export interface NewsletterPreviewResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: PreviewWarning[];
  /** True quando almeno un avviso impedisce l'invio. */
  blocking: boolean;
}

interface PreviewInput {
  newsletterId?: string | null;
  document?: EmailDocument | null;
  subject?: string | null;
  preheader?: string | null;
  sampleContactId?: string | null;
}

/** Contatto usato come campione per i merge tag. */
interface SampleContact {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}

const renderPreview = callable<PreviewInput, NewsletterPreviewResult>('renderNewsletterPreview', {
  timeoutMs: 120_000,
});

const SEVERITY_META: Record<
  PreviewWarningSeverity,
  { label: string; icon: React.ReactNode; className: string }
> = {
  errore: {
    label: 'Errore',
    icon: <CircleAlert />,
    className: 'border-destructive/30 bg-destructive/5 text-destructive',
  },
  avviso: {
    label: 'Avviso',
    icon: <TriangleAlert />,
    className: 'border-warning/40 bg-warning/10 text-warning-foreground',
  },
  info: {
    label: 'Nota',
    icon: <Info />,
    className: 'border-border bg-muted/50 text-muted-foreground',
  },
};

export interface PreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: EmailDocument;
  subject: string;
  preheader: string;
  /** Newsletter salvata: consente al renderer di usare gli URL reali. */
  newsletterId?: string | null;
}

export function PreviewDialog({
  open,
  onOpenChange,
  document: emailDocument,
  subject,
  preheader,
  newsletterId,
}: PreviewDialogProps) {
  const [sampleContactId, setSampleContactId] = React.useState<string>('esempio');
  const [result, setResult] = React.useState<NewsletterPreviewResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  const contactConstraints = React.useMemo(
    () => [orderBy('updatedAt', 'desc'), limitTo(LIMITS.previewSampleSize)],
    [],
  );
  const { data: contacts } = useCollectionQuery<SampleContact>(
    COLLECTIONS.contacts,
    contactConstraints,
    { enabled: open },
  );

  // Riferimenti: il documento cambia a ogni battuta di tastiera, ma l'anteprima
  // si rigenera solo all'apertura o su richiesta esplicita.
  const payloadRef = React.useRef({ emailDocument, subject, preheader, newsletterId });
  payloadRef.current = { emailDocument, subject, preheader, newsletterId };

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    const payload = payloadRef.current;
    renderPreview({
      newsletterId: payload.newsletterId ?? null,
      document: payload.emailDocument,
      subject: payload.subject,
      preheader: payload.preheader,
      sampleContactId: sampleContactId === 'esempio' ? null : sampleContactId,
    })
      .then((data) => {
        if (cancelled) return;
        setResult(data);
      })
      .catch((previewError: unknown) => {
        if (cancelled) return;
        setResult(null);
        setError(
          previewError instanceof Error
            ? previewError.message
            : 'Impossibile generare l’anteprima.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sampleContactId, reloadToken]);

  const copyHtml = async () => {
    if (!result?.html) return;
    try {
      await navigator.clipboard.writeText(result.html);
      toastSuccess('HTML copiato negli appunti.');
    } catch (copyError) {
      toastError(copyError, 'Impossibile copiare l’HTML.');
    }
  };

  const warnings = result?.warnings ?? [];
  const errors = warnings.filter((warning) => warning.severity === 'errore');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="max-h-[94vh] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Anteprima</DialogTitle>
          <DialogDescription>
            Generata dallo stesso motore che compone l’email inviata, merge tag inclusi.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="desktop" className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
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
                <TypeIcon aria-hidden="true" />
                Testo
              </TabsTrigger>
            </TabsList>

            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="anteprima-contatto" className="text-xs text-muted-foreground">
                Contatto campione
              </Label>
              <Select value={sampleContactId} onValueChange={setSampleContactId}>
                <SelectTrigger id="anteprima-contatto" className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="esempio">Valori di esempio</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contact.displayName?.trim() ||
                        [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
                        contact.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadToken((token) => token + 1)}
                loading={loading}
              >
                <RefreshCw aria-hidden="true" />
                Aggiorna
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyHtml()}
                disabled={!result?.html}
              >
                <Copy aria-hidden="true" />
                Copia HTML
              </Button>
            </div>
          </div>

          {/* Riga oggetto come apparirà nella casella di posta. */}
          <div className="border-b border-border bg-muted/40 px-5 py-2.5">
            <p className="truncate text-sm font-semibold text-foreground">
              {result?.subject || subject || 'Oggetto non impostato'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {result?.preheader || preheader || 'Nessun testo di anteprima'}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-muted/30">
            {loading && !result ? (
              <div className="flex h-[52vh] flex-col items-center justify-center gap-3">
                <Spinner />
                <p className="text-sm text-muted-foreground">Composizione dell’email in corso…</p>
                <Skeleton className="h-2 w-40" />
              </div>
            ) : error ? (
              <div className="flex h-[52vh] flex-col items-center justify-center gap-2 px-6 text-center">
                <CircleAlert className="size-8 text-destructive" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Anteprima non disponibile</p>
                <p className="max-w-md text-sm text-muted-foreground">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setReloadToken((token) => token + 1)}
                >
                  <RefreshCw aria-hidden="true" />
                  Riprova
                </Button>
              </div>
            ) : (
              <>
                <TabsContent value="desktop" className="mt-0 h-[52vh]">
                  <iframe
                    title="Anteprima desktop"
                    sandbox=""
                    srcDoc={result?.html ?? ''}
                    className="size-full border-0 bg-white"
                  />
                </TabsContent>

                <TabsContent value="mobile" className="mt-0 h-[52vh]">
                  <div className="flex h-full items-start justify-center overflow-auto py-4">
                    <div
                      className="overflow-hidden rounded-[1.75rem] border-8 border-slate-800 bg-white shadow-popover"
                      style={{ width: MOBILE_WIDTH + 16 }}
                    >
                      <iframe
                        title="Anteprima mobile"
                        sandbox=""
                        srcDoc={result?.html ?? ''}
                        style={{ width: MOBILE_WIDTH, height: '46vh' }}
                        className="border-0 bg-white"
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="testo" className="mt-0 h-[52vh]">
                  <ScrollArea className="h-full">
                    <pre className="whitespace-pre-wrap p-5 font-mono text-xs leading-relaxed text-foreground">
                      {result?.text || 'Versione testuale non disponibile.'}
                    </pre>
                  </ScrollArea>
                </TabsContent>
              </>
            )}
          </div>

          {/* Avvisi di validazione */}
          <div className="max-h-[22vh] shrink-0 overflow-y-auto border-t border-border bg-card px-5 py-3 scrollbar-thin">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Controlli
              </p>
              {result ? (
                errors.length > 0 ? (
                  <Badge variant="destructive">
                    {errors.length} {errors.length === 1 ? 'errore' : 'errori'}
                  </Badge>
                ) : warnings.length > 0 ? (
                  <Badge variant="warning">
                    {warnings.length} {warnings.length === 1 ? 'segnalazione' : 'segnalazioni'}
                  </Badge>
                ) : (
                  <Badge variant="success">Nessun problema</Badge>
                )
              ) : null}
            </div>

            {warnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {result
                  ? 'La newsletter è pronta per l’invio: nessun problema rilevato.'
                  : 'I controlli compaiono al termine della composizione.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {warnings.map((warning, index) => {
                  const meta = SEVERITY_META[warning.severity] ?? SEVERITY_META.info;
                  return (
                    <li
                      key={`${warning.code}-${index}`}
                      className={cn(
                        'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-snug',
                        meta.className,
                      )}
                    >
                      <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{meta.icon}</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{meta.label}: </span>
                        {warning.message}
                        {warning.blockId ? (
                          <span className="ml-1 font-mono text-[10px] opacity-70">
                            ({warning.blockId})
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
