/**
 * Ciclo di vita degli utenti della web app.
 *
 * ## Dove vive il ruolo
 * Il ruolo sta in due posti, e devono restare allineati:
 *  - nel **custom claim** `role` del token Firebase Auth, che è ciò che leggono
 *    le regole di sicurezza Firestore e `requireAuth` nelle callable;
 *  - nel documento `users/{uid}`, che è ciò che mostra la UI.
 * Il claim è la fonte di verità per i permessi: il documento senza il claim non
 * autorizza nulla.
 *
 * ## Primo accesso
 * Il primo utente che si registra diventa `owner` (altrimenti nessuno potrebbe
 * assegnare i ruoli); tutti gli altri partono da `viewer` e attendono che un
 * amministratore li promuova.
 *
 * ## Due strade, stessa logica
 *  - `onUserCreated` è il trigger di Firebase Auth (generazione 1): scatta alla
 *    registrazione, anche quando l'utente viene creato dalla console;
 *  - `bootstrapUser` è la callable che la web app invoca al primo accesso.
 * Entrambe chiamano `ensureUserDocument`, che è idempotente: se il documento
 * esiste già si limita ad aggiornare data di accesso e anagrafica. La callable
 * serve anche come rete di sicurezza per gli account creati prima del deploy
 * del trigger.
 */

import { region } from 'firebase-functions/v1';
import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { UserRecord } from 'firebase-admin/auth';
import type { AppUser, UserRole } from '@alphaink/shared';

import { requireAuth } from '../lib/auth';
import { LIGHT_RUNTIME, REGION } from '../lib/config';
import { toHttpsError } from '../lib/errors';
import { auditCreate, auth, col, db, logActivity, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('users.triggers');

/** Ruolo assegnato a chi si registra quando esiste già almeno un utente. */
export const DEFAULT_ROLE: UserRole = 'viewer';

/** Ruolo assegnato al primissimo utente registrato. */
export const BOOTSTRAP_ROLE: UserRole = 'owner';

export interface EnsureUserResult {
  user: AppUser;
  /** true se il documento è stato creato ora. */
  created: boolean;
  /** true se i custom claim sono stati riscritti: il client deve rinfrescare il token. */
  claimsUpdated: boolean;
}

/**
 * Allinea i custom claim al ruolo salvato.
 * Scrive solo se qualcosa è cambiato: `setCustomUserClaims` invalida la cache
 * dei token e non va chiamata ad ogni accesso.
 */
export async function syncCustomClaims(
  uid: string,
  role: UserRole,
  disabled: boolean,
): Promise<boolean> {
  const record = await auth.getUser(uid).catch(() => null);
  const claims = (record?.customClaims ?? {}) as { role?: string; disabled?: boolean };
  if (claims.role === role && Boolean(claims.disabled) === disabled) return false;

  await auth.setCustomUserClaims(uid, { ...claims, role, disabled });
  log.info('Custom claim aggiornati', { uid, role, disabled });
  return true;
}

/**
 * Crea (o aggiorna) `users/{uid}` e allinea i claim.
 *
 * La lettura "esiste già qualche utente?" avviene dentro la transazione: due
 * registrazioni simultanee non possono produrre due `owner`.
 */
export async function ensureUserDocument(input: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  /** Aggiorna `lastLoginAt` (vero quando la chiamata arriva da un accesso). */
  touchLogin?: boolean;
}): Promise<EnsureUserResult> {
  const ref = col.users().doc(input.uid);
  const email = (input.email ?? '').trim().toLowerCase();

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);

    if (snapshot.exists) {
      const existing = withId<AppUser>(snapshot);
      const patch: Record<string, unknown> = { updatedAt: nowIso() };
      if (email && existing.email !== email) patch.email = email;
      if (input.displayName && existing.displayName !== input.displayName) {
        patch.displayName = input.displayName;
      }
      if (input.photoURL && existing.photoURL !== input.photoURL) patch.photoURL = input.photoURL;
      if (input.touchLogin) patch.lastLoginAt = nowIso();
      tx.set(ref, patch, { merge: true });
      return { user: { ...existing, ...(patch as Partial<AppUser>) } as AppUser, created: false };
    }

    // Nessun documento: si guarda se questo è il primo utente in assoluto.
    const others = await tx.get(col.users().limit(1));
    const role: UserRole = others.empty ? BOOTSTRAP_ROLE : DEFAULT_ROLE;

    const data: Omit<AppUser, 'id'> = {
      email,
      displayName: input.displayName?.trim() || email.split('@')[0] || 'Utente',
      photoURL: input.photoURL ?? null,
      role,
      disabled: false,
      lastLoginAt: input.touchLogin ? nowIso() : null,
      ...auditCreate(input.uid),
    };
    tx.set(ref, data);
    return { user: { ...data, id: input.uid }, created: true };
  });

  const claimsUpdated = await syncCustomClaims(
    input.uid,
    outcome.user.role,
    Boolean(outcome.user.disabled),
  );

  if (outcome.created) {
    log.info('Documento utente creato', { uid: input.uid, role: outcome.user.role });
    await logActivity({
      action: 'user.created',
      entityType: 'user',
      entityId: input.uid,
      userId: input.uid,
      summary:
        outcome.user.role === BOOTSTRAP_ROLE
          ? `Primo accesso: ${outcome.user.email} è stato registrato come proprietario`
          : `Nuovo utente registrato: ${outcome.user.email}`,
      metadata: { role: outcome.user.role },
    });
  }

  return { ...outcome, claimsUpdated };
}

// -----------------------------------------------------------------------------
// Trigger di registrazione
// -----------------------------------------------------------------------------

/**
 * Trigger di Firebase Auth alla creazione di un account.
 *
 * È una funzione di prima generazione: è l'unico trigger di autenticazione che
 * funziona su Firebase Auth senza richiedere l'upgrade a Identity Platform (che
 * le funzioni bloccanti `beforeUserCreated` invece pretendono). Convive senza
 * problemi con le funzioni v2 dello stesso codebase.
 */
export const onUserCreated = region(REGION)
  .auth.user()
  .onCreate(async (user: UserRecord) => {
    try {
      await ensureUserDocument({
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
      });
    } catch (error) {
      // Un errore qui non deve impedire la registrazione: la callable
      // `bootstrapUser`, invocata al primo accesso, ripara la situazione.
      log.error('Creazione del documento utente non riuscita', error, { uid: user.uid });
    }
  });

// -----------------------------------------------------------------------------
// bootstrapUser
// -----------------------------------------------------------------------------

export interface BootstrapUserResult {
  user: AppUser;
  created: boolean;
  /** Se true la web app deve rinfrescare il token (`getIdToken(true)`). */
  claimsUpdated: boolean;
}

/**
 * Chiamata dalla web app subito dopo l'accesso.
 *
 * Non richiede alcun permesso oltre all'autenticazione: serve proprio a chi non
 * ha ancora un ruolo. Restituisce il proprio profilo e segnala se il token va
 * rinfrescato per vedere i nuovi claim.
 */
export const bootstrapUser = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<BootstrapUserResult> => {
    try {
      const caller = requireAuth(request);
      const record = await auth.getUser(caller.uid).catch(() => null);

      const result = await ensureUserDocument({
        uid: caller.uid,
        email: caller.email ?? record?.email ?? null,
        displayName: record?.displayName ?? null,
        photoURL: record?.photoURL ?? null,
        touchLogin: true,
      });

      return { user: result.user, created: result.created, claimsUpdated: result.claimsUpdated };
    } catch (error) {
      log.error('Callable bootstrapUser fallita', error);
      throw toHttpsError(error);
    }
  },
);
