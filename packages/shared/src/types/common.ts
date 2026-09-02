/**
 * Tipi comuni condivisi fra web app e Cloud Functions.
 *
 * Nota sulle date: Firestore restituisce `Timestamp` lato admin/client SDK, ma il
 * contratto condiviso usa `IsoDate` (stringa ISO-8601 UTC) per essere serializzabile
 * su JSON, in `postMessage` e nelle risposte HTTP. La conversione avviene nei
 * repository (`toIso` / `fromIso`).
 */
export type IsoDate = string;

/** Identificativo di documento Firestore. */
export type DocId = string;

/** Metadati di audit presenti su tutti i documenti scrivibili dalla UI. */
export interface AuditFields {
  createdAt: IsoDate;
  updatedAt: IsoDate;
  createdBy?: DocId | null;
  updatedBy?: DocId | null;
}

/** Wrapper standard delle risposte delle API/Callable. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiErrorCode =
  | 'invalid_argument'
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_found'
  | 'already_exists'
  | 'failed_precondition'
  | 'resource_exhausted'
  | 'rate_limited'
  | 'upstream_error'
  | 'internal';

/** Paginazione a cursore usata dalle liste. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface PageRequest {
  limit?: number;
  cursor?: string | null;
}

/** Intervallo temporale usato da filtri e dashboard. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** Lingua supportata dalla UI e dai template. */
export type Locale = 'it' | 'en';

export const DEFAULT_LOCALE: Locale = 'it';

/** Fuso orario di default dell'azienda. */
export const DEFAULT_TIMEZONE = 'Europe/Rome';

/** Valuta di default. */
export const DEFAULT_CURRENCY = 'EUR';
