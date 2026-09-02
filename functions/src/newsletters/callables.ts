/**
 * API delle newsletter usata dalla web app.
 *
 *  - `createNewsletter` / `updateNewsletter` / `duplicateNewsletter`
 *  - `deleteNewsletter` / `archiveNewsletter`
 *  - `scheduleNewsletter` / `cancelNewsletterSchedule`
 *  - `sendNewsletterNow` / `pauseNewsletter` / `resumeNewsletter`
 *  - `sendTestEmail` / `renderNewsletterPreview` / `estimateAudience`
 *  - `getCalendarEntries` (calendario editoriale)
 *
 * Convenzione condivisa con gli altri moduli: input validato con zod, errori
 * applicativi come `AppError` convertiti in `HttpsError` dal wrapper `guard`,
 * risultato restituito nudo (senza involucro `{ok,data}`).
 *
 * Ripartizione dei permessi:
 *  - `newsletter:write`    creare, modificare, duplicare, archiviare, provare
 *  - `newsletter:schedule` pianificare, annullare la pianificazione, pausa/ripresa
 *  - `newsletter:send`     inviare subito
 *  - `newsletter:read`     anteprime, stime e calendario
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  CALENDAR_STATUSES,
  DEFAULT_TIMEZONE,
  dayKey,
  displayNameFor,
  emailDocumentSchema,
  newsletterInputSchema,
  newsletterScheduleSchema,
  scheduleNewsletterSchema,
  sendTestSchema,
} from '@alphaink/shared';
import type {
  AutomationKey,
  DocId,
  EmailDocument,
  IsoDate,
  Newsletter,
  NewsletterCategory,
  NewsletterInput,
  NewsletterStatus,
} from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import { BREVO_API_KEY, HEAVY_RUNTIME, LIGHT_RUNTIME, LINK_SIGNING_KEY, TIMEZONE } from '../lib/config';
import { AppError, failedPrecondition, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { FieldValue, col, logActivity, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { requireApiKey, readBrevoSettings, resolveReplyTo, resolveSender } from '../brevo/settings';
import { sendTransactionalBatch } from '../brevo/transactional';
import { estimateAudienceSize } from '../clusters';
import { getContactById } from '../contacts/repository';
import type { RenderWarning } from '../render';
import {
  composeNewsletterEmail,
  customHeaderFor,
  loadNewsletterEnvironment,
  renderNewsletterMaster,
  sampleComposeContact,
  toComposeContact,
} from './compose';
import { runNewsletterDispatch } from './dispatcher';
import {
  assertEditable,
  buildNewsletterData,
  buildNewsletterPatch,
  createNewsletterRecord,
  deleteNewsletterRecord,
  requireNewsletter,
  transitionNewsletter,
  updateNewsletterRecord,
} from './repository';
import {
  cancelNewsletterQueue,
  dispatchNewsletter,
  finalizeNewsletterIfComplete,
  hasPreparedQueue,
  pauseNewsletterQueue,
  resumeNewsletterQueue,
} from './sender';

const log = createLogger('newsletters.callables');

/** Tolleranza sulla data di invio: evita errori per l'orologio del browser. */
const SCHEDULE_TOLERANCE_MS = 60_000;

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

/** Messaggio unico a partire dagli avvisi bloccanti. */
function blockingMessage(warnings: RenderWarning[]): string {
  return (
    warnings
      .filter((warning) => warning.severity === 'errore')
      .map((warning) => warning.message)
      .join(' ') || 'Il contenuto della newsletter non è valido.'
  );
}

/** Verifica che il contenuto sia spedibile; solleva se non lo è. */
async function assertSendable(newsletter: Newsletter): Promise<RenderWarning[]> {
  const env = await loadNewsletterEnvironment();
  const rendered = renderNewsletterMaster(newsletter, env);
  if (rendered.blocking) {
    throw new AppError('failed_precondition', blockingMessage(rendered.warnings));
  }
  return rendered.warnings;
}

// -----------------------------------------------------------------------------
// createNewsletter
// -----------------------------------------------------------------------------

const createSchema = newsletterInputSchema.extend({
  /** Template di partenza: ne incrementa il contatore di utilizzo. */
  templateId: z.string().min(1).nullable().optional(),
});

export const createNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter }> =>
    guard('createNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(createSchema, request.data);

      const newsletter = await createNewsletterRecord(input, caller.uid, {
        templateId: input.templateId ?? null,
      });

      if (input.templateId) {
        // Il contatore serve solo a ordinare i template più usati: se il
        // documento non esiste più non è un errore da propagare.
        await col
          .templates()
          .doc(input.templateId)
          .update({ usageCount: FieldValue.increment(1) })
          .catch(() => undefined);
      }

      await logActivity({
        action: 'newsletter.create',
        entityType: 'newsletter',
        entityId: newsletter.id,
        userId: caller.uid,
        summary: `Newsletter "${newsletter.name}" creata`,
      });

      return { newsletter };
    }),
);

// -----------------------------------------------------------------------------
// updateNewsletter
// -----------------------------------------------------------------------------

const updateSchema = newsletterInputSchema.extend({
  newsletterId: z.string().min(1),
});

export const updateNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter }> =>
    guard('updateNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(updateSchema, request.data);

      const existing = await requireNewsletter(input.newsletterId);
      assertEditable(existing);
      // `paused` è uno stato modificabile, ma non quando la spedizione è già
      // stata preparata: i batch rimasti partirebbero con il contenuto nuovo,
      // mentre chi è già stato servito ha in casella quello vecchio. Il
      // congelamento è anche nel trigger (`isContentFrozen`), qui si nega la
      // modifica per dirlo all'operatore invece di ignorarla in silenzio.
      if (existing.status === 'paused' && hasPreparedQueue(existing)) {
        throw failedPrecondition(
          'La spedizione è già iniziata ed è solo sospesa: il contenuto non può più essere modificato. ' +
            'Annulla la programmazione oppure duplica la newsletter per inviarne una versione diversa.',
        );
      }

      const patch = buildNewsletterPatch(existing, input, caller.uid);
      const newsletter = await updateNewsletterRecord(input.newsletterId, patch, caller.uid);
      return { newsletter };
    }),
);

// -----------------------------------------------------------------------------
// duplicateNewsletter
// -----------------------------------------------------------------------------

const duplicateSchema = z.object({
  newsletterId: z.string().min(1),
  name: z.string().trim().min(2).max(160).optional(),
});

export const duplicateNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter }> =>
    guard('duplicateNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(duplicateSchema, request.data);
      const source = await requireNewsletter(input.newsletterId);

      // La copia riparte da zero: niente statistiche, niente programmazione,
      // niente destinatari. Solo il contenuto e i criteri di pubblico.
      const copyInput = {
          name: input.name ?? `${source.name} (copia)`,
          subject: source.subject,
          preheader: source.preheader ?? null,
          fromName: source.fromName,
          fromEmail: source.fromEmail,
          replyTo: source.replyTo ?? null,
          document: source.document,
          audience: {
            clusterIds: source.audience?.clusterIds ?? [],
            excludeClusterIds: source.audience?.excludeClusterIds ?? [],
            includeContactIds: source.audience?.includeContactIds ?? [],
            excludeContactIds: source.audience?.excludeContactIds ?? [],
            suppressIfContactedWithinDays: source.audience?.suppressIfContactedWithinDays ?? null,
            suppressIfPurchasedWithinDays: source.audience?.suppressIfPurchasedWithinDays ?? null,
          },
          schedule: null,
          tags: source.tags ?? [],
          color: source.color ?? null,
          category: source.category ?? null,
      } as unknown as NewsletterInput;

      const copy = buildNewsletterData(copyInput, caller.uid);

      const ref = col.newsletters().doc();
      await ref.set({
        ...copy,
        duplicatedFromId: source.id,
        templateId: source.templateId ?? null,
        abTest: source.abTest ?? null,
        variants: (source.variants ?? []).map((variant) => ({
          ...variant,
          brevoCampaignId: null,
          stats: { ...copy.stats },
        })),
      });

      await logActivity({
        action: 'newsletter.duplicate',
        entityType: 'newsletter',
        entityId: ref.id,
        userId: caller.uid,
        summary: `Newsletter "${source.name}" duplicata`,
        metadata: { sourceId: source.id },
      });

      const newsletter = await requireNewsletter(ref.id);
      return { newsletter };
    }),
);

// -----------------------------------------------------------------------------
// deleteNewsletter
// -----------------------------------------------------------------------------

const idSchema = z.object({ newsletterId: z.string().min(1) });

/** Stati in cui l'eliminazione definitiva è consentita. */
const DELETABLE_STATUSES: NewsletterStatus[] = ['draft', 'cancelled', 'failed'];

export const deleteNewsletter = onCall(
  { ...HEAVY_RUNTIME },
  async (
    request: CallableRequest<unknown>,
  ): Promise<{ deleted: true; recipients: number; batches: number }> =>
    guard('deleteNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(idSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      if (!DELETABLE_STATUSES.includes(newsletter.status)) {
        throw failedPrecondition(
          'Una newsletter già inviata o in corso non si elimina: archiviala per toglierla dagli elenchi.',
        );
      }

      const removed = await deleteNewsletterRecord(input.newsletterId);
      await logActivity({
        action: 'newsletter.delete',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Newsletter "${newsletter.name}" eliminata`,
        metadata: { ...removed },
        severity: 'warning',
      });

      return { deleted: true, ...removed };
    }),
);

// -----------------------------------------------------------------------------
// archiveNewsletter
// -----------------------------------------------------------------------------

const archiveSchema = z.object({
  newsletterId: z.string().min(1),
  archived: z.boolean().default(true),
});

export const archiveNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter }> =>
    guard('archiveNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(archiveSchema, request.data);
      await requireNewsletter(input.newsletterId);

      const newsletter = await updateNewsletterRecord(
        input.newsletterId,
        { archived: input.archived },
        caller.uid,
      );
      return { newsletter };
    }),
);

// -----------------------------------------------------------------------------
// scheduleNewsletter
// -----------------------------------------------------------------------------

const scheduleSchema = scheduleNewsletterSchema.extend({
  throttle: newsletterScheduleSchema.shape.throttle,
  quietHours: newsletterScheduleSchema.shape.quietHours,
  optimizeSendTime: z.boolean().optional(),
});

export const scheduleNewsletter = onCall(
  { ...HEAVY_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (
    request: CallableRequest<unknown>,
  ): Promise<{ newsletter: Newsletter; estimatedRecipients: number; warnings: RenderWarning[] }> =>
    guard('scheduleNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:schedule');
      const input = parseInput(scheduleSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      if (Date.parse(input.sendAt) < Date.now() - SCHEDULE_TOLERANCE_MS) {
        throw invalidArgument('La data di invio è nel passato: scegli un momento futuro.');
      }

      const warnings = await assertSendable(newsletter);

      const estimate = await estimateAudienceSize(newsletter.audience);
      if (estimate.recipients === 0) {
        throw failedPrecondition(
          'Nessun destinatario contattabile con i criteri di pubblico impostati: la newsletter non può essere pianificata.',
        );
      }

      const updated = await transitionNewsletter(input.newsletterId, 'scheduled', {
        userId: caller.uid,
        expected: ['draft', 'scheduled', 'paused', 'failed', 'cancelled'],
        patch: {
          schedule: {
            sendAt: input.sendAt,
            timezone: input.timezone || TIMEZONE,
            throttle: input.throttle ?? newsletter.schedule?.throttle ?? null,
            optimizeSendTime: input.optimizeSendTime ?? newsletter.schedule?.optimizeSendTime ?? false,
            quietHours: input.quietHours ?? newsletter.schedule?.quietHours ?? null,
          },
          failureReason: null,
          cancelledAt: null,
          audience: {
            ...newsletter.audience,
            estimatedRecipients: estimate.recipients,
            estimatedAt: nowIso(),
          },
        },
      });

      await logActivity({
        action: 'newsletter.schedule',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Newsletter "${newsletter.name}" pianificata per ${input.sendAt}`,
        metadata: { sendAt: input.sendAt, recipients: estimate.recipients },
      });

      return {
        newsletter: updated ?? (await requireNewsletter(input.newsletterId)),
        estimatedRecipients: estimate.recipients,
        warnings,
      };
    }),
);

// -----------------------------------------------------------------------------
// cancelNewsletterSchedule
// -----------------------------------------------------------------------------

export const cancelNewsletterSchedule = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter; cancelledBatches: number }> =>
    guard('cancelNewsletterSchedule', async () => {
      const caller = requirePermission(request, 'newsletter:schedule');
      const input = parseInput(idSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      if (newsletter.status === 'sending') {
        throw failedPrecondition(
          'La spedizione è già iniziata: mettila in pausa prima di annullare la programmazione.',
        );
      }

      const cancelledBatches = await cancelNewsletterQueue(input.newsletterId);
      const updated = await transitionNewsletter(input.newsletterId, 'draft', {
        userId: caller.uid,
        expected: ['scheduled', 'queued', 'paused', 'failed'],
        patch: { schedule: null, queue: null, failureReason: null },
      });

      await logActivity({
        action: 'newsletter.cancel_schedule',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Programmazione della newsletter "${newsletter.name}" annullata`,
        metadata: { cancelledBatches },
      });

      return {
        newsletter: updated ?? (await requireNewsletter(input.newsletterId)),
        cancelledBatches,
      };
    }),
);

// -----------------------------------------------------------------------------
// sendNewsletterNow
// -----------------------------------------------------------------------------

const sendNowSchema = z.object({
  newsletterId: z.string().min(1),
  /** Conferma esplicita richiesta dalla UI prima di spedire davvero. */
  confirm: z.literal(true),
});

export const sendNewsletterNow = onCall(
  { ...HEAVY_RUNTIME, secrets: [BREVO_API_KEY, LINK_SIGNING_KEY] },
  async (
    request: CallableRequest<unknown>,
  ): Promise<{ newsletterId: DocId; recipients: number; batches: number; sent: number }> =>
    guard('sendNewsletterNow', async () => {
      const caller = requirePermission(request, 'newsletter:send');
      const input = parseInput(sendNowSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      await assertSendable(newsletter);
      // La chiave API si verifica prima di toccare lo stato: fallire dopo aver
      // messo la newsletter in coda lascerebbe l'operatore senza spiegazioni.
      requireApiKey();

      const now = nowIso();
      await transitionNewsletter(input.newsletterId, 'queued', {
        userId: caller.uid,
        expected: ['draft', 'scheduled', 'paused', 'failed'],
        patch: {
          schedule: {
            sendAt: now,
            timezone: newsletter.schedule?.timezone || TIMEZONE,
            throttle: newsletter.schedule?.throttle ?? null,
            optimizeSendTime: false,
            quietHours: null,
          },
          failureReason: null,
        },
      });

      const dispatched = await dispatchNewsletter(input.newsletterId, { userId: caller.uid });

      // Primo giro di invii subito, così le spedizioni piccole si concludono
      // mentre l'operatore è ancora davanti alla schermata. Il resto lo
      // completa il dispatcher programmato.
      const run = await runNewsletterDispatch({
        skipStart: true,
        onlyNewsletterId: input.newsletterId,
        budgetMs: 5 * 60 * 1000,
      });

      await logActivity({
        action: 'newsletter.send_now',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Invio immediato di "${newsletter.name}" a ${dispatched.recipients} destinatari`,
        metadata: { recipients: dispatched.recipients, batches: dispatched.batches, sent: run.sent },
      });

      return {
        newsletterId: input.newsletterId,
        recipients: dispatched.recipients,
        batches: dispatched.batches,
        sent: run.sent,
      };
    }),
);

// -----------------------------------------------------------------------------
// pauseNewsletter / resumeNewsletter
// -----------------------------------------------------------------------------

export const pauseNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter; pausedBatches: number }> =>
    guard('pauseNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:schedule');
      const input = parseInput(idSchema, request.data);
      await requireNewsletter(input.newsletterId);

      // Prima i batch, poi lo stato: un batch preso in carico nel frattempo
      // trova comunque la newsletter in pausa e si ferma da solo.
      const pausedBatches = await pauseNewsletterQueue(input.newsletterId);
      const updated = await transitionNewsletter(input.newsletterId, 'paused', {
        userId: caller.uid,
        expected: ['scheduled', 'queued', 'sending'],
        patch: {},
      });

      await logActivity({
        action: 'newsletter.pause',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Newsletter messa in pausa (${pausedBatches} batch sospesi)`,
      });

      return {
        newsletter: updated ?? (await requireNewsletter(input.newsletterId)),
        pausedBatches,
      };
    }),
);

export const resumeNewsletter = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ newsletter: Newsletter; resumedBatches: number }> =>
    guard('resumeNewsletter', async () => {
      const caller = requirePermission(request, 'newsletter:schedule');
      const input = parseInput(idSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      if (newsletter.status !== 'paused') {
        throw failedPrecondition('La newsletter non è in pausa.');
      }

      const resumedBatches = await resumeNewsletterQueue(input.newsletterId);
      // Con una spedizione già preparata si torna in `sending`; se non c'era
      // ancora nessuna coda, la newsletter torna semplicemente pianificata.
      const hadQueue = Boolean((newsletter as Newsletter & { queue?: unknown }).queue);
      const target: NewsletterStatus =
        resumedBatches > 0 || hadQueue ? 'sending' : newsletter.schedule ? 'scheduled' : 'draft';

      await transitionNewsletter(input.newsletterId, target, {
        userId: caller.uid,
        expected: ['paused'],
        patch: { failureReason: null },
      });

      // Pausa arrivata quando ormai era tutto spedito: la ripresa chiude la
      // spedizione invece di lasciarla eternamente "in corso".
      if (target === 'sending' && resumedBatches === 0) {
        await finalizeNewsletterIfComplete(input.newsletterId);
      }

      await logActivity({
        action: 'newsletter.resume',
        entityType: 'newsletter',
        entityId: input.newsletterId,
        userId: caller.uid,
        summary: `Newsletter ripresa (${resumedBatches} batch rimessi in coda)`,
      });

      // Si rilegge sempre: `finalizeNewsletterIfComplete` può aver appena
      // chiuso la spedizione e lo stato in memoria sarebbe già vecchio.
      return { newsletter: await requireNewsletter(input.newsletterId), resumedBatches };
    }),
);

// -----------------------------------------------------------------------------
// sendTestEmail
// -----------------------------------------------------------------------------

const testSchema = sendTestSchema.extend({
  variantId: z.string().min(1).nullable().optional(),
});

export const sendTestEmail = onCall(
  { ...HEAVY_RUNTIME, secrets: [BREVO_API_KEY, LINK_SIGNING_KEY] },
  async (
    request: CallableRequest<unknown>,
  ): Promise<{ sent: number; subject: string; warnings: RenderWarning[]; messageIds: Record<string, string> }> =>
    guard('sendTestEmail', async () => {
      const caller = requirePermission(request, 'newsletter:write');
      const input = parseInput(testSchema, request.data);
      const newsletter = await requireNewsletter(input.newsletterId);

      const contact = input.sampleContactId
        ? ((await getContactById(input.sampleContactId).then((found) =>
            found ? toComposeContact(found) : null,
          )) ?? sampleComposeContact())
        : sampleComposeContact();

      const env = await loadNewsletterEnvironment();
      const composed = composeNewsletterEmail(newsletter, contact, {
        env,
        variantId: input.variantId ?? null,
        isTest: true,
      });
      if (composed.blocking) {
        throw new AppError('failed_precondition', blockingMessage(composed.warnings));
      }

      const apiKey = requireApiKey();
      const brevo = await readBrevoSettings();
      const sender = resolveSender(brevo, { email: newsletter.fromEmail, name: newsletter.fromName });
      const replyTo = resolveReplyTo(brevo, newsletter.replyTo ?? null);

      // Un messaggio per destinatario, tutti con lo stesso contenuto: Brevo li
      // raggruppa in `messageVersions` e nessuno vede l'indirizzo degli altri.
      const messageIds = await sendTransactionalBatch(
        apiKey,
        input.recipients.map((email) => ({
          to: [{ email, name: displayNameFor({ email }) }],
          sender,
          replyTo,
          subject: `[TEST] ${composed.subject}`,
          htmlContent: composed.html,
          textContent: composed.text,
          source: 'test' as const,
          ref: composed.ref,
          tags: ['test', `newsletter-${newsletter.id}`],
          headers: {
            'X-Mailin-custom': customHeaderFor({
              ref: composed.ref,
              newsletterId: newsletter.id,
              variantId: composed.variantId,
              contactId: contact.id,
              isTest: true,
            }),
          },
        })),
      );

      const sentAt = nowIso();
      await col
        .newsletters()
        .doc(newsletter.id)
        .update({
          testSends: FieldValue.arrayUnion(
            ...input.recipients.map((email) => ({ email, sentAt, by: caller.uid })),
          ),
        });

      await logActivity({
        action: 'newsletter.test',
        entityType: 'newsletter',
        entityId: newsletter.id,
        userId: caller.uid,
        summary: `Invio di prova a ${input.recipients.length} indirizzi`,
        metadata: { recipients: input.recipients },
      });

      return {
        sent: input.recipients.length,
        subject: composed.subject,
        warnings: composed.warnings,
        messageIds,
      };
    }),
);

// -----------------------------------------------------------------------------
// renderNewsletterPreview
// -----------------------------------------------------------------------------

const previewSchema = z
  .object({
    newsletterId: z.string().min(1).nullable().optional(),
    /** Documento non ancora salvato: l'editor lo manda per l'anteprima dal vivo. */
    document: emailDocumentSchema.nullable().optional(),
    subject: z.string().max(300).nullable().optional(),
    preheader: z.string().max(300).nullable().optional(),
    variantId: z.string().min(1).nullable().optional(),
    sampleContactId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Boolean(value.newsletterId || value.document), {
    message: 'Indica una newsletter esistente oppure il documento da visualizzare.',
  });

export interface NewsletterPreview {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
}

export const renderNewsletterPreview = onCall(
  // `LINK_SIGNING_KEY` serve anche in anteprima: senza, i link tracciati
  // uscirebbero senza firma e l'anteprima non rispecchierebbe l'invio reale.
  { ...HEAVY_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (request: CallableRequest<unknown>): Promise<NewsletterPreview> =>
    guard('renderNewsletterPreview', async () => {
      requirePermission(request, 'newsletter:read');
      const input = parseInput(previewSchema, request.data);

      const stored = input.newsletterId ? await requireNewsletter(input.newsletterId) : null;
      if (!stored && !input.document) {
        throw notFound('Newsletter', input.newsletterId ?? undefined);
      }

      // Bozza virtuale: permette di vedere l'anteprima di un contenuto mai
      // salvato, senza scrivere nulla su Firestore.
      const newsletter: Newsletter = {
        ...(stored ??
          ({
            id: 'anteprima',
            name: 'Anteprima',
            fromName: '',
            fromEmail: '',
            status: 'draft',
            tags: [],
            sendAttempts: 0,
            archived: false,
          } as unknown as Newsletter)),
        subject: input.subject ?? stored?.subject ?? '',
        preheader: input.preheader ?? stored?.preheader ?? null,
        document: (input.document ?? stored?.document) as unknown as EmailDocument,
      };

      const contact = input.sampleContactId
        ? ((await getContactById(input.sampleContactId).then((found) =>
            found ? toComposeContact(found) : null,
          )) ?? sampleComposeContact())
        : sampleComposeContact();

      const env = await loadNewsletterEnvironment();
      const composed = composeNewsletterEmail(newsletter, contact, {
        env,
        variantId: input.variantId ?? null,
        isPreview: true,
        disableTracking: true,
      });

      return {
        subject: composed.subject,
        preheader: composed.preheader,
        html: composed.html,
        text: composed.text,
        warnings: composed.warnings,
        blocking: composed.blocking,
      };
    }),
);

// -----------------------------------------------------------------------------
// estimateAudience
// -----------------------------------------------------------------------------

const audienceCriteriaSchema = newsletterInputSchema.shape.audience;

const estimateSchema = z
  .object({
    newsletterId: z.string().min(1).nullable().optional(),
    audience: audienceCriteriaSchema.nullable().optional(),
  })
  .refine((value) => Boolean(value.newsletterId || value.audience), {
    message: 'Indica una newsletter oppure i criteri di pubblico da stimare.',
  });

export interface AudienceEstimate {
  recipients: number;
  excludedCount: number;
  reasons: Record<string, number>;
  warnings: string[];
  estimatedAt: IsoDate;
}

export const estimateAudience = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<AudienceEstimate> =>
    guard('estimateAudience', async () => {
      requirePermission(request, 'newsletter:read');
      const input = parseInput(estimateSchema, request.data);

      const stored = input.newsletterId ? await requireNewsletter(input.newsletterId) : null;
      const audience = input.audience
        ? { ...input.audience, estimatedRecipients: 0, estimatedAt: null }
        : stored?.audience;
      if (!audience) throw invalidArgument('Criteri di pubblico mancanti.');

      const estimate = await estimateAudienceSize(audience);
      const estimatedAt = nowIso();

      if (stored) {
        await col.newsletters().doc(stored.id).update({
          'audience.estimatedRecipients': estimate.recipients,
          'audience.estimatedAt': estimatedAt,
        });
      }

      return {
        recipients: estimate.recipients,
        excludedCount: estimate.excludedCount,
        reasons: estimate.reasons,
        warnings: estimate.warnings,
        estimatedAt,
      };
    }),
);

// -----------------------------------------------------------------------------
// getCalendarEntries
// -----------------------------------------------------------------------------

export interface CalendarEntry {
  id: string;
  type: 'newsletter' | 'automation';
  title: string;
  /** Istante dell'occorrenza (invio pianificato o effettivo). */
  date: IsoDate;
  /** Giorno locale `YYYY-MM-DD`: chiave di raggruppamento del calendario. */
  day: string;
  status: NewsletterStatus | 'scheduled';
  category: NewsletterCategory | null;
  color: string | null;
  recipients: number;
  newsletterId: DocId | null;
  automationId: DocId | null;
  automationKey: AutomationKey | null;
  /** Occorrenze aggregate nel giorno (solo per le automazioni). */
  occurrences: number;
  stats: { delivered: number; opened: number; clicked: number; revenue: number } | null;
}

const calendarSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  statuses: z.array(z.string().min(1)).max(10).optional(),
  categories: z.array(z.string().min(1)).max(10).optional(),
  includeArchived: z.boolean().default(false),
  /** Aggiunge le esecuzioni programmate delle automazioni. */
  includeAutomations: z.boolean().default(true),
  timezone: z.string().min(1).default(DEFAULT_TIMEZONE),
});

/** Occorrenze delle automazioni lette al massimo (una scansione, non un conteggio). */
const AUTOMATION_RUN_SCAN_LIMIT = 2_000;

function newsletterEntry(newsletter: Newsletter, date: IsoDate, timezone: string): CalendarEntry {
  return {
    id: `newsletter:${newsletter.id}`,
    type: 'newsletter',
    title: newsletter.name || newsletter.subject,
    date,
    day: dayKey(date, timezone),
    status: newsletter.status,
    category: newsletter.category ?? null,
    color: newsletter.color ?? null,
    recipients: newsletter.stats?.recipients || newsletter.audience?.estimatedRecipients || 0,
    newsletterId: newsletter.id,
    automationId: null,
    automationKey: null,
    occurrences: 1,
    stats: {
      delivered: newsletter.stats?.delivered ?? 0,
      opened: newsletter.stats?.uniqueOpened ?? 0,
      clicked: newsletter.stats?.uniqueClicked ?? 0,
      revenue: newsletter.stats?.revenue ?? 0,
    },
  };
}

export const getCalendarEntries = onCall(
  { ...HEAVY_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ entries: CalendarEntry[] }> =>
    guard('getCalendarEntries', async () => {
      requirePermission(request, 'newsletter:read');
      const input = parseInput(calendarSchema, request.data);

      const from = new Date(input.from).toISOString();
      const to = new Date(input.to).toISOString();
      if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
        throw invalidArgument('Intervallo di date non valido.');
      }

      // Due query a campo singolo (programmate e inviate): niente indice
      // composto da mantenere e nessun rischio di query rifiutata.
      const [plannedSnapshot, sentSnapshot] = await Promise.all([
        col
          .newsletters()
          .where('schedule.sendAt', '>=', from)
          .where('schedule.sendAt', '<=', to)
          .limit(500)
          .get(),
        col.newsletters().where('sentAt', '>=', from).where('sentAt', '<=', to).limit(500).get(),
      ]);

      const statuses = new Set(input.statuses?.length ? input.statuses : CALENDAR_STATUSES);
      const categories = new Set(input.categories ?? []);
      const byId = new Map<DocId, CalendarEntry>();

      const inRange = (value: IsoDate | null | undefined): boolean => {
        if (!value) return false;
        const time = Date.parse(value);
        return time >= Date.parse(from) && time <= Date.parse(to);
      };

      const consider = (newsletter: Newsletter, date: IsoDate | null | undefined): void => {
        if (!date) return;
        if (!input.includeArchived && newsletter.archived) return;
        if (!statuses.has(newsletter.status)) return;
        if (categories.size && !categories.has(newsletter.category ?? '')) return;
        // Una newsletter può comparire in entrambe le query: vince la data di
        // invio effettiva, che è quella che l'operatore si aspetta di vedere.
        const when = inRange(newsletter.sentAt) ? (newsletter.sentAt as IsoDate) : date;
        byId.set(newsletter.id, newsletterEntry(newsletter, when, input.timezone));
      };

      for (const doc of plannedSnapshot.docs) {
        const newsletter = withId<Newsletter>(doc);
        consider(newsletter, newsletter.schedule?.sendAt ?? null);
      }
      for (const doc of sentSnapshot.docs) {
        const newsletter = withId<Newsletter>(doc);
        consider(newsletter, newsletter.sentAt ?? newsletter.schedule?.sendAt ?? null);
      }

      const entries = Array.from(byId.values());

      // --- Automazioni --------------------------------------------------------
      if (input.includeAutomations) {
        const runs = await col
          .allAutomationRuns()
          .where('status', '==', 'scheduled')
          .where('scheduledFor', '>=', from)
          .where('scheduledFor', '<=', to)
          .select('automationId', 'automationKey', 'scheduledFor')
          .limit(AUTOMATION_RUN_SCAN_LIMIT)
          .get();

        // Le occorrenze si aggregano per automazione e per giorno: il calendario
        // mostra "Riacquisto Toner — 42 invii previsti", non 42 righe.
        const grouped = new Map<string, CalendarEntry>();
        for (const doc of runs.docs) {
          const scheduledFor = (doc.get('scheduledFor') as IsoDate) ?? null;
          if (!scheduledFor) continue;
          const automationId = (doc.get('automationId') as string) ?? doc.ref.parent.parent?.id ?? '';
          const automationKey = (doc.get('automationKey') as AutomationKey) ?? null;
          const day = dayKey(scheduledFor, input.timezone);
          const key = `${automationId}:${day}`;
          const existing = grouped.get(key);
          if (existing) {
            existing.occurrences += 1;
            existing.recipients += 1;
            continue;
          }
          grouped.set(key, {
            id: `automation:${key}`,
            type: 'automation',
            title: automationKey ?? 'Automazione',
            date: scheduledFor,
            day,
            status: 'scheduled',
            category: 'automazione',
            color: null,
            recipients: 1,
            newsletterId: null,
            automationId,
            automationKey,
            occurrences: 1,
            stats: null,
          });
        }

        // I nomi leggibili stanno sul documento automazione: una lettura sola.
        const automationIds = Array.from(
          new Set(Array.from(grouped.values()).map((entry) => entry.automationId).filter(Boolean)),
        ) as DocId[];
        if (automationIds.length) {
          const snapshots = await Promise.all(
            automationIds.map((id) => col.automations().doc(id).get()),
          );
          const names = new Map(
            snapshots
              .filter((snapshot) => snapshot.exists)
              .map((snapshot) => [snapshot.id, (snapshot.get('name') as string) ?? snapshot.id]),
          );
          for (const entry of grouped.values()) {
            if (entry.automationId && names.has(entry.automationId)) {
              entry.title = names.get(entry.automationId) as string;
            }
          }
        }

        entries.push(...grouped.values());
      }

      entries.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      return { entries };
    }),
);
