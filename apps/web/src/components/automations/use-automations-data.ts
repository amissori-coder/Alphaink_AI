'use client';

import { COLLECTIONS, DEFAULT_TIMEZONE, dayKey } from '@alphaink/shared';
import type { Automation } from '@alphaink/shared';
import { type UseQueryResult, useQueries, useQuery } from '@tanstack/react-query';

import { isFirebaseConfigured } from '@/lib/firebase/client';
import { useCollectionQuery, type UseCollectionResult } from '@/lib/hooks/use-collection';
import { useDocumentQuery, type UseDocumentResult } from '@/lib/hooks/use-document';

import { getAutomationReport } from './api';
import { LIST_RECENT_LIMIT, REPORT_RANGE_DAYS, automationReportKey } from './constants';
import type { AutomationReport } from './types';

/**
 * Letture dell'area automazioni.
 *
 * I documenti arrivano in tempo reale da Firestore (attivazione, contenuti,
 * ultimi errori), mentre le statistiche del periodo passano dalla callable
 * `getAutomationReport`, che aggrega la sotto-collezione delle esecuzioni.
 */

/** Tutte le automazioni configurate. Sono poche: nessuna paginazione. */
export function useAutomations(enabled = true): UseCollectionResult<Automation> {
  return useCollectionQuery<Automation>(COLLECTIONS.automations, [], {
    enabled,
    key: 'automazioni-elenco',
  });
}

/** Una singola automazione: l'id del documento coincide con la sua chiave. */
export function useAutomation(
  automationId: string | null,
  enabled = true,
): UseDocumentResult<Automation> {
  return useDocumentQuery<Automation>(COLLECTIONS.automations, automationId, {
    enabled: enabled && Boolean(automationId),
  });
}

/**
 * Inizio del periodo osservato, ancorato alla mezzanotte del giorno di partenza.
 * Ancorare al giorno mantiene stabile la chiave di cache per tutta la giornata.
 */
export function reportRangeFrom(days: number): string {
  const start = new Date(Date.now() - Math.max(0, days - 1) * 86_400_000);
  return `${dayKey(start, DEFAULT_TIMEZONE)}T00:00:00.000Z`;
}

export interface UseAutomationReportOptions {
  automationId: string | null;
  days?: number;
  recentLimit?: number;
  enabled?: boolean;
}

/** Report di una singola automazione per il periodo indicato. */
export function useAutomationReport({
  automationId,
  days = REPORT_RANGE_DAYS,
  recentLimit = LIST_RECENT_LIMIT,
  enabled = true,
}: UseAutomationReportOptions): UseQueryResult<AutomationReport, Error> {
  return useQuery<AutomationReport, Error>({
    queryKey: automationReportKey(automationId ?? '', days, recentLimit),
    queryFn: () =>
      getAutomationReport({
        automationId: automationId as string,
        from: reportRangeFrom(days),
        recentLimit,
      }),
    enabled: enabled && Boolean(automationId) && isFirebaseConfigured(),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export interface AutomationReportEntry {
  automationId: string;
  data: AutomationReport | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * Report di più automazioni in parallelo (elenco e cruscotto analitico).
 * Ogni richiesta ha la propria chiave di cache: una lentezza non blocca le altre.
 */
export function useAutomationReports(
  automationIds: string[],
  options: { days?: number; recentLimit?: number; enabled?: boolean } = {},
): AutomationReportEntry[] {
  const days = options.days ?? REPORT_RANGE_DAYS;
  const recentLimit = options.recentLimit ?? LIST_RECENT_LIMIT;
  const enabled = (options.enabled ?? true) && isFirebaseConfigured();
  const from = reportRangeFrom(days);

  const results = useQueries({
    queries: automationIds.map((automationId) => ({
      queryKey: automationReportKey(automationId, days, recentLimit),
      queryFn: () => getAutomationReport({ automationId, from, recentLimit }),
      enabled,
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });

  return results.map((result, index) => ({
    automationId: automationIds[index] ?? '',
    data: result.data,
    loading: result.isLoading,
    error: (result.error as Error | null) ?? null,
  }));
}
