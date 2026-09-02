/**
 * Callable della sincronizzazione sito.
 *
 * - `runSiteSync`      → avvia un job per un negozio (permesso `sync:run`)
 * - `cancelSiteSync`   → chiede l'annullamento di un job in corso
 * - `saveSiteSettings` → salva `settings/site` (permesso `settings:write`)
 *
 * Le credenziali dei negozi passano da qui una sola volta: vengono validate,
 * scritte in Secret Manager e MAI salvate su Firestore.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { STORE_SOURCES, syncRequestSchema } from '@alphaink/shared';
import type { OrderStatus, SiteSettings, StoreSource, SyncEntity } from '@alphaink/shared';
import { requirePermission } from '../lib/auth';
import { HEAVY_RUNTIME, LIGHT_RUNTIME, STORE_SECRETS, storeParams } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import { logActivity } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { PrestaShopMysqlBackend } from './prestashop-mysql';
import { PrestaShopWebserviceBackend } from './prestashop-webservice';
import { getAdapter } from './prestashop';
import { requestSyncCancel, runSync } from './orchestrator';
import type { RunSyncResult } from './orchestrator';
import {
  readSiteSettings,
  storeSecretName,
  storeStoreSecret,
  writeSiteSettings,
} from './settings';
import type { SiteSettingsPatch } from './settings';
import type { ConnectionCheck } from './types';

const log = createLogger('sync.callables');

/** Runtime pesante + accesso ai segreti dei due negozi. */
const SYNC_OPTIONS = { ...HEAVY_RUNTIME, secrets: STORE_SECRETS };

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw invalidArgument('Dati non validi.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data as z.infer<S>;
}

/** Converte qualunque errore nella forma attesa dal client Firebase. */
async function guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`Callable ${operation} fallita`, error);
    throw toHttpsError(error);
  }
}

// -----------------------------------------------------------------------------
// runSiteSync
// -----------------------------------------------------------------------------

export const runSiteSync = onCall(
  SYNC_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<RunSyncResult> =>
    guard('runSiteSync', async () => {
      const caller = requirePermission(request, 'sync:run');
      const input = parseInput(syncRequestSchema, request.data);

      return runSync({
        source: input.source,
        entities: input.entities as SyncEntity[],
        since: input.since ?? null,
        fullResync: input.fullResync,
        requestedBy: caller.uid,
        trigger: input.fullResync ? 'backfill' : 'manual',
      });
    }),
);

// -----------------------------------------------------------------------------
// cancelSiteSync
// -----------------------------------------------------------------------------

const cancelSyncSchema = z.object({ jobId: z.string().min(1) });

export const cancelSiteSync = onCall(
  LIGHT_RUNTIME,
  async (request: CallableRequest<unknown>): Promise<{ jobId: string; cancelRequested: true }> =>
    guard('cancelSiteSync', async () => {
      const caller = requirePermission(request, 'sync:run');
      const { jobId } = parseInput(cancelSyncSchema, request.data);

      await requestSyncCancel(jobId, caller.uid);
      await logActivity({
        action: 'sync.cancel',
        entityType: 'syncJob',
        entityId: jobId,
        userId: caller.uid,
        summary: 'Annullamento della sincronizzazione richiesto.',
        severity: 'warning',
      });
      return { jobId, cancelRequested: true };
    }),
);

// -----------------------------------------------------------------------------
// saveSiteSettings
// -----------------------------------------------------------------------------

const ORDER_STATUS_VALUES = [
  'pending',
  'processing',
  'awaiting_payment',
  'paid',
  'shipped',
  'completed',
  'cancelled',
  'refunded',
  'failed',
] as const satisfies readonly OrderStatus[];

const SYNC_ENTITY_VALUES = [
  'customers',
  'orders',
  'carts',
  'products',
  'categories',
  'coupons',
  'customer_groups',
] as const satisfies readonly SyncEntity[];

const storeInputSchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().min(1).max(120).optional(),
  baseUrl: z.string().url('Indica un URL completo, es. https://alphaink.net').optional(),
  mode: z.enum(['webservice', 'mysql']).optional(),
  /** `null` = installazione dedicata, numero = shop di un'installazione multistore. */
  multistoreShopId: z.number().int().positive().nullable().optional(),
  tablePrefix: z
    .string()
    .regex(/^[A-Za-z0-9_]{0,16}$/, 'Il prefisso può contenere solo lettere, cifre e underscore (max 16).')
    .optional(),
  defaultSegment: z.enum(['b2c', 'b2b']).optional(),
  customerGroupMapping: z.record(z.enum(['b2c', 'b2b'])).optional(),
  orderStateMapping: z.record(z.enum(ORDER_STATUS_VALUES)).optional(),
  languageId: z.number().int().positive().max(999).optional(),
  /** Credenziali: validate, salvate in Secret Manager, mai su Firestore. */
  wsKey: z.string().min(8).max(200).optional(),
  dbPassword: z.string().min(1).max(500).optional(),
});

const familyRuleSchema = z.object({
  id: z.string().min(1),
  family: z.string().min(1),
  categoryPatterns: z.array(z.string()).default([]),
  skuPatterns: z.array(z.string()).default([]),
  namePatterns: z.array(z.string()).default([]),
  priority: z.number().int().min(0).max(1000),
});

const siteSettingsInputSchema = z.object({
  stores: z.record(z.enum(['prestashop_b2c', 'prestashop_b2b']), storeInputSchema).optional(),
  syncSchedule: z
    .object({
      enabled: z.boolean(),
      cron: z.string().min(1),
      timezone: z.string().min(1),
      entities: z.array(z.enum(SYNC_ENTITY_VALUES)).min(1),
    })
    .partial()
    .optional(),
  familyRules: z.array(familyRuleSchema).max(100).optional(),
  repurchaseCycleDays: z.record(z.number().int().min(1).max(3650)).optional(),
  abandonedPaymentAfterMinutes: z.number().int().min(5).max(10_080).optional(),
  abandonedCartAfterMinutes: z.number().int().min(5).max(10_080).optional(),
  defaultSource: z.enum(['prestashop_b2c', 'prestashop_b2b']).optional(),
  /** Verifica la connessione dei negozi toccati prima di rispondere. */
  testConnection: z.boolean().default(false),
});

export interface SaveSiteSettingsResult {
  settings: SiteSettings;
  /** Esito della verifica di connessione, per negozio. */
  checks: Partial<Record<StoreSource, ConnectionCheck>>;
  /** Segreti effettivamente scritti in Secret Manager. */
  secretsStored: string[];
  /** Avvisi da mostrare all'operatore. */
  warnings: string[];
}

export const saveSiteSettings = onCall(
  SYNC_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<SaveSiteSettingsResult> =>
    guard('saveSiteSettings', async () => {
      const caller = requirePermission(request, 'settings:write');
      const input = parseInput(siteSettingsInputSchema, request.data);
      const current = await readSiteSettings();

      const warnings: string[] = [];
      const secretsStored: string[] = [];
      const checks: Partial<Record<StoreSource, ConnectionCheck>> = {};
      const patch: SiteSettingsPatch = {
        syncSchedule: input.syncSchedule,
        familyRules: input.familyRules,
        repurchaseCycleDays: input.repurchaseCycleDays,
        abandonedPaymentAfterMinutes: input.abandonedPaymentAfterMinutes,
        abandonedCartAfterMinutes: input.abandonedCartAfterMinutes,
        defaultSource: input.defaultSource,
        stores: {},
      };

      for (const source of STORE_SOURCES) {
        const storeInput = input.stores?.[source];
        if (!storeInput) continue;
        const { wsKey, dbPassword, ...safe } = storeInput;
        const merged = { ...current.stores[source], ...safe };

        // Le credenziali vengono provate prima di essere salvate: meglio un
        // errore immediato che una configurazione inutilizzabile.
        if (input.testConnection) {
          checks[source] = await checkStore(merged, { wsKey, dbPassword });
          if (!checks[source]?.ok) {
            warnings.push(`${merged.label}: ${checks[source]?.message ?? 'verifica non riuscita.'}`);
          }
        }

        let credentialsConfigured = current.stores[source].credentialsConfigured;
        if (wsKey) {
          const name = storeSecretName(source, 'ws');
          const result = await storeStoreSecret(name, wsKey);
          if (result.stored) {
            secretsStored.push(name);
            credentialsConfigured = true;
          } else {
            warnings.push(`${merged.label}: ${result.reason ?? 'chiave Webservice non salvata.'}`);
          }
        }
        if (dbPassword) {
          const name = storeSecretName(source, 'db');
          const result = await storeStoreSecret(name, dbPassword);
          if (result.stored) {
            secretsStored.push(name);
            credentialsConfigured = true;
          } else {
            warnings.push(`${merged.label}: ${result.reason ?? 'password del database non salvata.'}`);
          }
        }

        patch.stores = { ...patch.stores, [source]: { ...safe, credentialsConfigured } };
      }

      if (secretsStored.length > 0) {
        // I segreti sono letti all'avvio dell'istanza: quelle già in esecuzione
        // continuano a usare il valore precedente.
        warnings.push(
          'Le nuove credenziali entrano in servizio entro pochi minuti, quando le istanze delle funzioni ' +
            'vengono rinnovate.',
        );
      }

      const settings = await writeSiteSettings(patch, caller.uid);

      await logActivity({
        action: 'settings.site.save',
        entityType: 'settings',
        entityId: 'site',
        userId: caller.uid,
        summary: 'Impostazioni sito aggiornate.',
        metadata: {
          stores: Object.keys(input.stores ?? {}),
          secretsStored,
          checks: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value?.ok ?? false])),
        },
      });

      return { settings, checks, secretsStored, warnings };
    }),
);

/**
 * Verifica la raggiungibilità di un negozio.
 *
 * Se l'operatore ha appena inserito una credenziale, la prova viene fatta con
 * QUELLA credenziale: il secret appena scritto non è ancora visibile
 * all'istanza in esecuzione, quindi usarlo darebbe un falso negativo.
 */
async function checkStore(
  store: SiteSettings['stores'][StoreSource],
  credentials: { wsKey?: string; dbPassword?: string },
): Promise<ConnectionCheck> {
  const params = storeParams(store.source);
  try {
    if (store.mode === 'mysql') {
      const password = credentials.dbPassword ?? safeValue(() => params.dbPassword.value());
      if (!password) {
        return {
          ok: false,
          mode: 'mysql',
          message: 'Password del database non configurata: inseriscila per verificare la connessione.',
        };
      }
      const backend = new PrestaShopMysqlBackend({
        source: store.source,
        host: safeValue(() => params.dbHost.value()),
        port: Number.parseInt(safeValue(() => params.dbPort.value()) || '3306', 10) || 3306,
        user: safeValue(() => params.dbUser.value()),
        password,
        database: safeValue(() => params.dbName.value()),
        tablePrefix: store.tablePrefix || 'ps_',
        languageId: store.languageId,
        multistoreShopId: store.multistoreShopId,
      });
      try {
        return await backend.ping();
      } finally {
        await backend.close();
      }
    }

    const wsKey = credentials.wsKey ?? safeValue(() => params.wsKey.value());
    if (!wsKey) {
      return {
        ok: false,
        mode: 'webservice',
        message: 'Chiave Webservice non configurata: inseriscila per verificare la connessione.',
      };
    }
    const backend = new PrestaShopWebserviceBackend({
      source: store.source,
      baseUrl: store.baseUrl || safeValue(() => params.baseUrl.value()),
      wsKey,
      languageId: store.languageId,
      multistoreShopId: store.multistoreShopId,
    });
    return await backend.ping();
  } catch (error) {
    return {
      ok: false,
      mode: store.mode,
      message: `Verifica non riuscita: ${(error as Error).message}`,
    };
  }
}

/** Legge un parametro senza far fallire la callable quando non è dichiarato. */
function safeValue(read: () => string): string {
  try {
    return (read() ?? '').trim();
  } catch {
    return '';
  }
}

/** Esposta per i test manuali dalla console: verifica un negozio già configurato. */
export async function testStoreConnection(source: StoreSource): Promise<ConnectionCheck> {
  const settings = await readSiteSettings();
  const adapter = getAdapter(source, settings);
  try {
    return await adapter.testConnection();
  } finally {
    await adapter.close();
  }
}
