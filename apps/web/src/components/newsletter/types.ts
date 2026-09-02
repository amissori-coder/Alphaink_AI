import type {
  DocId,
  EmailDocument,
  IsoDate,
  Newsletter,
  NewsletterCategory,
  NewsletterStats,
  NewsletterStatus,
  Page,
  RecipientStatus,
} from '@alphaink/shared';

/**
 * Contratti delle callable usate dalle schermate newsletter.
 *
 * Rispecchiano fedelmente i tipi restituiti da `functions/src/newsletters/callables.ts`
 * e `functions/src/tracking/callables.ts`: non vanno modificati senza allineare
 * anche il backend.
 */

/** Gravità degli avvisi prodotti dal renderer delle email. */
export type WarningSeverity = 'info' | 'avviso' | 'errore';

export interface RenderWarning {
  code: string;
  message: string;
  severity: WarningSeverity | string;
  blockId?: string;
  sectionId?: string;
}

// -----------------------------------------------------------------------------
// Pubblico
// -----------------------------------------------------------------------------

/** Criteri di pubblico modificabili dalla UI (senza i campi calcolati). */
export interface AudienceCriteria {
  clusterIds: DocId[];
  excludeClusterIds: DocId[];
  includeContactIds: DocId[];
  excludeContactIds: DocId[];
  suppressIfContactedWithinDays?: number | null;
  suppressIfPurchasedWithinDays?: number | null;
}

export const EMPTY_AUDIENCE: AudienceCriteria = {
  clusterIds: [],
  excludeClusterIds: [],
  includeContactIds: [],
  excludeContactIds: [],
  suppressIfContactedWithinDays: null,
  suppressIfPurchasedWithinDays: null,
};

/** Motivi di esclusione restituiti da `estimateAudience`. */
export type AudienceExclusionReason =
  | 'not_found'
  | 'not_sendable'
  | 'invalid_email'
  | 'duplicate_email'
  | 'excluded_cluster'
  | 'excluded_contact'
  | 'suppressed_recently_contacted'
  | 'suppressed_recently_purchased';

export interface EstimateAudienceInput {
  newsletterId?: DocId | null;
  audience?: AudienceCriteria | null;
}

export interface AudienceEstimate {
  recipients: number;
  excludedCount: number;
  reasons: Partial<Record<AudienceExclusionReason, number>> & Record<string, number>;
  warnings: string[];
  estimatedAt: IsoDate;
}

// -----------------------------------------------------------------------------
// Azioni sulla newsletter
// -----------------------------------------------------------------------------

export interface NewsletterEnvelope {
  newsletter: Newsletter;
}

export interface ScheduleNewsletterInput {
  newsletterId: DocId;
  sendAt: IsoDate;
  timezone: string;
  throttle?: { batchSize: number; intervalMinutes: number } | null;
  quietHours?: { start: string; end: string } | null;
  optimizeSendTime?: boolean;
}

export interface ScheduleNewsletterResult {
  newsletter: Newsletter;
  estimatedRecipients: number;
  warnings: RenderWarning[];
}

export interface CancelScheduleResult {
  newsletter: Newsletter;
  cancelledBatches: number;
}

export interface SendNowResult {
  newsletterId: DocId;
  recipients: number;
  batches: number;
  sent: number;
}

export interface PauseResult {
  newsletter: Newsletter;
  pausedBatches: number;
}

export interface ResumeResult {
  newsletter: Newsletter;
  resumedBatches: number;
}

export interface DeleteNewsletterResult {
  deleted: true;
  recipients: number;
  batches: number;
}

export interface SendTestInput {
  newsletterId: DocId;
  recipients: string[];
  sampleContactId?: DocId | null;
  variantId?: string | null;
}

export interface SendTestResult {
  sent: number;
  subject: string;
  warnings: RenderWarning[];
  messageIds: Record<string, string>;
}

export interface PreviewInput {
  newsletterId?: DocId | null;
  document?: EmailDocument | null;
  subject?: string | null;
  preheader?: string | null;
  variantId?: string | null;
  sampleContactId?: DocId | null;
}

export interface NewsletterPreviewResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
}

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

export interface TimelinePoint {
  bucket: IsoDate;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
}

export interface TopLink {
  url: string;
  clicks: number;
  uniqueClicks: number;
}

export interface DomainStat {
  domain: string;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  openRate: number;
}

export interface BreakdownEntry {
  label: string;
  count: number;
  share: number;
}

export interface RecipientRow {
  id: string;
  contactId: string;
  email: string;
  status: RecipientStatus;
  variantId: string | null;
  sentAt: IsoDate | null;
  deliveredAt: IsoDate | null;
  firstOpenedAt: IsoDate | null;
  openCount: number;
  firstClickedAt: IsoDate | null;
  clickCount: number;
  unsubscribedAt: IsoDate | null;
  bounceReason: string | null;
  convertedOrderId: string | null;
  revenue: number | null;
}

export interface NewsletterReportInput {
  newsletterId: DocId;
  cursor?: string | null;
  limit?: number;
  status?: RecipientStatus | null;
  recipientsOnly?: boolean;
}

export interface NewsletterReportResult {
  newsletter: {
    id: string;
    name: string;
    subject: string;
    preheader: string | null;
    status: NewsletterStatus;
    category: NewsletterCategory | null;
    tags: string[];
    fromName: string;
    fromEmail: string;
    sentAt: IsoDate | null;
    completedAt: IsoDate | null;
    thumbnailUrl: string | null;
    brevoCampaignId: number | null;
  };
  stats: NewsletterStats;
  variants: Array<{
    id: string;
    name: string;
    subject: string;
    splitPercent: number;
    stats: NewsletterStats;
  }>;
  timeline: TimelinePoint[];
  timelineGranularity: 'hour' | 'day';
  topLinks: TopLink[];
  topDomains: DomainStat[];
  devices: BreakdownEntry[];
  clients: BreakdownEntry[];
  eventsScanned: number;
  eventsTruncated: boolean;
  recipients: Page<RecipientRow>;
  computedAt: IsoDate;
}

// -----------------------------------------------------------------------------
// Contatti (selettori del pubblico e dell'invio di prova)
// -----------------------------------------------------------------------------

/** Proiezione minima di un contatto usata dai selettori. */
export interface ContactOption {
  id: DocId;
  email: string;
  displayName: string;
  status: string;
  segment: 'b2c' | 'b2b';
}
