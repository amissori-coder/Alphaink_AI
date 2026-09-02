'use client';

/**
 * Lettura dei documenti `settings/*` e stato locale dei moduli.
 *
 * Le impostazioni arrivano in tempo reale da Firestore (`onSnapshot`): dopo un
 * salvataggio la vista si aggiorna da sola, senza ricaricare nulla a mano.
 * I valori mancanti sono completati con i default condivisi, così la UI è
 * utilizzabile anche prima del primo `seedDefaults`.
 */

import {
  COLLECTIONS,
  DEFAULT_BRANDING,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_TRACKING_SETTINGS,
  defaultStoreSettings,
  type BrandingSettings,
  type BrevoSettings,
  type SiteSettings,
  type SyncJob,
  type TrackingSettings,
} from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import * as React from 'react';

import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { useDocumentQuery } from '@/lib/hooks/use-document';

import { listUsers } from './api';
import type { UserListEntry } from './types';

// -----------------------------------------------------------------------------
// Documenti di configurazione
// -----------------------------------------------------------------------------

export interface SettingsDocResult<T> {
  data: T;
  /** `false` quando il documento non esiste ancora su Firestore. */
  exists: boolean;
  loading: boolean;
  error: Error | null;
}

/** Impostazioni Brevo con i default applicati ai campi mancanti. */
export function useBrevoSettings(): SettingsDocResult<BrevoSettings> {
  const query = useDocumentQuery<BrevoSettings>(COLLECTIONS.settings, 'brevo');
  const data = React.useMemo<BrevoSettings>(() => {
    const stored = query.data;
    return {
      apiKeyConfigured: stored?.apiKeyConfigured ?? false,
      apiKeyHint: stored?.apiKeyHint ?? null,
      accountEmail: stored?.accountEmail ?? null,
      accountCompany: stored?.accountCompany ?? null,
      credits: stored?.credits ?? null,
      senders: stored?.senders ?? [],
      defaultSenderEmail: stored?.defaultSenderEmail ?? '',
      defaultReplyTo: stored?.defaultReplyTo ?? null,
      webhooks: stored?.webhooks ?? [],
      webhookSecretConfigured: stored?.webhookSecretConfigured ?? false,
      syncContacts: stored?.syncContacts ?? false,
      defaultListId: stored?.defaultListId ?? null,
      attributeMapping: stored?.attributeMapping ?? {},
      maxSendsPerHour: stored?.maxSendsPerHour ?? null,
      lastCheckedAt: stored?.lastCheckedAt ?? null,
      lastError: stored?.lastError ?? null,
      createdAt: stored?.createdAt ?? '',
      updatedAt: stored?.updatedAt ?? '',
      createdBy: stored?.createdBy ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  }, [query.data]);

  return { data, exists: Boolean(query.data), loading: query.loading, error: query.error };
}

/** Impostazioni del sito: i due negozi PrestaShop più le regole comuni. */
export function useSiteSettings(): SettingsDocResult<SiteSettings> {
  const query = useDocumentQuery<SiteSettings>(COLLECTIONS.settings, 'site');
  const data = React.useMemo<SiteSettings>(() => {
    const stored = query.data;
    return {
      ...DEFAULT_SITE_SETTINGS,
      ...stored,
      stores: {
        prestashop_b2c: {
          ...defaultStoreSettings('prestashop_b2c'),
          ...stored?.stores?.prestashop_b2c,
        },
        prestashop_b2b: {
          ...defaultStoreSettings('prestashop_b2b'),
          ...stored?.stores?.prestashop_b2b,
        },
      },
      syncSchedule: { ...DEFAULT_SITE_SETTINGS.syncSchedule, ...stored?.syncSchedule },
      familyRules: stored?.familyRules?.length ? stored.familyRules : DEFAULT_SITE_SETTINGS.familyRules,
      repurchaseCycleDays: {
        ...DEFAULT_SITE_SETTINGS.repurchaseCycleDays,
        ...stored?.repurchaseCycleDays,
      },
      createdAt: stored?.createdAt ?? '',
      updatedAt: stored?.updatedAt ?? '',
      createdBy: stored?.createdBy ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  }, [query.data]);

  return { data, exists: Boolean(query.data), loading: query.loading, error: query.error };
}

/** Impostazioni di tracciamento e attribuzione. */
export function useTrackingSettings(): SettingsDocResult<TrackingSettings> {
  const query = useDocumentQuery<TrackingSettings>(COLLECTIONS.settings, 'tracking');
  const data = React.useMemo<TrackingSettings>(() => {
    const stored = query.data;
    return {
      ...DEFAULT_TRACKING_SETTINGS,
      ...stored,
      attribution: { ...DEFAULT_TRACKING_SETTINGS.attribution, ...stored?.attribution },
      createdAt: stored?.createdAt ?? '',
      updatedAt: stored?.updatedAt ?? '',
      createdBy: stored?.createdBy ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  }, [query.data]);

  return { data, exists: Boolean(query.data), loading: query.loading, error: query.error };
}

/** Identità visiva usata dall'editor e dagli invii. */
export function useBrandingSettings(): SettingsDocResult<BrandingSettings> {
  const query = useDocumentQuery<BrandingSettings>(COLLECTIONS.settings, 'branding');
  const data = React.useMemo<BrandingSettings>(() => {
    const stored = query.data;
    return {
      ...DEFAULT_BRANDING,
      ...stored,
      palette: { ...DEFAULT_BRANDING.palette, ...stored?.palette },
      fonts: { ...DEFAULT_BRANDING.fonts, ...stored?.fonts },
      socialLinks: stored?.socialLinks ?? [],
      createdAt: stored?.createdAt ?? '',
      updatedAt: stored?.updatedAt ?? '',
      createdBy: stored?.createdBy ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  }, [query.data]);

  return { data, exists: Boolean(query.data), loading: query.loading, error: query.error };
}

// -----------------------------------------------------------------------------
// Cronologia delle sincronizzazioni
// -----------------------------------------------------------------------------

/**
 * Ultimi job di sincronizzazione, in ordine cronologico inverso.
 *
 * Si legge un'unica lista ordinata per `startedAt` e si filtra per negozio in
 * memoria: evita un indice composto solo per questa vista.
 */
export function useSyncJobs(max = 40): {
  jobs: SyncJob[];
  loading: boolean;
  error: Error | null;
} {
  const constraints = React.useMemo(() => [orderBy('startedAt', 'desc'), limitTo(max)], [max]);
  const query = useCollectionQuery<SyncJob>(COLLECTIONS.syncJobs, constraints, { key: 'impostazioni' });
  return { jobs: query.data, loading: query.loading, error: query.error };
}

// -----------------------------------------------------------------------------
// Utenti
// -----------------------------------------------------------------------------

export interface UsersQueryResult {
  users: UserListEntry[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Elenco degli utenti con i dati di accesso (richiede ruolo `admin`). */
export function useUsersList(enabled: boolean): UsersQueryResult {
  const query = useQuery({
    queryKey: ['settings', 'users'],
    queryFn: () => listUsers({ limit: 200, includeDisabled: true }),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  return {
    users: query.data?.users ?? [],
    loading: enabled && query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: () => void query.refetch(),
  };
}

// -----------------------------------------------------------------------------
// Stato locale dei moduli
// -----------------------------------------------------------------------------

export interface SettingsFormState<TForm> {
  form: TForm;
  setForm: React.Dispatch<React.SetStateAction<TForm>>;
  /** Aggiorna alcune proprietà del modulo. */
  update: (patch: Partial<TForm>) => void;
  /** `true` quando ci sono modifiche non salvate. */
  dirty: boolean;
  /** Riporta il modulo ai valori del server. */
  reset: () => void;
  /** Segna i valori correnti come salvati (chiamare dopo la callable). */
  commit: (values?: TForm) => void;
}

/**
 * Tiene il modulo allineato al documento Firestore senza calpestare le
 * modifiche in corso: finché ci sono modifiche non salvate il form resta
 * intoccato, ma il confronto avviene sempre con l'ultimo valore del server.
 */
export function useSettingsForm<TRemote, TForm>(
  remote: TRemote,
  toForm: (remote: TRemote) => TForm,
): SettingsFormState<TForm> {
  const toFormRef = React.useRef(toForm);
  toFormRef.current = toForm;

  const remoteRef = React.useRef(remote);
  remoteRef.current = remote;

  const [form, setForm] = React.useState<TForm>(() => toForm(remote));
  const [baseline, setBaseline] = React.useState<string>(() => JSON.stringify(toForm(remote)));

  const dirty = React.useMemo(() => JSON.stringify(form) !== baseline, [form, baseline]);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;

  // Firma del documento remoto: cambia solo quando cambiano davvero i dati.
  const remoteSignature = React.useMemo(() => JSON.stringify(remote ?? null), [remote]);

  React.useEffect(() => {
    const next = toFormRef.current(remoteRef.current);
    const serialized = JSON.stringify(next);
    setBaseline((current) => (current === serialized ? current : serialized));
    // Con modifiche in corso non si sovrascrive quello che l'operatore sta scrivendo.
    if (!dirtyRef.current) setForm(next);
  }, [remoteSignature]);

  const update = React.useCallback((patch: Partial<TForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const reset = React.useCallback(() => {
    setForm(toFormRef.current(remoteRef.current));
  }, []);

  const formRef = React.useRef(form);
  formRef.current = form;

  const commit = React.useCallback((values?: TForm) => {
    const next = values ?? formRef.current;
    setForm(next);
    setBaseline(JSON.stringify(next));
  }, []);

  return { form, setForm, update, dirty, reset, commit };
}
