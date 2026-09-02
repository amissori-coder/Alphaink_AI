/**
 * Callable delle automazioni.
 *
 *  - `saveAutomation`            crea o aggiorna un flusso
 *  - `toggleAutomation`          attiva/disattiva
 *  - `sendAutomationTest`        invia uno step a indirizzi di prova
 *  - `previewAutomationStep`     restituisce HTML e testo senza inviare
 *  - `resetAutomationToDefaults` ripristina i contenuti predefiniti
 *  - `getAutomationReport`       statistiche per step, serie storica, ultimi invii
 *
 * Regola condivisa con il resto dell'app: l'input è validato con zod, gli
 * errori applicativi sono `AppError` e vengono convertiti in `HttpsError` dal
 * wrapper `guard`; il risultato è restituito nudo, senza involucro `{ok,data}`.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  AUTOMATION_KEYS,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  EMPTY_STEP_STATS,
  automationInputSchema,
  dayKey,
  displayNameFor,
  emailSchema,
  normalizeEmail,
  safeRate,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationKey,
  AutomationRun,
  AutomationStep,
  Contact,
  CouponPolicy,
  DocId,
  EmailDocument,
  IsoDate,
  Order,
  ProductFamily,
} from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import {
  APP_URL,
  BREVO_API_KEY,
  HEAVY_RUNTIME,
  LIGHT_RUNTIME,
  LINK_SIGNING_KEY,
} from '../lib/config';
import { AppError, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { col, logActivity, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { requireApiKey, readBrevoSettings, resolveReplyTo, resolveSender } from '../brevo/settings';
import { sendTransactionalEmail } from '../brevo/transactional';
import { getContactById } from '../contacts/repository';
import { buildEmail, buildMergeContext, decodeBasicEntities, resolveMergeTags } from '../render';
import type { RenderWarning } from '../render';
import { discountLabelOf } from './coupons';
import { buildDefaultAutomation } from './defaults';
import { buildSystemUrls, recentSentRuns, resolveStepDocument } from './dispatcher';
import type { RunOrderContext } from './enrollment';
import {
  applyAutomationStats,
  createAutomation,
  findStep,
  getAutomationByKey,
  listSentRunsBetween,
  readBrandingSettings,
  requireAutomation,
  updateAutomation,
} from './repository';

const log = createLogger('automations.callables');

const DAY_MS = 86_400_000;

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

async function guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`Callable ${operation} fallita`, error);
    throw toHttpsError(error);
  }
}

/** Parametro stringa con fallback: fuori dal runtime Functions non è risolvibile. */
function readParam(read: () => string, fallback: string): string {
  try {
    return read() || fallback;
  } catch {
    return fallback;
  }
}

// -----------------------------------------------------------------------------
// saveAutomation
// -----------------------------------------------------------------------------

const automationKeySchema = z.enum(AUTOMATION_KEYS as [AutomationKey, ...AutomationKey[]]);

const saveSchema = automationInputSchema.extend({
  id: z.string().min(1).optional(),
  /** Obbligatoria in creazione: determina i comportamenti del motore. */
  key: automationKeySchema.optional(),
});

/**
 * Le statistiche degli step vivono nel documento e non arrivano dalla UI:
 * si riportano quelle esistenti, azzerando solo per gli step nuovi.
 */
function mergeStepStats(
  incoming: z.infer<typeof automationInputSchema>['steps'],
  existing: AutomationStep[] | undefined,
): AutomationStep[] {
  const previous = new Map((existing ?? []).map((step) => [step.id, step]));
  return incoming.map((step) => ({
    ...step,
    preheader: step.preheader ?? null,
    document: (step.document ?? null) as EmailDocument | null,
    templateId: step.templateId ?? null,
    coupon: step.coupon
      ? ({
          ...step.coupon,
          sharedCode: step.coupon.sharedCode ?? null,
          minOrderTotal: step.coupon.minOrderTotal ?? null,
          restrictToFamilies: (step.coupon.restrictToFamilies ?? []) as ProductFamily[],
          restrictToCompatibleSkus: step.coupon.restrictToCompatibleSkus ?? false,
        } as CouponPolicy)
      : null,
    stats: previous.get(step.id)?.stats ?? { ...EMPTY_STEP_STATS },
  })) as AutomationStep[];
}

export const saveAutomation = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<Automation> =>
    guard('saveAutomation', async () => {
      const caller = requirePermission(request, 'automations:write');
      const input = parseInput(saveSchema, request.data);

      if (input.id) {
        const existing = await requireAutomation(input.id);
        const steps = mergeStepStats(input.steps, existing.steps);
        const saved = await updateAutomation(
          input.id,
          {
            name: input.name,
            description: input.description ?? null,
            enabled: input.enabled,
            testMode: input.testMode,
            testRecipients: input.testRecipients,
            trigger: input.trigger as Automation['trigger'],
            steps,
            audienceFilter: (input.audienceFilter ?? null) as Automation['audienceFilter'],
            excludeClusterIds: input.excludeClusterIds,
            cooldownDays: input.cooldownDays,
            maxPerContactPerYear: input.maxPerContactPerYear ?? null,
            quietHours: input.quietHours ?? null,
            allowedWeekdays: input.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
            maxSendsPerHour: input.maxSendsPerHour ?? null,
            timezone: input.timezone,
            fromName: input.fromName,
            fromEmail: input.fromEmail,
            replyTo: input.replyTo ?? null,
          },
          caller.uid,
        );

        await logActivity({
          action: 'automation.update',
          entityType: 'automation',
          entityId: saved.id,
          userId: caller.uid,
          summary: `Automazione "${saved.name}" aggiornata`,
        });
        return saved;
      }

      if (!input.key) {
        throw invalidArgument('Per creare un\'automazione è necessario indicarne il tipo (key).');
      }
      const duplicate = await getAutomationByKey(input.key);
      if (duplicate) {
        throw new AppError(
          'already_exists',
          `Esiste già un'automazione di tipo "${input.key}": modifica quella invece di crearne un'altra.`,
        );
      }

      const now = nowIso();
      const created = await createAutomation(
        {
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          enabled: input.enabled,
          testMode: input.testMode,
          testRecipients: input.testRecipients,
          trigger: input.trigger as Automation['trigger'],
          steps: mergeStepStats(input.steps, []),
          audienceFilter: (input.audienceFilter ?? null) as Automation['audienceFilter'],
          excludeClusterIds: input.excludeClusterIds,
          cooldownDays: input.cooldownDays,
          maxPerContactPerYear: input.maxPerContactPerYear ?? null,
          quietHours: input.quietHours ?? null,
          allowedWeekdays: input.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
          maxSendsPerHour: input.maxSendsPerHour ?? null,
          timezone: input.timezone,
          fromName: input.fromName,
          fromEmail: input.fromEmail,
          replyTo: input.replyTo ?? null,
          stats: {
            enrolled: 0, scheduled: 0, sent: 0, cancelled: 0, delivered: 0,
            opened: 0, clicked: 0, orders: 0, revenue: 0,
            currency: DEFAULT_CURRENCY, updatedAt: now,
          },
          lastRunAt: null,
          lastErrorAt: null,
          lastError: null,
          isCore: false,
          createdAt: now,
          updatedAt: now,
          createdBy: caller.uid,
          updatedBy: caller.uid,
        },
        { docId: input.key, userId: caller.uid },
      );

      await logActivity({
        action: 'automation.create',
        entityType: 'automation',
        entityId: created.id,
        userId: caller.uid,
        summary: `Automazione "${created.name}" creata`,
      });
      return created;
    }),
);

// -----------------------------------------------------------------------------
// toggleAutomation
// -----------------------------------------------------------------------------

const toggleSchema = z.object({
  automationId: z.string().min(1),
  enabled: z.boolean(),
});

export const toggleAutomation = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ id: DocId; enabled: boolean }> =>
    guard('toggleAutomation', async () => {
      const caller = requirePermission(request, 'automations:toggle');
      const input = parseInput(toggleSchema, request.data);
      const automation = await requireAutomation(input.automationId);

      if (input.enabled) {
        // Attivare un flusso senza contenuti manderebbe email vuote.
        const usable = (automation.steps ?? []).some(
          (step) => step.enabled && (step.document || step.templateId),
        );
        if (!usable) {
          throw new AppError(
            'failed_precondition',
            'L\'automazione non ha nessuno step attivo con un contenuto email: completala prima di attivarla.',
          );
        }
      }

      await updateAutomation(input.automationId, { enabled: input.enabled }, caller.uid);
      await logActivity({
        action: input.enabled ? 'automation.enable' : 'automation.disable',
        entityType: 'automation',
        entityId: automation.id,
        userId: caller.uid,
        summary: `Automazione "${automation.name}" ${input.enabled ? 'attivata' : 'disattivata'}`,
      });
      return { id: automation.id, enabled: input.enabled };
    }),
);

// -----------------------------------------------------------------------------
// Anteprima e invio di prova — contesto di esempio
// -----------------------------------------------------------------------------

/** Contatto fittizio usato quando non ne viene indicato uno reale. */
function sampleContact(): Contact {
  const now = nowIso();
  return {
    id: 'anteprima',
    email: 'mario.rossi@esempio.it',
    emailNormalized: 'mario.rossi@esempio.it',
    firstName: 'Mario',
    lastName: 'Rossi',
    displayName: 'Mario Rossi',
    phone: null,
    company: 'Studio Rossi',
    vatNumber: null,
    source: 'prestashop_b2c',
    sources: ['prestashop_b2c'],
    externalIds: {},
    status: 'subscribed',
    optInAt: now,
    optOutAt: null,
    consentSource: 'anteprima',
    language: 'it',
    country: 'IT',
    province: 'MI',
    city: 'Milano',
    postcode: '20100',
    customerGroup: null,
    segment: 'b2c',
    tags: [],
    clusterIds: [],
    dynamicClusterIds: [],
    stats: {
      ordersCount: 4,
      totalSpent: 486.5,
      averageOrderValue: 121.63,
      firstOrderAt: new Date(Date.now() - 300 * DAY_MS).toISOString(),
      lastOrderAt: new Date(Date.now() - 45 * DAY_MS).toISOString(),
      averageDaysBetweenOrders: 62,
      nextPurchaseDueAt: {},
      spentByFamily: {},
      ordersByFamily: {},
      lastOrderByFamily: {},
    },
    engagement: {
      sent: 12, delivered: 12, opened: 7, clicked: 3, bounced: 0, complaints: 0,
      lastSentAt: now, lastOpenedAt: now, lastClickedAt: null,
      engagementScore: 68, engagementTier: 'warm',
    },
    printers: [
      {
        brand: 'HP',
        model: 'LaserJet Pro M404dn',
        detectedFrom: 'order',
        detectedAt: now,
        compatibleSkus: ['CF259A', 'CF259X'],
      },
    ],
    brevoContactId: null,
    brevoSyncedAt: null,
    brevoListIds: [],
    lastSyncAt: null,
    customAttributes: {},
    notes: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

/** Ordine di esempio: dà corpo a `{{order.itemsList}}` e agli altri tag ordine. */
function sampleOrderContext(): RunOrderContext {
  return {
    orderNumber: 'AI-10482',
    externalId: '10482',
    total: 129.9,
    currency: DEFAULT_CURRENCY,
    placedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    items: [
      {
        sku: 'CF259X',
        name: 'Toner HP 59X nero ad alta capacità',
        quantity: 2,
        unitPrice: 49.9,
        total: 99.8,
        family: 'toner',
        brand: 'HP',
        printerModels: ['LaserJet Pro M404dn'],
      },
      {
        sku: 'PAP-A4-80',
        name: 'Carta A4 80 g/m² — risma da 500 fogli',
        quantity: 1,
        unitPrice: 30.1,
        total: 30.1,
        family: 'carta',
        brand: null,
        printerModels: [],
      },
    ],
    recoveryUrl: null,
  };
}

/** Ultimo ordine reale del contatto, se disponibile. */
async function lastOrderContextFor(contact: Contact): Promise<RunOrderContext | null> {
  const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
  if (!email) return null;
  const snapshot = await col
    .orders()
    .where('emailNormalized', '==', email)
    .orderBy('placedAt', 'desc')
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  if (!doc) return null;
  const order = withId<Order>(doc);
  return {
    orderNumber: order.orderNumber ?? null,
    externalId: order.externalId,
    total: order.total ?? null,
    currency: order.currency ?? DEFAULT_CURRENCY,
    placedAt: order.placedAt,
    items: (order.items ?? []).slice(0, 12),
    recoveryUrl: null,
  };
}

export interface RenderedStep {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
  /** Codice coupon di esempio, se lo step ne prevede uno. */
  couponCode: string | null;
}

/**
 * Costruisce l'email di uno step con dati di esempio.
 * Nessun coupon viene realmente emesso: in anteprima il codice è fittizio.
 */
async function renderStepPreview(options: {
  automation: Automation;
  step: AutomationStep;
  contact: Contact;
  order: RunOrderContext | null;
  tracking: boolean;
}): Promise<RenderedStep> {
  const { automation, step, contact } = options;
  const document = await resolveStepDocument(step);
  if (!document) {
    throw new AppError(
      'failed_precondition',
      `Lo step "${step.name}" non ha un documento email né un template collegato.`,
    );
  }

  const branding = await readBrandingSettings();
  const appUrl = readParam(() => APP_URL.value(), 'https://newsletter.alphaink.net');
  let signingKey = '';
  try {
    signingKey = LINK_SIGNING_KEY.value() ?? '';
  } catch {
    signingKey = '';
  }

  const ref = `a:${automation.id}:${step.id}`;
  const couponCode = step.coupon?.enabled ? `${step.coupon.prefix}-XXXX-XXXX`.toUpperCase() : null;
  const order = options.order ?? sampleOrderContext();

  const urls = {
    ...buildSystemUrls(appUrl, signingKey, { id: contact.id, email: contact.email }, ref),
    recoveryUrl: order.recoveryUrl ?? branding.websiteUrl,
    couponUrl: null,
  };

  const merge = buildMergeContext({
    contact,
    order,
    coupon: couponCode
      ? {
          code: couponCode,
          discountType: step.coupon?.discountType ?? 'percent',
          discountValue: step.coupon?.discountValue ?? 0,
          discountLabel: step.coupon ? discountLabelOf(step.coupon) : null,
          expiresAt: new Date(Date.now() + (step.coupon?.validForDays ?? 30) * DAY_MS).toISOString(),
        }
      : undefined,
    branding,
    urls,
    timezone: automation.timezone,
    locale: DEFAULT_LOCALE,
    currency: order.currency ?? DEFAULT_CURRENCY,
  });

  // Nell'oggetto le entità HTML non hanno senso: si riportano ai caratteri veri.
  const subject = decodeBasicEntities(resolveMergeTags(step.subject, merge));
  const preheader = decodeBasicEntities(resolveMergeTags(step.preheader ?? '', merge));

  const email = buildEmail({
    document,
    context: { subject, preheader, merge, urls, branding, contact, isPreview: true },
    branding,
    tracking: options.tracking
      ? {
          clickTracking: true,
          openTracking: false,
          ref,
          contactId: contact.id,
          secret: signingKey,
          appUrl,
        }
      : null,
  });

  return {
    subject,
    preheader,
    html: email.html,
    text: email.text,
    warnings: email.warnings,
    blocking: email.blocking,
    couponCode,
  };
}

// -----------------------------------------------------------------------------
// previewAutomationStep
// -----------------------------------------------------------------------------

const previewSchema = z.object({
  automationId: z.string().min(1),
  stepId: z.string().min(1),
  sampleContactId: z.string().min(1).nullable().optional(),
});

export const previewAutomationStep = onCall(
  { ...HEAVY_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (request: CallableRequest<unknown>): Promise<RenderedStep> =>
    guard('previewAutomationStep', async () => {
      requirePermission(request, 'automations:read');
      const input = parseInput(previewSchema, request.data);

      const automation = await requireAutomation(input.automationId);
      const step = findStep(automation, input.stepId);
      if (!step) throw notFound('Step', input.stepId);

      const contact = input.sampleContactId
        ? ((await getContactById(input.sampleContactId)) ?? sampleContact())
        : sampleContact();
      const order = input.sampleContactId ? await lastOrderContextFor(contact) : null;

      return renderStepPreview({ automation, step, contact, order, tracking: false });
    }),
);

// -----------------------------------------------------------------------------
// sendAutomationTest
// -----------------------------------------------------------------------------

const testSchema = z.object({
  automationId: z.string().min(1),
  stepId: z.string().min(1),
  recipients: z.array(emailSchema).min(1).max(10),
  sampleContactId: z.string().min(1).nullable().optional(),
});

export const sendAutomationTest = onCall(
  { ...HEAVY_RUNTIME, secrets: [BREVO_API_KEY, LINK_SIGNING_KEY] },
  async (
    request: CallableRequest<unknown>,
  ): Promise<{ sent: number; messageId: string; subject: string; warnings: RenderWarning[] }> =>
    guard('sendAutomationTest', async () => {
      const caller = requirePermission(request, 'automations:write');
      const input = parseInput(testSchema, request.data);

      const automation = await requireAutomation(input.automationId);
      const step = findStep(automation, input.stepId);
      if (!step) throw notFound('Step', input.stepId);

      const contact = input.sampleContactId
        ? ((await getContactById(input.sampleContactId)) ?? sampleContact())
        : sampleContact();
      const order = input.sampleContactId ? await lastOrderContextFor(contact) : null;

      const rendered = await renderStepPreview({ automation, step, contact, order, tracking: false });
      if (rendered.blocking) {
        const problems = rendered.warnings
          .filter((warning) => warning.severity === 'errore')
          .map((warning) => warning.message)
          .join(' ');
        throw new AppError('failed_precondition', problems || 'Il contenuto dell\'email non è valido.');
      }

      const apiKey = requireApiKey();
      const brevo = await readBrevoSettings();
      const sender = resolveSender(brevo, { email: automation.fromEmail, name: automation.fromName });
      const replyTo = resolveReplyTo(brevo, automation.replyTo ?? null);

      const sent = await sendTransactionalEmail(apiKey, {
        to: input.recipients.map((email) => ({
          email,
          name: displayNameFor({
            firstName: contact.firstName,
            lastName: contact.lastName,
            company: contact.company,
            email,
          }),
        })),
        sender,
        replyTo,
        subject: `[TEST] ${rendered.subject}`,
        htmlContent: rendered.html,
        textContent: rendered.text,
        source: 'test',
        ref: `a:${automation.id}:${step.id}`,
        tags: [automation.key, 'test'],
        // `source: test` tiene gli eventi di prova fuori dalle statistiche
        // dell'automazione: il modulo di tracciamento li riconosce da qui.
        headers: {
          'X-Mailin-custom': JSON.stringify({
            source: 'test',
            automationId: automation.id,
            contactId: contact.id,
          }),
        },
      });

      await logActivity({
        action: 'automation.test',
        entityType: 'automation',
        entityId: automation.id,
        userId: caller.uid,
        summary: `Invio di prova dello step "${step.name}" a ${input.recipients.length} destinatari`,
        metadata: { recipients: input.recipients, stepId: step.id },
      });

      return {
        sent: input.recipients.length,
        messageId: sent.messageId,
        subject: rendered.subject,
        warnings: rendered.warnings,
      };
    }),
);

// -----------------------------------------------------------------------------
// resetAutomationToDefaults
// -----------------------------------------------------------------------------

const resetSchema = z.object({
  automationId: z.string().min(1),
  /** Ripristina anche il pubblico (filtro ed esclusioni). Default: sì. */
  resetAudience: z.boolean().default(true),
});

export const resetAutomationToDefaults = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<Automation> =>
    guard('resetAutomationToDefaults', async () => {
      const caller = requirePermission(request, 'automations:write');
      const input = parseInput(resetSchema, request.data);
      const automation = await requireAutomation(input.automationId);

      const branding = await readBrandingSettings();
      const defaults = buildDefaultAutomation(automation.key, branding);
      if (!defaults) {
        throw new AppError(
          'failed_precondition',
          `Per l'automazione "${automation.name}" non esiste una configurazione predefinita.`,
        );
      }

      // Si ripristinano contenuti, tempi e regole; **non** lo stato di
      // attivazione né le statistiche: spegnere un flusso funzionante durante un
      // ripristino dei testi sarebbe una sorpresa sgradita.
      const patch: Partial<Automation> = {
        name: defaults.name,
        description: defaults.description,
        trigger: defaults.trigger,
        steps: defaults.steps.map((step) => {
          const existing = findStep(automation, step.id);
          return { ...step, stats: existing?.stats ?? { ...EMPTY_STEP_STATS } };
        }),
        cooldownDays: defaults.cooldownDays,
        maxPerContactPerYear: defaults.maxPerContactPerYear,
        quietHours: defaults.quietHours,
        allowedWeekdays: defaults.allowedWeekdays,
        maxSendsPerHour: defaults.maxSendsPerHour,
        timezone: defaults.timezone,
        fromName: defaults.fromName,
        fromEmail: defaults.fromEmail,
        replyTo: defaults.replyTo,
      };
      if (input.resetAudience) {
        patch.audienceFilter = defaults.audienceFilter;
        patch.excludeClusterIds = defaults.excludeClusterIds;
      }

      const saved = await updateAutomation(automation.id, patch, caller.uid);
      await logActivity({
        action: 'automation.reset',
        entityType: 'automation',
        entityId: automation.id,
        userId: caller.uid,
        summary: `Automazione "${automation.name}" ripristinata ai contenuti predefiniti`,
      });
      return saved;
    }),
);

// -----------------------------------------------------------------------------
// getAutomationReport
// -----------------------------------------------------------------------------

const reportSchema = z.object({
  automationId: z.string().min(1),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  recentLimit: z.number().int().min(1).max(100).default(20),
});

export interface AutomationStepReport {
  id: string;
  name: string;
  enabled: boolean;
  subject: string;
  delay: AutomationStep['delay'];
  stats: AutomationStep['stats'];
  rates: { openRate: number; clickRate: number; cancelRate: number; conversionRate: number };
}

export interface AutomationReportPoint {
  day: string;
  sent: number;
  converted: number;
  revenue: number;
}

export interface AutomationRecentSend {
  runId: DocId;
  stepId: string;
  email: string;
  sentAt: IsoDate | null;
  messageId: string | null;
  couponCode: string | null;
  convertedOrderId: DocId | null;
  revenue: number | null;
}

export interface AutomationReport {
  automation: {
    id: DocId;
    key: AutomationKey;
    name: string;
    enabled: boolean;
    testMode: boolean;
    isCore: boolean;
    lastRunAt: IsoDate | null;
    lastError: string | null;
  };
  stats: Automation['stats'];
  rates: { openRate: number; clickRate: number; conversionRate: number };
  steps: AutomationStepReport[];
  timeseries: AutomationReportPoint[];
  recent: AutomationRecentSend[];
  range: { from: IsoDate; to: IsoDate };
}

export const getAutomationReport = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<AutomationReport> =>
    guard('getAutomationReport', async () => {
      requirePermission(request, 'analytics:read');
      const input = parseInput(reportSchema, request.data);
      const automation = await requireAutomation(input.automationId);

      const to = input.to ?? nowIso();
      const from = input.from ?? new Date(Date.parse(to) - 30 * DAY_MS).toISOString();

      const runs: AutomationRun[] = await listSentRunsBetween(automation.id, from, to);
      const timezone = automation.timezone || 'Europe/Rome';

      const byDay = new Map<string, AutomationReportPoint>();
      for (const run of runs) {
        if (!run.sentAt) continue;
        const day = dayKey(run.sentAt, timezone);
        const point = byDay.get(day) ?? { day, sent: 0, converted: 0, revenue: 0 };
        point.sent += 1;
        if (run.convertedOrderId) {
          point.converted += 1;
          point.revenue += run.revenue ?? 0;
        }
        byDay.set(day, point);
      }
      const timeseries = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));

      const steps: AutomationStepReport[] = (automation.steps ?? []).map((step) => {
        const stats = { ...EMPTY_STEP_STATS, ...(step.stats ?? {}) };
        return {
          id: step.id,
          name: step.name,
          enabled: step.enabled,
          subject: step.subject,
          delay: step.delay,
          stats,
          rates: {
            openRate: safeRate(stats.opened, stats.delivered || stats.sent),
            clickRate: safeRate(stats.clicked, stats.delivered || stats.sent),
            cancelRate: safeRate(stats.cancelled, stats.scheduled || stats.sent + stats.cancelled),
            conversionRate: safeRate(stats.orders, stats.sent),
          },
        };
      });

      const recent = (await recentSentRuns(automation.id, input.recentLimit)).map((run) => ({
        runId: run.id,
        stepId: run.stepId,
        email: run.email,
        sentAt: run.sentAt ?? null,
        messageId: run.messageId ?? null,
        couponCode: run.couponCode ?? null,
        convertedOrderId: run.convertedOrderId ?? null,
        revenue: run.revenue ?? null,
      }));

      const stats = automation.stats;
      return {
        automation: {
          id: automation.id,
          key: automation.key,
          name: automation.name,
          enabled: automation.enabled,
          testMode: automation.testMode,
          isCore: automation.isCore,
          lastRunAt: automation.lastRunAt ?? null,
          lastError: automation.lastError ?? null,
        },
        stats,
        rates: {
          openRate: safeRate(stats.opened, stats.delivered || stats.sent),
          clickRate: safeRate(stats.clicked, stats.delivered || stats.sent),
          conversionRate: safeRate(stats.orders, stats.sent),
        },
        steps,
        timeseries,
        recent,
        range: { from, to },
      };
    }),
);

/** Riallinea i contatori aggregati a partire dagli step: utile dopo un ripristino. */
export async function recomputeAutomationTotals(automationId: DocId): Promise<void> {
  const automation = await requireAutomation(automationId);
  const totals = (automation.steps ?? []).reduce(
    (acc, step) => {
      const stats = { ...EMPTY_STEP_STATS, ...(step.stats ?? {}) };
      acc.sent += stats.sent;
      acc.cancelled += stats.cancelled;
      acc.delivered += stats.delivered;
      acc.opened += stats.opened;
      acc.clicked += stats.clicked;
      acc.orders += stats.orders;
      acc.revenue += stats.revenue;
      return acc;
    },
    { sent: 0, cancelled: 0, delivered: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 },
  );

  await applyAutomationStats(automationId, {
    automation: {
      sent: totals.sent - (automation.stats?.sent ?? 0),
      cancelled: totals.cancelled - (automation.stats?.cancelled ?? 0),
      delivered: totals.delivered - (automation.stats?.delivered ?? 0),
      opened: totals.opened - (automation.stats?.opened ?? 0),
      clicked: totals.clicked - (automation.stats?.clicked ?? 0),
      orders: totals.orders - (automation.stats?.orders ?? 0),
      revenue: totals.revenue - (automation.stats?.revenue ?? 0),
    },
  });
}
