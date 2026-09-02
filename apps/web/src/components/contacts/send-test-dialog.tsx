'use client';

import { NEWSLETTER_STATUS_LABELS } from '@alphaink/shared';
import type { Contact, Newsletter } from '@alphaink/shared';
import { AlertTriangle, Info, Send } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';

import { sendTestEmail } from './api';

/** Estrae un testo leggibile dagli avvisi di composizione restituiti dal backend. */
function warningText(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  if (warning && typeof warning === 'object' && 'message' in warning) {
    return String((warning as { message: unknown }).message);
  }
  return 'Avviso non specificato.';
}

export interface SendTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  newsletters: Newsletter[];
}

/**
 * Invia a questo contatto un'anteprima di una newsletter.
 *
 * Il contatto viene usato anche come campione per risolvere i merge tag: si
 * vede quindi l'email esattamente come la riceverebbe lui, con nome, azienda e
 * dati d'acquisto reali.
 */
export function SendTestDialog({ open, onOpenChange, contact, newsletters }: SendTestDialogProps) {
  const [newsletterId, setNewsletterId] = React.useState('');
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (!open) setNewsletterId('');
  }, [open]);

  const options: ComboboxOption[] = React.useMemo(
    () =>
      newsletters
        .filter((newsletter) => !newsletter.archived)
        .map((newsletter) => ({
          value: newsletter.id,
          label: newsletter.name,
          description: `${NEWSLETTER_STATUS_LABELS[newsletter.status]} · ${newsletter.subject}`,
        })),
    [newsletters],
  );

  const selected = newsletters.find((newsletter) => newsletter.id === newsletterId) ?? null;

  const handleSend = async () => {
    if (!newsletterId) return;
    setSending(true);
    try {
      const result = await sendTestEmail({
        newsletterId,
        recipients: [contact.email],
        sampleContactId: contact.id,
      });
      toastSuccess(
        'Email di prova inviata.',
        `“${result.subject}” è stata spedita a ${contact.email}.`,
      );
      const warnings = (result.warnings ?? []).map(warningText).filter(Boolean);
      if (warnings.length > 0) {
        toastWarning('Avvisi di composizione', warnings.slice(0, 3).join(' · '));
      }
      onOpenChange(false);
    } catch (error) {
      toastError(error, 'Invio dell’email di prova non riuscito.');
    } finally {
      setSending(false);
    }
  };

  const notSendable = contact.status !== 'subscribed';

  return (
    <Dialog open={open} onOpenChange={(next) => (sending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invia un’email di prova</DialogTitle>
          <DialogDescription>
            L’anteprima viene spedita a <strong className="text-foreground">{contact.email}</strong>{' '}
            usando i dati reali di questo contatto per risolvere i campi personalizzati.
          </DialogDescription>
        </DialogHeader>

        {notSendable ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Contatto non iscritto</AlertTitle>
            <AlertDescription>
              L’email di prova viene comunque recapitata perché è un invio transazionale, ma questo
              contatto non riceverebbe la newsletter in un invio reale.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="test-newsletter">Newsletter</Label>
          <Combobox
            id="test-newsletter"
            options={options}
            value={newsletterId}
            onChange={(next) => setNewsletterId(next as string)}
            disabled={sending || options.length === 0}
            placeholder={options.length === 0 ? 'Nessuna newsletter disponibile' : 'Scegli una newsletter'}
            searchPlaceholder="Cerca una newsletter…"
            emptyMessage="Nessuna newsletter."
            className="h-9 w-full"
            contentClassName="min-w-[20rem]"
          />
        </div>

        {selected ? (
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>{selected.subject}</AlertTitle>
            <AlertDescription>
              Mittente: {selected.fromName} &lt;{selected.fromEmail}&gt;
              {selected.preheader ? ` · Anteprima: ${selected.preheader}` : ''}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            loading={sending}
            disabled={sending || !newsletterId}
            onClick={() => void handleSend()}
          >
            <Send aria-hidden="true" />
            Invia la prova
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
