import type { DateRange, IsoDate } from '@alphaink/shared';

/**
 * Forma della risposta della callable `getDashboardMetrics`.
 * Ricalca i tipi esportati dalle Cloud Functions (`functions/src/tracking`):
 * il pacchetto condiviso non li espone, quindi vivono qui per il solo client.
 */

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

export interface DashboardMetricsInput {
  /** Ultimi N giorni, oggi incluso. */
  days: number;
  compare: boolean;
  topLimit: number;
}
