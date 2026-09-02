'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { DashboardMetricsInput, DashboardMetricsResult } from '@/components/dashboard/types';
import { callable, isFirebaseConfigured } from '@/lib/firebase/client';

/** Periodi selezionabili dalla dashboard. */
export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  7: '7 giorni',
  30: '30 giorni',
  90: '90 giorni',
};

/** Etichetta del confronto mostrata sotto le metriche. */
export const PERIOD_COMPARE_LABELS: Record<DashboardPeriod, string> = {
  7: 'rispetto ai 7 giorni precedenti',
  30: 'rispetto ai 30 giorni precedenti',
  90: 'rispetto ai 90 giorni precedenti',
};

const fetchDashboardMetrics = callable<DashboardMetricsInput, DashboardMetricsResult>(
  'getDashboardMetrics',
  { timeoutMs: 120_000 },
);

export interface UseDashboardMetricsOptions {
  days: DashboardPeriod;
  /** Disattiva la richiesta (permessi mancanti, sessione non pronta). */
  enabled?: boolean;
}

/** Metriche aggregate della dashboard per il periodo selezionato. */
export function useDashboardMetrics({
  days,
  enabled = true,
}: UseDashboardMetricsOptions): UseQueryResult<DashboardMetricsResult, Error> {
  return useQuery<DashboardMetricsResult, Error>({
    queryKey: ['dashboard', 'metrics', days],
    queryFn: () => fetchDashboardMetrics({ days, compare: true, topLimit: 5 }),
    enabled: enabled && isFirebaseConfigured(),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
