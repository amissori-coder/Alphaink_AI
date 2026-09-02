'use client';

import { COLLECTIONS, normalizeEmail } from '@alphaink/shared';
import type { Cluster, Contact, Newsletter, Order, TrackingEvent } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  collectionGroup,
  documentId,
  endAt,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  startAt,
  where,
} from 'firebase/firestore';
import * as React from 'react';

import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';
import { withId } from '@/lib/firebase/serialize';
import { type UseCollectionResult, useCollectionQuery } from '@/lib/hooks/use-collection';
import { type UseDocumentResult, useDocumentQuery } from '@/lib/hooks/use-document';

import {
  CONTACTS_PAGE_SIZE,
  DETAIL_EMAILS_LIMIT,
  DETAIL_EVENTS_LIMIT,
  DETAIL_ORDERS_LIMIT,
} from './constants';
import type { ReceivedEmail } from './types';

export const CONTACTS_QUERY_ROOT = ['contatti'] as const;

/**
 * Rubrica in tempo reale, ordinata per email normalizzata.
 *
 * L'ordinamento usa l'indice a campo singolo creato in automatico da Firestore
 * ed è stabile: la stessa riga resta al suo posto anche mentre i webhook
 * aggiornano gli stati. Il tetto è alzabile dall'interfaccia ("carica altri"),
 * perché una sottoscrizione in tempo reale su decine di migliaia di documenti
 * sarebbe insostenibile per il browser.
 */
export function useContacts(
  max: number = CONTACTS_PAGE_SIZE,
  enabled = true,
): UseCollectionResult<Contact> {
  return useCollectionQuery<Contact>(
    COLLECTIONS.contacts,
    [orderBy('emailNormalized', 'asc'), limitTo(max)],
    { enabled, key: `contatti-elenco-${max}` },
  );
}

/** Cluster disponibili come filtro e come destinazione delle azioni di gruppo. */
export function useContactClusters(enabled = true): UseCollectionResult<Cluster> {
  return useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limitTo(300)],
    { enabled, key: 'contatti-cluster' },
  );
}

/** Singolo contatto, in tempo reale. */
export function useContact(contactId: string | null): UseDocumentResult<Contact> {
  return useDocumentQuery<Contact>(COLLECTIONS.contacts, contactId, {
    enabled: Boolean(contactId),
  });
}

/** Newsletter usabili come sorgente delle email di prova. */
export function useTestableNewsletters(enabled = true): UseCollectionResult<Newsletter> {
  return useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [orderBy('updatedAt', 'desc'), limitTo(100)],
    { enabled, key: 'contatti-newsletter-test' },
  );
}

// -----------------------------------------------------------------------------
// Ricerca lato server
// -----------------------------------------------------------------------------

/**
 * Ricerca per prefisso sull'indirizzo email.
 *
 * Serve a trovare i contatti che stanno oltre il tetto della sottoscrizione in
 * tempo reale: senza di essa una rubrica di 40.000 indirizzi sarebbe
 * consultabile solo per i primi mille in ordine alfabetico.
 */
async function searchContactsByEmail(prefix: string, max: number): Promise<Contact[]> {
  if (prefix.length < 2) return [];
  const snapshot = await getDocs(
    query(
      collection(getDb(), COLLECTIONS.contacts),
      orderBy('emailNormalized'),
      startAt(prefix),
      endAt(`${prefix}`),
      limitTo(max),
    ),
  );
  return snapshot.docs.map((document) => withId<Contact>(document.id, document.data()));
}

export function useContactEmailSearch(term: string, enabled = true, max = 50) {
  const prefix = normalizeEmail(term);
  return useQuery<Contact[], Error>({
    queryKey: [...CONTACTS_QUERY_ROOT, 'ricerca-email', prefix, max],
    queryFn: () => searchContactsByEmail(prefix, max),
    enabled: enabled && prefix.length >= 2 && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Scheda del contatto: ordini, eventi ed email ricevute
// -----------------------------------------------------------------------------

/**
 * Ordini del contatto.
 *
 * La query filtra su `emailNormalized` e ordina per data: è esattamente
 * l'indice composito già dichiarato in `firestore.indexes.json`, quindi non
 * richiede configurazione aggiuntiva.
 */
async function fetchOrders(emailNormalized: string): Promise<Order[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), COLLECTIONS.orders),
      where('emailNormalized', '==', emailNormalized),
      orderBy('placedAt', 'desc'),
      limitTo(DETAIL_ORDERS_LIMIT),
    ),
  );
  return snapshot.docs.map((document) => withId<Order>(document.id, document.data()));
}

export function useContactOrders(email: string | null | undefined) {
  const normalized = email ? normalizeEmail(email) : '';
  return useQuery<Order[], Error>({
    queryKey: [...CONTACTS_QUERY_ROOT, 'ordini', normalized],
    queryFn: () => fetchOrders(normalized),
    enabled: normalized.length > 0 && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

/** Eventi di tracciamento del contatto (invii, aperture, click, bounce). */
async function fetchEvents(email: string): Promise<TrackingEvent[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), COLLECTIONS.events),
      where('email', '==', email),
      orderBy('occurredAt', 'desc'),
      limitTo(DETAIL_EVENTS_LIMIT),
    ),
  );
  return snapshot.docs.map((document) => withId<TrackingEvent>(document.id, document.data()));
}

export function useContactEvents(email: string | null | undefined) {
  const normalized = email ? normalizeEmail(email) : '';
  return useQuery<TrackingEvent[], Error>({
    queryKey: [...CONTACTS_QUERY_ROOT, 'eventi', normalized],
    queryFn: () => fetchEvents(normalized),
    enabled: normalized.length > 0 && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

/** Documento `recipients` così com'è su Firestore, prima della normalizzazione. */
interface RawRecipient {
  email?: string;
  status?: ReceivedEmail['status'];
  sentAt?: string | null;
  deliveredAt?: string | null;
  firstOpenedAt?: string | null;
  firstClickedAt?: string | null;
  openCount?: number;
  clickCount?: number;
  revenue?: number | null;
  bounceReason?: string | null;
  error?: string | null;
}

/**
 * Email ricevute dal contatto.
 *
 * I destinatari vivono in una sotto-collezione di ciascuna newsletter: la
 * lettura passa quindi da una query di gruppo su `recipients`, che l'indice
 * `email + sentAt` già dichiarato rende possibile. L'id della newsletter si
 * ricava dal percorso del documento (`newsletters/{id}/recipients/{id}`).
 */
async function fetchReceivedEmails(email: string): Promise<ReceivedEmail[]> {
  const snapshot = await getDocs(
    query(
      collectionGroup(getDb(), COLLECTIONS.recipients),
      where('email', '==', email),
      orderBy('sentAt', 'desc'),
      limitTo(DETAIL_EMAILS_LIMIT),
    ),
  );

  return snapshot.docs.map((document) => {
    const data = document.data() as RawRecipient;
    const newsletterId = document.ref.parent.parent?.id ?? null;
    return {
      id: document.ref.path,
      newsletterId,
      // Il nome viene risolto dal chiamante: qui resterebbe congelato nella cache.
      newsletterName: '',
      status: data.status ?? 'pending',
      sentAt: data.sentAt ?? null,
      deliveredAt: data.deliveredAt ?? null,
      firstOpenedAt: data.firstOpenedAt ?? null,
      firstClickedAt: data.firstClickedAt ?? null,
      openCount: data.openCount ?? 0,
      clickCount: data.clickCount ?? 0,
      revenue: data.revenue ?? null,
      bounceReason: data.bounceReason ?? null,
      error: data.error ?? null,
    } satisfies ReceivedEmail;
  });
}

export function useContactEmails(email: string | null | undefined) {
  const normalized = email ? normalizeEmail(email) : '';
  return useQuery<ReceivedEmail[], Error>({
    queryKey: [...CONTACTS_QUERY_ROOT, 'email-ricevute', normalized],
    queryFn: () => fetchReceivedEmails(normalized),
    enabled: normalized.length > 0 && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Risoluzione dei cluster di appartenenza
// -----------------------------------------------------------------------------

const CLUSTER_LOOKUP_CHUNK = 10;

/** Legge i cluster a cui il contatto appartiene, a blocchi di dieci id. */
async function fetchClustersByIds(ids: string[]): Promise<Cluster[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += CLUSTER_LOOKUP_CHUNK) {
    chunks.push(unique.slice(index, index + CLUSTER_LOOKUP_CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const snapshot = await getDocs(
        query(collection(getDb(), COLLECTIONS.clusters), where(documentId(), 'in', chunk)),
      );
      return snapshot.docs.map((document) => withId<Cluster>(document.id, document.data()));
    }),
  );
  return results.flat();
}

export function useClustersByIds(ids: string[]) {
  const signature = React.useMemo(() => Array.from(new Set(ids)).sort().join(','), [ids]);
  return useQuery<Cluster[], Error>({
    queryKey: [...CONTACTS_QUERY_ROOT, 'cluster-per-id', signature],
    queryFn: () => fetchClustersByIds(signature ? signature.split(',') : []),
    enabled: signature.length > 0 && isFirebaseConfigured(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
