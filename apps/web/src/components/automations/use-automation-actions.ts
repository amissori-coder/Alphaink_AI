'use client';

import type { Automation } from '@alphaink/shared';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';

import { toastError, toastSuccess } from '@/lib/toast';

import {
  previewAutomationStep,
  resetAutomationToDefaults,
  saveAutomation,
  sendAutomationTest,
  toggleAutomation,
} from './api';
import type {
  PreviewStepInput,
  RenderedStep,
  ResetAutomationInput,
  SaveAutomationInput,
  SendAutomationTestInput,
  SendAutomationTestResult,
  ToggleAutomationInput,
  ToggleAutomationResult,
} from './types';

/**
 * Azioni sulle automazioni.
 *
 * Il documento aggiornato arriva dal listener Firestore: qui invalidiamo solo
 * le statistiche, che vivono in React Query e non in tempo reale.
 */

function useInvalidateReports() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['automations', 'report'] });
  };
}

/** Attiva o disattiva un'automazione. */
export function useToggleAutomation(): UseMutationResult<
  ToggleAutomationResult,
  Error,
  ToggleAutomationInput
> {
  return useMutation<ToggleAutomationResult, Error, ToggleAutomationInput>({
    mutationKey: ['automations', 'toggle'],
    mutationFn: (input) => toggleAutomation(input),
    onSuccess: (_data, variables) => {
      toastSuccess(variables.enabled ? 'Automazione attivata.' : 'Automazione disattivata.');
    },
    onError: (error) => {
      toastError(error, 'Impossibile cambiare lo stato dell’automazione.');
    },
  });
}

export interface SaveAutomationOptions {
  /** Messaggio mostrato al salvataggio riuscito; `null` per nessun toast. */
  successMessage?: string | null;
  onSaved?: (automation: Automation) => void;
}

/** Salva la configurazione completa di un'automazione. */
export function useSaveAutomation(
  options: SaveAutomationOptions = {},
): UseMutationResult<Automation, Error, SaveAutomationInput> {
  const invalidateReports = useInvalidateReports();
  const { successMessage = 'Automazione salvata.', onSaved } = options;

  return useMutation<Automation, Error, SaveAutomationInput>({
    mutationKey: ['automations', 'save'],
    mutationFn: (input) => saveAutomation(input),
    onSuccess: (automation) => {
      if (successMessage) toastSuccess(successMessage);
      invalidateReports();
      onSaved?.(automation);
    },
    onError: (error) => {
      toastError(error, 'Impossibile salvare l’automazione.');
    },
  });
}

/** Ripristina contenuti, tempi e regole predefinite dell'automazione. */
export function useResetAutomation(): UseMutationResult<Automation, Error, ResetAutomationInput> {
  const invalidateReports = useInvalidateReports();

  return useMutation<Automation, Error, ResetAutomationInput>({
    mutationKey: ['automations', 'reset'],
    mutationFn: (input) => resetAutomationToDefaults(input),
    onSuccess: () => {
      toastSuccess('Impostazioni predefinite ripristinate.');
      invalidateReports();
    },
    onError: (error) => {
      toastError(error, 'Ripristino non riuscito.');
    },
  });
}

/** Invia lo step agli indirizzi di prova. */
export function useSendAutomationTest(): UseMutationResult<
  SendAutomationTestResult,
  Error,
  SendAutomationTestInput
> {
  return useMutation<SendAutomationTestResult, Error, SendAutomationTestInput>({
    mutationKey: ['automations', 'test'],
    mutationFn: (input) => sendAutomationTest(input),
    onSuccess: (result) => {
      toastSuccess(
        result.sent === 1
          ? 'Email di prova inviata.'
          : `Email di prova inviate a ${result.sent} indirizzi.`,
        result.subject,
      );
    },
    onError: (error) => {
      toastError(error, 'Invio dell’email di prova non riuscito.');
    },
  });
}

/** Genera l'anteprima di uno step senza inviare nulla. */
export function usePreviewStep(): UseMutationResult<RenderedStep, Error, PreviewStepInput> {
  return useMutation<RenderedStep, Error, PreviewStepInput>({
    mutationKey: ['automations', 'preview'],
    mutationFn: (input) => previewAutomationStep(input),
    onError: (error) => {
      toastError(error, 'Anteprima non disponibile.');
    },
  });
}
