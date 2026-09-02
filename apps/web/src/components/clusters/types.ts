import type {
  Cluster,
  ClusterType,
  DocId,
  FilterField,
  FilterGroup,
  IsoDate,
} from '@alphaink/shared';

/** Raggruppamento dei campi nel selettore delle condizioni. */
export type FieldGroupId = 'anagrafica' | 'commerciale' | 'engagement' | 'sistema';

/**
 * Tipo del valore atteso da un campo. Determina sia gli operatori proposti sia
 * il controllo di input mostrato nella riga della condizione.
 */
export type FieldKind =
  | 'text'
  | 'enum'
  | 'number'
  | 'currency'
  | 'date'
  | 'list'
  | 'cluster'
  | 'custom';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  field: FilterField;
  label: string;
  group: FieldGroupId;
  kind: FieldKind;
  /** Valori ammessi per i campi a scelta chiusa. */
  options?: FieldOption[];
  /** Testo esplicativo mostrato sotto la condizione. */
  hint?: string;
  placeholder?: string;
  /** Unità di misura mostrata accanto al valore numerico. */
  unit?: string;
}

/** Cluster pronto all'uso proposto nella pagina di elenco. */
export interface SuggestedCluster {
  key: string;
  name: string;
  description: string;
  color: string;
  rules: FilterGroup;
}

/** Stato del modulo di modifica di un cluster. */
export interface ClusterDraft {
  name: string;
  description: string;
  type: ClusterType;
  color: string;
  rules: FilterGroup;
  contactIds: DocId[];
  siteGroupName: string;
  brevoListId: number | null;
  autoRefresh: boolean;
  syncToBrevo: boolean;
}

/** Errori di validazione del modulo, per campo. */
export type ClusterDraftErrors = Partial<Record<'name' | 'rules' | 'contactIds' | 'siteGroupName' | 'brevoListId', string>>;

// -----------------------------------------------------------------------------
// Risultati delle callable (rispecchiano `functions/src/clusters/callables.ts`)
// -----------------------------------------------------------------------------

export interface RecomputeClusterResult {
  clusterId: DocId;
  name: string;
  contactCount: number;
  sendableCount: number;
  added: number;
  removed: number;
  /** True se il ricalcolo ha superato il tetto di contatti valutabili. */
  truncated: boolean;
  durationMs: number;
  warnings: string[];
}

export interface SaveClusterResult {
  cluster: Cluster;
  recompute: RecomputeClusterResult | null;
  warnings: string[];
}

export interface RecomputeClusterCallableResult extends RecomputeClusterResult {
  cluster: Cluster;
  brevo: { listId: number; added: number; removed: number } | null;
}

export interface DeleteClusterResult {
  clusterId: DocId;
  detachedContacts: number;
}

/** Input accettato da `previewCluster`. */
export interface PreviewClusterInput {
  type: ClusterType;
  rules?: FilterGroup | null;
  contactIds?: DocId[];
  siteGroupName?: string | null;
  brevoListId?: number | null;
  limit?: number;
  /** Anteprima di un cluster già salvato: le regole si leggono dal documento. */
  clusterId?: string;
}

/** Input accettato da `saveCluster`. */
export interface SaveClusterInput {
  /** Assente in creazione. */
  id?: string;
  name: string;
  description?: string | null;
  type: ClusterType;
  color: string;
  icon?: string | null;
  rules?: FilterGroup | null;
  contactIds?: DocId[];
  siteGroupName?: string | null;
  brevoListId?: number | null;
  autoRefresh: boolean;
  syncToBrevo: boolean;
  /** Se false il ricalcolo è rimandato al job schedulato. */
  recompute?: boolean;
}

/** Riga dell'elenco cluster arricchita con i dati derivati mostrati in scheda. */
export interface ClusterCardData {
  cluster: Cluster;
  /** Percentuale di contattabili sul totale (0-1). */
  sendableRate: number;
  lastComputedAt: IsoDate | null;
  /** True se il ricalcolo è più vecchio di 24 ore. */
  stale: boolean;
}
