/**
 * Lettura delle impostazioni usate da tutto il modulo di tracciamento.
 *
 * Le due letture (`settings/tracking` e `settings/branding`) avvengono per ogni
 * evento in ingresso: un webhook Brevo può recapitare centinaia di eventi in un
 * colpo solo, quindi i documenti sono tenuti in una cache di processo con TTL
 * breve. La cache è per istanza: un cambio di impostazioni si propaga entro
 * `SETTINGS_CACHE_TTL_MS` su tutte le istanze attive.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import {
  DEFAULT_ATTRIBUTION_SETTINGS,
  DEFAULT_BRANDING,
  DEFAULT_TRACKING_SETTINGS,
  emailSchema,
  hexColorSchema,
  trackingSettingsInputSchema,
} from '@alphaink/shared';
import type { AttributionSettings, BrandingSettings, SettingsDocId, TrackingSettings } from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import { APP_URL, LIGHT_RUNTIME, LINK_SIGNING_KEY } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import { auditCreate, auditUpdate, col, logActivity, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('tracking.settings');

export const TRACKING_SETTINGS_DOC: SettingsDocId = 'tracking';
export const BRANDING_SETTINGS_DOC: SettingsDocId = 'branding';

/** Durata della cache di processo delle impostazioni. */
export const SETTINGS_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

let trackingCache: CacheEntry<TrackingSettings> | null = null;
let brandingCache: CacheEntry<BrandingSettings> | null = null;

/** Svuota la cache: usata dai test e dopo un salvataggio delle impostazioni. */
export function clearSettingsCache(): void {
  trackingCache = null;
  brandingCache = null;
}

export function defaultTrackingSettings(): TrackingSettings {
  const now = nowIso();
  return {
    ...DEFAULT_TRACKING_SETTINGS,
    attribution: { ...DEFAULT_ATTRIBUTION_SETTINGS },
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

export function defaultBrandingSettings(): BrandingSettings {
  const now = nowIso();
  return {
    ...DEFAULT_BRANDING,
    palette: { ...DEFAULT_BRANDING.palette },
    fonts: { ...DEFAULT_BRANDING.fonts },
    socialLinks: [...DEFAULT_BRANDING.socialLinks],
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

/** Legge `settings/tracking` completando i campi mancanti con i default. */
export async function readTrackingSettings(options: { fresh?: boolean } = {}): Promise<TrackingSettings> {
  if (!options.fresh && trackingCache && trackingCache.expiresAt > Date.now()) {
    return trackingCache.value;
  }

  const defaults = defaultTrackingSettings();
  let value = defaults;
  try {
    const snapshot = await col.settings().doc(TRACKING_SETTINGS_DOC).get();
    if (snapshot.exists) {
      const stored = serializeDoc<Partial<TrackingSettings>>(snapshot.data() ?? {});
      value = {
        ...defaults,
        ...stored,
        attribution: { ...defaults.attribution, ...(stored.attribution ?? {}) },
      };
    }
  } catch (error) {
    // Con Firestore irraggiungibile è meglio tracciare con i default che perdere l'evento.
    log.error('Lettura di settings/tracking fallita: uso i valori predefiniti', error);
  }

  trackingCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return value;
}

/** Configurazione di attribuzione, normalizzata (finestre non negative). */
export async function readAttributionSettings(): Promise<AttributionSettings> {
  const settings = await readTrackingSettings();
  const attribution = settings.attribution ?? DEFAULT_ATTRIBUTION_SETTINGS;
  return {
    ...DEFAULT_ATTRIBUTION_SETTINGS,
    ...attribution,
    clickWindowDays: Math.max(0, Number(attribution.clickWindowDays ?? 0)),
    openWindowDays: Math.max(0, Number(attribution.openWindowDays ?? 0)),
    countStatuses:
      attribution.countStatuses?.length > 0
        ? attribution.countStatuses
        : DEFAULT_ATTRIBUTION_SETTINGS.countStatuses,
  };
}

/** Legge `settings/branding`, usato dalle pagine pubbliche. */
export async function readBrandingSettings(options: { fresh?: boolean } = {}): Promise<BrandingSettings> {
  if (!options.fresh && brandingCache && brandingCache.expiresAt > Date.now()) {
    return brandingCache.value;
  }

  const defaults = defaultBrandingSettings();
  let value = defaults;
  try {
    const snapshot = await col.settings().doc(BRANDING_SETTINGS_DOC).get();
    if (snapshot.exists) {
      const stored = serializeDoc<Partial<BrandingSettings>>(snapshot.data() ?? {});
      value = {
        ...defaults,
        ...stored,
        palette: { ...defaults.palette, ...(stored.palette ?? {}) },
        fonts: { ...defaults.fonts, ...(stored.fonts ?? {}) },
        socialLinks: stored.socialLinks ?? defaults.socialLinks,
      };
    }
  } catch (error) {
    log.error('Lettura di settings/branding fallita: uso i valori predefiniti', error);
  }

  brandingCache = { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return value;
}

// -----------------------------------------------------------------------------
// Parametri di runtime
// -----------------------------------------------------------------------------

/** Chiave di firma dei link tracciati e dei token. Stringa vuota se assente. */
export function signingSecret(): string {
  try {
    return (LINK_SIGNING_KEY.value() ?? '').trim();
  } catch {
    return '';
  }
}

/** URL pubblico della web app, senza slash finale. */
export function publicAppUrl(): string {
  try {
    return (APP_URL.value() ?? '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// -----------------------------------------------------------------------------
// Callable: salvataggio delle impostazioni
// -----------------------------------------------------------------------------

/**
 * Schema del brand. Non esiste in `@alphaink/shared` (a differenza di
 * `trackingSettingsInputSchema`) perché la forma è usata solo qui: i colori
 * riusano comunque `hexColorSchema` condiviso, così UI e backend rifiutano
 * esattamente gli stessi valori.
 */
export const brandingSettingsInputSchema = z.object({
  companyName: z.string().min(1).max(120),
  legalName: z.string().min(1).max(160),
  address: z.string().max(300),
  vatNumber: z.string().max(40),
  supportEmail: emailSchema,
  supportPhone: z.string().max(40).nullable().optional(),
  websiteUrl: z.string().url().max(300),
  logoUrl: z.string().url().max(500).nullable().optional(),
  logoDarkUrl: z.string().url().max(500).nullable().optional(),
  faviconUrl: z.string().url().max(500).nullable().optional(),
  palette: z.object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    surface: hexColorSchema,
    text: hexColorSchema,
    muted: hexColorSchema,
    success: hexColorSchema,
    danger: hexColorSchema,
  }),
  fonts: z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(80) }),
  socialLinks: z
    .array(z.object({ network: z.string().min(1).max(40), url: z.string().url().max(500) }))
    .max(12)
    .default([]),
  legalFooterHtml: z.string().max(4_000),
  unsubscribeText: z.string().max(300),
});

export type BrandingSettingsInput = z.infer<typeof brandingSettingsInputSchema>;

function parseSettingsInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
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

export interface SaveTrackingSettingsResult {
  settings: TrackingSettings;
}

/**
 * Salva `settings/tracking`.
 *
 * Dopo la scrittura la cache di processo viene svuotata e la lettura è forzata
 * `fresh`: l'operatore vede subito il valore salvato invece di quello vecchio
 * rimasto in cache fino a `SETTINGS_CACHE_TTL_MS`. Le altre istanze si
 * allineano entro il TTL.
 */
export const saveTrackingSettings = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<SaveTrackingSettingsResult> => {
    try {
      const caller = requirePermission(request, 'settings:write');
      const input = parseSettingsInput(trackingSettingsInputSchema, request.data);

      const ref = col.settings().doc(TRACKING_SETTINGS_DOC);
      const snapshot = await ref.get();
      const audit = snapshot.exists ? auditUpdate(caller.uid) : auditCreate(caller.uid);

      await ref.set(
        {
          ...input,
          attribution: { ...input.attribution },
          ...audit,
        },
        { merge: true },
      );

      clearSettingsCache();
      const settings = await readTrackingSettings({ fresh: true });

      await logActivity({
        action: 'settings.tracking.save',
        entityType: 'settings',
        entityId: TRACKING_SETTINGS_DOC,
        userId: caller.uid,
        summary: 'Impostazioni di tracciamento aggiornate.',
        metadata: { model: settings.attribution.model, autoUtm: settings.autoUtm },
      });

      return { settings };
    } catch (error) {
      log.error('Callable saveTrackingSettings fallita', error);
      throw toHttpsError(error);
    }
  },
);

export interface SaveBrandingSettingsResult {
  settings: BrandingSettings;
}

/** Salva `settings/branding`: identità visiva usata da editor, invii e pagine pubbliche. */
export const saveBrandingSettings = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<SaveBrandingSettingsResult> => {
    try {
      const caller = requirePermission(request, 'settings:write');
      const input = parseSettingsInput(brandingSettingsInputSchema, request.data);

      const ref = col.settings().doc(BRANDING_SETTINGS_DOC);
      const snapshot = await ref.get();
      const audit = snapshot.exists ? auditUpdate(caller.uid) : auditCreate(caller.uid);

      await ref.set(
        {
          ...input,
          supportPhone: input.supportPhone ?? null,
          logoUrl: input.logoUrl ?? null,
          logoDarkUrl: input.logoDarkUrl ?? null,
          faviconUrl: input.faviconUrl ?? null,
          palette: { ...input.palette },
          fonts: { ...input.fonts },
          socialLinks: [...input.socialLinks],
          ...audit,
        },
        { merge: true },
      );

      clearSettingsCache();
      const settings = await readBrandingSettings({ fresh: true });

      await logActivity({
        action: 'settings.branding.save',
        entityType: 'settings',
        entityId: BRANDING_SETTINGS_DOC,
        userId: caller.uid,
        summary: 'Impostazioni del brand aggiornate.',
        metadata: { companyName: settings.companyName },
      });

      return { settings };
    } catch (error) {
      log.error('Callable saveBrandingSettings fallita', error);
      throw toHttpsError(error);
    }
  },
);
