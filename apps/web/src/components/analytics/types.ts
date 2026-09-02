import type {
  DateRange,
  DocId,
  IsoDate,
  NewsletterCategory,
  NewsletterStats,
  NewsletterStatus,
} from '@alphaink/shared';

/**
 * Contratti delle callable analitiche.
 *
 * Rispecchiano i tipi restituiti da `functions/src/tracking/callables.ts`
 * (`getDashboardMetrics`, `getNewsletterReport`): il pacchetto condiviso non li
 * espone, quindi vivono qui per il solo client.
 */

// -----------------------------------------------------------------------------
// getDashboardMetrics
// -----------------------------------------------------------------------------

export interface ChannelMetrics {
  sent: number;
  delivered: number;
  opened: number;
  uniqueOpened: number;
  proxyOpened: number;
  clicked: number;
  uniqueClicked: number;
  softBounces: number;
  hardBounces: number;
  blocked: number;
  complaints: number;
  unsubscribed: number;
  orders: number;
  revenue: number;
}

export const EMPTY_CHANNEL_METRICS: ChannelMetrics = {
  sent: 0,
  delivered: 0,
  opened: 0,
  uniqueOpened: 0,
  proxyOpened: 0,
  clicked: 0,
  uniqueClicked: 0,
  softBounces: 0,
  hardBounces: 0,
  blocked: 0,
  complaints: 0,
  unsubscribed: 0,
  orders: 0,
  revenue: 0,
};

export interface MetricRates {
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  bounceRate: number;
  unsubscribeRate: number;
  conversionRate: number;
  revenuePerDelivered: number;
}

export interface DashboardSeriesPoint extends ChannelMetrics {
  /** Chiave giorno `YYYY-MM-DD` nel fuso Europe/Rome. */
  day: string;
  /** Il giorno non è ancora concluso: i valori possono cambiare. */
  partial: boolean;
}

export interface TopNewsletter {
  id: string;
  name: string;
  subject: string;
  sentAt: IsoDate | null;
  recipients: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  orders: number;
  revenue: number;
}

export interface DashboardAudience {
  total: number;
  subscribed: number;
  unsubscribed: number;
  notSendable: number;
}

export interface DashboardMetricsInput {
  from?: IsoDate;
  to?: IsoDate;
  /** Alternativa a from/to: ultimi N giorni, oggi incluso. */
  days?: number;
  compare?: boolean;
  topLimit?: number;
}

export interface DashboardMetricsResult {
  range: DateRange;
  timezone: string;
  totals: ChannelMetrics;
  rates: MetricRates;
  channels: { newsletter: ChannelMetrics; automation: ChannelMetrics };
  store: { orders: number; revenue: number; currency: string };
  /** Quota del fatturato del negozio attribuita alle email (0-1). */
  emailRevenueShare: number;
  series: DashboardSeriesPoint[];
  previous: { range: DateRange; totals: ChannelMetrics } | null;
  /** Variazione relativa rispetto al periodo precedente (0.12 = +12%). */
  deltas: Record<string, number> | null;
  audience: DashboardAudience;
  topNewsletters: TopNewsletter[];
  /** Giorni non consolidati e non ricalcolati: valgono zero. */
  missingDays: string[];
  computedAt: IsoDate;
}

// -----------------------------------------------------------------------------
// getNewsletterReport (sottoinsieme usato dall'area analytics)
// -----------------------------------------------------------------------------

export interface TimelinePoint {
  /** Inizio del bucket, in UTC. */
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

export interface NewsletterReportInput {
  newsletterId: DocId;
  cursor?: string | null;
  limit?: number;
  /** Salta l'analisi degli eventi quando servono solo i totali. */
  recipientsOnly?: boolean;
}

export interface NewsletterReportSummary {
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
}

export interface NewsletterReportResult {
  newsletter: NewsletterReportSummary;
  stats: NewsletterStats;
  timeline: TimelinePoint[];
  timelineGranularity: 'hour' | 'day';
  topLinks: TopLink[];
  topDomains: DomainStat[];
  devices: BreakdownEntry[];
  clients: BreakdownEntry[];
  eventsScanned: number;
  eventsTruncated: boolean;
  computedAt: IsoDate;
}
