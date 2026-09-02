'use client';

import { COLLECTIONS } from '@alphaink/shared';
import type { TrackingSettings } from '@alphaink/shared';
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query';

import { isFirebaseConfigured } from '@/lib/firebase/client';
import { useDocumentQuery } from '@/lib/hooks/use-document';

import { getDashboardMetrics, getNewsletterReport } from './api';
import type { DashboardMetricsResult, NewsletterReportResult } from './types';

/** Periodi osservabili dal cruscotto analitico. */
export const ANALYTICS_PERIODS = [7, 14, 30, 90, 180, 365] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  7: 'Ultimi 7 giorni',
  14: 'Ultimi 14 giorni',
  30: 'Ultimi 30 giorni',
  90: 'Ultimi 90 giorni',
  180: 'Ultimi 6 mesi',
  365: 'Ultimo anno',
};

export const PERIOD_COMPARE_LABELS: Record<AnalyticsPeriod, string> = {
  7: 'rispetto ai 7 giorni precedenti',
  14: 'rispetto ai 14 giorni precedenti',
  30: 'rispetto ai 30 giorni precedenti',
  90: 'rispetto ai 90 giorni precedenti',
  180: 'rispetto ai 6 mesi precedenti',
  365: 'rispetto all’anno precedente',
};

/** Newsletter richieste in classifica: alimentano tabella, link e mappa di calore. */
export const TOP_NEWSLETTER_LIMIT = 25;

/** Report di dettaglio scaricati per l'analisi degli eventi (link, device, ore). */
export const DETAIL_REPORT_LIMIT = 8;

export interface UseAnalyticsMetricsOptions {
  days: AnalyticsPeriod;
  topLimit?: number;
  enabled?: boolean;
}

/** Metriche aggregate del periodo, con confronto sul periodo precedente. */
export function useAnalyticsMetrics({
  days,
  topLimit = TOP_NEWSLETTER_LIMIT,
  enabled = true,
}: UseAnalyticsMetricsOptions): UseQueryResult<DashboardMetricsResult, Error> {
  return useQuery<DashboardMetricsResult, Error>({
    queryKey: ['analytics', 'metrics', days, topLimit],
    queryFn: () => getDashboardMetrics({ days, compare: true, topLimit }),
    enabled: enabled && isFirebaseConfigured(),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export interface NewsletterReportEntry {
  newsletterId: string;
  data: NewsletterReportResult | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * Report di più newsletter in parallelo.
 *
 * `recipientsOnly` salta l'analisi degli eventi: si usa quando servono solo i
 * totali consolidati (confronto fra campagne), risparmiando la scansione.
 */
export function useNewsletterReports(
  newsletterIds: string[],
  options: { enabled?: boolean; recipientsOnly?: boolean } = {},
): NewsletterReportEntry[] {
  const enabled = (options.enabled ?? true) && isFirebaseConfigured();
  const recipientsOnly = options.recipientsOnly ?? false;

  const results = useQueries({
    queries: newsletterIds.map((newsletterId) => ({
      queryKey: ['analytics', 'newsletter-report', newsletterId, recipientsOnly],
      queryFn: () => getNewsletterReport({ newsletterId, recipientsOnly, limit: 1 }),
      enabled,
      staleTime: 5 * 60_000,
      gcTime: 15 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });

  return results.map((result, index) => ({
    newsletterId: newsletterIds[index] ?? '',
    data: result.data,
    loading: result.isLoading,
    error: (result.error as Error | null) ?? null,
  }));
}

/** Impostazioni di tracciamento: servono a dichiarare il modello di attribuzione. */
export function useTrackingSettings(enabled = true): TrackingSettings | null {
  const { data } = useDocumentQuery<TrackingSettings>(COLLECTIONS.settings, 'tracking', {
    enabled,
  });
  return data;
}
