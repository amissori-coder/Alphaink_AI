import type { CallableRequest } from 'firebase-functions/v2/https';
import { ROLE_RANK, hasPermission } from '@alphaink/shared';
import type { Permission, UserRole } from '@alphaink/shared';
import { AppError } from './errors';

export interface CallerContext {
  uid: string;
  email: string | null;
  role: UserRole;
}

/** Estrae e valida il chiamante di una callable. */
export function requireAuth(request: CallableRequest<unknown>): CallerContext {
  const auth = request.auth;
  if (!auth) {
    throw new AppError('unauthenticated', 'Devi effettuare l\'accesso.');
  }
  if (auth.token.disabled === true) {
    throw new AppError('permission_denied', 'Account disabilitato.');
  }
  const role = (auth.token.role as UserRole | undefined) ?? 'viewer';
  if (!(role in ROLE_RANK)) {
    throw new AppError('permission_denied', 'Ruolo non riconosciuto.');
  }
  return { uid: auth.uid, email: (auth.token.email as string | undefined) ?? null, role };
}

/** Valida il chiamante e verifica che possieda il permesso richiesto. */
export function requirePermission(
  request: CallableRequest<unknown>,
  permission: Permission,
): CallerContext {
  const caller = requireAuth(request);
  if (!hasPermission(caller.role, permission)) {
    throw new AppError('permission_denied', `Permesso "${permission}" mancante.`);
  }
  return caller;
}

/** Valida il chiamante e verifica il ruolo minimo. */
export function requireRole(
  request: CallableRequest<unknown>,
  minimum: UserRole,
): CallerContext {
  const caller = requireAuth(request);
  if (ROLE_RANK[caller.role] < ROLE_RANK[minimum]) {
    throw new AppError('permission_denied', `Ruolo minimo richiesto: ${minimum}.`);
  }
  return caller;
}
