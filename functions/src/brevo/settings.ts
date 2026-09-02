/**
 * Lettura e scrittura del documento `settings/brevo`.
 *
 * REGOLA NON NEGOZIABILE: la chiave API non finisce MAI su Firestore.
 * Su Firestore restano solo `apiKeyConfigured` e `apiKeyHint` (ultime 4 cifre);
 * il valore vero vive in Secret Manager ed è letto a runtime dal parametro
 * `BREVO_API_KEY`.
 */

import { DEFAULT_BRANDING } from '@alphaink/shared';
import type { BrevoSettings, SettingsDocId } from '@alphaink/shared';
import { BREVO_API_KEY } from '../lib/config';
import { AppError } from '../lib/errors';
import { auditCreate, auditUpdate, col, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { gcpProjectId } from './client';
import { BREVO_ATTRIBUTES } from './contacts';
import type { BrevoEmailAddress } from './transactional';

const log = createLogger('brevo.settings');

/** Id del documento impostazioni. */
export const BREVO_SETTINGS_DOC: SettingsDocId = 'brevo';

/** Mappatura di default "chiave applicativa → attributo Brevo". */
export const DEFAULT_ATTRIBUTE_MAPPING: Record<string, string> = Object.fromEntries(
  Object.entries(BREVO_ATTRIBUTES),
);

/** Impostazioni iniziali usate finché l'operatore non salva le proprie. */
export function defaultBrevoSettings(): BrevoSettings {
  const now = nowIso();
  return {
    apiKeyConfigured: false,
    apiKeyHint: null,
    accountEmail: null,
    accountCompany: null,
    credits: null,
    senders: [],
    defaultSenderEmail: DEFAULT_BRANDING.supportEmail,
    defaultReplyTo: null,
    webhooks: [],
    webhookSecretConfigured: false,
    syncContacts: true,
    defaultListId: null,
    attributeMapping: { ...DEFAULT_ATTRIBUTE_MAPPING },
    maxSendsPerHour: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

/** Legge `settings/brevo`, completando i campi mancanti con i default. */
export async function readBrevoSettings(): Promise<BrevoSettings> {
  const snapshot = await col.settings().doc(BREVO_SETTINGS_DOC).get();
  const defaults = defaultBrevoSettings();
  if (!snapshot.exists) return defaults;

  const stored = serializeDoc<Partial<BrevoSettings>>(snapshot.data() ?? {});
  return {
    ...defaults,
    ...stored,
    attributeMapping: { ...defaults.attributeMapping, ...(stored.attributeMapping ?? {}) },
    senders: stored.senders ?? defaults.senders,
    webhooks: stored.webhooks ?? defaults.webhooks,
  };
}

/**
 * Aggiorna `settings/brevo` in modo incrementale.
 * Qualsiasi `apiKey` presente nel patch viene scartata prima della scrittura:
 * è una rete di sicurezza contro un payload passato per errore dalla UI.
 */
export async function writeBrevoSettings(
  patch: Partial<BrevoSettings> & { apiKey?: unknown },
  uid?: string | null,
): Promise<BrevoSettings> {
  const { apiKey, ...safe } = patch;
  if (apiKey !== undefined) {
    log.warn('Tentativo di salvare la chiave API su Firestore: ignorato.');
  }

  const ref = col.settings().doc(BREVO_SETTINGS_DOC);
  const snapshot = await ref.get();
  const audit = snapshot.exists ? auditUpdate(uid) : { ...auditCreate(uid) };

  await ref.set({ ...safe, ...audit }, { merge: true });
  return readBrevoSettings();
}

// -----------------------------------------------------------------------------
// Mittente
// -----------------------------------------------------------------------------

/** Override accettato da `resolveSender`: solo l'email o l'oggetto completo. */
export type SenderOverride = string | Partial<BrevoEmailAddress> | null | undefined;

/**
 * Determina il mittente da usare per un invio.
 * L'override vince sul default; il nome, se non indicato, viene preso dal
 * mittente registrato su Brevo e in ultima istanza dal nome azienda.
 */
export function resolveSender(settings: BrevoSettings, override?: SenderOverride): BrevoEmailAddress {
  const requested =
    typeof override === 'string' ? { email: override } : (override ?? undefined);

  const email = (requested?.email ?? settings.defaultSenderEmail ?? '').trim().toLowerCase();
  if (!email) {
    throw new AppError(
      'failed_precondition',
      'Nessun mittente configurato: imposta il mittente predefinito in Impostazioni → Brevo.',
    );
  }

  const registered = settings.senders.find((sender) => sender.email.toLowerCase() === email);
  const name = requested?.name?.trim() || registered?.name?.trim() || DEFAULT_BRANDING.companyName;
  return { email, name };
}

/** Indirizzo di risposta: override, poi default configurato, poi il mittente. */
export function resolveReplyTo(
  settings: BrevoSettings,
  override?: SenderOverride,
): BrevoEmailAddress | null {
  const requested = typeof override === 'string' ? { email: override } : (override ?? undefined);
  const email = (requested?.email ?? settings.defaultReplyTo ?? '').trim().toLowerCase();
  if (!email) return null;
  const registered = settings.senders.find((sender) => sender.email.toLowerCase() === email);
  const name = requested?.name?.trim() || registered?.name?.trim();
  return name ? { email, name } : { email };
}

// -----------------------------------------------------------------------------
// Chiave API
// -----------------------------------------------------------------------------

/** Legge la chiave dal secret senza far esplodere l'esecuzione se non è associata. */
export function readApiKeyFromSecret(): string {
  try {
    return (BREVO_API_KEY.value() ?? '').trim();
  } catch {
    return '';
  }
}

/** Chiave API o errore parlante: da usare all'inizio di ogni operazione Brevo. */
export function requireApiKey(): string {
  const key = readApiKeyFromSecret();
  if (!key) {
    throw new AppError(
      'failed_precondition',
      'Chiave API Brevo non configurata. Salvala da Impostazioni → Brevo oppure esegui "firebase functions:secrets:set BREVO_API_KEY".',
    );
  }
  return key;
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

export interface StoreApiKeyResult {
  stored: boolean;
  /** Motivo del mancato salvataggio, già in italiano e mostrabile in UI. */
  reason?: string;
}

/**
 * Salva la chiave come nuova versione del secret `BREVO_API_KEY`.
 *
 * Usa l'API REST di Secret Manager con il token del service account: evita di
 * aggiungere una dipendenza npm. Richiede il permesso
 * `secretmanager.versions.add`; se manca (caso frequente sui progetti appena
 * creati) NON solleva errore, ma restituisce il motivo così che la UI possa
 * chiedere di eseguire `firebase functions:secrets:set BREVO_API_KEY`.
 *
 * Nota operativa: le istanze già avviate continuano a usare la versione
 * precedente, la nuova chiave entra in servizio sulle istanze successive.
 */
export async function storeBrevoApiKey(apiKey: string): Promise<StoreApiKeyResult> {
  const project = gcpProjectId();
  if (!project) {
    return { stored: false, reason: 'Progetto Google Cloud non determinabile in questo ambiente.' };
  }

  const token = await metadataAccessToken();
  if (!token) {
    return {
      stored: false,
      reason:
        'Credenziali di servizio non disponibili: salva la chiave con "firebase functions:secrets:set BREVO_API_KEY".',
    };
  }

  const secretName = 'BREVO_API_KEY';
  const base = 'https://secretmanager.googleapis.com/v1';
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  const payload = JSON.stringify({
    payload: { data: Buffer.from(apiKey, 'utf8').toString('base64') },
  });

  const addVersion = async (): Promise<globalThis.Response> =>
    fetch(`${base}/projects/${project}/secrets/${secretName}:addVersion`, {
      method: 'POST',
      headers,
      body: payload,
    });

  try {
    let response = await addVersion();

    if (response.status === 404) {
      // Il secret non esiste ancora: lo creiamo con replica automatica.
      const created = await fetch(
        `${base}/projects/${project}/secrets?secretId=${secretName}`,
        { method: 'POST', headers, body: JSON.stringify({ replication: { automatic: {} } }) },
      );
      if (!created.ok && created.status !== 409) {
        return { stored: false, reason: `Secret Manager: creazione non riuscita (HTTP ${created.status}).` };
      }
      response = await addVersion();
    }

    if (!response.ok) {
      const detail = response.status === 403 ? 'permessi insufficienti sul secret' : `HTTP ${response.status}`;
      return {
        stored: false,
        reason: `Secret Manager: salvataggio non riuscito (${detail}). Usa "firebase functions:secrets:set BREVO_API_KEY".`,
      };
    }

    log.info('Nuova versione del secret BREVO_API_KEY salvata');
    return { stored: true };
  } catch (error) {
    log.error('Errore durante il salvataggio del secret BREVO_API_KEY', error);
    return {
      stored: false,
      reason: 'Errore di rete verso Secret Manager: salva la chiave da riga di comando.',
    };
  }
}
