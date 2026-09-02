/**
 * Lettura e scrittura del documento `settings/site`.
 *
 * Il documento parte sempre da `DEFAULT_SITE_SETTINGS`: le installazioni nuove
 * funzionano senza configurazione manuale e i campi aggiunti in futuro
 * compaiono con il loro default anche sui documenti già salvati.
 *
 * REGOLA NON NEGOZIABILE: le credenziali dei negozi (chiave Webservice,
 * password MySQL) non finiscono MAI su Firestore. Su `settings/site` resta solo
 * `credentialsConfigured`; il valore vero vive in Secret Manager e viene letto
 * a runtime dai parametri dichiarati in `lib/config`.
 */

import {
  DEFAULT_FAMILY_RULES,
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  DEFAULT_SITE_SETTINGS,
  STORE_SOURCES,
  defaultStoreSettings,
} from '@alphaink/shared';
import type {
  FamilyRule,
  IsoDate,
  PrestaShopStoreSettings,
  SettingsDocId,
  SiteSettings,
  StoreSource,
} from '@alphaink/shared';
import { AppError } from '../lib/errors';
import { auditCreate, auditUpdate, col, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('sync.settings');

/** Id del documento impostazioni sito. */
export const SITE_SETTINGS_DOC: SettingsDocId = 'site';

/** Impostazioni iniziali, usate finché l'operatore non salva le proprie. */
export function defaultSiteSettings(): SiteSettings {
  const now = nowIso();
  return {
    ...DEFAULT_SITE_SETTINGS,
    stores: {
      prestashop_b2c: defaultStoreSettings('prestashop_b2c'),
      prestashop_b2b: defaultStoreSettings('prestashop_b2b'),
    },
    familyRules: [...DEFAULT_FAMILY_RULES],
    repurchaseCycleDays: { ...DEFAULT_REPURCHASE_CYCLE_DAYS },
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

/** Patch accettato da `writeSiteSettings`: parziale a ogni livello utile. */
export interface SiteSettingsPatch {
  stores?: Partial<Record<StoreSource, Partial<PrestaShopStoreSettings>>>;
  syncSchedule?: Partial<SiteSettings['syncSchedule']>;
  familyRules?: FamilyRule[];
  repurchaseCycleDays?: Record<string, number>;
  abandonedPaymentAfterMinutes?: number;
  abandonedCartAfterMinutes?: number;
  webhookSecretConfigured?: boolean;
  defaultSource?: StoreSource;
}

/** Legge `settings/site`, completando i campi mancanti con i default. */
export async function readSiteSettings(): Promise<SiteSettings> {
  const snapshot = await col.settings().doc(SITE_SETTINGS_DOC).get();
  const defaults = defaultSiteSettings();
  if (!snapshot.exists) return defaults;

  const stored = serializeDoc<Partial<SiteSettings>>(snapshot.data() ?? {});
  const stores = {} as Record<StoreSource, PrestaShopStoreSettings>;
  for (const source of STORE_SOURCES) {
    stores[source] = {
      ...defaults.stores[source],
      ...(stored.stores?.[source] ?? {}),
      // `source` non è modificabile: è la chiave della mappa.
      source,
      orderStateMapping: {
        ...defaults.stores[source].orderStateMapping,
        ...(stored.stores?.[source]?.orderStateMapping ?? {}),
      },
      customerGroupMapping: {
        ...defaults.stores[source].customerGroupMapping,
        ...(stored.stores?.[source]?.customerGroupMapping ?? {}),
      },
    };
  }

  return {
    ...defaults,
    ...stored,
    stores,
    syncSchedule: { ...defaults.syncSchedule, ...(stored.syncSchedule ?? {}) },
    familyRules: stored.familyRules?.length ? stored.familyRules : defaults.familyRules,
    repurchaseCycleDays: { ...defaults.repurchaseCycleDays, ...(stored.repurchaseCycleDays ?? {}) },
  };
}

/**
 * Aggiorna `settings/site` fondendo il patch sulle impostazioni correnti.
 * Eventuali credenziali passate per errore nel patch vengono scartate.
 */
export async function writeSiteSettings(
  patch: SiteSettingsPatch & { wsKey?: unknown; dbPassword?: unknown },
  uid?: string | null,
): Promise<SiteSettings> {
  const { wsKey, dbPassword, ...safe } = patch;
  if (wsKey !== undefined || dbPassword !== undefined) {
    log.warn('Tentativo di salvare credenziali su Firestore: ignorato.');
  }

  const ref = col.settings().doc(SITE_SETTINGS_DOC);
  const snapshot = await ref.get();
  const current = await readSiteSettings();

  const stores = { ...current.stores };
  for (const source of STORE_SOURCES) {
    const storePatch = safe.stores?.[source];
    if (!storePatch) continue;
    stores[source] = {
      ...stores[source],
      ...storePatch,
      source,
      orderStateMapping: storePatch.orderStateMapping ?? stores[source].orderStateMapping,
      customerGroupMapping: storePatch.customerGroupMapping ?? stores[source].customerGroupMapping,
    };
  }

  const merged: SiteSettings = {
    ...current,
    ...safe,
    stores,
    syncSchedule: { ...current.syncSchedule, ...(safe.syncSchedule ?? {}) },
    repurchaseCycleDays: { ...current.repurchaseCycleDays, ...(safe.repurchaseCycleDays ?? {}) },
    ...(snapshot.exists ? auditUpdate(uid) : auditCreate(uid)),
  };

  await ref.set(merged, { merge: true });
  return merged;
}

/** Impostazioni di un singolo negozio. */
export async function getStoreSettings(source: StoreSource): Promise<PrestaShopStoreSettings> {
  const settings = await readSiteSettings();
  const store = settings.stores?.[source];
  if (!store) {
    throw new AppError('not_found', `Configurazione mancante per il negozio ${source}.`);
  }
  return store;
}

/** Aggiorna le impostazioni di un solo negozio. */
export async function updateStoreSettings(
  source: StoreSource,
  patch: Partial<PrestaShopStoreSettings>,
  uid?: string | null,
): Promise<PrestaShopStoreSettings> {
  const settings = await writeSiteSettings({ stores: { [source]: patch } }, uid);
  return settings.stores[source];
}

/**
 * Registra l'esito di una sincronizzazione sul negozio.
 * Scrive per campo, senza rileggere l'intero documento: è chiamata alla fine di
 * ogni job e non deve entrare in conflitto con le modifiche fatte dalla UI.
 */
export async function markStoreSync(
  source: StoreSource,
  outcome: { at?: IsoDate | null; error?: string | null },
): Promise<void> {
  // `lastSyncAt` si scrive solo se indicato: dopo un fallimento deve restare
  // quello vecchio, altrimenti la corsa successiva salterebbe tutti i record
  // modificati nel frattempo.
  const store: Record<string, unknown> = { lastSyncError: outcome.error ?? null };
  if (outcome.at !== undefined) store.lastSyncAt = outcome.at;

  await col.settings().doc(SITE_SETTINGS_DOC).set(
    { stores: { [source]: store }, updatedAt: nowIso() },
    { merge: true },
  );
}

// -----------------------------------------------------------------------------
// Credenziali in Secret Manager
// -----------------------------------------------------------------------------

/** Nome del secret che custodisce una credenziale del negozio. */
export function storeSecretName(source: StoreSource, kind: 'ws' | 'db'): string {
  const prefix = source === 'prestashop_b2b' ? 'PRESTASHOP_B2B' : 'PRESTASHOP_B2C';
  return kind === 'ws' ? `${prefix}_WS_KEY` : `${prefix}_DB_PASSWORD`;
}

export interface StoreSecretResult {
  stored: boolean;
  /** Motivo del mancato salvataggio, già in italiano e mostrabile in UI. */
  reason?: string;
}

/** Progetto Google Cloud corrente, dedotto dall'ambiente di esecuzione. */
function gcpProjectId(): string | null {
  const direct = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? process.env.PROJECT_ID;
  if (direct) return direct;
  try {
    const config = process.env.FIREBASE_CONFIG;
    if (!config) return null;
    return (JSON.parse(config) as { projectId?: string }).projectId ?? null;
  } catch {
    return null;
  }
}

/** Token del service account della funzione, letto dal metadata server. */
async function metadataAccessToken(): Promise<string | null> {
  const host = process.env.GCE_METADATA_HOST ?? 'metadata.google.internal';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `http://${host}/computeMetadata/v1/instance/service-accounts/default/token`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: controller.signal },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    // Fuori da Google Cloud (emulatore, test locali) il metadata server non esiste.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Salva una credenziale come nuova versione del secret indicato.
 *
 * Usa l'API REST di Secret Manager con il token del service account: evita di
 * aggiungere una dipendenza npm. Se il permesso `secretmanager.versions.add`
 * manca (frequente sui progetti appena creati) non solleva errore, ma
 * restituisce il motivo, così la UI può suggerire il comando manuale.
 *
 * Nota operativa: le istanze già avviate continuano a usare la versione
 * precedente; la nuova credenziale entra in servizio sulle istanze successive.
 */
export async function storeStoreSecret(secretName: string, value: string): Promise<StoreSecretResult> {
  const project = gcpProjectId();
  if (!project) {
    return { stored: false, reason: 'Progetto Google Cloud non determinabile in questo ambiente.' };
  }

  const token = await metadataAccessToken();
  if (!token) {
    return {
      stored: false,
      reason: `Credenziali di servizio non disponibili: salva il valore con "firebase functions:secrets:set ${secretName}".`,
    };
  }

  const base = 'https://secretmanager.googleapis.com/v1';
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const payload = JSON.stringify({ payload: { data: Buffer.from(value, 'utf8').toString('base64') } });

  const addVersion = (): Promise<globalThis.Response> =>
    fetch(`${base}/projects/${project}/secrets/${secretName}:addVersion`, {
      method: 'POST',
      headers,
      body: payload,
    });

  try {
    let response = await addVersion();

    if (response.status === 404) {
      // Il secret non esiste ancora: lo creiamo con replica automatica.
      const created = await fetch(`${base}/projects/${project}/secrets?secretId=${secretName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ replication: { automatic: {} } }),
      });
      if (!created.ok && created.status !== 409) {
        return { stored: false, reason: `Secret Manager: creazione non riuscita (HTTP ${created.status}).` };
      }
      response = await addVersion();
    }

    if (!response.ok) {
      const detail = response.status === 403 ? 'permessi insufficienti sul secret' : `HTTP ${response.status}`;
      return {
        stored: false,
        reason: `Secret Manager: salvataggio non riuscito (${detail}). Usa "firebase functions:secrets:set ${secretName}".`,
      };
    }

    log.info('Nuova versione del secret salvata', { secretName });
    return { stored: true };
  } catch (error) {
    return {
      stored: false,
      reason: `Secret Manager non raggiungibile: ${(error as Error).message}`,
    };
  }
}
