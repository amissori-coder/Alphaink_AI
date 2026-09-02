/**
 * Callable di reportistica.
 *
 *  - `getDashboardMetrics` — andamento del periodo per la home: totali, serie
 *    storica giorno per giorno, ripartizione fra newsletter e automazioni,
 *    confronto con il periodo precedente e classifica delle campagne.
 *  - `getNewsletterReport` — scheda completa di una singola newsletter:
 *    statistiche, andamento nel tempo, link più cliccati, domini, dispositivi
 *    e l'elenco paginato dei destinatari.
 *
 * La dashboard legge i documenti già consolidati in `metricsDaily`; solo i
 * giorni non ancora consolidati (oggi, o un buco lasciato da un guasto)
 * vengono calcolati al volo, e non più di `MAX_LIVE_DAYS` per non trasformare
 * l'apertura del cruscotto in una scansione di centinaia di migliaia di eventi.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  DEFAULT_CURRENCY,
  EMPTY_STATS,
  dayKey,
  emailDomain,
  safeRate,
} from '@alphaink/shared';
import type {
  BrevoEventType,
  DateRange,
  IsoDate,
  Newsletter,
  NewsletterRecipient,
  NewsletterStats,
  Page,
  RecipientStatus,
} from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import { LIGHT_RUNTIME, TIMEZONE } from '../lib/config';
import { invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { col, db, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { chunk } from '../lib/async';
import {
  addMetrics,
  computeDailyMetrics,
  daysInRange,
  emptyChannelMetrics,
  previousDay,
} from './metrics';
import type { ChannelMetrics, DailyMetrics } from './metrics';

const log = createLogger('tracking.callables');

/** Giorni non consolidati che accettiamo di calcolare a richiesta. */
export const MAX_LIVE_DAYS = 2;

/** Periodo massimo interrogabile dalla dashboard. */
export const MAX_RANGE_DAYS = 366;

/** Eventi letti al massimo per il report di una newsletter. */
export const REPORT_EVENT_LIMIT = 20_000;

/** Destinatari restituiti per pagina. */
export const REPORT_PAGE_SIZE = 50;

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

// =============================================================================
// getDashboardMetrics
// =============================================================================

const dashboardSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    /** Alternativa a from/to: ultimi N giorni (oggi incluso). */
    days: z.number().int().min(1).max(MAX_RANGE_DAYS).optional(),
    /** Confronto con il periodo immediatamente precedente. */
    compare: z.boolean().default(true),
    /** Numero di newsletter nella classifica. */
    topLimit: z.number().int().min(1).max(50).default(5),
  })
  .default({ compare: true, topLimit: 5 });

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
  day: string;
  /** Il giorno non è ancora concluso. */
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

export interface DashboardMetricsResult {
  range: DateRange;
  timezone: string;
  totals: ChannelMetrics;
  rates: MetricRates;
  channels: { newsletter: ChannelMetrics; automation: ChannelMetrics };
  store: { orders: number; revenue: number; currency: string };
  emailRevenueShare: number;
  series: DashboardSeriesPoint[];
  previous: { range: DateRange; totals: ChannelMetrics } | null;
  /** Variazione percentuale rispetto al periodo precedente (0.12 = +12%). */
  deltas: Record<string, number> | null;
  audience: { total: number; subscribed: number; unsubscribed: number; notSendable: number };
  topNewsletters: TopNewsletter[];
  /** Giorni non consolidati e non ricalcolati: i valori sono a zero. */
  missingDays: string[];
  computedAt: IsoDate;
}

function ratesOf(metrics: ChannelMetrics): MetricRates {
  const base = metrics.sent || metrics.delivered;
  return {
    deliveryRate: safeRate(metrics.delivered, base),
    openRate: safeRate(metrics.uniqueOpened, metrics.delivered),
    clickRate: safeRate(metrics.uniqueClicked, metrics.delivered),
    clickToOpenRate: safeRate(metrics.uniqueClicked, metrics.uniqueOpened),
    bounceRate: safeRate(metrics.softBounces + metrics.hardBounces + metrics.blocked, base),
    unsubscribeRate: safeRate(metrics.unsubscribed, metrics.delivered),
    conversionRate: safeRate(metrics.orders, metrics.delivered),
    revenuePerDelivered: safeRate(metrics.revenue, metrics.delivered),
  };
}

/** Variazione relativa fra due periodi, protetta dalla divisione per zero. */
function deltasBetween(current: ChannelMetrics, previous: ChannelMetrics): Record<string, number> {
  const deltas: Record<string, number> = {};
  for (const key of Object.keys(current) as Array<keyof ChannelMetrics>) {
    const before = Number(previous[key] ?? 0);
    const after = Number(current[key] ?? 0);
    deltas[key] = before === 0 ? (after === 0 ? 0 : 1) : Math.round(((after - before) / before) * 1000) / 1000;
  }
  return deltas;
}

/** Legge i giorni consolidati; per quelli mancanti decide se calcolarli. */
async function loadDays(
  days: string[],
  options: { allowLive: boolean },
): Promise<{ metrics: Map<string, DailyMetrics>; missing: string[] }> {
  const metrics = new Map<string, DailyMetrics>();
  const missing: string[] = [];

  for (const block of chunk(days, 300)) {
    const snapshots = await db.getAll(...block.map((day) => col.metricsDaily().doc(day)));
    for (const snapshot of snapshots) {
      if (snapshot.exists) metrics.set(snapshot.id, withId<DailyMetrics>(snapshot));
      else missing.push(snapshot.id);
    }
  }

  if (!options.allowLive) return { metrics, missing };

  // Solo i giorni più recenti valgono il costo di una scansione live: sono
  // quelli che il job notturno non ha ancora consolidato.
  const live = missing.slice(-MAX_LIVE_DAYS);
  const stillMissing: string[] = [];
  for (const day of missing) {
    if (!live.includes(day)) {
      stillMissing.push(day);
      continue;
    }
    try {
      metrics.set(day, await computeDailyMetrics(day));
    } catch (error) {
      log.error('Calcolo metriche del giorno fallito', error, { day });
      stillMissing.push(day);
    }
  }

  return { metrics, missing: stillMissing };
}

/** Somma i giorni caricati in un unico insieme di metriche per canale. */
function aggregate(days: string[], loaded: Map<string, DailyMetrics>): {
  totals: ChannelMetrics;
  newsletter: ChannelMetrics;
  automation: ChannelMetrics;
  store: { orders: number; revenue: number; currency: string };
  series: DashboardSeriesPoint[];
} {
  let totals = emptyChannelMetrics();
  let newsletter = emptyChannelMetrics();
  let automation = emptyChannelMetrics();
  const store = { orders: 0, revenue: 0, currency: DEFAULT_CURRENCY };
  const series: DashboardSeriesPoint[] = [];

  for (const day of days) {
    const metrics = loaded.get(day);
    const channelTotal = metrics?.channels?.total ?? emptyChannelMetrics();
    totals = addMetrics(totals, channelTotal);
    newsletter = addMetrics(newsletter, metrics?.channels?.newsletter ?? emptyChannelMetrics());
    automation = addMetrics(automation, metrics?.channels?.automation ?? emptyChannelMetrics());
    store.orders += metrics?.store?.orders ?? 0;
    store.revenue += metrics?.store?.revenue ?? 0;
    if (metrics?.store?.currency) store.currency = metrics.store.currency;

    series.push({ ...channelTotal, day, partial: metrics?.partial ?? false });
  }

  store.revenue = Math.round(store.revenue * 100) / 100;
  return { totals, newsletter, automation, store, series };
}

/** Fotografia della rubrica: numeri assoluti, non legati al periodo. */
async function audienceSnapshot(): Promise<DashboardMetricsResult['audience']> {
  const contacts = col.contacts();
  const [total, subscribed, unsubscribed] = await Promise.all([
    contacts.count().get(),
    contacts.where('status', '==', 'subscribed').count().get(),
    contacts.where('status', '==', 'unsubscribed').count().get(),
  ]);

  const totalCount = total.data().count;
  const subscribedCount = subscribed.data().count;
  return {
    total: totalCount,
    subscribed: subscribedCount,
    unsubscribed: unsubscribed.data().count,
    notSendable: Math.max(0, totalCount - subscribedCount),
  };
}

/** Classifica delle newsletter spedite nel periodo. */
async function topNewsletters(range: DateRange, limit: number): Promise<TopNewsletter[]> {
  const snapshot = await col
    .newsletters()
    .where('status', '==', 'sent')
    .where('sentAt', '>=', range.from)
    .where('sentAt', '<=', range.to)
    .orderBy('sentAt', 'desc')
    .limit(200)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Partial<Newsletter>;
      const stats: NewsletterStats = { ...EMPTY_STATS, ...(data.stats ?? {}) };
      return {
        id: doc.id,
        name: data.name ?? '',
        subject: data.subject ?? '',
        sentAt: data.sentAt ?? null,
        recipients: stats.recipients,
        delivered: stats.delivered,
        openRate: stats.openRate,
        clickRate: stats.clickRate,
        orders: stats.orders,
        revenue: stats.revenue,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.openRate - a.openRate)
    .slice(0, limit);
}

export const getDashboardMetrics = onCall(
  { ...LIGHT_RUNTIME, timeoutSeconds: 120 },
  async (request: CallableRequest<unknown>): Promise<DashboardMetricsResult> =>
    guard('getDashboardMetrics', async () => {
      requirePermission(request, 'analytics:read');
      const input = parseInput(dashboardSchema, request.data);

      const today = dayKey(new Date(), TIMEZONE);
      const toDay = input.to ? dayKey(input.to, TIMEZONE) : today;
      const fromDay = input.from
        ? dayKey(input.from, TIMEZONE)
        : shiftDays(toDay, -(input.days ?? 30) + 1);

      if (fromDay > toDay) throw invalidArgument('L\'inizio del periodo è successivo alla fine.');

      const days = daysInRange(`${fromDay}T12:00:00Z`, `${toDay}T12:00:00Z`, TIMEZONE);
      if (days.length > MAX_RANGE_DAYS) {
        throw invalidArgument(`Il periodo non può superare ${MAX_RANGE_DAYS} giorni.`);
      }

      const { metrics: loaded, missing } = await loadDays(days, { allowLive: true });
      const current = aggregate(days, loaded);

      let previous: DashboardMetricsResult['previous'] = null;
      let deltas: Record<string, number> | null = null;
      if (input.compare) {
        const previousTo = previousDay(fromDay);
        const previousFrom = shiftDays(previousTo, -(days.length - 1));
        const previousDays = daysInRange(`${previousFrom}T12:00:00Z`, `${previousTo}T12:00:00Z`, TIMEZONE);
        const { metrics: previousLoaded } = await loadDays(previousDays, { allowLive: false });
        const aggregated = aggregate(previousDays, previousLoaded);
        previous = {
          range: { from: `${previousFrom}T00:00:00.000Z`, to: `${previousTo}T23:59:59.999Z` },
          totals: aggregated.totals,
        };
        deltas = deltasBetween(current.totals, aggregated.totals);
      }

      const range: DateRange = {
        from: loaded.get(days[0]!)?.from ?? `${fromDay}T00:00:00.000Z`,
        to: loaded.get(days[days.length - 1]!)?.to ?? `${toDay}T23:59:59.999Z`,
      };

      const [audience, top] = await Promise.all([
        audienceSnapshot(),
        topNewsletters(range, input.topLimit),
      ]);

      return {
        range,
        timezone: TIMEZONE,
        totals: current.totals,
        rates: ratesOf(current.totals),
        channels: { newsletter: current.newsletter, automation: current.automation },
        store: current.store,
        emailRevenueShare: safeRate(current.totals.revenue, current.store.revenue),
        series: current.series,
        previous,
        deltas,
        audience,
        topNewsletters: top,
        missingDays: missing,
        computedAt: nowIso(),
      };
    }),
);

/** Sposta una chiave giorno di N giorni (positivi o negativi). */
function shiftDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

// =============================================================================
// getNewsletterReport
// =============================================================================

const reportSchema = z.object({
  newsletterId: z.string().min(1, 'Newsletter mancante'),
  /** Cursore della pagina destinatari: id dell'ultimo elemento ricevuto. */
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(200).default(REPORT_PAGE_SIZE),
  status: z
    .enum([
      'pending',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'converted',
      'soft_bounced',
      'hard_bounced',
      'blocked',
      'unsubscribed',
      'spam',
      'failed',
    ])
    .nullable()
    .optional(),
  /** Salta l'analisi degli eventi quando serve solo la pagina successiva. */
  recipientsOnly: z.boolean().default(false),
});

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

export interface NewsletterReportResult {
  newsletter: {
    id: string;
    name: string;
    subject: string;
    preheader: string | null;
    status: Newsletter['status'];
    category: Newsletter['category'];
    tags: string[];
    fromName: string;
    fromEmail: string;
    sentAt: IsoDate | null;
    completedAt: IsoDate | null;
    thumbnailUrl: string | null;
    brevoCampaignId: number | null;
  };
  stats: NewsletterStats;
  variants: Array<{ id: string; name: string; subject: string; splitPercent: number; stats: NewsletterStats }>;
  timeline: TimelinePoint[];
  /** Granularità della serie: `hour` nelle prime 72 ore, poi `day`. */
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

/** Tipi di evento che alimentano il report. */
const REPORT_EVENT_TYPES: BrevoEventType[] = [
  'delivered',
  'opened',
  'unique_opened',
  'proxy_open',
  'click',
  'unsubscribed',
  'soft_bounce',
  'hard_bounce',
  'blocked',
  'spam',
];

function bucketKey(occurredAt: string, granularity: 'hour' | 'day'): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return occurredAt;
  if (granularity === 'hour') {
    date.setUTCMinutes(0, 0, 0);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

function emptyPoint(bucket: string): TimelinePoint {
  return { bucket, delivered: 0, opened: 0, clicked: 0, unsubscribed: 0, bounced: 0 };
}

function toBreakdown(counts: Map<string, number>, total: number): BreakdownEntry[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, share: safeRate(count, total) }))
    .sort((a, b) => b.count - a.count);
}

/** Analisi degli eventi della newsletter: serie storica, link, domini, device. */
async function analyseEvents(
  newsletterId: string,
  sentAt: IsoDate | null,
): Promise<{
  timeline: TimelinePoint[];
  granularity: 'hour' | 'day';
  topLinks: TopLink[];
  topDomains: DomainStat[];
  devices: BreakdownEntry[];
  clients: BreakdownEntry[];
  scanned: number;
  truncated: boolean;
}> {
  const snapshot = await col
    .events()
    .where('newsletterId', '==', newsletterId)
    .where('type', 'in', REPORT_EVENT_TYPES)
    .orderBy('occurredAt', 'asc')
    .select('type', 'occurredAt', 'email', 'url', 'device', 'emailClient')
    .limit(REPORT_EVENT_LIMIT)
    .get();

  const start = sentAt ? Date.parse(sentAt) : Date.parse(snapshot.docs[0]?.get('occurredAt') ?? nowIso());
  const last = snapshot.docs[snapshot.size - 1]?.get('occurredAt') as string | undefined;
  const span = last ? Date.parse(last) - start : 0;
  const granularity: 'hour' | 'day' = span <= 72 * 3_600_000 ? 'hour' : 'day';

  const buckets = new Map<string, TimelinePoint>();
  const linkClicks = new Map<string, { clicks: number; contacts: Set<string> }>();
  const domains = new Map<string, DomainStat>();
  const devices = new Map<string, number>();
  const clients = new Map<string, number>();
  const seenOpens = new Set<string>();
  const seenClicks = new Set<string>();
  let interactions = 0;

  const domainOf = (email: string): DomainStat => {
    const domain = emailDomain(email) || 'sconosciuto';
    const existing = domains.get(domain);
    if (existing) return existing;
    const created: DomainStat = { domain, delivered: 0, opened: 0, clicked: 0, bounced: 0, openRate: 0 };
    domains.set(domain, created);
    return created;
  };

  for (const doc of snapshot.docs) {
    const type = doc.get('type') as BrevoEventType;
    const occurredAt = (doc.get('occurredAt') as string | undefined) ?? nowIso();
    const email = (doc.get('email') as string | undefined) ?? '';
    const key = bucketKey(occurredAt, granularity);
    const point = buckets.get(key) ?? emptyPoint(key);
    const domain = domainOf(email);

    switch (type) {
      case 'delivered':
        point.delivered += 1;
        domain.delivered += 1;
        break;
      case 'opened':
      case 'unique_opened':
      case 'proxy_open': {
        point.opened += 1;
        if (!seenOpens.has(email)) {
          seenOpens.add(email);
          domain.opened += 1;
        }
        interactions += 1;
        const device = (doc.get('device') as string | undefined) ?? 'unknown';
        devices.set(device, (devices.get(device) ?? 0) + 1);
        const client = (doc.get('emailClient') as string | undefined) ?? 'Sconosciuto';
        clients.set(client, (clients.get(client) ?? 0) + 1);
        break;
      }
      case 'click': {
        point.clicked += 1;
        if (!seenClicks.has(email)) {
          seenClicks.add(email);
          domain.clicked += 1;
        }
        interactions += 1;
        const device = (doc.get('device') as string | undefined) ?? 'unknown';
        devices.set(device, (devices.get(device) ?? 0) + 1);
        const client = (doc.get('emailClient') as string | undefined) ?? 'Sconosciuto';
        clients.set(client, (clients.get(client) ?? 0) + 1);

        const url = (doc.get('url') as string | undefined) ?? '';
        if (url) {
          const entry = linkClicks.get(url) ?? { clicks: 0, contacts: new Set<string>() };
          entry.clicks += 1;
          if (email) entry.contacts.add(email);
          linkClicks.set(url, entry);
        }
        break;
      }
      case 'unsubscribed':
        point.unsubscribed += 1;
        break;
      case 'soft_bounce':
      case 'hard_bounce':
      case 'blocked':
      case 'spam':
        point.bounced += 1;
        domain.bounced += 1;
        break;
      default:
        break;
    }

    buckets.set(key, point);
  }

  for (const stat of domains.values()) {
    stat.openRate = safeRate(stat.opened, stat.delivered);
  }

  return {
    timeline: Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    granularity,
    topLinks: Array.from(linkClicks.entries())
      .map(([url, entry]) => ({ url, clicks: entry.clicks, uniqueClicks: entry.contacts.size }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 25),
    topDomains: Array.from(domains.values())
      .sort((a, b) => b.delivered - a.delivered || b.opened - a.opened)
      .slice(0, 15),
    devices: toBreakdown(devices, interactions),
    clients: toBreakdown(clients, interactions).slice(0, 10),
    scanned: snapshot.size,
    truncated: snapshot.size >= REPORT_EVENT_LIMIT,
  };
}

/** Pagina di destinatari, ordinata per id documento (cursore stabile). */
async function recipientsPage(
  newsletterId: string,
  options: { cursor?: string | null; limit: number; status?: RecipientStatus | null },
): Promise<Page<RecipientRow>> {
  let query = col.recipients(newsletterId).orderBy('__name__').limit(options.limit + 1);
  if (options.status) {
    query = col
      .recipients(newsletterId)
      .where('status', '==', options.status)
      .orderBy('__name__')
      .limit(options.limit + 1);
  }
  if (options.cursor) query = query.startAfter(options.cursor);

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, options.limit);
  const items: RecipientRow[] = docs.map((doc) => {
    const data = withId<NewsletterRecipient>(doc);
    return {
      id: data.id,
      contactId: data.contactId ?? '',
      email: data.email ?? '',
      status: data.status ?? 'pending',
      variantId: data.variantId ?? null,
      sentAt: data.sentAt ?? null,
      deliveredAt: data.deliveredAt ?? null,
      firstOpenedAt: data.firstOpenedAt ?? null,
      openCount: Number(data.openCount ?? 0),
      firstClickedAt: data.firstClickedAt ?? null,
      clickCount: Number(data.clickCount ?? 0),
      unsubscribedAt: data.unsubscribedAt ?? null,
      bounceReason: data.bounceReason ?? null,
      convertedOrderId: data.convertedOrderId ?? null,
      revenue: data.revenue ?? null,
    };
  });

  return {
    items,
    nextCursor: snapshot.size > options.limit ? (docs[docs.length - 1]?.id ?? null) : null,
  };
}

export const getNewsletterReport = onCall(
  { ...LIGHT_RUNTIME, timeoutSeconds: 120, memory: '512MiB' },
  async (request: CallableRequest<unknown>): Promise<NewsletterReportResult> =>
    guard('getNewsletterReport', async () => {
      requirePermission(request, 'analytics:read');
      const input = parseInput(reportSchema, request.data);

      const snapshot = await col.newsletters().doc(input.newsletterId).get();
      if (!snapshot.exists) throw notFound('Newsletter', input.newsletterId);
      const newsletter = withId<Newsletter>(snapshot);

      const [analysis, recipients] = await Promise.all([
        input.recipientsOnly
          ? Promise.resolve(null)
          : analyseEvents(newsletter.id, newsletter.sentAt ?? null),
        recipientsPage(newsletter.id, {
          cursor: input.cursor ?? null,
          limit: input.limit,
          status: input.status ?? null,
        }),
      ]);

      return {
        newsletter: {
          id: newsletter.id,
          name: newsletter.name,
          subject: newsletter.subject,
          preheader: newsletter.preheader ?? null,
          status: newsletter.status,
          category: newsletter.category ?? null,
          tags: newsletter.tags ?? [],
          fromName: newsletter.fromName,
          fromEmail: newsletter.fromEmail,
          sentAt: newsletter.sentAt ?? null,
          completedAt: newsletter.completedAt ?? null,
          thumbnailUrl: newsletter.thumbnailUrl ?? null,
          brevoCampaignId: newsletter.brevoCampaignId ?? null,
        },
        stats: { ...EMPTY_STATS, ...(newsletter.stats ?? {}) },
        variants: (newsletter.variants ?? []).map((variant) => ({
          id: variant.id,
          name: variant.name,
          subject: variant.subject,
          splitPercent: variant.splitPercent,
          stats: { ...EMPTY_STATS, ...(variant.stats ?? {}) },
        })),
        timeline: analysis?.timeline ?? [],
        timelineGranularity: analysis?.granularity ?? 'day',
        topLinks: analysis?.topLinks ?? [],
        topDomains: analysis?.topDomains ?? [],
        devices: analysis?.devices ?? [],
        clients: analysis?.clients ?? [],
        eventsScanned: analysis?.scanned ?? 0,
        eventsTruncated: analysis?.truncated ?? false,
        recipients,
        computedAt: nowIso(),
      };
    }),
);
