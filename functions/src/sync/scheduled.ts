/**
 * Sincronizzazione automatica oraria dei due negozi.
 *
 * Gira in modo incrementale (riparte da `lastSyncAt` di ciascun negozio) e
 * tratta i due negozi come job indipendenti eseguiti uno dopo l'altro: se il
 * B2C fallisce, il B2B viene sincronizzato lo stesso.
 *
 * Il budget di tempo complessivo è diviso fra i negozi ancora da fare. Quando
 * un negozio esaurisce il suo budget il job si chiude in `partial` salvando il
 * cursore: la corsa dell'ora successiva riprende da lì, quindi anche un
 * backfill di centinaia di migliaia di ordini si completa in più passaggi
 * senza intervento manuale.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { STORE_SOURCES, SYNC_ENTITIES } from '@alphaink/shared';
import type { StoreSource, SyncEntity } from '@alphaink/shared';
import { HEAVY_RUNTIME, STORE_SECRETS, TIMEZONE } from '../lib/config';
import { createLogger } from '../lib/logger';
import { DEFAULT_ENTITIES, runSync } from './orchestrator';
import { readSiteSettings } from './settings';

const log = createLogger('sync.scheduled');

/** Budget complessivo della corsa: sotto il timeout, con margine di chiusura. */
const TOTAL_BUDGET_MS = 460_000;

/** Sotto questa soglia non vale la pena avviare un altro negozio. */
const MIN_STORE_BUDGET_MS = 45_000;

export const scheduledSiteSync = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: TIMEZONE,
    ...HEAVY_RUNTIME,
    secrets: STORE_SECRETS,
    retryCount: 0,
  },
  async () => {
    const settings = await readSiteSettings();
    if (!settings.syncSchedule?.enabled) {
      log.info('Sincronizzazione automatica disattivata: nessuna azione.');
      return;
    }

    const configured = (settings.syncSchedule.entities ?? []).filter((entity): entity is SyncEntity =>
      SYNC_ENTITIES.includes(entity as SyncEntity),
    );
    const entities = configured.length > 0 ? configured : DEFAULT_ENTITIES;

    const stores: StoreSource[] = STORE_SOURCES.filter((source) => settings.stores?.[source]?.enabled);
    if (stores.length === 0) {
      log.warn('Nessun negozio abilitato: sincronizzazione saltata.');
      return;
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let remaining = stores.length;

    for (const source of stores) {
      const available = deadline - Date.now();
      if (available < MIN_STORE_BUDGET_MS) {
        log.warn('Budget di tempo esaurito: negozio rimandato alla corsa successiva', { source });
        break;
      }
      // Il tempo residuo si divide fra i negozi ancora da fare, così il primo
      // non consuma tutto il budget lasciando l'altro senza.
      const budget = Math.floor(available / remaining);
      remaining -= 1;

      try {
        const result = await runSync({
          source,
          entities,
          trigger: 'schedule',
          requestedBy: null,
          timeBudgetMs: budget,
        });
        log.info('Sincronizzazione programmata conclusa', {
          source,
          status: result.status,
          durationMs: result.durationMs,
          resumeRequired: result.resumeRequired,
        });
      } catch (error) {
        // Un negozio che fallisce non deve impedire la sincronizzazione dell'altro.
        log.error('Sincronizzazione programmata fallita', error, { source });
      }
    }
  },
);
