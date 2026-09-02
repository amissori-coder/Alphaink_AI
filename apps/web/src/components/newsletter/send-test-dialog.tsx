'use client';

import { LIMITS, isValidEmail, normalizeEmail } from '@alphaink/shared';
import type { Newsletter } from '@alphaink/shared';
import { useMutation } from '@tanstack/react-query';
import { Plus, Send, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { toast, toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { sendTestEmail } from './api';
import { ContactSingleSelect } from './contact-search';
import type { RenderWarning } from './types';

export interface SendTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newsletter: Newsletter | null;
  /** Variante A/B da provare, quando la newsletter ne ha più di una. */
  variantId?: string | null;
}

const MAX_RECIPIENTS = LIMITS.maxTestRecipients;

/**
 * Invio di prova a un massimo di dieci indirizzi.
 *
 * Il contatto campione serve a risolvere i merge tag: senza, l'anteprima usa
 * un contatto fittizio e i segnaposto restano generici.
 */
export function SendTestDialog({
  open,
  onOpenChange,
  newsletter,
  variantId = null,
}: SendTestDialogProps) {
  const { user } = useAuth();
  const [recipients, setRecipients] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sampleContactId, setSampleContactId] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<RenderWarning[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const ownEmail = user?.email ? normalizeEmail(user.email) : null;

  // All'apertura si riparte dall'indirizzo di chi sta lavorando.
  React.useEffect(() => {
    if (!open) return;
    setRecipients(ownEmail ? [ownEmail] : []);
    setDraft('');
    setSampleContactId(null);
    setWarnings([]);
    setError(null);
  }, [open, ownEmail]);

  const addDraft = (raw?: string): void => {
    const source = raw ?? draft;
    const candidates = source
      .split(/[\s,;]+/)
      .map((item) => normalizeEmail(item))
      .filter(Boolean);
    if (candidates.length === 0) return;

    const accepted: string[] = [];
    let rejected: string | null = null;

    for (const candidate of candidates) {
      if (!isValidEmail(candidate)) {
        rejected = candidate;
        continue;
      }
      if (recipients.includes(candidate) || accepted.includes(candidate)) continue;
      if (recipients.length + accepted.length >= MAX_RECIPIENTS) break;
      accepted.push(candidate);
    }

    if (accepted.length > 0) setRecipients([...recipients, ...accepted]);
    setDraft(rejected ? rejected : '');
    setError(
      rejected
        ? `“${rejected}” non è un indirizzo email valido.`
        : recipients.length + accepted.length >= MAX_RECIPIENTS && candidates.length > accepted.length
          ? `Puoi indicare al massimo ${MAX_RECIPIENTS} indirizzi.`
          : null,
    );
  };

  const removeRecipient = (email: string) =>
    setRecipients(recipients.filter((item) => item !== email));

  const mutation = useMutation({ mutationFn: sendTestEmail });

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newsletter || mutation.isPending) return;

    // Un indirizzo lasciato nel campo di testo va comunque considerato.
    const pending = normalizeEmail(draft);
    const list =
      pending && isValidEmail(pending) && !recipients.includes(pending)
        ? [...recipients, pending].slice(0, MAX_RECIPIENTS)
        : recipients;

    if (list.length === 0) {
      setError('Indica almeno un indirizzo a cui inviare la prova.');
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        newsletterId: newsletter.id,
        recipients: list,
        sampleContactId,
        variantId,
      });
      setWarnings(result.warnings.filter((warning) => warning.severity !== 'info'));
      toast.success(
        result.sent === 1
          ? 'Email di prova inviata.'
          : `Email di prova inviate a ${result.sent} indirizzi.`,
        { description: `Oggetto: ${result.subject}` },
      );
      if (result.warnings.every((warning) => warning.severity === 'info')) {
        onOpenChange(false);
      }
    } catch (caught) {
      toastError(caught, 'Invio dell’email di prova non riuscito.');
    }
  };

  const busy = mutation.isPending;
  const full = recipients.length >= MAX_RECIPIENTS;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4 text-primary" aria-hidden="true" />
              Invia una prova
            </DialogTitle>
            <DialogDescription>
              {newsletter
                ? `“${newsletter.name}” viene spedita con l’oggetto preceduto da [TEST] e senza tracciamento delle statistiche.`
                : 'Seleziona una newsletter da provare.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="prova-destinatari">
              Destinatari ({recipients.length}/{MAX_RECIPIENTS})
            </Label>
            <div className="flex gap-2">
              <Input
                id="prova-destinatari"
                type="email"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                    event.preventDefault();
                    addDraft();
                  }
                }}
                onPaste={(event) => {
                  const text = event.clipboardData.getData('text');
                  if (/[\s,;]/.test(text)) {
                    event.preventDefault();
                    addDraft(text);
                  }
                }}
                placeholder="nome@azienda.it"
                disabled={busy || full}
                invalid={Boolean(error)}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => addDraft()}
                disabled={busy || full || draft.trim().length === 0}
                aria-label="Aggiungi l’indirizzo"
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Premi Invio per aggiungere un indirizzo; puoi anche incollarne più di uno separati da
              virgola.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>

          {recipients.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {recipients.map((email) => (
                <li key={email}>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs',
                      email === ownEmail && 'border-primary/40 bg-primary/5',
                    )}
                  >
                    <span className="max-w-[16rem] truncate">{email}</span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(email)}
                      disabled={busy}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Rimuovi ${email}`}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="prova-campione">Contatto campione per i merge tag</Label>
            <ContactSingleSelect
              id="prova-campione"
              value={sampleContactId}
              onChange={setSampleContactId}
              placeholder="Contatto fittizio (Mario Rossi)"
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Nome, cognome, stampanti possedute e coupon dell’anteprima verranno presi da questo
              contatto.
            </p>
          </div>

          {warnings.length > 0 ? (
            <ul className="space-y-1.5">
              {warnings.map((warning, index) => (
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Chiudi
            </Button>
            <Button
              type="submit"
              disabled={busy || !newsletter || (recipients.length === 0 && draft.trim().length === 0)}
              loading={busy}
            >
              Invia la prova
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
