/**
 * `seedDefaults`: prepara un'installazione nuova (o completa una esistente).
 *
 * Fa tre cose, tutte idempotenti:
 *  1. crea i quattro documenti di `settings` (`brevo`, `site`, `branding`,
 *     `tracking`) con i valori predefiniti condivisi, e su quelli già presenti
 *     aggiunge soltanto le chiavi mancanti (utile dopo un aggiornamento che
 *     introduce nuove impostazioni);
 *  2. installa i cinque template di sistema;
 *  3. crea le automazioni predefinite tramite `ensureCoreAutomations`.
 *
 * ## Cosa NON fa
 * Non sovrascrive il lavoro dell'operatore. Le impostazioni già valorizzate
 * restano com'erano e i template già presenti conservano il proprio contenuto,
 * a meno che non si chieda esplicitamente il ripristino con
 * `overwriteTemplates: true`.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { AutomationKey, NewsletterTemplate, SettingsDocId } from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import { HEAVY_RUNTIME } from '../lib/config';
import { invalidArgument, toHttpsError } from '../lib/errors';
import { auditCreate, auditUpdate, col, logActivity, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { ensureCoreAutomations } from '../automations';
import { defaultBrevoSettings } from '../brevo/settings';
import { defaultSiteSettings } from '../sync/settings';
import {
  clearSettingsCache,
  defaultBrandingSettings,
  defaultTrackingSettings,
  readBrandingSettings,
} from '../tracking/settings';
import { buildSystemTemplates } from './templates';

const log = createLogger('seed.callables');

/** Esito dell'installazione di un singolo documento. */
export type SeedOutcome = 'creato' | 'completato' | 'invariato';

export interface SeedResult {
  settings: Record<SettingsDocId, SeedOutcome>;
  templates: { created: string[]; updated: string[]; unchanged: string[] };
  automations: { created: AutomationKey[]; existing: AutomationKey[] };
}

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

// -----------------------------------------------------------------------------
// Impostazioni
// -----------------------------------------------------------------------------

/**
 * Crea il documento se manca, altrimenti aggiunge solo le chiavi assenti.
 *
 * Il confronto è al primo livello: basta a far comparire le impostazioni
 * introdotte da un aggiornamento senza rischiare di calpestare quelle
 * annidate che l'operatore ha personalizzato (per esempio la mappa degli stati
 * ordine di PrestaShop).
 */
export async function ensureSettingsDoc(
  docId: SettingsDocId,
  defaults: Record<string, unknown>,
  userId?: string | null,
): Promise<SeedOutcome> {
  const ref = col.settings().doc(docId);
  const snapshot = await ref.get();

  if (!snapshot.exists) {
    await ref.set({ ...defaults, ...auditCreate(userId ?? null) });
    return 'creato';
  }

  const stored = snapshot.data() ?? {};
  const missing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(key)) continue;
    if (stored[key] === undefined) missing[key] = value;
  }

  if (!Object.keys(missing).length) return 'invariato';
  await ref.set({ ...missing, ...auditUpdate(userId ?? null) }, { merge: true });
  return 'completato';
}

// -----------------------------------------------------------------------------
// Template di sistema
// -----------------------------------------------------------------------------

export interface TemplateSeedResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

/**
 * Installa i template di sistema.
 *
 * Con `overwrite: false` (predefinito) i template già presenti conservano il
 * proprio contenuto: l'operatore potrebbe averli adattati. Vengono comunque
 * riallineati nome, descrizione, categoria ed etichette, così un rinominare
 * fatto in casa non impedisce di riconoscerli.
 */
export async function seedSystemTemplates(
  options: { overwrite?: boolean; userId?: string | null } = {},
): Promise<TemplateSeedResult> {
  const branding = await readBrandingSettings({ fresh: true });
  const templates = buildSystemTemplates(branding);
  const result: TemplateSeedResult = { created: [], updated: [], unchanged: [] };

  for (const template of templates) {
    const ref = col.templates().doc(template.id);
    const snapshot = await ref.get();
    const { id, ...data } = template;

    if (!snapshot.exists) {
      await ref.set({
        ...data,
        usageCount: 0,
        ...auditCreate(options.userId ?? null),
      } satisfies Omit<NewsletterTemplate, 'id'>);
      result.created.push(id);
      continue;
    }

    const patch: Record<string, unknown> = {
      name: data.name,
      description: data.description,
      category: data.category,
      tags: data.tags,
      isSystem: true,
      ...auditUpdate(options.userId ?? null),
    };
    if (options.overwrite) patch.document = data.document;

    await ref.set(patch, { merge: true });
    if (options.overwrite) result.updated.push(id);
    else result.unchanged.push(id);
  }

  return result;
}

// -----------------------------------------------------------------------------
// seedDefaults
// -----------------------------------------------------------------------------

const seedSchema = z.object({
  /** Ripristina il contenuto originale dei template di sistema. */
  overwriteTemplates: z.boolean().default(false),
  /** Crea le automazioni predefinite mancanti. */
  includeAutomations: z.boolean().default(true),
});

export const seedDefaults = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<SeedResult> => {
    try {
      const caller = requirePermission(request, 'settings:write');
      const input = parseInput(seedSchema, request.data);

      // 1. Impostazioni. L'ordine conta: l'identità visiva serve ai template e
      //    alle automazioni, quindi si scrive per prima.
      const settings: Record<SettingsDocId, SeedOutcome> = {
        branding: await ensureSettingsDoc(
          'branding',
          defaultBrandingSettings() as unknown as Record<string, unknown>,
          caller.uid,
        ),
        tracking: await ensureSettingsDoc(
          'tracking',
          defaultTrackingSettings() as unknown as Record<string, unknown>,
          caller.uid,
        ),
        brevo: await ensureSettingsDoc(
          'brevo',
          defaultBrevoSettings() as unknown as Record<string, unknown>,
          caller.uid,
        ),
        site: await ensureSettingsDoc(
          'site',
          defaultSiteSettings() as unknown as Record<string, unknown>,
          caller.uid,
        ),
      };

      // La cache di processo tiene le impostazioni per un minuto: dopo averle
      // scritte va svuotata, altrimenti template e automazioni nascerebbero con
      // i valori vecchi.
      clearSettingsCache();

      // 2. Template di sistema.
      const templates = await seedSystemTemplates({
        overwrite: input.overwriteTemplates,
        userId: caller.uid,
      });

      // 3. Automazioni predefinite.
      const automations = input.includeAutomations
        ? await ensureCoreAutomations({ userId: caller.uid })
        : { created: [], existing: [] };

      const summary =
        `Installazione predefinita: ${templates.created.length} template creati, ` +
        `${automations.created.length} automazioni create`;

      log.info('seedDefaults completato', {
        settings,
        templates: templates.created.length,
        automations: automations.created.length,
        at: nowIso(),
      });

      await logActivity({
        action: 'seed.defaults',
        entityType: 'settings',
        userId: caller.uid,
        summary,
        metadata: {
          settings,
          templatesCreated: templates.created,
          templatesUpdated: templates.updated,
          automationsCreated: automations.created,
        },
      });

      return {
        settings,
        templates,
        automations: {
          created: automations.created,
          existing: automations.existing,
        },
      };
    } catch (error) {
      log.error('Callable seedDefaults fallita', error);
      throw toHttpsError(error);
    }
  },
);
