'use client';

import type { Newsletter } from '@alphaink/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { callable } from '@/lib/firebase/client';
import { toast, toastError } from '@/lib/toast';
import { formatDateTimeIt } from '@/lib/utils';

import { BUSINESS_TIMEZONE, CALENDAR_QUERY_ROOT, ROUTES } from './constants';
import type { CalendarItem, NewsletterDraftInput, RescheduleUndo } from './types';

/** Avviso di rendering restituito dalle callable di pianificazione. */
export interface CalendarWarning {
  code: string;
  message: string;
  severity: 'info' | 'avviso' | 'errore' | string;
}

export interface ScheduleNewsletterResult {
  newsletter: Newsletter;
  estimatedRecipients: number;
  warnings: CalendarWarning[];
}

export interface NewsletterPreviewResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: CalendarWarning[];
  blocking: boolean;
}

const scheduleNewsletter = callable<
  { newsletterId: string; sendAt: string; timezone: string },
  ScheduleNewsletterResult
>('scheduleNewsletter');

const cancelNewsletterSchedule = callable<
  { newsletterId: string },
  { newsletter: Newsletter; cancelledBatches: number }
>('cancelNewsletterSchedule');

const duplicateNewsletter = callable<
  { newsletterId: string; name?: string },
  { newsletter: Newsletter }
>('duplicateNewsletter');

const createNewsletter = callable<NewsletterDraftInput, { newsletter: Newsletter }>(
  'createNewsletter',
);

export const renderNewsletterPreview = callable<
  { newsletterId: string },
  NewsletterPreviewResult
>('renderNewsletterPreview');

export interface RescheduleInput {
  item: CalendarItem;
  /** Nuovo istante di invio in formato ISO. */
  sendAt: string;
  /** Testo aggiuntivo mostrato nel toast di conferma. */
  origin?: 'trascinamento' | 'dialogo';
}

export interface UseCalendarActionsResult {
  reschedule: (input: RescheduleInput) => Promise<Newsletter | null>;
  cancelSchedule: (item: CalendarItem) => Promise<Newsletter | null>;
  duplicate: (item: CalendarItem) => Promise<Newsletter | null>;
  createDraft: (input: NewsletterDraftInput) => Promise<Newsletter | null>;
  openEditor: (newsletterId: string) => void;
  /** Id della newsletter con un'operazione in corso, per gli stati di attesa. */
  pendingId: string | null;
  isRescheduling: boolean;
  isCreating: boolean;
}

/**
 * Azioni del calendario: ripianificazione (con annullamento), annullamento
 * della programmazione, duplicazione e creazione rapida di una bozza.
 * Tutte invalidano la query del calendario così la griglia resta coerente.
 */
export function useCalendarActions(): UseCalendarActionsResult {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...CALENDAR_QUERY_ROOT] });
  }, [queryClient]);

  const scheduleMutation = useMutation({
    mutationFn: (input: { newsletterId: string; sendAt: string }) =>
      scheduleNewsletter({
        newsletterId: input.newsletterId,
        sendAt: input.sendAt,
        timezone: BUSINESS_TIMEZONE,
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: (newsletterId: string) => cancelNewsletterSchedule({ newsletterId }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (input: { newsletterId: string; name: string }) =>
      duplicateNewsletter({ newsletterId: input.newsletterId, name: input.name }),
  });

  const createMutation = useMutation({
    mutationFn: (input: NewsletterDraftInput) => createNewsletter(input),
  });

  const openEditor = React.useCallback(
    (newsletterId: string) => {
      router.push(ROUTES.newsletter(newsletterId));
    },
    [router],
  );

  /** Ripristina la pianificazione precedente dopo un annullamento dal toast. */
  const undoReschedule = React.useCallback(
    async (undo: RescheduleUndo) => {
      try {
        if (undo.previousStatus === 'draft' || !undo.previousSendAt) {
          await cancelMutation.mutateAsync(undo.newsletterId);
          toast.success('Ripianificazione annullata.', {
            description: 'La newsletter è tornata in bozza, senza data di invio.',
          });
        } else {
          await scheduleMutation.mutateAsync({
            newsletterId: undo.newsletterId,
            sendAt: undo.previousSendAt,
          });
          toast.success(
            `Ripianificazione annullata: invio di nuovo previsto per ${formatDateTimeIt(undo.previousSendAt)}.`,
          );
        }
      } catch (error) {
        toastError(error, 'Impossibile annullare la ripianificazione.');
      } finally {
        invalidate();
      }
    },
    [cancelMutation, scheduleMutation, invalidate],
  );

  const reschedule = React.useCallback(
    async ({ item, sendAt, origin = 'dialogo' }: RescheduleInput): Promise<Newsletter | null> => {
      if (!item.newsletterId) return null;
      const undo: RescheduleUndo = {
        newsletterId: item.newsletterId,
        previousSendAt: item.date,
        previousStatus: item.status,
      };
      setPendingId(item.newsletterId);
      try {
        const result = await scheduleMutation.mutateAsync({
          newsletterId: item.newsletterId,
          sendAt,
        });
        const notices = result.warnings?.filter((warning) => warning.severity === 'avviso') ?? [];
        toast.success(`Invio spostato al ${formatDateTimeIt(sendAt)}`, {
          description:
            notices.length > 0
              ? notices[0].message
              : `“${item.title}” · ${origin === 'trascinamento' ? 'spostata trascinandola' : 'ripianificata'} · ${result.estimatedRecipients} destinatari stimati.`,
          action: {
            label: 'Annulla',
            onClick: () => {
              void undoReschedule(undo);
            },
          },
        });
        return result.newsletter;
      } catch (error) {
        toastError(error, 'Impossibile ripianificare l’invio.');
        return null;
      } finally {
        setPendingId(null);
        invalidate();
      }
    },
    [scheduleMutation, undoReschedule, invalidate],
  );

  const cancelSchedule = React.useCallback(
    async (item: CalendarItem): Promise<Newsletter | null> => {
      if (!item.newsletterId) return null;
      setPendingId(item.newsletterId);
      try {
        const result = await cancelMutation.mutateAsync(item.newsletterId);
        toast.success('Invio annullato: la newsletter è tornata in bozza.', {
          description: `“${item.title}” non verrà più inviata alla data prevista.`,
        });
        return result.newsletter;
      } catch (error) {
        toastError(error, 'Impossibile annullare l’invio.');
        return null;
      } finally {
        setPendingId(null);
        invalidate();
      }
    },
    [cancelMutation, invalidate],
  );

  const duplicate = React.useCallback(
    async (item: CalendarItem): Promise<Newsletter | null> => {
      if (!item.newsletterId) return null;
      setPendingId(item.newsletterId);
      try {
        const result = await duplicateMutation.mutateAsync({
          newsletterId: item.newsletterId,
          name: `${item.title} (copia)`.slice(0, 160),
        });
        toast.success('Newsletter duplicata.', {
          description: 'La copia è una bozza senza programmazione.',
          action: {
            label: 'Apri',
            onClick: () => openEditor(result.newsletter.id),
          },
        });
        return result.newsletter;
      } catch (error) {
        toastError(error, 'Impossibile duplicare la newsletter.');
        return null;
      } finally {
        setPendingId(null);
        invalidate();
      }
    },
    [duplicateMutation, openEditor, invalidate],
  );

  const createDraft = React.useCallback(
    async (input: NewsletterDraftInput): Promise<Newsletter | null> => {
      try {
        const result = await createMutation.mutateAsync(input);
        toast.success('Bozza creata.', {
          description: input.schedule?.sendAt
            ? `Data di invio precompilata: ${formatDateTimeIt(input.schedule.sendAt)}.`
            : 'Completa il contenuto per poterla pianificare.',
        });
        return result.newsletter;
      } catch (error) {
        toastError(error, 'Impossibile creare la newsletter.');
        return null;
      } finally {
        invalidate();
      }
    },
    [createMutation, invalidate],
  );

  return {
    reschedule,
    cancelSchedule,
    duplicate,
    createDraft,
    openEditor,
    pendingId,
    isRescheduling: scheduleMutation.isPending,
    isCreating: createMutation.isPending,
  };
}
