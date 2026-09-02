'use client';

import type { EmailDocument, Newsletter, NewsletterInput } from '@alphaink/shared';

import { callable } from '@/lib/firebase/client';

import type {
  AudienceEstimate,
  CancelScheduleResult,
  DeleteNewsletterResult,
  EstimateAudienceInput,
  NewsletterEnvelope,
  NewsletterPreviewResult,
  NewsletterReportInput,
  NewsletterReportResult,
  PauseResult,
  PreviewInput,
  ResumeResult,
  ScheduleNewsletterInput,
  ScheduleNewsletterResult,
  SendNowResult,
  SendTestInput,
  SendTestResult,
} from './types';

/**
 * Callable delle Cloud Functions usate dall'area newsletter.
 * I nomi corrispondono esattamente a quelli esportati da `functions/src/index.ts`.
 */

/**
 * Payload accettato da `createNewsletter`/`updateNewsletter`.
 *
 * È lo schema condiviso con il documento tipizzato come `EmailDocument`: il
 * tipo dedotto da zod descrive la stessa struttura ma perde le unioni
 * discriminate dei blocchi, e non è quindi utilizzabile lato editor.
 */
export interface NewsletterPayload extends Omit<NewsletterInput, 'document'> {
  document: EmailDocument;
}

export interface CreateNewsletterInput extends NewsletterPayload {
  /** Template di partenza: ne incrementa il contatore di utilizzo. */
  templateId?: string | null;
}

export interface UpdateNewsletterInput extends NewsletterPayload {
  newsletterId: string;
}

export const createNewsletter = callable<CreateNewsletterInput, NewsletterEnvelope>(
  'createNewsletter',
);

export const updateNewsletter = callable<UpdateNewsletterInput, NewsletterEnvelope>(
  'updateNewsletter',
);

export const duplicateNewsletter = callable<
  { newsletterId: string; name?: string },
  NewsletterEnvelope
>('duplicateNewsletter');

export const deleteNewsletter = callable<{ newsletterId: string }, DeleteNewsletterResult>(
  'deleteNewsletter',
  { timeoutMs: 300_000 },
);

export const archiveNewsletter = callable<
  { newsletterId: string; archived: boolean },
  NewsletterEnvelope
>('archiveNewsletter');

export const scheduleNewsletter = callable<ScheduleNewsletterInput, ScheduleNewsletterResult>(
  'scheduleNewsletter',
  { timeoutMs: 300_000 },
);

export const cancelNewsletterSchedule = callable<{ newsletterId: string }, CancelScheduleResult>(
  'cancelNewsletterSchedule',
);

export const sendNewsletterNow = callable<
  { newsletterId: string; confirm: true },
  SendNowResult
>('sendNewsletterNow', { timeoutMs: 540_000 });

export const pauseNewsletter = callable<{ newsletterId: string }, PauseResult>('pauseNewsletter');

export const resumeNewsletter = callable<{ newsletterId: string }, ResumeResult>('resumeNewsletter');

export const sendTestEmail = callable<SendTestInput, SendTestResult>('sendTestEmail', {
  timeoutMs: 180_000,
});

export const renderNewsletterPreview = callable<PreviewInput, NewsletterPreviewResult>(
  'renderNewsletterPreview',
  { timeoutMs: 180_000 },
);

export const estimateAudience = callable<EstimateAudienceInput, AudienceEstimate>(
  'estimateAudience',
  { timeoutMs: 180_000 },
);

export const getNewsletterReport = callable<NewsletterReportInput, NewsletterReportResult>(
  'getNewsletterReport',
  { timeoutMs: 180_000 },
);

/** Costruisce l'input completo richiesto da `createNewsletter`/`updateNewsletter`. */
export function toNewsletterInput(newsletter: Newsletter): NewsletterPayload {
  return {
    name: newsletter.name,
    subject: newsletter.subject,
    preheader: newsletter.preheader ?? null,
    fromName: newsletter.fromName,
    fromEmail: newsletter.fromEmail,
    replyTo: newsletter.replyTo ?? null,
    document: newsletter.document,
    audience: {
      clusterIds: newsletter.audience?.clusterIds ?? [],
      excludeClusterIds: newsletter.audience?.excludeClusterIds ?? [],
      includeContactIds: newsletter.audience?.includeContactIds ?? [],
      excludeContactIds: newsletter.audience?.excludeContactIds ?? [],
      suppressIfContactedWithinDays: newsletter.audience?.suppressIfContactedWithinDays ?? null,
      suppressIfPurchasedWithinDays: newsletter.audience?.suppressIfPurchasedWithinDays ?? null,
    },
    schedule: newsletter.schedule
      ? {
          sendAt: newsletter.schedule.sendAt,
          timezone: newsletter.schedule.timezone,
          throttle: newsletter.schedule.throttle ?? null,
          optimizeSendTime: newsletter.schedule.optimizeSendTime ?? false,
          quietHours: newsletter.schedule.quietHours ?? null,
        }
      : null,
    tags: newsletter.tags ?? [],
    color: newsletter.color ?? null,
    category: newsletter.category ?? null,
  };
}
