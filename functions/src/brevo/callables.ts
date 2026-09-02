/**
 * Callable per la configurazione Brevo.
 *
 * Tutte le operazioni leggono la chiave API dal secret `BREVO_API_KEY`.
 * `saveBrevoSettings` è l'unico punto in cui una chiave arriva dall'esterno:
 * viene validata su `/account`, salvata in Secret Manager e mai su Firestore.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { brevoSettingsInputSchema } from '@alphaink/shared';
import type { BrevoSender, BrevoSettings } from '@alphaink/shared';
import { requirePermission } from '../lib/auth';
import { APP_URL, BREVO_API_KEY, BREVO_WEBHOOK_SECRET, LIGHT_RUNTIME } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import { logActivity, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { accountCredits, apiKeyHint, getBrevoAccount } from './client';
import { ensureBrevoAttributes } from './contacts';
import { listSenders } from './senders';
import {
  readApiKeyFromSecret,
  readBrevoSettings,
  requireApiKey,
  storeBrevoApiKey,
  writeBrevoSettings,
} from './settings';
import { syncBrevoWebhooks } from './webhooks';
import type { RegisteredWebhook } from './webhooks';

const log = createLogger('brevo.callables');

/** Opzioni comuni: runtime leggero + accesso al secret della chiave API. */
const CALLABLE_OPTIONS = { ...LIGHT_RUNTIME, secrets: [BREVO_API_KEY] };

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
// saveBrevoSettings
// -----------------------------------------------------------------------------

export interface SaveBrevoSettingsResult {
  settings: BrevoSettings;
  /** `true` se la nuova chiave è stata scritta in Secret Manager. */
  apiKeyStored: boolean;
  /** Avviso da mostrare all'operatore (chiave non persistita, attributi, ...). */
  warning: string | null;
}

export const saveBrevoSettings = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<SaveBrevoSettingsResult> =>
    guard('saveBrevoSettings', async () => {
      const caller = requirePermission(request, 'settings:write');
      const input = parseInput(brevoSettingsInputSchema, request.data);
      const current = await readBrevoSettings();

      let warning: string | null = null;
      let apiKeyStored = false;
      let hint = current.apiKeyHint ?? null;
      let accountEmail = current.accountEmail ?? null;
      let accountCompany = current.accountCompany ?? null;
      let credits = current.credits ?? null;
      let senders: BrevoSender[] = current.senders;

      const newKey = input.apiKey?.trim();
      // La chiave viene provata prima di essere salvata: meglio un errore
      // immediato che una configurazione inutilizzabile.
      if (newKey) {
        const account = await getBrevoAccount(newKey);
        accountEmail = account.email ?? null;
        accountCompany = account.companyName ?? null;
        credits = accountCredits(account);
        senders = await listSenders(newKey);

        const stored = await storeBrevoApiKey(newKey);
        apiKeyStored = stored.stored;
        if (stored.stored) {
          hint = apiKeyHint(newKey);
        } else {
          // Il suggerimento resta quello della chiave davvero in uso: mostrarne
          // uno mai entrato in servizio confonderebbe l'operatore.
          warning = stored.reason ?? null;
        }
      }

      const secretKey = readApiKeyFromSecret();
      const effectiveKey = newKey || secretKey;

      const settings = await writeBrevoSettings(
        {
          // "Configurata" = utilizzabile a runtime dalle Functions.
          apiKeyConfigured: apiKeyStored || Boolean(secretKey),
          apiKeyHint: hint,
          accountEmail,
          accountCompany,
          credits,
          senders,
          defaultSenderEmail: input.defaultSenderEmail,
          defaultReplyTo: input.defaultReplyTo ?? null,
          syncContacts: input.syncContacts,
          defaultListId: input.defaultListId ?? null,
          maxSendsPerHour: input.maxSendsPerHour ?? null,
          lastCheckedAt: newKey ? nowIso() : current.lastCheckedAt ?? null,
          lastError: newKey ? null : current.lastError ?? null,
        },
        caller.uid,
      );

      // Gli attributi devono esistere su Brevo prima del primo push contatti.
      if (settings.syncContacts && effectiveKey) {
        try {
          await ensureBrevoAttributes(effectiveKey, settings.attributeMapping);
        } catch (error) {
          log.warn('Attributi Brevo non allineati', { message: (error as Error)?.message });
          warning =
            warning ??
            'Impostazioni salvate, ma non è stato possibile creare gli attributi contatto su Brevo.';
        }
      }

      await logActivity({
        action: 'brevo.settings.save',
        entityType: 'settings',
        entityId: 'brevo',
        userId: caller.uid,
        summary: newKey
          ? 'Impostazioni Brevo aggiornate con una nuova chiave API'
          : 'Impostazioni Brevo aggiornate',
        metadata: { apiKeyStored, senders: settings.senders.length },
      });

      return { settings, apiKeyStored, warning };
    }),
);

// -----------------------------------------------------------------------------
// testBrevoConnection
// -----------------------------------------------------------------------------

const testConnectionSchema = z.object({
  /** Chiave da provare prima di salvarla; se assente si usa quella configurata. */
  apiKey: z.string().min(20).optional(),
});

export interface TestBrevoConnectionResult {
  account: {
    email: string;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  senders: BrevoSender[];
  credits: { email: number | null; sms: number | null };
}

export const testBrevoConnection = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<TestBrevoConnectionResult> =>
    guard('testBrevoConnection', async () => {
      const caller = requirePermission(request, 'settings:read');
      const input = parseInput(testConnectionSchema, request.data);
      // Provare una chiave arbitraria è a tutti gli effetti una modifica di configurazione.
      if (input.apiKey) requirePermission(request, 'settings:write');

      const usingOverride = Boolean(input.apiKey);
      const apiKey = input.apiKey?.trim() || requireApiKey();

      try {
        const [account, senders] = await Promise.all([
          getBrevoAccount(apiKey),
          listSenders(apiKey),
        ]);
        const credits = accountCredits(account);

        await writeBrevoSettings(
          {
            accountEmail: account.email ?? null,
            accountCompany: account.companyName ?? null,
            credits,
            senders,
            lastCheckedAt: nowIso(),
            lastError: null,
            ...(usingOverride ? {} : { apiKeyConfigured: true, apiKeyHint: apiKeyHint(apiKey) }),
          },
          caller.uid,
        );

        return {
          account: {
            email: account.email,
            companyName: account.companyName ?? null,
            firstName: account.firstName ?? null,
            lastName: account.lastName ?? null,
          },
          senders,
          credits,
        };
      } catch (error) {
        await writeBrevoSettings(
          {
            lastCheckedAt: nowIso(),
            lastError: (error as Error)?.message ?? 'Connessione a Brevo non riuscita.',
          },
          caller.uid,
        );
        throw error;
      }
    }),
);

// -----------------------------------------------------------------------------
// registerBrevoWebhooks
// -----------------------------------------------------------------------------

export interface RegisterBrevoWebhooksResult {
  url: string;
  webhooks: RegisteredWebhook[];
  created: number;
  updated: number;
  webhookSecretConfigured: boolean;
}

export const registerBrevoWebhooks = onCall(
  // Serve anche il segreto dei webhook per riportare in UI se è configurato.
  { ...LIGHT_RUNTIME, secrets: [BREVO_API_KEY, BREVO_WEBHOOK_SECRET] },
  async (request: CallableRequest<unknown>): Promise<RegisterBrevoWebhooksResult> =>
    guard('registerBrevoWebhooks', async () => {
      const caller = requirePermission(request, 'settings:write');
      const apiKey = requireApiKey();

      let webhookSecretConfigured = false;
      try {
        webhookSecretConfigured = Boolean((BREVO_WEBHOOK_SECRET.value() ?? '').trim());
      } catch {
        webhookSecretConfigured = false;
      }

      const result = await syncBrevoWebhooks(apiKey, APP_URL.value());

      await writeBrevoSettings(
        {
          webhooks: result.webhooks,
          webhookSecretConfigured,
          lastCheckedAt: nowIso(),
          lastError: null,
        },
        caller.uid,
      );

      await logActivity({
        action: 'brevo.webhooks.register',
        entityType: 'settings',
        entityId: 'brevo',
        userId: caller.uid,
        summary: `Webhook Brevo sincronizzati su ${result.url}`,
        metadata: { created: result.created, updated: result.updated },
      });

      return { ...result, webhookSecretConfigured };
    }),
);
