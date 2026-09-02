import type {
  AutomationKey,
  DocId,
  EmailDocument,
  IsoDate,
  NewsletterCategory,
  NewsletterInput,
  NewsletterStatus,
} from '@alphaink/shared';

/**
 * Tipi del calendario editoriale.
 *
 * `CalendarEntry` rispecchia fedelmente il risultato della callable
 * `getCalendarEntries`: è il contratto con le Cloud Functions e non va cambiato
 * senza allineare `functions/src/newsletters/callables.ts`.
 */

/**
 * Payload di creazione di una bozza dal calendario.
 *
 * Corrisponde a `newsletterInputSchema`, ma con il documento tipizzato come
 * `EmailDocument`: il tipo dedotto da zod perde le unioni discriminate dei
 * blocchi e non è quindi assegnabile dai costruttori dell'editor.
 */
export interface NewsletterDraftInput extends Omit<NewsletterInput, 'document'> {
  document: EmailDocument;
}

/** Vista attiva del calendario. */
export type CalendarView = 'mese' | 'settimana' | 'agenda';

/** Statistiche essenziali associate a una voce già inviata. */
export interface CalendarEntryStats {
  delivered: number;
  opened: number;
  clicked: number;
  revenue: number;
}

/** Voce del calendario così come arriva dal backend. */
export interface CalendarEntry {
  id: string;
  type: 'newsletter' | 'automation';
  title: string;
  /** Istante dell'occorrenza (invio pianificato o effettivo). */
  date: IsoDate;
  /** Giorno `YYYY-MM-DD` calcolato dal backend nel fuso richiesto. */
  day: string;
  status: NewsletterStatus;
  category: NewsletterCategory | null;
  color: string | null;
  recipients: number;
  newsletterId: DocId | null;
  automationId: DocId | null;
  automationKey: AutomationKey | null;
  /** Occorrenze aggregate nel giorno (solo per le automazioni). */
  occurrences: number;
  stats: CalendarEntryStats | null;
}

/** Input della callable `getCalendarEntries`. */
export interface GetCalendarEntriesInput {
  from: string;
  to: string;
  statuses?: string[];
  categories?: string[];
  includeArchived?: boolean;
  includeAutomations?: boolean;
  timezone?: string;
}

export interface GetCalendarEntriesResult {
  entries: CalendarEntry[];
}

/**
 * Voce pronta per la UI: la base arriva dalla callable, i campi editoriali
 * (tag, cluster, oggetto) e lo stato aggiornato arrivano dalla sottoscrizione
 * in tempo reale sui documenti newsletter.
 */
export interface CalendarItem extends CalendarEntry {
  /** Giorno locale `YYYY-MM-DD`: chiave di raggruppamento della griglia. */
  dayId: string;
  /** Orario locale `HH:mm`. */
  time: string;
  /** Timestamp in millisecondi, per gli ordinamenti. */
  timestamp: number;
  subject: string | null;
  tags: string[];
  clusterIds: DocId[];
  /** Tasso di apertura unico (0-1), disponibile solo dopo l'invio. */
  openRate: number | null;
  /** True se la voce può essere trascinata su un altro giorno. */
  draggable: boolean;
  /** True se l'occorrenza è già passata. */
  past: boolean;
}

/** Filtri applicati lato client alle voci caricate. */
export interface CalendarFilters {
  search: string;
  statuses: NewsletterStatus[];
  categories: NewsletterCategory[];
  clusterIds: string[];
  tags: string[];
  showAutomations: boolean;
}

/** Intervallo visualizzato e giorni che compongono la griglia. */
export interface CalendarRange {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
  /** Giorni della griglia (42 per il mese, 7 per la settimana). */
  days: Date[];
}

/** Dati necessari per annullare una ripianificazione appena eseguita. */
export interface RescheduleUndo {
  newsletterId: DocId;
  previousSendAt: IsoDate | null;
  previousStatus: NewsletterStatus;
}
