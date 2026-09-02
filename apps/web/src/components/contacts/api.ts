'use client';

import { callable } from '@/lib/firebase/client';

import type {
  DeleteContactResult,
  ExportContactsInput,
  ExportContactsResult,
  ImportContactsInput,
  ImportContactsResult,
  RunSyncInput,
  RunSyncResult,
  SendTestEmailInput,
  SendTestEmailResult,
  UnsubscribeContactInput,
  UnsubscribeContactResult,
  UpsertContactInput,
  UpsertContactResult,
} from './types';

/**
 * Callable dell'area contatti. I nomi e la forma dei payload corrispondono
 * esattamente a quanto esposto da `functions/src/contacts/*` e
 * `functions/src/sync/callables.ts`.
 */

/** Crea o aggiorna un contatto; la deduplica per email vale anche qui. */
export const upsertContact = callable<UpsertContactInput, UpsertContactResult>('upsertContact');

/** Elimina definitivamente un contatto (facoltativamente anche da Brevo). */
export const deleteContact = callable<
  { contactId: string; deleteOnBrevo?: boolean },
  DeleteContactResult
>('deleteContact');

/** Registra l'opt-out di un contatto e lo propaga alla blocklist Brevo. */
export const unsubscribeContact = callable<UnsubscribeContactInput, UnsubscribeContactResult>(
  'unsubscribeContact',
);

/** Import massivo: al massimo 5.000 righe per chiamata (qui usiamo blocchi da 500). */
export const importContacts = callable<ImportContactsInput, ImportContactsResult>(
  'importContacts',
  { timeoutMs: 540_000 },
);

/** Esporta i contatti in CSV su Storage e ne restituisce una URL firmata. */
export const exportContacts = callable<ExportContactsInput, ExportContactsResult>(
  'exportContacts',
  { timeoutMs: 540_000 },
);

/** Avvia una sincronizzazione manuale da uno dei due negozi PrestaShop. */
export const runSiteSync = callable<RunSyncInput, RunSyncResult>('runSiteSync', {
  timeoutMs: 540_000,
});

/** Invia un'anteprima di una newsletter a un indirizzo di prova. */
export const sendTestEmail = callable<SendTestEmailInput, SendTestEmailResult>('sendTestEmail', {
  timeoutMs: 120_000,
});
