'use client';

import { COLLECTIONS } from '@alphaink/shared';
import type { EmailDocument, Newsletter } from '@alphaink/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CircleAlert,
  Eye,
  Lock,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { EmailEditor } from '@/components/editor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { useDocumentQuery } from '@/lib/hooks/use-document';
import { toastError } from '@/lib/toast';
import { cn, relativeTimeIt } from '@/lib/utils';

import { toNewsletterInput, updateNewsletter } from './api';
import {
  AUTOSAVE_DEBOUNCE_MS,
  EDITABLE_STATUSES,
  NEWSLETTER_QUERY_ROOT,
  ROUTES,
} from './constants';
import { PreviewDialog } from './newsletter-preview';
import { ScheduleDialog } from './schedule-dialog';
import { SendTestDialog } from './send-test-dialog';
import { StatusBadge } from './status-badge';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface EditorShellProps {
  newsletterId: string;
}

/**
 * Pagina dell'editor a schermo intero.
 *
 * Il documento vive nello stato locale: le modifiche vengono salvate 1,5
 * secondi dopo l'ultima digitazione (o subito con ⌘S / Ctrl+S) e la barra in
 * alto racconta sempre a che punto è il salvataggio. Chiudere la scheda con
 * modifiche non salvate richiede una conferma del browser.
 */
export function EditorShell({ newsletterId }: EditorShellProps) {
  const { can } = useAuth();
  const canWrite = can('newsletter:write');
  const canSchedule = can('newsletter:schedule');

  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: newsletter, loading, error, exists } = useDocumentQuery<Newsletter>(
    COLLECTIONS.newsletters,
    newsletterId,
  );

  const [doc, setDoc] = React.useState<EmailDocument | null>(null);
  const [subject, setSubject] = React.useState('');
  const [preheader, setPreheader] = React.useState('');
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [leaveOpen, setLeaveOpen] = React.useState(false);

  // Il contenuto si idrata una sola volta: gli aggiornamenti in tempo reale del
  // documento non devono sovrascrivere quello che l'operatore sta scrivendo.
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (hydrated.current || !newsletter) return;
    hydrated.current = true;
    setDoc(newsletter.document);
    setSubject(newsletter.subject ?? '');
    setPreheader(newsletter.preheader ?? '');
    setSavedAt(newsletter.updatedAt ?? null);
  }, [newsletter]);

  const editable = newsletter ? EDITABLE_STATUSES.includes(newsletter.status) : false;
  const readOnly = !canWrite || !editable;

  const mutation = useMutation({ mutationFn: updateNewsletter });

  // Riferimenti sempre aggiornati: il salvataggio ritardato legge da qui.
  const stateRef = React.useRef({ newsletter, doc, subject, preheader });
  stateRef.current = { newsletter, doc, subject, preheader };

  // Contatore delle modifiche: se ne arriva una mentre il salvataggio è in
  // volo, al termine si resta in stato "da salvare" invece di dichiarare tutto
  // salvato e perdere l'ultima battuta.
  const versionRef = React.useRef(0);

  const save = React.useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    const version = versionRef.current;
    if (!current.newsletter || !current.doc) return false;

    setSaveState('saving');
    setSaveError(null);
    try {
      const result = await mutation.mutateAsync({
        ...toNewsletterInput(current.newsletter),
        newsletterId: current.newsletter.id,
        document: current.doc,
        subject: current.subject.trim() || current.newsletter.subject,
        preheader: current.preheader.trim() ? current.preheader.trim() : null,
      });
      setSaveState(versionRef.current === version ? 'saved' : 'dirty');
      setSavedAt(result.newsletter.updatedAt ?? new Date().toISOString());
      void queryClient.invalidateQueries({ queryKey: [...NEWSLETTER_QUERY_ROOT] });
      return true;
    } catch (caught) {
      setSaveState('error');
      setSaveError(
        caught instanceof Error ? caught.message : 'Salvataggio non riuscito. Riprova.',
      );
      toastError(caught, 'Salvataggio non riuscito.');
      return false;
    }
  }, [mutation, queryClient]);

  const markDirty = React.useCallback(() => {
    if (readOnly) return;
    versionRef.current += 1;
    setSaveState('dirty');
  }, [readOnly]);

  // Salvataggio automatico con ritardo dopo l'ultima modifica.
  React.useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [saveState, save, doc, subject, preheader]);

  // ⌘S / Ctrl+S: salvataggio immediato.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!readOnly) void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save, readOnly]);

  // Avviso del browser se si chiude la scheda con modifiche in sospeso.
  const unsaved = saveState === 'dirty' || saveState === 'saving' || saveState === 'error';
  React.useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  /** Torna alla scheda, chiedendo conferma quando ci sono modifiche in sospeso. */
  const leave = () => {
    if (unsaved) {
      setLeaveOpen(true);
      return;
    }
    router.push(ROUTES.detail(newsletterId));
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title="Impossibile aprire l’editor"
        description={error.message}
        action={
          <Button asChild variant="outline">
            <Link href={ROUTES.list}>Torna all’elenco</Link>
          </Button>
        }
      />
    );
  }

  if (!newsletter || !exists) {
    return (
      <EmptyState
        icon={<CircleAlert />}
        title="Newsletter non trovata"
        description="Il collegamento non è più valido: la newsletter potrebbe essere stata eliminata."
        action={
          <Button asChild>
            <Link href={ROUTES.list}>Torna all’elenco</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={leave}
          aria-label="Torna alla scheda della newsletter"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{newsletter.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {subject || 'Oggetto non impostato'}
          </p>
        </div>

        <StatusBadge status={newsletter.status} className="shrink-0" />

        <SaveIndicator
          state={saveState}
          savedAt={savedAt}
          message={saveError}
          readOnly={readOnly}
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye aria-hidden="true" />
            Anteprima
          </Button>
          {canWrite ? (
            <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
              <Send aria-hidden="true" />
              Prova
            </Button>
          ) : null}
          {canSchedule && editable ? (
            <Button
              size="sm"
              onClick={async () => {
                if (unsaved) await save();
                setScheduleOpen(true);
              }}
            >
              <CalendarClock aria-hidden="true" />
              Pianifica
            </Button>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          {canWrite
            ? 'La newsletter è già in spedizione o conclusa: il contenuto non è più modificabile.'
            : 'Il tuo ruolo consente la sola consultazione del contenuto.'}
        </p>
      ) : null}

      {doc ? (
        <EmailEditor
          document={doc}
          onChange={(next: EmailDocument) => {
            setDoc(next);
            markDirty();
          }}
          subject={subject}
          preheader={preheader}
          onSubjectChange={(next: string) => {
            setSubject(next);
            markDirty();
          }}
          onPreheaderChange={(next: string) => {
            setPreheader(next);
            markDirty();
          }}
          onSaveRequested={() => {
            void save();
          }}
          newsletterId={newsletter.id}
          newsletterName={newsletter.name}
          onSendTestRequested={() => setTestOpen(true)}
          saving={saveState === 'saving'}
          className="flex-1"
        />
      ) : (
        <Skeleton className="flex-1" />
      )}

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        newsletterId={newsletter.id}
        newsletterName={newsletter.name}
      />

      <SendTestDialog open={testOpen} onOpenChange={setTestOpen} newsletter={newsletter} />

      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} newsletter={newsletter} />

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title="Uscire senza salvare?"
        description="Ci sono modifiche non ancora salvate: se esci adesso andranno perse."
        confirmLabel="Salva ed esci"
        cancelLabel="Resta nell’editor"
        onConfirm={async () => {
          const ok = await save();
          if (!ok) throw new Error('Salvataggio non riuscito.');
          router.push(ROUTES.detail(newsletter.id));
        }}
      />
    </div>
  );
}

interface SaveIndicatorProps {
  state: SaveState;
  savedAt: string | null;
  message: string | null;
  readOnly: boolean;
}

/** Indicatore testuale dello stato del salvataggio automatico. */
function SaveIndicator({ state, savedAt, message, readOnly }: SaveIndicatorProps) {
  if (readOnly) return null;

  const content = (() => {
    switch (state) {
      case 'saving':
        return (
          <>
            <Spinner className="size-3.5" />
            Salvataggio…
          </>
        );
      case 'dirty':
        return (
          <>
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            Modifiche non salvate
          </>
        );
      case 'error':
        return (
          <>
            <CircleAlert className="size-3.5" aria-hidden="true" />
            {message ?? 'Salvataggio non riuscito'}
          </>
        );
      case 'saved':
      case 'idle':
      default:
        return (
          <>
            <Check className="size-3.5" aria-hidden="true" />
            {savedAt ? `Salvato ${relativeTimeIt(savedAt)}` : 'Salvato'}
          </>
        );
    }
  })();

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs',
        state === 'error' && 'border-destructive/40 text-destructive',
        state === 'dirty' && 'text-warning-foreground',
        (state === 'saved' || state === 'idle') && 'text-muted-foreground',
      )}
    >
      {content}
    </span>
  );
}
