import type {
  Contact,
  DocId,
  EngagementTier,
  IsoDate,
  Order,
  ProductFamily,
  RecipientStatus,
  SiteSource,
  SubscriptionStatus,
} from '@alphaink/shared';

// -----------------------------------------------------------------------------
// Filtri dell'elenco
// -----------------------------------------------------------------------------

export interface ContactFilters {
  /** Testo cercato su email, nome, cognome e azienda. */
  term: string;
  status: SubscriptionStatus[];
  segment: Array<'b2c' | 'b2b'>;
  source: SiteSource[];
  clusterIds: DocId[];
  tiers: EngagementTier[];
  /** Estremi della spesa totale, in euro. `null` = nessun limite. */
  minSpent: number | null;
  maxSpent: number | null;
  /** Famiglie di prodotto che il contatto deve avere acquistato. */
  families: ProductFamily[];
  /** Solo contatti con almeno un ordine. */
  onlyBuyers: boolean;
}

export const EMPTY_FILTERS: ContactFilters = {
  term: '',
  status: [],
  segment: [],
  source: [],
  clusterIds: [],
  tiers: [],
  minSpent: null,
  maxSpent: null,
  families: [],
  onlyBuyers: false,
};

/** Conteggi mostrati nella barra superiore dell'elenco. */
export interface ContactCounters {
  total: number;
  subscribed: number;
  unsubscribed: number;
  bounced: number;
  pending: number;
}

export const EMPTY_COUNTERS: ContactCounters = {
  total: 0,
  subscribed: 0,
  unsubscribed: 0,
  bounced: 0,
  pending: 0,
};

// -----------------------------------------------------------------------------
// Scheda del contatto
// -----------------------------------------------------------------------------

/** Categoria di una voce della timeline, usata da icone e filtri. */
export type TimelineKind = 'invio' | 'apertura' | 'click' | 'ordine' | 'consenso' | 'problema';

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  occurredAt: IsoDate;
  title: string;
  description?: string | null;
  /** Link interno alla newsletter o all'ordine collegato. */
  href?: string | null;
  /** Etichetta secondaria (nome newsletter, numero ordine, importo). */
  badge?: string | null;
  /** URL cliccato, presente sugli eventi di click. */
  url?: string | null;
}

/** Email ricevuta dal contatto, ricostruita dai documenti `recipients`. */
export interface ReceivedEmail {
  id: string;
  newsletterId: DocId | null;
  newsletterName: string;
  status: RecipientStatus;
  sentAt: IsoDate | null;
  deliveredAt: IsoDate | null;
  firstOpenedAt: IsoDate | null;
  firstClickedAt: IsoDate | null;
  openCount: number;
  clickCount: number;
  revenue: number | null;
  bounceReason: string | null;
  error: string | null;
}

// -----------------------------------------------------------------------------
// Import CSV
// -----------------------------------------------------------------------------

/** Campi del contatto valorizzabili da un file CSV. */
export type ContactCsvField =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'vatNumber'
  | 'phone'
  | 'segment'
  | 'status'
  | 'language'
  | 'tags'
  | 'notes';

/** Riga già normalizzata, pronta per la callable `importContacts`. */
export interface ImportRow {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;
  language: string;
  segment: 'b2c' | 'b2b';
  tags: string[];
  clusterIds: string[];
  status: SubscriptionStatus;
  notes?: string | null;
}

/** Riga scartata in fase di preparazione lato client. */
export interface ImportIssue {
  /** Numero della riga nel file, 1 = prima riga di dati. */
  row: number;
  email: string;
  reason: string;
}

/** Esito della preparazione delle righe, prima dell'invio al backend. */
export interface ImportPreparation {
  rows: ImportRow[];
  issues: ImportIssue[];
  /** Righe valide mostrate in anteprima, con il numero di riga originale. */
  preview: Array<{ row: number; data: ImportRow }>;
  duplicatesInFile: number;
}

export type ImportStep = 'file' | 'mappatura' | 'esecuzione';

/** Errore per riga restituito dalla callable. */
export interface ImportRowError {
  row: number;
  email: string;
  reason: string;
}

/** Risultato di una singola chiamata a `importContacts`. */
export interface ImportContactsResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: ImportRowError[];
  addedToClusters: DocId[];
  warnings: string[];
}

/** Riepilogo cumulativo di tutti i blocchi inviati. */
export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: ImportIssue[];
  warnings: string[];
  addedToClusters: DocId[];
}

// -----------------------------------------------------------------------------
// Risultati delle callable (rispecchiano `functions/src/contacts/*`)
// -----------------------------------------------------------------------------

export interface UpsertContactInput {
  /** Assente in creazione. */
  contactId?: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  vatNumber?: string | null;
  language: string;
  segment: 'b2c' | 'b2b';
  tags: string[];
  clusterIds: string[];
  status: SubscriptionStatus;
  notes?: string | null;
  source?: SiteSource;
  /** Riattiva un contatto disiscritto: solo su consenso documentato. */
  allowResubscribe?: boolean;
  consentSource?: string | null;
}

export interface UpsertContactResult {
  contact: Contact;
  created: boolean;
}

export interface DeleteContactResult {
  contactId: string;
  email: string;
  deletedOnBrevo: boolean;
}

export interface UnsubscribeContactInput {
  contactId?: string;
  email?: string;
  reason?: string | null;
  status?: 'unsubscribed' | 'blocked';
}

export interface UnsubscribeContactResult {
  contactId: string | null;
  email: string;
  status: 'unsubscribed' | 'blocked';
  blocklistedOnBrevo: boolean;
}

export interface ImportContactsInput {
  rows: ImportRow[];
  addToClusterIds: string[];
  updateExisting: boolean;
  source: 'csv' | 'manual';
}

export interface ExportContactsInput {
  clusterId?: string | null;
  status?: SubscriptionStatus[];
  segment?: 'b2c' | 'b2b' | null;
  source?: SiteSource | null;
  onlySendable?: boolean;
  limit?: number;
  fileName?: string;
}

export interface ExportContactsResult {
  url: string;
  fileName: string;
  path: string;
  rows: number;
  expiresAt: string;
}

export interface RunSyncInput {
  source: 'prestashop_b2c' | 'prestashop_b2b';
  entities: Array<
    'customers' | 'orders' | 'carts' | 'products' | 'categories' | 'coupons' | 'customer_groups'
  >;
  since?: string | null;
  fullResync?: boolean;
}

export interface SyncCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface RunSyncResult {
  jobId: string;
  source: 'prestashop_b2c' | 'prestashop_b2b';
  status: 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
  counts: Record<string, SyncCounts>;
  warnings: string[];
  error: string | null;
  durationMs: number;
  cursors: Record<string, string | null>;
  resumeRequired: boolean;
}

export interface SendTestEmailInput {
  newsletterId: string;
  recipients: string[];
  sampleContactId?: string | null;
}

export interface SendTestEmailResult {
  sent: number;
  subject: string;
  warnings: Array<{ code?: string; message: string; blocking?: boolean } | string>;
  messageIds: Record<string, string>;
}

/** Ordine mostrato nella scheda del contatto. */
export type ContactOrder = Order;
