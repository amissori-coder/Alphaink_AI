/**
 * Ricalcolo periodico dei cluster.
 *
 * Ogni 6 ore vengono ricalcolati i cluster con `autoRefresh` attivo, partendo
 * dai più stantii (`lastComputedAt` crescente). Il job lavora a budget di tempo:
 * se lo esaurisce si ferma e riprende dal punto giusto alla corsa successiva,
 * perché l'ordinamento per data di ultimo calcolo mette in testa proprio quelli
 * rimasti indietro.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Cluster } from '@alphaink/shared';
import { BREVO_API_KEY, HEAVY_RUNTIME, TIMEZONE } from '../lib/config';
import { col, logActivity, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { readApiKeyFromSecret } from '../brevo/settings';
import { syncClusterToBrevoList } from './brevo-lists';
import { recomputeCluster } from './engine';

const log = createLogger('clusters.scheduled');

/** Tempo massimo di lavoro: lascia margine sul timeout di 540 s della funzione. */
export const REFRESH_TIME_BUDGET_MS = 7 * 60 * 1000;

/** Cluster esaminati al massimo in una corsa. */
export const REFRESH_MAX_CLUSTERS = 200;

export interface ClusterRefreshSummary {
  processed: number;
  succeeded: number;
  failed: number;
  brevoSynced: number;
  exhaustedBudget: boolean;
  durationMs: number;
}

/** Cluster candidati al ricalcolo, i più stantii per primi. */
async function staleClusters(limit: number): Promise<Cluster[]> {
  const snapshot = await col
    .clusters()
    .where('archived', '==', false)
    .where('autoRefresh', '==', true)
    .orderBy('lastComputedAt', 'asc')
    .limit(limit)
    .get();
  return snapshot.docs.map((doc) => withId<Cluster>(doc));
}

/** Corpo del job, isolato per poter essere richiamato dai test e dalla shell. */
export async function runClusterRefresh(
  options: { budgetMs?: number; maxClusters?: number } = {},
): Promise<ClusterRefreshSummary> {
  const startedAt = Date.now();
  const budget = options.budgetMs ?? REFRESH_TIME_BUDGET_MS;
  const maxClusters = options.maxClusters ?? REFRESH_MAX_CLUSTERS;

  const clusters = await staleClusters(maxClusters);
  const apiKey = readApiKeyFromSecret();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let brevoSynced = 0;
  let exhaustedBudget = false;

  for (const cluster of clusters) {
    if (Date.now() - startedAt > budget) {
      exhaustedBudget = true;
      log.warn('Budget di tempo esaurito: il ricalcolo riprenderà alla prossima corsa', {
        processed,
        remaining: clusters.length - processed,
      });
      break;
    }

    processed += 1;
    try {
      const result = await recomputeCluster(cluster.id);
      succeeded += 1;

      if (cluster.syncToBrevo && apiKey) {
        try {
          const fresh = withId<Cluster>(await col.clusters().doc(cluster.id).get());
          await syncClusterToBrevoList(fresh, apiKey);
          brevoSynced += 1;
        } catch (error) {
          // Un problema su Brevo non deve invalidare il ricalcolo appena riuscito.
          log.error('Sincronizzazione Brevo del cluster fallita', error, { clusterId: cluster.id });
        }
      }

      log.debug('Cluster aggiornato dal job', {
        clusterId: cluster.id,
        contactCount: result.contactCount,
        durationMs: result.durationMs,
      });
    } catch (error) {
      failed += 1;
      log.error('Ricalcolo automatico del cluster fallito', error, { clusterId: cluster.id });
    }
  }

  const summary: ClusterRefreshSummary = {
    processed,
    succeeded,
    failed,
    brevoSynced,
    exhaustedBudget,
    durationMs: Date.now() - startedAt,
  };

  if (processed > 0) {
    await logActivity({
      action: 'cluster.refresh',
      entityType: 'cluster',
      userId: null,
      summary: `Ricalcolo automatico: ${succeeded} cluster aggiornati, ${failed} in errore`,
      metadata: { ...summary },
      severity: failed > 0 ? 'warning' : 'info',
    });
  }

  log.info('Ricalcolo periodico dei cluster completato', { ...summary });
  return summary;
}

export const scheduledClusterRefresh = onSchedule(
  {
    ...HEAVY_RUNTIME,
    schedule: 'every 6 hours',
    timeZone: TIMEZONE,
    secrets: [BREVO_API_KEY],
    retryCount: 0,
  },
  async () => {
    await runClusterRefresh();
  },
);
