'use client';

import { CLUSTER_TYPE_LABELS } from '@alphaink/shared';
import type { Cluster } from '@alphaink/shared';
import {
  AlertTriangle,
  Copy,
  Mail,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn, formatNumber, formatPercent, relativeTimeIt } from '@/lib/utils';

import { ROUTES } from './constants';

export interface ClusterCardProps {
  cluster: Cluster;
  canWrite: boolean;
  busy: boolean;
  onDuplicate: () => void;
  onRecompute: () => void;
  onDelete: () => void;
  onToggleBrevoSync: (next: boolean) => void;
  onUseInNewsletter: () => void;
}

/** Un ricalcolo più vecchio di 24 ore va segnalato: i conteggi potrebbero essere superati. */
function isStale(cluster: Cluster): boolean {
  if (cluster.type !== 'dynamic' || !cluster.autoRefresh) return false;
  if (!cluster.lastComputedAt) return true;
  const computed = Date.parse(cluster.lastComputedAt);
  if (!Number.isFinite(computed)) return true;
  return Date.now() - computed > 24 * 60 * 60 * 1000;
}

/**
 * Scheda di un cluster nell'elenco: identità, conteggi, stato del ricalcolo,
 * interruttore per la lista Brevo e menu delle azioni.
 */
export function ClusterCard({
  cluster,
  canWrite,
  busy,
  onDuplicate,
  onRecompute,
  onDelete,
  onToggleBrevoSync,
  onUseInNewsletter,
}: ClusterCardProps) {
  const sendableRate = cluster.contactCount > 0 ? cluster.sendableCount / cluster.contactCount : 0;
  const stale = isStale(cluster);
  const switchId = `brevo-${cluster.id}`;

  return (
    <Card className={cn('flex flex-col transition-shadow hover:shadow-card', busy && 'opacity-70')}>
      <CardHeader className="flex-row items-start gap-3 space-y-0 pb-3">
        <span
          className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-card"
          style={{ backgroundColor: cluster.color, boxShadow: `0 0 0 2px ${cluster.color}33` }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={ROUTES.detail(cluster.id)}
            className="block truncate text-base font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {cluster.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline">{CLUSTER_TYPE_LABELS[cluster.type]}</Badge>
            {cluster.syncToBrevo ? <Badge variant="default">Su Brevo</Badge> : null}
            {cluster.type === 'dynamic' && !cluster.autoRefresh ? (
              <Badge variant="secondary">Ricalcolo manuale</Badge>
            ) : null}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={busy}
              aria-label={`Azioni per il cluster ${cluster.name}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href={ROUTES.detail(cluster.id)}>
                <Pencil aria-hidden="true" />
                Modifica
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onUseInNewsletter}>
              <Mail aria-hidden="true" />
              Usa in una newsletter
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`${ROUTES.contacts}?cluster=${cluster.id}`}>
                <Users aria-hidden="true" />
                Vedi i contatti
              </Link>
            </DropdownMenuItem>
            {canWrite ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDuplicate}>
                  <Copy aria-hidden="true" />
                  Duplica
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRecompute}>
                  <RefreshCw aria-hidden="true" />
                  Ricalcola adesso
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 aria-hidden="true" />
                  Elimina
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 pb-3">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {cluster.description?.trim() || 'Nessuna descrizione.'}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Contatti</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {formatNumber(cluster.contactCount)}
            </p>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Contattabili</p>
            <p className="text-lg font-semibold tabular-nums text-success">
              {formatNumber(cluster.sendableCount)}
            </p>
          </div>
        </div>

        {cluster.contactCount > 0 ? (
          <div className="space-y-1">
            <Progress
              value={sendableRate * 100}
              size="sm"
              tone={sendableRate >= 0.5 ? 'success' : sendableRate >= 0.2 ? 'warning' : 'destructive'}
              aria-label={`Quota contattabile del cluster ${cluster.name}`}
            />
            <p className="text-[11px] text-muted-foreground">
              {formatPercent(sendableRate)} dei contatti è raggiungibile via email.
            </p>
          </div>
        ) : null}

        {cluster.computeError ? (
          <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="line-clamp-2">{cluster.computeError}</span>
          </p>
        ) : null}
      </CardContent>

      <CardFooter className="flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <SimpleTooltip
          content={
            cluster.lastComputedAt
              ? `Ultimo ricalcolo: ${new Date(cluster.lastComputedAt).toLocaleString('it-IT')}`
              : 'Il cluster non è mai stato ricalcolato.'
          }
        >
          <span
            className={cn(
              'text-xs',
              stale ? 'font-medium text-warning-foreground' : 'text-muted-foreground',
            )}
          >
            {cluster.lastComputedAt
              ? `Ricalcolato ${relativeTimeIt(cluster.lastComputedAt)}`
              : 'Mai ricalcolato'}
          </span>
        </SimpleTooltip>

        <label
          htmlFor={switchId}
          className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
        >
          <span>Brevo</span>
          <Switch
            id={switchId}
            checked={cluster.syncToBrevo}
            disabled={!canWrite || busy}
            onCheckedChange={onToggleBrevoSync}
            aria-label={`Sincronizza il cluster ${cluster.name} su Brevo`}
          />
        </label>
      </CardFooter>
    </Card>
  );
}
