/**
 * Gestione dei contatti: repository, import/export, callable e trigger.
 *
 * Attenzione ai nomi: la callable `upsertContact` (contratto API) e la funzione
 * del repository hanno lo stesso nome. Qui vince la callable; la funzione del
 * repository è riesportata come `upsertContactRecord`. Chi scrive contatti dal
 * backend (sincronizzazione sito, webhook, automazioni) importi da
 * `./contacts/repository` oppure usi l'alias.
 */

export {
  PROTECTED_STATUSES,
  buildContactPatch,
  buildNewContactData,
  deleteContactRecord,
  emptyContactStats,
  findContactsByEmails,
  getContactByEmail,
  getContactById,
  getContactsByIds,
  recomputeEngagement,
  setSubscriptionStatus,
  upsertContact as upsertContactRecord,
} from './repository';
export type {
  ContactUpsertInput,
  ContactUpsertOptions,
  ContactUpsertResult,
} from './repository';

export { runContactImport } from './import';
export type { ImportContactsResult, ImportRowError } from './import';

export {
  EXPORT_COLUMNS,
  EXPORT_MAX_ROWS,
  EXPORT_URL_TTL_MS,
  buildContactsCsv,
  contactToCsvRow,
} from './export';
export type { ExportContactsResult } from './export';

export * from './callables';
export * from './triggers';
