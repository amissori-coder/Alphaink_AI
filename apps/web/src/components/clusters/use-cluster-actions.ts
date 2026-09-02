'use client';

import type { Cluster } from '@alphaink/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { toastError, toastSuccess, toastWarning } from '@/lib/toast';
import { formatNumber } from '@/lib/utils';

import { deleteCluster, recomputeCluster, saveCluster } from './api';
import { ROUTES } from './constants';
import type { SaveClusterInput } from './types';

/**
 * Azioni sui cluster condivise fra elenco e scheda di modifica.
 *
 * Ogni azione segnala l'esito con un toast e tiene traccia del cluster su cui
 * sta lavorando (`pendingId`), così la UI può disabilitare i comandi della
 * singola scheda senza bloccare l'intera pagina.
 */
export interface ClusterActions {
  pendingId: string | null;
  /** True mentre è in corso un salvataggio. */
  saving: boolean;
  save: (input: SaveClusterInput) => Promise<Cluster | null>;
  duplicate: (cluster: Cluster) => Promise<Cluster | null>;
  recompute: (cluster: Cluster) => Promise<boolean>;
  remove: (cluster: Cluster, force?: boolean) => Promise<boolean>;
  toggleBrevoSync: (cluster: Cluster, next: boolean) => Promise<boolean>;
  openDetail: (clusterId: string) => void;
  useInNewsletter: (clusterId: string) => void;
}

/** Riporta le regole nella forma accettata dalla callable. */
function toSavePayload(cluster: Cluster, overrides: Partial<SaveClusterInput>): SaveClusterInput {
  return {
    id: cluster.id,
    name: cluster.name,
    description: cluster.description ?? null,
    type: cluster.type,
    color: cluster.color,
    icon: cluster.icon ?? null,
    rules: cluster.type === 'dynamic' ? (cluster.rules ?? null) : null,
    contactIds: cluster.type === 'static' ? (cluster.contactIds ?? []) : [],
    siteGroupName: cluster.siteGroupName ?? null,
    brevoListId: cluster.brevoListId ?? null,
    autoRefresh: cluster.autoRefresh,
    syncToBrevo: cluster.syncToBrevo,
    ...overrides,
  };
}

/** Mostra gli avvisi restituiti dal backend, uno per riga. */
function reportWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  toastWarning(
    warnings.length === 1 ? 'Attenzione' : `${warnings.length} avvisi dal ricalcolo`,
    warnings.join(' · '),
  );
}

export function useClusterActions(): ClusterActions {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['firestore'] });
  }, [queryClient]);

  const save = React.useCallback(
    async (input: SaveClusterInput): Promise<Cluster | null> => {
      setSaving(true);
      setPendingId(input.id ?? null);
      try {
        const result = await saveCluster(input);
        const counted = result.recompute
          ? `${formatNumber(result.recompute.contactCount)} contatti, ${formatNumber(
              result.recompute.sendableCount,
            )} contattabili`
          : 'ricalcolo rimandato al job automatico';
        toastSuccess(
          input.id ? 'Cluster aggiornato.' : 'Cluster creato.',
          `${result.cluster.name}: ${counted}.`,
        );
        reportWarnings(result.warnings);
        invalidate();
        return result.cluster;
      } catch (error) {
        toastError(error, 'Impossibile salvare il cluster.');
        return null;
      } finally {
        setSaving(false);
        setPendingId(null);
      }
    },
    [invalidate],
  );

  const duplicate = React.useCallback(
    async (cluster: Cluster): Promise<Cluster | null> => {
      setPendingId(cluster.id);
      try {
        const payload = toSavePayload(cluster, {
          id: undefined,
          name: `${cluster.name} (copia)`,
          // Una copia non deve rispecchiarsi sulla stessa lista Brevo dell'originale.
          syncToBrevo: false,
          brevoListId: null,
        });
        const result = await saveCluster(payload);
        toastSuccess('Cluster duplicato.', result.cluster.name);
        reportWarnings(result.warnings);
        invalidate();
        return result.cluster;
      } catch (error) {
        toastError(error, 'Impossibile duplicare il cluster.');
        return null;
      } finally {
        setPendingId(null);
      }
    },
    [invalidate],
  );

  const recompute = React.useCallback(
    async (cluster: Cluster): Promise<boolean> => {
      setPendingId(cluster.id);
      try {
        const result = await recomputeCluster({ clusterId: cluster.id });
        toastSuccess(
          `“${result.name}” ricalcolato.`,
          `${formatNumber(result.contactCount)} contatti (${formatNumber(
            result.sendableCount,
          )} contattabili) · +${formatNumber(result.added)} / −${formatNumber(result.removed)}`,
        );
        reportWarnings(result.warnings);
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Ricalcolo del cluster non riuscito.');
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [invalidate],
  );

  const remove = React.useCallback(
    async (cluster: Cluster, force = false): Promise<boolean> => {
      setPendingId(cluster.id);
      try {
        const result = await deleteCluster({ clusterId: cluster.id, force });
        toastSuccess(
          'Cluster eliminato.',
          result.detachedContacts > 0
            ? `${formatNumber(result.detachedContacts)} contatti non vi appartengono più.`
            : undefined,
        );
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile eliminare il cluster.');
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [invalidate],
  );

  const toggleBrevoSync = React.useCallback(
    async (cluster: Cluster, next: boolean): Promise<boolean> => {
      setPendingId(cluster.id);
      try {
        // Il ricalcolo non serve: cambia solo la destinazione della sincronizzazione.
        await saveCluster(toSavePayload(cluster, { syncToBrevo: next, recompute: false }));
        toastSuccess(
          next
            ? 'Il cluster verrà sincronizzato come lista Brevo.'
            : 'Sincronizzazione su Brevo disattivata.',
        );
        invalidate();
        return true;
      } catch (error) {
        toastError(error, 'Impossibile cambiare la sincronizzazione su Brevo.');
        return false;
      } finally {
        setPendingId(null);
      }
    },
    [invalidate],
  );

  const openDetail = React.useCallback(
    (clusterId: string) => router.push(ROUTES.detail(clusterId)),
    [router],
  );

  const useInNewsletter = React.useCallback(
    (clusterId: string) => router.push(`${ROUTES.newsletterCreate}?cluster=${clusterId}`),
    [router],
  );

  return {
    pendingId,
    saving,
    save,
    duplicate,
    recompute,
    remove,
    toggleBrevoSync,
    openDetail,
    useInNewsletter,
  };
}
