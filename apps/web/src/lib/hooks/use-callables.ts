'use client';

import type {
  Automation,
  AutomationInput,
  Cluster,
  ClusterInput,
  ClusterPreview,
  Newsletter,
  NewsletterAudience,
  NewsletterInput,
  StoreSource,
  SyncEntity,
  SyncJob,
} from '@alphaink/shared';
import { type UseMutationOptions, type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';

import { callable } from '@/lib/firebase/client';
import { toastError, toastSuccess } from '@/lib/toast';

// -----------------------------------------------------------------------------
// Tipi degli input/output delle callable usate dalla UI.
// I nomi delle funzioni corrispondono esattamente a quelli esportati dalle
// Cloud Functions (vedi API pubblica in functions/src/index.ts).
// -----------------------------------------------------------------------------

export interface CreateNewsletterInput extends Partial<NewsletterInput> {
  /** Template da cui partire; se assente si crea un documento vuoto. */
  templateId?: string | null;
}

export interface UpdateNewsletterInput {
  newsletterId: string;
  patch: Partial<NewsletterInput>;
}

export interface ScheduleNewsletterInput {
  newsletterId: string;
  sendAt: string;
  timezone: string;
}

export interface SendTestInput {
  newsletterId: string;
  recipients: string[];
  sampleContactId?: string | null;
}

export interface EstimateAudienceInput {
  audience: NewsletterAudience;
  newsletterId?: string | null;
}

export interface EstimateAudienceResult {
  /** Contatti che soddisfano l'audience. */
  total: number;
  /** Contatti effettivamente contattabili (iscritti e non soppressi). */
  sendable: number;
  /** Contatti rimossi dalle regole di soppressione. */
  suppressed: number;
  warnings: string[];
}

export interface SaveClusterInput extends ClusterInput {
  /** Assente in creazione. */
  clusterId?: string | null;
}

export interface ToggleAutomationInput {
  automationId: string;
  enabled: boolean;
}

export interface SaveAutomationInput extends AutomationInput {
  automationId?: string | null;
  /** Chiave dell'automazione di sistema, quando applicabile. */
  key?: string | null;
}

export interface RunSyncInput {
  source: StoreSource;
  entities: SyncEntity[];
  since?: string | null;
  fullResync?: boolean;
}

export interface RequestMediaUploadInput {
  fileName: string;
  contentType: string;
  size: number;
  folder?: string;
}

export interface RequestMediaUploadResult {
  assetId: string;
  /** URL firmato per il PUT diretto su Storage. */
  uploadUrl: string;
  /** Percorso dell'oggetto su Storage. */
  storagePath: string;
  /** URL pubblico da usare nel documento email. */
  publicUrl: string;
  expiresAt: string;
}

export interface SeedDefaultsResult {
  automations: number;
  clusters: number;
  templates: number;
  settings: boolean;
}

// -----------------------------------------------------------------------------
// Fabbrica comune: mutation tipizzata con toast in italiano e invalidazioni.
// -----------------------------------------------------------------------------

type MutationExtras<TOut, TIn> = Omit<
  UseMutationOptions<TOut, Error, TIn>,
  'mutationFn' | 'mutationKey'
>;

interface CallableMutationConfig<TIn, TOut> {
  name: string;
  /** Messaggio di successo; se `null` non mostra alcun toast. */
  successMessage?: string | ((data: TOut, variables: TIn) => string) | null;
  errorFallback?: string;
  /** Chiavi React Query da invalidare dopo il successo. */
  invalidate?: readonly (readonly unknown[])[];
  timeoutMs?: number;
}

function useCallableMutation<TIn, TOut>(
  config: CallableMutationConfig<TIn, TOut>,
  options?: MutationExtras<TOut, TIn>,
): UseMutationResult<TOut, Error, TIn> {
  const queryClient = useQueryClient();
  const invoke = callable<TIn, TOut>(config.name, { timeoutMs: config.timeoutMs });

  return useMutation<TOut, Error, TIn>({
    mutationKey: ['callable', config.name],
    mutationFn: (input: TIn) => invoke(input),
    ...options,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (config.successMessage) {
        toastSuccess(
          typeof config.successMessage === 'function'
            ? config.successMessage(data, variables)
            : config.successMessage,
        );
      }
      for (const key of config.invalidate ?? []) {
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }
      options?.onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: (error, variables, onMutateResult, context) => {
      toastError(error, config.errorFallback);
      options?.onError?.(error, variables, onMutateResult, context);
    },
  });
}

// -----------------------------------------------------------------------------
// Newsletter
// -----------------------------------------------------------------------------

export function useCreateNewsletter(options?: MutationExtras<Newsletter, CreateNewsletterInput>) {
  return useCallableMutation<CreateNewsletterInput, Newsletter>(
    {
      name: 'createNewsletter',
      successMessage: 'Newsletter creata.',
      errorFallback: 'Impossibile creare la newsletter.',
    },
    options,
  );
}

export function useUpdateNewsletter(options?: MutationExtras<Newsletter, UpdateNewsletterInput>) {
  return useCallableMutation<UpdateNewsletterInput, Newsletter>(
    {
      name: 'updateNewsletter',
      // Il salvataggio avviene di continuo nell'editor: niente toast di successo.
      successMessage: null,
      errorFallback: 'Impossibile salvare le modifiche.',
    },
    options,
  );
}

export function useScheduleNewsletter(options?: MutationExtras<Newsletter, ScheduleNewsletterInput>) {
  return useCallableMutation<ScheduleNewsletterInput, Newsletter>(
    {
      name: 'scheduleNewsletter',
      successMessage: 'Invio pianificato.',
      errorFallback: 'Impossibile pianificare l’invio.',
    },
    options,
  );
}

export function useSendTest(options?: MutationExtras<{ sent: number }, SendTestInput>) {
  return useCallableMutation<SendTestInput, { sent: number }>(
    {
      name: 'sendTestEmail',
      successMessage: (data) =>
        data.sent === 1 ? 'Email di prova inviata.' : `Email di prova inviate a ${data.sent} indirizzi.`,
      errorFallback: 'Invio dell’email di prova non riuscito.',
    },
    options,
  );
}

export function useEstimateAudience(
  options?: MutationExtras<EstimateAudienceResult, EstimateAudienceInput>,
) {
  return useCallableMutation<EstimateAudienceInput, EstimateAudienceResult>(
    {
      name: 'estimateAudience',
      successMessage: null,
      errorFallback: 'Impossibile stimare i destinatari.',
    },
    options,
  );
}

// -----------------------------------------------------------------------------
// Cluster
// -----------------------------------------------------------------------------

export function useSaveCluster(options?: MutationExtras<Cluster, SaveClusterInput>) {
  return useCallableMutation<SaveClusterInput, Cluster>(
    {
      name: 'saveCluster',
      successMessage: 'Cluster salvato.',
      errorFallback: 'Impossibile salvare il cluster.',
    },
    options,
  );
}

export function usePreviewCluster(options?: MutationExtras<ClusterPreview, ClusterInput>) {
  return useCallableMutation<ClusterInput, ClusterPreview>(
    {
      name: 'previewCluster',
      successMessage: null,
      errorFallback: 'Anteprima del cluster non disponibile.',
    },
    options,
  );
}

// -----------------------------------------------------------------------------
// Automazioni
// -----------------------------------------------------------------------------

export function useSaveAutomation(options?: MutationExtras<Automation, SaveAutomationInput>) {
  return useCallableMutation<SaveAutomationInput, Automation>(
    {
      name: 'saveAutomation',
      successMessage: 'Automazione salvata.',
      errorFallback: 'Impossibile salvare l’automazione.',
    },
    options,
  );
}

export function useToggleAutomation(options?: MutationExtras<Automation, ToggleAutomationInput>) {
  return useCallableMutation<ToggleAutomationInput, Automation>(
    {
      name: 'toggleAutomation',
      successMessage: (_data, variables) =>
        variables.enabled ? 'Automazione attivata.' : 'Automazione disattivata.',
      errorFallback: 'Impossibile cambiare lo stato dell’automazione.',
    },
    options,
  );
}

// -----------------------------------------------------------------------------
// Sincronizzazione sito
// -----------------------------------------------------------------------------

export function useRunSync(options?: MutationExtras<SyncJob, RunSyncInput>) {
  return useCallableMutation<RunSyncInput, SyncJob>(
    {
      name: 'runSiteSync',
      successMessage: 'Sincronizzazione avviata.',
      errorFallback: 'Impossibile avviare la sincronizzazione.',
      timeoutMs: 300_000,
    },
    options,
  );
}

// -----------------------------------------------------------------------------
// Media e configurazione iniziale
// -----------------------------------------------------------------------------

export function useRequestMediaUpload(
  options?: MutationExtras<RequestMediaUploadResult, RequestMediaUploadInput>,
) {
  return useCallableMutation<RequestMediaUploadInput, RequestMediaUploadResult>(
    {
      name: 'requestMediaUpload',
      successMessage: null,
      errorFallback: 'Impossibile preparare il caricamento del file.',
    },
    options,
  );
}

export function useSeedDefaults(options?: MutationExtras<SeedDefaultsResult, void>) {
  return useCallableMutation<void, SeedDefaultsResult>(
    {
      name: 'seedDefaults',
      successMessage: 'Configurazione iniziale completata.',
      errorFallback: 'Impossibile creare la configurazione iniziale.',
      timeoutMs: 300_000,
    },
    options,
  );
}
