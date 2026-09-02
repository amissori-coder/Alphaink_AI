/**
 * Campagne email Brevo (`/emailCampaigns`).
 *
 * Usate per gli invii massivi verso liste Brevo: rispetto al canale
 * transazionale gestiscono da sole throttling, link di disiscrizione e
 * versione web, ma il contenuto è unico per tutti i destinatari.
 *
 * Vincoli rilevanti:
 *  - alla creazione servono `name`, `subject`, `sender` e almeno una lista in
 *    `recipients.listIds`;
 *  - `sender` accetta `{ name, email }` di un mittente verificato oppure
 *    `{ id }` del mittente già registrato;
 *  - una campagna già inviata non è più modificabile (Brevo risponde 400);
 *  - `PUT /emailCampaigns/{id}` e gli endpoint di stato rispondono 204.
 */

import type { BrevoEmailAddress } from './transactional';
import { AppError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { brevoRequest } from './client';

const log = createLogger('brevo.campaigns');

export interface CampaignSender extends Partial<BrevoEmailAddress> {
  /** Id del mittente, alternativo a `email`. */
  id?: number;
}

export interface CampaignRecipients {
  listIds: number[];
  exclusionListIds?: number[];
  segmentIds?: number[];
}

export interface CreateCampaignInput {
  name: string;
  subject: string;
  sender: CampaignSender;
  recipients: CampaignRecipients;
  htmlContent?: string;
  htmlUrl?: string;
  templateId?: number;
  replyTo?: string | null;
  /** Nome mostrato al destinatario, supporta i merge tag Brevo. */
  toField?: string;
  scheduledAt?: string | null;
  tag?: string;
  inlineImageActivation?: boolean;
  mirrorActive?: boolean;
  utmCampaign?: string;
  params?: Record<string, unknown>;
  header?: string;
  footer?: string;
  attachmentUrl?: string;
  sendAtBestTime?: boolean;
  /**
   * Campi aggiuntivi passati così come sono al corpo della richiesta:
   * evita di dover toccare questo modulo per ogni opzione nuova di Brevo.
   */
  extraFields?: Record<string, unknown>;
}

export type UpdateCampaignInput = Partial<CreateCampaignInput>;

/** Stati accettati da `PUT /emailCampaigns/{id}/status`. */
export type CampaignStatus =
  | 'suspended'
  | 'archive'
  | 'darchive'
  | 'sent'
  | 'queued'
  | 'replicate'
  | 'replicateTemplate';

export interface BrevoCampaignStatistics {
  sent: number;
  delivered: number;
  hardBounces: number;
  softBounces: number;
  deferred: number;
  viewed: number;
  uniqueViews: number;
  trackableViews: number;
  uniqueClicks: number;
  clickers: number;
  complaints: number;
  unsubscriptions: number;
}

export interface BrevoCampaign {
  id: number;
  name: string;
  subject?: string;
  status?: string;
  type?: string;
  scheduledAt?: string | null;
  sentDate?: string | null;
  shareLink?: string | null;
  tag?: string | null;
  createdAt?: string;
  modifiedAt?: string;
  recipients?: { lists?: number[]; exclusionLists?: number[] };
  statistics?: {
    globalStats?: Partial<BrevoCampaignStatistics> & Record<string, unknown>;
    linksStats?: Record<string, number>;
  };
}

export interface BrevoCampaignReport {
  id: number;
  name: string;
  subject: string | null;
  status: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  shareLink: string | null;
  statistics: BrevoCampaignStatistics;
  /** Click per URL, così come li espone Brevo. */
  linkClicks: Record<string, number>;
}

const EMPTY_STATISTICS: BrevoCampaignStatistics = {
  sent: 0,
  delivered: 0,
  hardBounces: 0,
  softBounces: 0,
  deferred: 0,
  viewed: 0,
  uniqueViews: 0,
  trackableViews: 0,
  uniqueClicks: 0,
  clickers: 0,
  complaints: 0,
  unsubscriptions: 0,
};

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function buildCampaignBody(input: UpdateCampaignInput): Record<string, unknown> {
  const { extraFields, sender, recipients, replyTo, ...rest } = input;
  return {
    ...rest,
    sender: sender
      ? sender.id
        ? { id: sender.id }
        : { name: sender.name, email: sender.email }
      : undefined,
    recipients: recipients
      ? {
          listIds: recipients.listIds,
          exclusionListIds: recipients.exclusionListIds?.length
            ? recipients.exclusionListIds
            : undefined,
          segmentIds: recipients.segmentIds?.length ? recipients.segmentIds : undefined,
        }
      : undefined,
    replyTo: replyTo ?? undefined,
    scheduledAt: input.scheduledAt ?? undefined,
    ...(extraFields ?? {}),
  };
}

/** Crea una campagna in bozza (o programmata se passi `scheduledAt`). */
export async function createEmailCampaign(
  apiKey: string,
  input: CreateCampaignInput,
): Promise<{ id: number }> {
  if (!input.recipients?.listIds?.length) {
    throw new AppError('invalid_argument', 'Seleziona almeno una lista Brevo di destinatari.');
  }
  const response = await brevoRequest<{ id: number }>('/emailCampaigns', {
    apiKey,
    method: 'POST',
    body: buildCampaignBody(input),
  });
  if (!response?.id) {
    throw new AppError('upstream_error', 'Brevo non ha restituito l\'id della campagna creata.');
  }
  return { id: response.id };
}

/** Aggiorna una campagna non ancora inviata. */
export async function updateEmailCampaign(
  apiKey: string,
  campaignId: number,
  patch: UpdateCampaignInput,
): Promise<void> {
  await brevoRequest<void>(`/emailCampaigns/${campaignId}`, {
    apiKey,
    method: 'PUT',
    body: buildCampaignBody(patch),
  });
}

/** Cambia lo stato della campagna (sospensione, archiviazione, messa in coda). */
export async function updateCampaignStatus(
  apiKey: string,
  campaignId: number,
  status: CampaignStatus,
): Promise<void> {
  await brevoRequest<void>(`/emailCampaigns/${campaignId}/status`, {
    apiKey,
    method: 'PUT',
    body: { status },
  });
}

/**
 * Programma l'invio: prima imposta `scheduledAt`, poi mette la campagna in coda.
 * Brevo rifiuta il passaggio a `queued` se la campagna è già in coda; in quel
 * caso l'orario aggiornato è comunque stato applicato, quindi ci limitiamo a
 * registrare un avviso.
 */
export async function scheduleEmailCampaign(
  apiKey: string,
  campaignId: number,
  scheduledAt: string,
): Promise<void> {
  await updateEmailCampaign(apiKey, campaignId, { scheduledAt });
  try {
    await updateCampaignStatus(apiKey, campaignId, 'queued');
  } catch (error) {
    if (error instanceof AppError && error.code === 'invalid_argument') {
      log.warn('Campagna già in coda su Brevo: aggiornato solo l\'orario', {
        campaignId,
        scheduledAt,
        message: error.message,
      });
      return;
    }
    throw error;
  }
}

/** Invia subito la campagna. */
export async function sendEmailCampaignNow(apiKey: string, campaignId: number): Promise<void> {
  await brevoRequest<void>(`/emailCampaigns/${campaignId}/sendNow`, { apiKey, method: 'POST' });
}

/** Invia una copia di prova agli indirizzi indicati. */
export async function sendTestCampaign(
  apiKey: string,
  campaignId: number,
  emails: readonly string[],
): Promise<void> {
  const emailTo = Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  if (emailTo.length === 0) {
    throw new AppError('invalid_argument', 'Indica almeno un indirizzo per l\'email di prova.');
  }
  await brevoRequest<void>(`/emailCampaigns/${campaignId}/sendTest`, {
    apiKey,
    method: 'POST',
    body: { emailTo },
  });
}

/** Legge la campagna così come la espone Brevo. */
export async function getEmailCampaign(apiKey: string, campaignId: number): Promise<BrevoCampaign> {
  return brevoRequest<BrevoCampaign>(`/emailCampaigns/${campaignId}`, { apiKey, method: 'GET' });
}

/** Legge la campagna e ne normalizza le statistiche. */
export async function getCampaignReport(
  apiKey: string,
  campaignId: number,
): Promise<BrevoCampaignReport> {
  const campaign = await getEmailCampaign(apiKey, campaignId);
  const stats = campaign.statistics?.globalStats ?? {};

  return {
    id: campaign.id ?? campaignId,
    name: campaign.name ?? '',
    subject: campaign.subject ?? null,
    status: campaign.status ?? null,
    scheduledAt: campaign.scheduledAt ?? null,
    sentAt: campaign.sentDate ?? null,
    shareLink: campaign.shareLink ?? null,
    statistics: {
      ...EMPTY_STATISTICS,
      sent: toNumber(stats.sent),
      delivered: toNumber(stats.delivered),
      hardBounces: toNumber(stats.hardBounces),
      softBounces: toNumber(stats.softBounces),
      deferred: toNumber(stats.deferred),
      viewed: toNumber(stats.viewed),
      uniqueViews: toNumber(stats.uniqueViews),
      trackableViews: toNumber(stats.trackableViews),
      uniqueClicks: toNumber(stats.uniqueClicks),
      clickers: toNumber(stats.clickers),
      complaints: toNumber(stats.complaints),
      unsubscriptions: toNumber(stats.unsubscriptions),
    },
    linkClicks: campaign.statistics?.linksStats ?? {},
  };
}

/** Elenca le campagne, filtrabili per stato. */
export async function listEmailCampaigns(
  apiKey: string,
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ campaigns: BrevoCampaign[]; count: number }> {
  const response = await brevoRequest<{ campaigns?: BrevoCampaign[]; count?: number }>(
    '/emailCampaigns',
    {
      apiKey,
      method: 'GET',
      query: {
        type: 'classic',
        status: options.status,
        limit: Math.min(options.limit ?? 50, 100),
        offset: options.offset ?? 0,
      },
    },
  );
  return { campaigns: response?.campaigns ?? [], count: response?.count ?? 0 };
}

/** Elimina una campagna. Tollera l'assenza. */
export async function deleteCampaign(apiKey: string, campaignId: number): Promise<void> {
  await brevoRequest<void>(`/emailCampaigns/${campaignId}`, {
    apiKey,
    method: 'DELETE',
    ignoreStatuses: [404],
  });
}
