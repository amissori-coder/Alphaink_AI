'use client';

import type { Newsletter } from '@alphaink/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { toast, toastError } from '@/lib/toast';
import { formatNumber } from '@/lib/utils';

import {
  archiveNewsletter,
  cancelNewsletterSchedule,
  deleteNewsletter,
  duplicateNewsletter,
  pauseNewsletter,
  resumeNewsletter,
  sendNewsletterNow,
} from './api';
import { NEWSLETTER_QUERY_ROOT, ROUTES } from './constants';

export interface UseNewsletterActionsResult {
  duplicate: (newsletter: Newsletter) => Promise<Newsletter | null>;
  remove: (newsletter: Newsletter) => Promise<boolean>;
  setArchived: (newsletter: Newsletter, archived: boolean) => Promise<Newsletter | null>;
  cancelSchedule: (newsletter: Newsletter) => Promise<Newsletter | null>;
  sendNow: (newsletter: Newsletter) => Promise<boolean>;
  pause: (newsletter: Newsletter) => Promise<Newsletter | null>;
  resume: (newsletter: Newsletter) => Promise<Newsletter | null>;
  openEditor: (newsletterId: string) => void;
  openDetail: (newsletterId: string) => void;
  /** Id della newsletter con un'operazione in corso. */
  pendingId: string | null;
  /** Azione attualmente in esecuzione, per differenziare gli spinner. */
  pendingAction: NewsletterActionKind | null;
}

export type NewsletterActionKind =
  | 'duplica'
  | 'elimina'
  | 'archivia'
  | 'annulla'
  | 'invia'
  | 'pausa'
  | 'riprendi';

/**
 * Azioni disponibili su una newsletter (elenco e scheda di dettaglio).
 *
 * Ogni azione mostra un toast in italiano, gestisce da sé gli errori e
 * invalida le query dipendenti; i documenti restano comunque aggiornati in
 * tempo reale dalle sottoscrizioni Firestore.
 */
export function useNewsletterActions(): UseNewsletterActionsResult {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<{ id: string; action: NewsletterActionKind } | null>(
    null,
  );

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...NEWSLETTER_QUERY_ROOT] });
    void queryClient.invalidateQueries({ queryKey: ['calendario'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [queryClient]);

  const duplicateMutation = useMutation({ mutationFn: duplicateNewsletter });
  const deleteMutation = useMutation({ mutationFn: deleteNewsletter });
  const archiveMutation = useMutation({ mutationFn: archiveNewsletter });
  const cancelMutation = useMutation({ mutationFn: cancelNewsletterSchedule });
  const sendNowMutation = useMutation({ mutationFn: sendNewsletterNow });
  const pauseMutation = useMutation({ mutationFn: pauseNewsletter });
  const resumeMutation = useMutation({ mutationFn: resumeNewsletter });

  const openEditor = React.useCallback(
    (newsletterId: string) => router.push(ROUTES.editor(newsletterId)),
    [router],
  );

  const openDetail = React.useCallback(
    (newsletterId: string) => router.push(ROUTES.detail(newsletterId)),
    [router],
  );

  /** Esegue un'azione tracciando lo stato di attesa e ripulendo la cache. */
  const run = React.useCallback(
    async <T,>(
      newsletterId: string,
      action: NewsletterActionKind,
      task: () => Promise<T>,
      fallbackMessage: string,
    ): Promise<T | null> => {
      setPending({ id: newsletterId, action });
      try {
        return await task();
      } catch (error) {
        toastError(error, fallbackMessage);
        return null;
      } finally {
        setPending(null);
        invalidate();
      }
    },
    [invalidate],
  );

  const duplicate = React.useCallback(
    (newsletter: Newsletter) =>
      run(
        newsletter.id,
        'duplica',
        async () => {
          const result = await duplicateMutation.mutateAsync({
            newsletterId: newsletter.id,
            name: `${newsletter.name} (copia)`.slice(0, 160),
          });
          toast.success('Newsletter duplicata.', {
            description: 'La copia è una bozza senza programmazione.',
            action: { label: 'Apri', onClick: () => openEditor(result.newsletter.id) },
          });
          return result.newsletter;
        },
        'Impossibile duplicare la newsletter.',
      ),
    [run, duplicateMutation, openEditor],
  );

  const remove = React.useCallback(
    async (newsletter: Newsletter): Promise<boolean> => {
      const result = await run(
        newsletter.id,
        'elimina',
        async () => {
          const deleted = await deleteMutation.mutateAsync({ newsletterId: newsletter.id });
          toast.success(`“${newsletter.name}” eliminata.`, {
            description:
              deleted.recipients > 0
                ? `Rimossi anche ${formatNumber(deleted.recipients)} record di destinatari.`
                : 'Nessun destinatario era ancora stato preparato.',
          });
          return deleted;
        },
        'Impossibile eliminare la newsletter.',
      );
      return result !== null;
    },
    [run, deleteMutation],
  );

  const setArchived = React.useCallback(
    (newsletter: Newsletter, archived: boolean) =>
      run(
        newsletter.id,
        'archivia',
        async () => {
          const result = await archiveMutation.mutateAsync({
            newsletterId: newsletter.id,
            archived,
          });
          toast.success(archived ? 'Newsletter archiviata.' : 'Newsletter ripristinata.', {
            description: archived
              ? 'Non compare più negli elenchi, ma resta consultabile con il filtro “Archiviate”.'
              : 'È tornata visibile negli elenchi.',
          });
          return result.newsletter;
        },
        'Impossibile aggiornare l’archiviazione.',
      ),
    [run, archiveMutation],
  );

  const cancelSchedule = React.useCallback(
    (newsletter: Newsletter) =>
      run(
        newsletter.id,
        'annulla',
        async () => {
          const result = await cancelMutation.mutateAsync({ newsletterId: newsletter.id });
          toast.success('Programmazione annullata.', {
            description:
              result.cancelledBatches > 0
                ? `${formatNumber(result.cancelledBatches)} scaglioni sospesi: la newsletter è tornata in bozza.`
                : 'La newsletter è tornata in bozza.',
          });
          return result.newsletter;
        },
        'Impossibile annullare la programmazione.',
      ),
    [run, cancelMutation],
  );

  const sendNow = React.useCallback(
    async (newsletter: Newsletter): Promise<boolean> => {
      const result = await run(
        newsletter.id,
        'invia',
        async () => {
          return await sendNowMutation.mutateAsync({
            newsletterId: newsletter.id,
            confirm: true,
          });
        },
        'Invio non riuscito.',
      );
      if (!result) return false;
      toast.success(`Invio avviato: ${formatNumber(result.recipients)} destinatari.`, {
        description:
          result.sent >= result.recipients
            ? 'Spedizione completata.'
            : `${formatNumber(result.sent)} email già partite, le altre proseguono in ${formatNumber(result.batches)} scaglioni.`,
      });
      return true;
    },
    [run, sendNowMutation],
  );

  const pause = React.useCallback(
    (newsletter: Newsletter) =>
      run(
        newsletter.id,
        'pausa',
        async () => {
          const result = await pauseMutation.mutateAsync({ newsletterId: newsletter.id });
          toast.success('Spedizione in pausa.', {
            description: `${formatNumber(result.pausedBatches)} scaglioni sospesi.`,
          });
          return result.newsletter;
        },
        'Impossibile mettere in pausa la spedizione.',
      ),
    [run, pauseMutation],
  );

  const resume = React.useCallback(
    (newsletter: Newsletter) =>
      run(
        newsletter.id,
        'riprendi',
        async () => {
          const result = await resumeMutation.mutateAsync({ newsletterId: newsletter.id });
          toast.success('Spedizione ripresa.', {
            description: `${formatNumber(result.resumedBatches)} scaglioni rimessi in coda.`,
          });
          return result.newsletter;
        },
        'Impossibile riprendere la spedizione.',
      ),
    [run, resumeMutation],
  );

  return {
    duplicate,
    remove,
    setArchived,
    cancelSchedule,
    sendNow,
    pause,
    resume,
    openEditor,
    openDetail,
    pendingId: pending?.id ?? null,
    pendingAction: pending?.action ?? null,
  };
}
