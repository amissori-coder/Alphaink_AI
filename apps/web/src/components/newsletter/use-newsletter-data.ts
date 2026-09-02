'use client';

import { COLLECTIONS } from '@alphaink/shared';
import type { Cluster, Newsletter, NewsletterTemplate } from '@alphaink/shared';
import { limit, orderBy } from 'firebase/firestore';

import { useCollectionQuery, type UseCollectionResult } from '@/lib/hooks/use-collection';

import { CLUSTER_FETCH_LIMIT, NEWSLETTER_FETCH_LIMIT, TEMPLATE_FETCH_LIMIT } from './constants';

/**
 * Sottoscrizioni in tempo reale usate dall'area newsletter.
 * Sono raccolte qui perché elenco, editor e selettore del pubblico leggono
 * gli stessi documenti: una sola chiave di cache, un solo listener.
 */

/** Tutte le newsletter, dalla più recente. L'archiviazione si filtra a valle. */
export function useNewsletters(enabled = true): UseCollectionResult<Newsletter> {
  return useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [orderBy('updatedAt', 'desc'), limit(NEWSLETTER_FETCH_LIMIT)],
    { enabled, key: 'newsletter-elenco' },
  );
}

/** Cluster disponibili come pubblico. */
export function useClusters(enabled = true): UseCollectionResult<Cluster> {
  return useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limit(CLUSTER_FETCH_LIMIT)],
    { enabled, key: 'newsletter-cluster' },
  );
}

/** Template disponibili come punto di partenza. */
export function useTemplates(enabled = true): UseCollectionResult<NewsletterTemplate> {
  return useCollectionQuery<NewsletterTemplate>(
    COLLECTIONS.templates,
    [orderBy('name', 'asc'), limit(TEMPLATE_FETCH_LIMIT)],
    { enabled, key: 'newsletter-template' },
  );
}
