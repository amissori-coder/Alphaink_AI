import { DEFAULT_TIMEZONE, localTime, localWeekday, safeRate } from '@alphaink/shared';

import type { BreakdownEntry, NewsletterReportResult, TopLink } from './types';

/**
 * Aggregazioni sui report delle singole newsletter.
 *
 * Le callable restituiscono un report per campagna: qui i report vengono fusi
 * per ottenere le viste trasversali del periodo (link più cliccati, dispositivi,
 * client di posta, distribuzione oraria delle aperture).
 */

export interface OpenHeatmap {
  /** Matrice 7×24: `values[giornoSettimana][ora]`, con 0 = domenica. */
  values: number[][];
  /** Aperture totali collocate nella mappa. */
  total: number;
  /** Newsletter che hanno contribuito (solo quelle con serie oraria). */
  contributing: number;
  /** Newsletter escluse perché la loro serie è aggregata per giorno. */
  skipped: number;
}

function emptyMatrix(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

/**
 * Distribuzione delle aperture per giorno della settimana e ora locale.
 *
 * Solo i report con serie oraria possono essere collocati in una cella: quelli
 * con serie giornaliera vengono contati a parte e dichiarati nella UI, così il
 * numero non sembra più completo di quanto sia.
 */
export function buildOpenHeatmap(
  reports: Array<NewsletterReportResult | undefined>,
  timezone: string = DEFAULT_TIMEZONE,
): OpenHeatmap {
  const values = emptyMatrix();
  let total = 0;
  let contributing = 0;
  let skipped = 0;

  for (const report of reports) {
    if (!report) continue;
    if (report.timelineGranularity !== 'hour') {
      if (report.timeline.length > 0) skipped += 1;
      continue;
    }

    let placed = 0;
    for (const point of report.timeline) {
      if (!point.opened) continue;
      const weekday = localWeekday(point.bucket, timezone);
      const hour = Number.parseInt(localTime(point.bucket, timezone).slice(0, 2), 10);
      if (weekday < 0 || Number.isNaN(hour)) continue;
      const row = values[weekday];
      if (!row) continue;
      row[hour] = (row[hour] ?? 0) + point.opened;
      placed += point.opened;
    }
    total += placed;
    if (placed > 0) contributing += 1;
  }

  return { values, total, contributing, skipped };
}

/** Fonde le classifiche dei link, sommando click totali e click unici. */
export function mergeTopLinks(
  reports: Array<NewsletterReportResult | undefined>,
  limit = 10,
): TopLink[] {
  const merged = new Map<string, TopLink>();

  for (const report of reports) {
    if (!report) continue;
    for (const link of report.topLinks) {
      const existing = merged.get(link.url);
      if (existing) {
        existing.clicks += link.clicks;
        existing.uniqueClicks += link.uniqueClicks;
      } else {
        merged.set(link.url, { ...link });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.uniqueClicks - a.uniqueClicks || b.clicks - a.clicks)
    .slice(0, limit);
}

/** Fonde una ripartizione (dispositivi, client) ricalcolando le quote. */
export function mergeBreakdown(
  reports: Array<NewsletterReportResult | undefined>,
  field: 'devices' | 'clients',
  limit = 8,
): BreakdownEntry[] {
  const counts = new Map<string, number>();
  let total = 0;

  for (const report of reports) {
    if (!report) continue;
    for (const entry of report[field]) {
      counts.set(entry.label, (counts.get(entry.label) ?? 0) + entry.count);
      total += entry.count;
    }
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, share: safeRate(count, total) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
