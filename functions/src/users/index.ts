/**
 * Utenti e permessi.
 *
 *  - `callables.ts` `setUserRole` e `listUsers`
 *  - `triggers.ts`  creazione del documento utente al primo accesso
 *
 * Il ruolo vive nei custom claim del token Firebase Auth (fonte di verità per
 * le regole di sicurezza) ed è replicato su `users/{uid}` per la UI.
 */

export { listUsers, setUserRole } from './callables';
export type { SetUserRoleResult, UserListEntry } from './callables';

export { bootstrapUser, onUserCreated } from './triggers';
export { BOOTSTRAP_ROLE, DEFAULT_ROLE, ensureUserDocument, syncCustomClaims } from './triggers';
export type { BootstrapUserResult, EnsureUserResult } from './triggers';
