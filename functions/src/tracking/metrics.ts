/**
 * Consolidamento storico e riconciliazione.
 *
 * Due job periodici:
 *
 *  - `scheduledDailyMetrics` (ogni notte alle 02:00) riduce gli eventi del
 *    giorno a un solo documento `metricsDaily/{YYYY-MM-DD}`. I grafici della
 *    dashboard leggono quello: senza il consolidamento ogni apertura del
 *    cruscotto rileggerebbe centinaia di migliaia di eventi.
 *  - `scheduledStatsReconcile` (ogni ora) riprende gli eventi rimasti
 *    `processed: false` (istanza terminata, errore transitorio) e ricalcola da
 *    zero le statistiche delle newsletter spedite nelle ultime 48 ore, che è
 *    la finestra in cui arrivano quasi tutti gli eventi.
 *
 * Il giorno è quello **locale** (`Europe/Rome`): un invio delle 23:30 e le sue
 * aperture delle 00:10 finiscono in due giorni diversi, come si aspetta chi
 * legge il grafico.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { DEFAULT_CURRENCY, REVENUE_ORDER_STATUSES, dayKey, safeRate } from '@alphaink/shared';
import type { BrevoEventType, IsoDate, Order, OrderAttribution, SendSource } from '@alphaink/shared';

import { HEAVY_RUNTIME, TIMEZONE } from '../lib/config';
import { col, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { readTrackingSettings } from './settings';
import { processEvent, recomputeNewsletterStats } from './processor';
import type { TrackingEvent } from '@alphaink/shared';

const log = createLogger('tracking.metrics');

/** Tetto di sicurezza: oltre, il documento viene marcato `truncated`. */
export const MAX_EVENTS_PER_DAY = 300_000;
export const MAX_ORDERS_PER_DAY = 50_000;

// -----------------------------------------------------------------------------
// Intervallo del giorno locale
// -----------------------------------------------------------------------------

/** Scarto fra ora locale e UTC per l'istante indicato, in millisecondi. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - date.getTime();
}

/**
 * Istanti UTC di inizio e fine di un giorno locale.
 * Il doppio passaggio serve per i cambi d'ora: il primo calcolo usa l'offset
 * sbagliato di un'ora, il secondo lo corregge.
 */
export function zonedDayRange(day: string, timeZone: string = TIMEZONE): { from: IsoDate; to: IsoDate } {
  const boundary = (isoDay: string): number => {
    const naive = Date.parse(`${isoDay}T00:00:00Z`);
    const firstGuess = naive - timeZoneOffsetMs(new Date(naive), timeZone);
    return naive - timeZoneOffsetMs(new Date(firstGuess), timeZone);
  };

  const start = boundary(day);
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const end = boundary(nextDay);

  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

/** Elenco dei giorni locali compresi fra due istanti (estremi inclusi). */
export function daysInRange(from: IsoDate, to: IsoDate, timeZone: string = TIMEZONE): string[] {
  const days: string[] = [];
  const start = dayKey(from, timeZone);
  const end = dayKey(to, timeZone);
  let cursor = start;
  for (let guard = 0; guard < 800; guard += 1) {
    days.push(cursor);
    if (cursor >= end) break;
    const next = new Date(Date.parse(`${cursor}T12:00:00Z`) + 86_400_000);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}

/**
 * Scorre una query a pagine potendo interrompersi.
 *
 * `paginateQuery` di `lib/firestore` non prevede l'interruzione: qui serve,
 * perché al raggiungimento del tetto di sicurezza continuare a leggere
 * costerebbe soltanto letture inutili.
 */
async function scan(
  query: FirebaseFirestore.Query,
  pageSize: number,
  handler: (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => boolean,
): Promise<void> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let page = query.limit(pageSize);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) return;
    const shouldContinue = handler(snapshot.docs);
    if (!shouldContinue || snapshot.size < pageSize) return;
    cursor = snapshot.docs[snapshot.size - 1];
  }
}

// -----------------------------------------------------------------------------
// Metriche
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

export function emptyChannelMetrics(): ChannelMetrics {
  return {
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
}

/** Somma due insiemi di metriche (usata per i totali di periodo). */
export function addMetrics(a: ChannelMetrics, b: ChannelMetrics): ChannelMetrics {
  const sum = emptyChannelMetrics();
  for (const key of Object.keys(sum) as Array<keyof ChannelMetrics>) {
    sum[key] = Math.round((Number(a[key] ?? 0) + Number(b[key] ?? 0)) * 100) / 100;
  }
  return sum;
}

export interface DailyMetrics {
  day: string;
  timezone: string;
  from: IsoDate;
  to: IsoDate;
  channels: {
    newsletter: ChannelMetrics;
    automation: ChannelMetrics;
    total: ChannelMetrics;
  };
  /** Ordini del giorno indipendentemente dall'attribuzione. */
  store: { orders: number; revenue: number; currency: string };
  /** Quota di fatturato attribuita alle email (0-1). */
  emailRevenueShare: number;
  eventsScanned: number;
  ordersScanned: number;
  /** Il giorno non è ancora concluso: i valori cambieranno. */
  partial: boolean;
  /** Sono stati raggiunti i tetti di sicurezza: i numeri sono per difetto. */
  truncated: boolean;
  computedAt: IsoDate;
}

/**
 * Evento generato da un invio di prova.
 *
 * Le prove portano il `newsletterId` reale (serve a comporre il messaggio) ma
 * non sono traffico: vanno escluse dai conteggi, come già fa il redirector.
 */
function isTestEvent(event: { source?: SendSource | null }): boolean {
  return event.source === 'test';
}

/** Canale di un evento: dagli id risolti, non dal campo `source` grezzo. */
function channelOf(event: {
  newsletterId?: string | null;
  automationId?: string | null;
  source?: SendSource | null;
}): 'newsletter' | 'automation' | null {
  if (isTestEvent(event)) return null;
  if (event.newsletterId) return 'newsletter';
  if (event.automationId) return 'automation';
  if (event.source === 'newsletter' || event.source === 'automation') return event.source;
  return null;
}

/** Applica un evento alle metriche del canale e al totale. */
function applyEvent(
  type: BrevoEventType,
  target: ChannelMetrics,
  flags: { firstOpen: boolean; firstClick: boolean; countProxyOpens: boolean },
): void {
  switch (type) {
    case 'request':
      target.sent += 1;
      break;
    case 'delivered':
      target.delivered += 1;
      break;
    case 'opened':
    case 'unique_opened':
      target.opened += 1;
      if (flags.firstOpen) target.uniqueOpened += 1;
      break;
    case 'proxy_open':
      target.proxyOpened += 1;
      if (flags.countProxyOpens) {
        target.opened += 1;
        if (flags.firstOpen) target.uniqueOpened += 1;
      }
      break;
    case 'click':
      target.clicked += 1;
      if (flags.firstClick) target.uniqueClicked += 1;
      break;
    case 'soft_bounce':
      target.softBounces += 1;
      break;
    case 'hard_bounce':
    case 'invalid_email':
      target.hardBounces += 1;
      break;
    case 'blocked':
      target.blocked += 1;
      break;
    case 'spam':
      target.complaints += 1;
      break;
    case 'unsubscribed':
      target.unsubscribed += 1;
      break;
    default:
      break;
  }
}

/** Attribuzioni dell'ordine, in forma di elenco. */
function attributionsOf(order: Partial<Order>): OrderAttribution[] {
  if (order.attributions?.length) return order.attributions;
  return order.attribution ? [order.attribution] : [];
}

/**
 * Calcola le metriche di un giorno senza scriverle.
 * Esposta perché la dashboard la usa per il giorno in corso, che il job
 * notturno non ha ancora consolidato.
 */
export async function computeDailyMetrics(
  day: string,
  options: { timeZone?: string } = {},
): Promise<DailyMetrics> {
  const timeZone = options.timeZone ?? TIMEZONE;
  const { from, to } = zonedDayRange(day, timeZone);
  const settings = await readTrackingSettings();
  const countProxyOpens = !settings.excludeProxyOpens;

  const channels = {
    newsletter: emptyChannelMetrics(),
    automation: emptyChannelMetrics(),
    total: emptyChannelMetrics(),
  };

  // Le "uniche" del giorno si contano per coppia invio+contatto: due aperture
  // dello stesso destinatario valgono una sola apertura unica.
  const seenOpens = new Set<string>();
  const seenClicks = new Set<string>();
  let eventsScanned = 0;
  let truncated = false;

  await scan(
    col
      .events()
      .where('occurredAt', '>=', from)
      .where('occurredAt', '<', to)
      .select('type', 'source', 'newsletterId', 'automationId', 'automationRunId', 'email', 'occurredAt')
      .orderBy('occurredAt', 'asc'),
    1000,
    (docs) => {
      for (const doc of docs) {
        if (eventsScanned >= MAX_EVENTS_PER_DAY) {
          truncated = true;
          return false;
        }
        eventsScanned += 1;

        const data = doc.data() as {
          type: BrevoEventType;
          source?: SendSource | null;
          newsletterId?: string | null;
          automationId?: string | null;
          automationRunId?: string | null;
          email?: string;
        };
        // Le prove non entrano nemmeno nel totale: `channels.total` viene
        // sommato anche per gli eventi senza canale.
        if (isTestEvent(data)) continue;

        const channel = channelOf(data);
        const key = `${data.newsletterId ?? data.automationRunId ?? data.automationId ?? '-'}|${data.email ?? '-'}`;

        const firstOpen = !seenOpens.has(key);
        const firstClick = !seenClicks.has(key);
        if (data.type === 'opened' || data.type === 'unique_opened' || data.type === 'proxy_open') {
          seenOpens.add(key);
        }
        if (data.type === 'click') seenClicks.add(key);

        const flags = { firstOpen, firstClick, countProxyOpens };
        applyEvent(data.type, channels.total, flags);
        if (channel) applyEvent(data.type, channels[channel], flags);
      }
      return true;
    },
  );

  // --- Ordini -----------------------------------------------------------------
  let ordersScanned = 0;
  let storeOrders = 0;
  let storeRevenue = 0;
  let currency = DEFAULT_CURRENCY;

  await scan(
    col
      .orders()
      .where('placedAt', '>=', from)
      .where('placedAt', '<', to)
      .select('total', 'currency', 'status', 'placedAt', 'attribution', 'attributions')
      .orderBy('placedAt', 'asc'),
    500,
    (docs) => {
      for (const doc of docs) {
        if (ordersScanned >= MAX_ORDERS_PER_DAY) {
          truncated = true;
          return false;
        }
        ordersScanned += 1;

        const order = doc.data() as Partial<Order>;
        if (!REVENUE_ORDER_STATUSES.includes(order.status ?? 'pending')) continue;

        storeOrders += 1;
        storeRevenue += Number(order.total ?? 0);
        if (order.currency) currency = order.currency;

        for (const attribution of attributionsOf(order)) {
          const revenue = Number(attribution.attributedRevenue ?? 0);
          const target = attribution.newsletterId
            ? channels.newsletter
            : attribution.automationId
              ? channels.automation
              : null;
          if (!target) continue;
          // Un ordine è un ordine: il peso lo ripartisce fra i canali, non lo
          // moltiplica. Peso assente (attribuzioni precedenti ai modelli
          // multi-touch): l'ordine era intero.
          const weight = Number(attribution.weight);
          const share = Number.isFinite(weight) && weight > 0 ? Math.min(1, weight) : 1;
          target.orders += share;
          target.revenue += revenue;
          channels.total.orders += share;
          channels.total.revenue += revenue;
        }
      }
      return true;
    },
  );

  const round = (metrics: ChannelMetrics): ChannelMetrics => ({
    ...metrics,
    orders: Math.round(metrics.orders * 100) / 100,
    revenue: Math.round(metrics.revenue * 100) / 100,
  });

  const todayKey = dayKey(new Date(), timeZone);
  return {
    day,
    timezone: timeZone,
    from,
    to,
    channels: {
      newsletter: round(channels.newsletter),
      automation: round(channels.automation),
      total: round(channels.total),
    },
    store: {
      orders: storeOrders,
      revenue: Math.round(storeRevenue * 100) / 100,
      currency,
    },
    emailRevenueShare: safeRate(channels.total.revenue, storeRevenue),
    eventsScanned,
    ordersScanned,
    partial: day >= todayKey,
    truncated,
    computedAt: nowIso(),
  };
}

/** Calcola e salva `metricsDaily/{day}`. */
export async function writeDailyMetrics(day: string, timeZone: string = TIMEZONE): Promise<DailyMetrics> {
  const metrics = await computeDailyMetrics(day, { timeZone });
  await col.metricsDaily().doc(day).set(metrics, { merge: true });
  log.info('Metriche giornaliere consolidate', {
    day,
    events: metrics.eventsScanned,
    orders: metrics.ordersScanned,
    revenue: metrics.channels.total.revenue,
  });
  return metrics;
}

/** Legge un giorno già consolidato. */
export async function readDailyMetrics(day: string): Promise<DailyMetrics | null> {
  const snapshot = await col.metricsDaily().doc(day).get();
  return snapshot.exists ? withId<DailyMetrics>(snapshot) : null;
}

/** Giorno locale precedente a quello indicato. */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// scheduledDailyMetrics
// -----------------------------------------------------------------------------

export const scheduledDailyMetrics = onSchedule(
  {
    schedule: 'every day 02:00',
    timeZone: TIMEZONE,
    ...HEAVY_RUNTIME,
    retryCount: 1,
  },
  async () => {
    const today = dayKey(new Date(), TIMEZONE);
    const yesterday = previousDay(today);

    await writeDailyMetrics(yesterday);

    // Auto-riparazione: se il giorno prima manca (deploy, guasto), lo si
    // consolida adesso invece di lasciare un buco nei grafici.
    const gapDay = previousDay(yesterday);
    if (!(await readDailyMetrics(gapDay))) {
      await writeDailyMetrics(gapDay);
    }

    // Il giorno in corso viene salvato come parziale: la dashboard lo mostra
    // subito anche senza ricalcolarlo a ogni apertura.
    await writeDailyMetrics(today);
  },
);

// -----------------------------------------------------------------------------
// scheduledStatsReconcile
// -----------------------------------------------------------------------------

/** Eventi ripresi al massimo in una corsa. */
export const RECONCILE_EVENT_LIMIT = 500;

/** Newsletter ricalcolate al massimo in una corsa. */
export const RECONCILE_NEWSLETTER_LIMIT = 50;

/** Finestra in cui una newsletter è considerata "ancora viva". */
export const RECONCILE_WINDOW_HOURS = 48;

export interface ReconcileSummary {
  pendingEvents: number;
  processedEvents: number;
  failedEvents: number;
  recomputedNewsletters: number;
  durationMs: number;
}

export async function runStatsReconcile(
  options: { budgetMs?: number; eventLimit?: number; newsletterLimit?: number } = {},
): Promise<ReconcileSummary> {
  const startedAt = Date.now();
  const budget = options.budgetMs ?? 7 * 60 * 1000;
  const summary: ReconcileSummary = {
    pendingEvents: 0,
    processedEvents: 0,
    failedEvents: 0,
    recomputedNewsletters: 0,
    durationMs: 0,
  };

  // 1. Eventi rimasti indietro.
  const pending = await col
    .events()
    .where('processed', '==', false)
    .orderBy('receivedAt', 'asc')
    .limit(options.eventLimit ?? RECONCILE_EVENT_LIMIT)
    .get();

  summary.pendingEvents = pending.size;
  for (const doc of pending.docs) {
    if (Date.now() - startedAt > budget) break;
    const event = withId<TrackingEvent>(doc);
    try {
      await processEvent(event);
      summary.processedEvents += 1;
    } catch (error) {
      summary.failedEvents += 1;
      log.error('Riconciliazione evento fallita', error, { eventId: event.id, type: event.type });
    }
  }

  // 2. Newsletter spedite di recente: i contatori si riallineano ai destinatari.
  const since = new Date(Date.now() - RECONCILE_WINDOW_HOURS * 3_600_000).toISOString();
  const recent = await col
    .newsletters()
    .where('status', '==', 'sent')
    .where('sentAt', '>=', since)
    .orderBy('sentAt', 'desc')
    .limit(options.newsletterLimit ?? RECONCILE_NEWSLETTER_LIMIT)
    .get();

  for (const doc of recent.docs) {
    if (Date.now() - startedAt > budget) break;
    try {
      await recomputeNewsletterStats(doc.id);
      summary.recomputedNewsletters += 1;
    } catch (error) {
      log.error('Ricalcolo statistiche newsletter fallito', error, { newsletterId: doc.id });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  log.info('Riconciliazione completata', { ...summary });
  return summary;
}

export const scheduledStatsReconcile = onSchedule(
  {
    schedule: 'every 1 hours',
    timeZone: TIMEZONE,
    ...HEAVY_RUNTIME,
    retryCount: 0,
  },
  async () => {
    await runStatsReconcile();
  },
);
