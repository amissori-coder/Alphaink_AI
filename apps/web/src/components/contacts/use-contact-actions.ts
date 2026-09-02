'use client';

import type { Cluster, Contact } from '@alphaink/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { saveCluster } from '@/components/clusters/api';
import { toastError, toastInfo, toastSuccess, toastWarning } from '@/lib/toast';
import { formatNumber } from '@/lib/utils';

import { deleteContact, exportContacts, runSiteSync, unsubscribeContact, upsertContact } from './api';
import { ROUTES } from './constants';
import type {
  ExportContactsInput,
  RunSyncInput,
  UpsertContactInput,
} from './types';

/**
 * Azioni sui contatti condivise fra elenco e scheda.
 *
 * `pending` identifica l'operazione in corso, così la UI può disabilitare il
 * singolo comando senza congelare la pagina intera.
 */
export interface ContactActions {
  pending: string | null;
  save: (input: UpsertContactInput) => Promise<Contact | null>;
  unsubscribe: (
    contact: Pick<Contact, 'id' | 'email'>,
    options?: { reason?: string; status?: 'unsubscribed' | 'blocked' },
  ) => Promise<boolean>;
  unsubscribeMany: (contacts: Array<Pick<Contact, 'id' | 'email'>>) => Promise<number>;
  remove: (contact: Pick<Contact, 'id' | 'email'>, deleteOnBrevo: boolean) => Promise<boolean>;
  addToCluster: (cluster: Cluster, contactIds: string[]) => Promise<boolean>;
  exportCsv: (input: ExportContactsInput) => Promise<string | null>;
  sync: (input: RunSyncInput) => Promise<boolean>;
  openDetail: (contactId: string) => void;
}

export function useContactActions(): ContactActions {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<string | null>(null);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['firestore'] });
    void queryClient.invalidateQueries({ queryKey: ['contatti'] });
  }, [queryClient]);

  const save = React.useCallback(
    async (input: UpsertContactInput): Promise<Contact | null> => {
      setPending('save');
      try {
        const result = await upsertContact(input);
        toastSuccess(
          result.created ? 'Contatto creato.' : 'Contatto aggiornato.',
          result.contact.email,
        );
        invalidate();
        return result.contact;
      } catch (error) {
        toastError(error, 'Impossibile salvare il contatto.');
        return null;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  const unsubscribe = React.useCallback(
    async (
      contact: Pick<Contact, 'id' | 'email'>,
      options?: { reason?: string; status?: 'unsubscribed' | 'blocked' },
    ): Promise<boolean> => {
      setPending(`unsubscribe:${contact.id}`);
      try {
        const result = await unsubscribeContact({
          contactId: contact.id,
          reason: options?.reason ?? 'Disiscrizione richiesta dalla rubrica',
          status: options?.status ?? 'unsubscribed',
        });
        toastSuccess(
          result.status === 'blocked' ? 'Contatto bloccato.' : 'Contatto disiscritto.',
          result.blocklistedOnBrevo
            ? `${result.email} è stato aggiunto anche alla blocklist Brevo.`
            : result.email,
        );
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile disiscrivere il contatto.');
        return false;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  /**
   * Disiscrizione di gruppo: le chiamate sono sequenziali di proposito.
   * Ogni disiscrizione tocca anche Brevo, e mandare decine di richieste in
   * parallelo farebbe scattare il rate limit dell'API.
   */
  const unsubscribeMany = React.useCallback(
    async (contacts: Array<Pick<Contact, 'id' | 'email'>>): Promise<number> => {
      if (contacts.length === 0) return 0;
      setPending('unsubscribe-many');
      let done = 0;
      const failures: string[] = [];
      try {
        for (const contact of contacts) {
          try {
            await unsubscribeContact({
              contactId: contact.id,
              reason: 'Disiscrizione di gruppo dalla rubrica',
              status: 'unsubscribed',
            });
            done += 1;
          } catch {
            failures.push(contact.email);
          }
        }
        if (done > 0) {
          toastSuccess(
            done === 1 ? 'Contatto disiscritto.' : `${formatNumber(done)} contatti disiscritti.`,
          );
        }
        if (failures.length > 0) {
          toastWarning(
            `${formatNumber(failures.length)} disiscrizioni non riuscite`,
            failures.slice(0, 5).join(', '),
          );
        }
        invalidate();
        return done;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  const remove = React.useCallback(
    async (contact: Pick<Contact, 'id' | 'email'>, deleteOnBrevo: boolean): Promise<boolean> => {
      setPending(`delete:${contact.id}`);
      try {
        const result = await deleteContact({ contactId: contact.id, deleteOnBrevo });
        toastSuccess(
          'Contatto eliminato.',
          result.deletedOnBrevo ? `${result.email} è stato rimosso anche da Brevo.` : result.email,
        );
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile eliminare il contatto.');
        return false;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  /**
   * Aggiunge contatti a un cluster statico.
   *
   * Il backend non espone una callable dedicata: l'appartenenza statica vive
   * dentro il documento del cluster, quindi si passa da `saveCluster` unendo
   * gli id già presenti con quelli nuovi. Il cluster arriva già caricato dal
   * chiamante, così non si perde nessun campo nel salvataggio.
   */
  const addToCluster = React.useCallback(
    async (cluster: Cluster, contactIds: string[]): Promise<boolean> => {
      if (contactIds.length === 0) return false;
      setPending(`cluster:${cluster.id}`);
      try {
        const merged = Array.from(new Set([...(cluster.contactIds ?? []), ...contactIds]));
        const added = merged.length - (cluster.contactIds?.length ?? 0);

        await saveCluster({
          id: cluster.id,
          name: cluster.name,
          description: cluster.description ?? null,
          type: 'static',
          color: cluster.color,
          icon: cluster.icon ?? null,
          contactIds: merged,
          rules: null,
          siteGroupName: null,
          brevoListId: cluster.brevoListId ?? null,
          autoRefresh: cluster.autoRefresh,
          syncToBrevo: cluster.syncToBrevo,
          recompute: true,
        });

        toastSuccess(
          added === 0
            ? 'I contatti scelti erano già tutti nel cluster.'
            : added === 1
              ? `Contatto aggiunto a “${cluster.name}”.`
              : `${formatNumber(added)} contatti aggiunti a “${cluster.name}”.`,
        );
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile aggiungere i contatti al cluster.');
        return false;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  const exportCsv = React.useCallback(async (input: ExportContactsInput): Promise<string | null> => {
    setPending('export');
    try {
      const result = await exportContacts(input);
      toastSuccess(
        `Esportati ${formatNumber(result.rows)} contatti.`,
        'Il link di scaricamento resta valido per un’ora.',
      );
      return result.url;
    } catch (error) {
      toastError(error, 'Esportazione non riuscita.');
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  const sync = React.useCallback(
    async (input: RunSyncInput): Promise<boolean> => {
      setPending('sync');
      try {
        const result = await runSiteSync(input);
        const customers = result.counts.customers;
        const detail = customers
          ? `${formatNumber(customers.created)} nuovi, ${formatNumber(customers.updated)} aggiornati`
          : `stato: ${result.status}`;

        if (result.status === 'failed') {
          toastError(new Error(result.error ?? 'Sincronizzazione fallita.'));
          return false;
        }
        toastSuccess('Sincronizzazione completata.', detail);
        if (result.warnings.length > 0) {
          toastWarning('Avvisi dalla sincronizzazione', result.warnings.slice(0, 3).join(' · '));
        }
        if (result.resumeRequired) {
          toastInfo(
            'Sincronizzazione parziale',
            'I dati residui verranno recuperati dal job automatico.',
          );
        }
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile avviare la sincronizzazione.');
        return false;
      } finally {
        setPending(null);
      }
    },
    [invalidate],
  );

  const openDetail = React.useCallback(
    (contactId: string) => router.push(ROUTES.detail(contactId)),
    [router],
  );

  return {
    pending,
    save,
    unsubscribe,
    unsubscribeMany,
    remove,
    addToCluster,
    exportCsv,
    sync,
    openDetail,
  };
}
