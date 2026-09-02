'use client';

import type { UserRole } from '@alphaink/shared';
import { ChevronsUpDown, LogOut, Settings, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth-context';
import { toastError } from '@/lib/toast';
import { cn, initials } from '@/lib/utils';

/** Etichette in italiano dei ruoli applicativi. */
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Proprietario',
  admin: 'Amministratore',
  editor: 'Editor',
  analyst: 'Analista',
  viewer: 'Visualizzatore',
};

/** Avatar dell'utente con ruolo, collegamento alle impostazioni e logout. */
export function UserMenu({ className }: { className?: string }) {
  const { user, appUser, role, signOut, can } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  const name = appUser?.displayName?.trim() || user?.displayName?.trim() || user?.email || 'Utente';
  const email = appUser?.email || user?.email || '';
  const photo = appUser?.photoURL || user?.photoURL || undefined;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } catch (error) {
      toastError(error, 'Disconnessione non riuscita.');
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn('h-9 gap-2 px-1.5 sm:px-2', className)}
          aria-label={`Menu utente di ${name}`}
        >
          <Avatar size="sm">
            {photo ? <AvatarImage src={photo} alt="" /> : null}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
            <span className="max-w-[9rem] truncate text-xs font-medium text-foreground">{name}</span>
            <span className="text-[11px] text-muted-foreground">
              {role ? ROLE_LABELS[role] : 'Nessun ruolo'}
            </span>
          </span>
          <ChevronsUpDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar>
            {photo ? <AvatarImage src={photo} alt="" /> : null}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{name}</p>
            {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
          </div>
        </div>
        <div className="px-2 pb-2">
          <Badge variant={role === 'owner' || role === 'admin' ? 'default' : 'secondary'}>
            <User aria-hidden="true" />
            {role ? ROLE_LABELS[role] : 'Nessun ruolo assegnato'}
          </Badge>
        </div>

        <DropdownMenuSeparator />

        {can('settings:read') ? (
          <DropdownMenuItem asChild>
            <Link href="/impostazioni">
              <Settings aria-hidden="true" />
              <span>Impostazioni</span>
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut aria-hidden="true" />
          <span>{signingOut ? 'Disconnessione…' : 'Esci'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
