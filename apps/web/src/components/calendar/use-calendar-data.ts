'use client';

import { COLLECTIONS } from '@alphaink/shared';
import type { Automation, Cluster, Newsletter } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import { limit, orderBy, where } from 'firebase/firestore';
import * as React from 'react';

import { callable } from '@/lib/firebase/client';
import { useCollectionQuery } from '@/lib/hooks/use-collection';

import {
  ALL_STATUSES,
  AUTOMATION_FETCH_LIMIT,
  CLUSTER_FETCH_LIMIT,
  NEWSLETTER_FETCH_LIMIT,
  calendarEntriesKey,
} from './constants';
import type {
  CalendarEntry,
  CalendarFilters,
  CalendarItem,
  CalendarRange,
  GetCalendarEntriesInput,
  GetCalendarEntriesResult,
} from './types';
import {
  entryFromNewsletter,
  groupByDay,
  matchesFilters,
  resolveTimeZone,
  toCalendarItem,
} from './utils';

/** Callable del calendario editoriale. */
const fetchCalendarEntries = callable<GetCalendarEntriesInput, GetCalendarEntriesResult>(
  'getCalendarEntries',
);

export interface UseCalendarDataOptions {
  /** Disattiva ogni lettura finché il componente non è montato nel browser. */
  enabled?: boolean;
}

export interface UseCalendarDataResult {
  /** Tutte le voci dell'intervallo, prima dei filtri. */
  items: CalendarItem[];
  /** Voci che superano i filtri attivi. */
  filteredItems: CalendarItem[];
  /** Voci filtrate raggruppate per giorno locale (`YYYY-MM-DD`). */
  byDay: Map<string, CalendarItem[]>;
  /** Documenti newsletter dell'intervallo, per il pannello di dettaglio. */
  newsletterById: Map<string, Newsletter>;
  clusters: Cluster[];
  clusterNameById: Map<string, string>;
  automations: Automation[];
  activeAutomations: Automation[];
  /** Tag presenti nelle newsletter dell'intervallo, ordinati. */
  tagOptions: string[];
  loading: boolean;
  /** True durante un aggiornamento in background (dati già visibili). */
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Sorgente dati unica del calendario.
 *
 * Le voci arrivano dalla callable `getCalendarEntries`; i documenti newsletter
 * dell'intervallo sono letti anche in tempo reale, sia per arricchire le voci
 * (oggetto, tag, cluster) sia per riflettere subito nella griglia le modifiche
 * fatte altrove nell'applicazione.
 */
export function useCalendarData(
  range: CalendarRange,
  filters: CalendarFilters,
  options: UseCalendarDataOptions = {},
): UseCalendarDataResult {
  const enabled = options.enabled ?? true;
  const timezone = React.useMemo(() => resolveTimeZone(), []);
  const { fromIso, toIso } = range;

  const entriesQuery = useQuery<GetCalendarEntriesResult>({
    queryKey: calendarEntriesKey(fromIso, toIso),
    queryFn: () =>
      fetchCalendarEntries({
        from: fromIso,
        to: toIso,
        // Tutti gli stati: il filtro per stato è applicato lato client, così
        // cambiarlo non costa una nuova chiamata.
        statuses: ALL_STATUSES,
        includeArchived: false,
        includeAutomations: true,
        timezone,
      }),
    enabled,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  // Newsletter programmate nell'intervallo.
  const plannedQuery = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [
      where('schedule.sendAt', '>=', fromIso),
      where('schedule.sendAt', '<=', toIso),
      orderBy('schedule.sendAt', 'asc'),
      limit(NEWSLETTER_FETCH_LIMIT),
    ],
    { enabled, key: `calendario-programmate:${fromIso}` },
  );

  // Newsletter già inviate nell'intervallo.
  const sentQuery = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [
      where('sentAt', '>=', fromIso),
      where('sentAt', '<=', toIso),
      orderBy('sentAt', 'asc'),
      limit(NEWSLETTER_FETCH_LIMIT),
    ],
    { enabled, key: `calendario-inviate:${fromIso}` },
  );

  const clustersQuery = useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limit(CLUSTER_FETCH_LIMIT)],
    { enabled, key: 'calendario-cluster' },
  );

  const automationsQuery = useCollectionQuery<Automation>(
    COLLECTIONS.automations,
    [orderBy('name', 'asc'), limit(AUTOMATION_FETCH_LIMIT)],
    { enabled, key: 'calendario-automazioni' },
  );

  const plannedData = plannedQuery.data;
  const sentData = sentQuery.data;

  const newsletterById = React.useMemo(() => {
    const map = new Map<string, Newsletter>();
    for (const newsletter of plannedData) map.set(newsletter.id, newsletter);
    for (const newsletter of sentData) map.set(newsletter.id, newsletter);
    return map;
  }, [plannedData, sentData]);

  const entries = entriesQuery.data?.entries;

  const items = React.useMemo(() => {
    const now = new Date();
    const byId = new Map<string, CalendarEntry>();

    for (const entry of entries ?? []) byId.set(entry.id, entry);

    // Newsletter note a Firestore ma non ancora presenti nella risposta della
    // callable (create o spostate dopo l'ultimo caricamento).
    for (const newsletter of newsletterById.values()) {
      const synthetic = entryFromNewsletter(newsletter);
      if (synthetic && !byId.has(synthetic.id)) byId.set(synthetic.id, synthetic);
    }

    const result: CalendarItem[] = [];
    for (const entry of byId.values()) {
      const newsletter = entry.newsletterId ? newsletterById.get(entry.newsletterId) : undefined;
      if (newsletter?.archived) continue;
      result.push(toCalendarItem(entry, newsletter, now));
    }
    result.sort((a, b) => a.timestamp - b.timestamp || a.title.localeCompare(b.title, 'it'));
    return result;
  }, [entries, newsletterById]);

  const filteredItems = React.useMemo(
    () => items.filter((item) => matchesFilters(item, filters)),
    [items, filters],
  );

  const byDay = React.useMemo(() => groupByDay(filteredItems), [filteredItems]);

  const tagOptions = React.useMemo(() => {
    const tags = new Set<string>();
    for (const newsletter of newsletterById.values()) {
      for (const tag of newsletter.tags ?? []) if (tag.trim()) tags.add(tag);
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'it'));
  }, [newsletterById]);

  const clusters = React.useMemo(
    () => clustersQuery.data.filter((cluster) => !cluster.archived),
    [clustersQuery.data],
  );

  const clusterNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of clustersQuery.data) map.set(cluster.id, cluster.name);
    return map;
  }, [clustersQuery.data]);

  const automations = automationsQuery.data;
  const activeAutomations = React.useMemo(
    () => automations.filter((automation) => automation.enabled),
    [automations],
  );

  const error =
    (entriesQuery.error as Error | null) ??
    plannedQuery.error ??
    sentQuery.error ??
    clustersQuery.error ??
    automationsQuery.error ??
    null;

  const refetch = React.useCallback(() => {
    void entriesQuery.refetch();
  }, [entriesQuery]);

  return {
    items,
    filteredItems,
    byDay,
    newsletterById,
    clusters,
    clusterNameById,
    automations,
    activeAutomations,
    tagOptions,
    loading: entriesQuery.isLoading && !entriesQuery.data,
    refreshing: entriesQuery.isFetching && Boolean(entriesQuery.data),
    error,
    refetch,
  };
}
