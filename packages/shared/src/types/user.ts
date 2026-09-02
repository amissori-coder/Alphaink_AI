import type { AuditFields, DocId, IsoDate } from './common';

/**
 * Ruoli applicativi. L'ordine è gerarchico: `owner` include tutti i permessi
 * di `admin`, che include quelli di `editor`, ecc.
 */
export type UserRole = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';

export const ROLE_RANK: Record<UserRole, number> = {
  owner: 50,
  admin: 40,
  editor: 30,
  analyst: 20,
  viewer: 10,
};

/** Permessi granulari derivati dal ruolo. */
export type Permission =
  | 'newsletter:read'
  | 'newsletter:write'
  | 'newsletter:send'
  | 'newsletter:schedule'
  | 'contacts:read'
  | 'contacts:write'
  | 'contacts:export'
  | 'clusters:read'
  | 'clusters:write'
  | 'automations:read'
  | 'automations:write'
  | 'automations:toggle'
  | 'analytics:read'
  | 'media:write'
  | 'settings:read'
  | 'settings:write'
  | 'users:manage'
  | 'sync:run';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  viewer: ['newsletter:read', 'contacts:read', 'clusters:read', 'automations:read', 'analytics:read', 'settings:read'],
  analyst: [
    'newsletter:read', 'contacts:read', 'contacts:export', 'clusters:read',
    'automations:read', 'analytics:read', 'settings:read',
  ],
  editor: [
    'newsletter:read', 'newsletter:write', 'newsletter:schedule',
    'contacts:read', 'contacts:export', 'clusters:read', 'clusters:write',
    'automations:read', 'analytics:read', 'media:write', 'settings:read',
  ],
  admin: [
    'newsletter:read', 'newsletter:write', 'newsletter:send', 'newsletter:schedule',
    'contacts:read', 'contacts:write', 'contacts:export',
    'clusters:read', 'clusters:write',
    'automations:read', 'automations:write', 'automations:toggle',
    'analytics:read', 'media:write', 'settings:read', 'settings:write', 'sync:run',
  ],
  owner: [
    'newsletter:read', 'newsletter:write', 'newsletter:send', 'newsletter:schedule',
    'contacts:read', 'contacts:write', 'contacts:export',
    'clusters:read', 'clusters:write',
    'automations:read', 'automations:write', 'automations:toggle',
    'analytics:read', 'media:write', 'settings:read', 'settings:write',
    'users:manage', 'sync:run',
  ],
};

export interface AppUser extends AuditFields {
  id: DocId;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: UserRole;
  disabled: boolean;
  lastLoginAt?: IsoDate | null;
}

export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function atLeast(role: UserRole | undefined | null, minimum: UserRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
