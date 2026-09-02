'use client';

/**
 * Impostazioni → Utenti e permessi.
 *
 * Il ruolo e lo stato di abilitazione si cambiano solo tramite la callable
 * `setUserRole`: le regole Firestore vietano la scrittura diretta dei campi
 * `role` e `disabled`, perché il permesso effettivo vive nei custom claim del
 * token e solo l'Admin SDK può scriverli.
 *
 * Due protezioni lato server evitano di restare chiusi fuori:
 * nessuno può modificare il proprio ruolo e l'ultimo proprietario non può
 * essere retrocesso.
 */

import { type UserRole } from '@alphaink/shared';
import { RefreshCw, ShieldAlert, ShieldCheck, UserCog, Users } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth-context';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDateTimeIt, initials, relativeTimeIt } from '@/lib/utils';

import { setUserRole } from './api';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_OPTIONS } from './constants';
import { PermissionsMatrix } from './permissions-matrix';
import { LoadError, SectionSkeleton, SettingsSection } from './settings-shell';
import type { UserListEntry } from './types';
import { useUsersList } from './use-settings';

/** Provider di accesso in forma leggibile. */
const PROVIDER_LABELS: Record<string, string> = {
  'password': 'Email e password',
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
};

interface PendingChange {
  user: UserListEntry;
  role: UserRole;
  disabled: boolean;
  /** Descrizione dell'azione mostrata nella conferma. */
  summary: string;
}

export function UsersSettingsPanel() {
  const { can, appUser, role: currentRole } = useAuth();
  const canManage = can('users:manage');
  // L'elenco richiede almeno il ruolo admin lato server.
  const canList = currentRole === 'admin' || currentRole === 'owner';

  const { users, loading, error, refetch } = useUsersList(canList);
  const [pending, setPending] = React.useState<PendingChange | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const applyChange = React.useCallback(
    async (change: PendingChange) => {
      setSavingId(change.user.id);
      try {
        await setUserRole({
          userId: change.user.id,
          role: change.role,
          disabled: change.disabled,
        });
        toastSuccess('Utente aggiornato.', `${change.user.email}: ${ROLE_LABELS[change.role]}`);
        refetch();
      } catch (updateError) {
        toastError(updateError, 'Impossibile aggiornare l’utente.');
        throw updateError;
      } finally {
        setSavingId(null);
      }
    },
    [refetch],
  );

  const columns = React.useMemo<DataTableColumn<UserListEntry>[]>(
    () => [
      {
        id: 'utente',
        header: 'Utente',
        searchValue: (user) => `${user.displayName} ${user.email}`,
        sortValue: (user) => user.email,
        cell: (user) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              {user.photoURL ? <AvatarImage src={user.photoURL} alt="" /> : null}
              <AvatarFallback>{initials(user.displayName || user.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {user.displayName || 'Senza nome'}
                {user.id === appUser?.id ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">(tu)</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: 'ruolo',
        header: 'Ruolo',
        width: '14rem',
        sortValue: (user) => user.role,
        cell: (user) => {
          const isSelf = user.id === appUser?.id;
          return (
            <Select
              value={user.role}
              disabled={!canManage || isSelf || savingId === user.id}
              onValueChange={(value) =>
                setPending({
                  user,
                  role: value as UserRole,
                  disabled: user.disabled,
                  summary: `Assegnare il ruolo «${ROLE_LABELS[value as UserRole]}» a ${user.email}?`,
                })
              }
            >
              <SelectTrigger aria-label={`Ruolo di ${user.email}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        id: 'stato',
        header: 'Stato',
        width: '11rem',
        sortValue: (user) => (user.disabled ? 1 : 0),
        cell: (user) => {
          const isSelf = user.id === appUser?.id;
          return (
            <div className="flex items-center gap-2">
              <Switch
                checked={!user.disabled}
                disabled={!canManage || isSelf || savingId === user.id}
                onCheckedChange={(checked) =>
                  setPending({
                    user,
                    role: user.role,
                    disabled: !checked,
                    summary: checked
                      ? `Riattivare l’accesso di ${user.email}?`
                      : `Disattivare l’accesso di ${user.email}? Non potrà più entrare nell’applicazione.`,
                  })
                }
                aria-label={`Accesso di ${user.email}`}
              />
              <Badge variant={user.disabled ? 'destructive' : 'success'}>
                {user.disabled ? 'Disattivato' : 'Attivo'}
              </Badge>
            </div>
          );
        },
      },
      {
        id: 'accesso',
        header: 'Ultimo accesso',
        width: '12rem',
        hideOnMobile: true,
        sortValue: (user) => user.lastSignInAt ?? '',
        cell: (user) =>
          user.lastSignInAt ? (
            <span className="text-sm text-muted-foreground" title={formatDateTimeIt(user.lastSignInAt)}>
              {relativeTimeIt(user.lastSignInAt)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Mai</span>
          ),
      },
      {
        id: 'accessi',
        header: 'Metodo di accesso',
        width: '12rem',
        hideOnMobile: true,
        cell: (user) => (
          <div className="flex flex-wrap gap-1">
            {user.providers.length > 0 ? (
              user.providers.map((provider) => (
                <Badge key={provider} variant="outline" className="text-[11px]">
                  {PROVIDER_LABELS[provider] ?? provider}
                </Badge>
              ))
            ) : (
              <Badge variant="warning" className="text-[11px]">
                Account non trovato
              </Badge>
            )}
          </div>
        ),
      },
    ],
    [appUser?.id, canManage, savingId],
  );

  if (!canList) {
    return (
      <Alert variant="info">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>Elenco non disponibile</AlertTitle>
        <AlertDescription>
          Solo amministratori e proprietari possono consultare gli utenti dell’applicazione.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading) return <SectionSkeleton rows={3} />;

  return (
    <div className="space-y-5">
      {!canManage ? (
        <Alert variant="info">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Modifica riservata ai proprietari</AlertTitle>
          <AlertDescription>
            Puoi consultare l’elenco, ma solo un proprietario può cambiare ruoli e abilitazioni.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <LoadError message={error.message} /> : null}

      <SettingsSection
        title="Utenti dell’applicazione"
        description="Il ruolo determina cosa ogni persona può vedere e fare. Nessuno può modificare il proprio ruolo."
        icon={<Users />}
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw aria-hidden="true" />
            Aggiorna elenco
          </Button>
        }
      >
        <DataTable
          data={users}
          columns={columns}
          getRowId={(user) => user.id}
          searchable
          searchPlaceholder="Cerca per nome o email…"
          pageSize={25}
          emptyTitle="Nessun utente"
          emptyDescription="Gli account compaiono qui dopo il primo accesso all’applicazione."
          emptyIcon={<UserCog />}
          defaultSort={{ columnId: 'utente', direction: 'asc' }}
        />

        <p className="text-xs text-muted-foreground">
          Per aggiungere una persona: falla accedere una prima volta con Google o con email e password,
          poi assegnale il ruolo da questo elenco.
        </p>
      </SettingsSection>

      <SettingsSection
        title="Permessi per ruolo"
        description="Cosa può fare ciascun ruolo. La matrice riflette esattamente i controlli applicati dal server."
        icon={<ShieldCheck />}
      >
        <PermissionsMatrix />
        <p className="text-xs text-muted-foreground">
          {ROLE_OPTIONS.map((option) => `${option.label}: ${ROLE_DESCRIPTIONS[option.value]}`).join(' ')}
        </p>
      </SettingsSection>

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Confermi la modifica?"
        description={pending?.summary}
        confirmLabel="Applica"
        destructive={pending?.disabled === true}
        loading={savingId !== null}
        onConfirm={async () => {
          if (!pending) return;
          await applyChange(pending);
          setPending(null);
        }}
      />
    </div>
  );
}
