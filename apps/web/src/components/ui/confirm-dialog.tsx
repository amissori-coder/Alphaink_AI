'use client';

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Etichetta del pulsante di conferma. Default: "Conferma". */
  confirmLabel?: string;
  /** Etichetta del pulsante di annullamento. Default: "Annulla". */
  cancelLabel?: string;
  /** Stile distruttivo per azioni irreversibili. */
  destructive?: boolean;
  /** Disabilita i pulsanti mentre l'azione è in corso. */
  loading?: boolean;
  /** Eseguita alla conferma; se ritorna una promessa il dialogo attende. */
  onConfirm: () => void | Promise<unknown>;
}

/**
 * Dialogo di conferma per azioni sensibili (eliminazioni, invii, annullamenti).
 * Il dialogo si chiude da solo quando `onConfirm` termina senza errori.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Conferma',
  cancelLabel = 'Annulla',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const busy = pending || loading;

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Gestiamo noi la chiusura per poter attendere l'azione asincrona.
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // L'errore è già segnalato con un toast dal chiamante: il dialogo resta aperto.
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {busy ? 'Attendere…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
ConfirmDialog.displayName = 'ConfirmDialog';

export interface UseConfirmResult {
  /** Props da passare a `<ConfirmDialog />`. */
  dialogProps: Pick<ConfirmDialogProps, 'open' | 'onOpenChange'>;
  /** Apre il dialogo. */
  confirm: () => void;
}

/** Piccolo helper di stato per usare il dialogo senza boilerplate. */
function useConfirm(): UseConfirmResult {
  const [open, setOpen] = React.useState(false);
  return {
    dialogProps: { open, onOpenChange: setOpen },
    confirm: () => setOpen(true),
  };
}

export { ConfirmDialog, useConfirm };
