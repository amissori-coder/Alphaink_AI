'use client';

/**
 * Matrice statica dei permessi per ruolo.
 *
 * I dati arrivano da `ROLE_PERMISSIONS` del pacchetto condiviso: la tabella è
 * quindi sempre allineata a ciò che applicano davvero le Cloud Functions e le
 * regole Firestore.
 */

import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  roleHasPermission,
} from './constants';

export function PermissionsMatrix({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[16rem]">Permesso</TableHead>
            {ROLE_ORDER.map((role) => (
              <TableHead key={role} className="text-center">
                <span className="block text-sm font-medium text-foreground">{ROLE_LABELS[role]}</span>
                <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                  {ROLE_DESCRIPTIONS[role]}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERMISSION_GROUPS.map((group) => (
            <React.Fragment key={group.label}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={ROLE_ORDER.length + 1} className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </TableCell>
              </TableRow>
              {group.permissions.map((permission) => (
                <TableRow key={permission}>
                  <TableCell className="text-sm">
                    {PERMISSION_LABELS[permission]}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{permission}</span>
                  </TableCell>
                  {ROLE_ORDER.map((role) => {
                    const allowed = roleHasPermission(role, permission);
                    return (
                      <TableCell key={role} className="text-center">
                        <span className="sr-only">
                          {allowed
                            ? `${ROLE_LABELS[role]}: consentito`
                            : `${ROLE_LABELS[role]}: non consentito`}
                        </span>
                        {allowed ? (
                          <Check className="mx-auto size-4 text-success" aria-hidden="true" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground/50" aria-hidden="true" />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
