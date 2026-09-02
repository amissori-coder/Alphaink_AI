'use client';

import { blockId, emptyDocument } from '@alphaink/shared';
import type { EmailDocument } from '@alphaink/shared';
import * as React from 'react';

import { EmailEditor } from '@/components/editor';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { AutomationStepPayload } from './types';

export interface StepEmailPatch {
  document: EmailDocument;
  subject: string;
  preheader: string | null;
}

export interface StepEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Step in modifica; `null` quando il dialogo è chiuso. */
  step: AutomationStepPayload | null;
  automationName: string;
  saving?: boolean;
  /** Salvataggio delegato al contenitore (che chiama `saveAutomation`). */
  onSave: (patch: StepEmailPatch) => void | Promise<unknown>;
}

/** Documento di partenza quando lo step non ne ha ancora uno. */
function initialDocument(step: AutomationStepPayload | null): EmailDocument {
  return step?.document ?? emptyDocument(blockId('section'), blockId('column'));
}

/**
 * Editor a blocchi dello step, a schermo intero.
 *
 * Il documento resta locale finché non si salva: così si può sperimentare senza
 * toccare un'automazione attiva. Alla chiusura con modifiche pendenti viene
 * chiesta conferma.
 */
export function StepEditorDialog({
  open,
  onOpenChange,
  step,
  automationName,
  saving = false,
  onSave,
}: StepEditorDialogProps) {
  const [document, setDocument] = React.useState<EmailDocument>(() => initialDocument(step));
  const [subject, setSubject] = React.useState(step?.subject ?? '');
  const [preheader, setPreheader] = React.useState(step?.preheader ?? '');
  const [dirty, setDirty] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);

  // Ogni apertura riparte dai valori dello step: nessuna traccia della sessione precedente.
  React.useEffect(() => {
    if (!open) return;
    setDocument(initialDocument(step));
    setSubject(step?.subject ?? '');
    setPreheader(step?.preheader ?? '');
    setDirty(false);
  }, [open, step]);

  const requestClose = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  };

  const handleSave = async () => {
    await onSave({ document, subject, preheader: preheader.trim() || null });
    setDirty(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          size="full"
          className="flex h-[92vh] w-[min(98vw,1400px)] max-w-none flex-col gap-0 overflow-hidden p-0"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-4 text-left">
            <DialogTitle>Contenuto dell’email · {step?.name ?? 'Step'}</DialogTitle>
            <DialogDescription>
              Automazione «{automationName}». Le modifiche vengono applicate al salvataggio.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1">
            {step ? (
              <EmailEditor
                className="h-full"
                document={document}
                onChange={(next) => {
                  setDocument(next);
                  setDirty(true);
                }}
                subject={subject}
                onSubjectChange={(next) => {
                  setSubject(next);
                  setDirty(true);
                }}
                preheader={preheader}
                onPreheaderChange={(next) => {
                  setPreheader(next);
                  setDirty(true);
                }}
                onSaveRequested={() => void handleSave()}
                saving={saving}
                newsletterName={`${automationName} — ${step.name}`}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Chiudere senza salvare?"
        description="Le modifiche al contenuto dell’email andranno perse."
        confirmLabel="Chiudi senza salvare"
        cancelLabel="Continua a modificare"
        destructive
        onConfirm={() => {
          setDirty(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
