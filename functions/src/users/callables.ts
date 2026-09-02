/**
 * Gestione degli utenti della web app.
 *
 *  - `setUserRole` cambia ruolo e abilitazione di un account
 *  - `listUsers`   elenca gli utenti con i dati di accesso
 *
 * Il ruolo si cambia SOLO da qui: le regole Firestore vietano la scrittura dei
 * campi `role` e `disabled` dal client, perché il permesso effettivo vive nei
 * custom claim del token e solo l'Admin SDK può scriverli.
 *
 * Due protezioni impediscono di restare chiusi fuori dall'applicazione:
 *  1. nessuno può modificare il proprio ruolo (né disabilitarsi da solo);
 *  2. non si può togliere il ruolo all'ultimo proprietario rimasto.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ROLE_PERMISSIONS } from '@alphaink/shared';
import type { AppUser, IsoDate, UserRole } from '@alphaink/shared';

import { requirePermission, requireRole } from '../lib/auth';
import { LIGHT_RUNTIME } from '../lib/config';
import { failedPrecondition, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { auditUpdate, auth, col, logActivity, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { syncCustomClaims } from './triggers';

const log = createLogger('users.callables');

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw invalidArgument('Dati non validi.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data as z.infer<S>;
}

async function guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`Callable ${operation} fallita`, error);
    throw toHttpsError(error);
  }
}

const roleSchema = z.enum(['owner', 'admin', 'editor', 'analyst', 'viewer']);

// -----------------------------------------------------------------------------
// setUserRole
// -----------------------------------------------------------------------------

const setUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
  /** Blocca l'accesso all'applicazione senza cancellare l'account. */
  disabled: z.boolean().optional(),
});

export interface SetUserRoleResult {
  user: AppUser;
  /** Permessi effettivi del nuovo ruolo, comodi per la UI. */
  permissions: string[];
}

/** Numero di proprietari attivi, letto senza scaricare i documenti. */
async function countActiveOwners(excludeUserId?: string): Promise<number> {
  const snapshot = await col.users().where('role', '==', 'owner').select('disabled').get();
  return snapshot.docs.filter(
    (doc) => doc.id !== excludeUserId && doc.get('disabled') !== true,
  ).length;
}

export const setUserRole = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<SetUserRoleResult> =>
    guard('setUserRole', async () => {
      const caller = requirePermission(request, 'users:manage');
      const input = parseInput(setUserRoleSchema, request.data);

      if (input.userId === caller.uid) {
        throw failedPrecondition(
          'Non puoi modificare il tuo ruolo: chiedi a un altro proprietario di farlo.',
        );
      }

      const ref = col.users().doc(input.userId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw notFound('Utente', input.userId);
      const existing = withId<AppUser>(snapshot);

      const disabled = input.disabled ?? existing.disabled ?? false;
      const losesOwnership = existing.role === 'owner' && (input.role !== 'owner' || disabled);
      if (losesOwnership && (await countActiveOwners(input.userId)) === 0) {
        throw failedPrecondition(
          'Questo è l\'ultimo proprietario attivo: assegna il ruolo di proprietario a un altro utente prima di procedere.',
        );
      }

      // 1. Account Firebase Auth: l'utente disabilitato non ottiene più token.
      if (disabled !== Boolean(existing.disabled)) {
        await auth.updateUser(input.userId, { disabled });
      }

      // 2. Custom claim + revoca dei token: il cambio ha effetto subito, senza
      //    aspettare la scadenza dell'ID token in corso.
      const claimsUpdated = await syncCustomClaims(input.userId, input.role as UserRole, disabled);
      if (claimsUpdated) {
        await auth.revokeRefreshTokens(input.userId).catch(() => undefined);
      }

      // 3. Documento consultato dalla UI.
      const patch = { role: input.role, disabled, ...auditUpdate(caller.uid) };
      await ref.set(patch, { merge: true });

      await logActivity({
        action: 'user.role_changed',
        entityType: 'user',
        entityId: input.userId,
        userId: caller.uid,
        summary: `Ruolo di ${existing.email} portato da "${existing.role}" a "${input.role}"${
          disabled ? ' (account disabilitato)' : ''
        }`,
        metadata: { previousRole: existing.role, role: input.role, disabled },
        severity: 'warning',
      });

      return {
        user: { ...existing, ...patch } as AppUser,
        permissions: [...(ROLE_PERMISSIONS[input.role as UserRole] ?? [])],
      };
    }),
);

// -----------------------------------------------------------------------------
// listUsers
// -----------------------------------------------------------------------------

const listUsersSchema = z.object({
  limit: z.number().int().min(1).max(500).default(200),
  includeDisabled: z.boolean().default(true),
});

/** Utente con i dati di accesso letti da Firebase Auth. */
export interface UserListEntry extends AppUser {
  /** false se il documento sopravvive a un account cancellato. */
  authExists: boolean;
  emailVerified: boolean;
  lastSignInAt: IsoDate | null;
  providers: string[];
}

export const listUsers = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ users: UserListEntry[]; total: number }> =>
    guard('listUsers', async () => {
      // Gli amministratori vedono l'elenco; solo i proprietari possono
      // modificarlo (`users:manage`).
      requireRole(request, 'admin');
      const input = parseInput(listUsersSchema, request.data);

      const snapshot = await col.users().limit(input.limit).get();
      const users = snapshot.docs.map((doc) => withId<AppUser>(doc));
      const visible = input.includeDisabled ? users : users.filter((user) => !user.disabled);

      // `getUsers` accetta al massimo 100 identificatori per chiamata.
      const records = new Map<string, Awaited<ReturnType<typeof auth.getUser>>>();
      for (let i = 0; i < visible.length; i += 100) {
        const block = visible.slice(i, i + 100).map((user) => ({ uid: user.id }));
        if (!block.length) continue;
        const result = await auth.getUsers(block);
        for (const record of result.users) records.set(record.uid, record);
      }

      const entries: UserListEntry[] = visible
        .map((user) => {
          const record = records.get(user.id);
          return {
            ...user,
            authExists: Boolean(record),
            emailVerified: record?.emailVerified ?? false,
            lastSignInAt: record?.metadata?.lastSignInTime
              ? new Date(record.metadata.lastSignInTime).toISOString()
              : (user.lastLoginAt ?? null),
            providers: record?.providerData?.map((provider) => provider.providerId) ?? [],
          };
        })
        .sort((a, b) => a.email.localeCompare(b.email, 'it'));

      return { users: entries, total: entries.length };
    }),
);
