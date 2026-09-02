'use client';

import {
  COLLECTIONS,
  SITE_SOURCE_LABELS,
  STORE_SOURCES,
  type SiteSettings,
  type StoreSource,
  type SyncCounts,
  type SyncEntity,
  type SyncJob,
  type SyncJobStatus,
} from '@alphaink/shared';
import { limit, orderBy } from 'firebase/firestore';
import { Database, RefreshCw, Store, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { DashboardPanel } from '@/components/dashboard/panel';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { useDocumentQuery } from '@/lib/hooks/use-document';
import { useRunSync } from '@/lib/hooks/use-callables';
import { formatNumber, relativeTimeIt } from '@/lib/utils';

/** Entità sincronizzate dal pulsante rapido della dashboard. */
const QUICK_ENTITIES: SyncEntity[] = ['customers', 'orders'];

const STATUS_LABELS: Record<SyncJobStatus, string> = {
  queued: 'In coda',
  running: 'In corso',
  success: 'Completata',
  partial: 'Parziale',
  failed: 'Fallita',
  cancelled: 'Annullata',
};

const STATUS_VARIANTS: Record<SyncJobStatus, NonNullable<BadgeProps['variant']>> = {
  queued: 'secondary',
  running: 'default',
  success: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'secondary',
};

/** Record importati (creati + aggiornati) per una entità del job. */
function importedCount(job: SyncJob | undefined, entity: SyncEntity): number {
  if (!job) return 0;
  const counts = (job.counts as Record<string, SyncCounts | undefined>)[entity];
  if (!counts) return 0;
  return (counts.created ?? 0) + (counts.updated ?? 0);
}

export interface SyncStatusProps {
  className?: string;
}

/** Stato della sincronizzazione con i negozi PrestaShop. */
export function SyncStatus({ className }: SyncStatusProps) {
  const { can } = useAuth();
  const canRun = can('sync:run');

  const settings = useDocumentQuery<SiteSettings>(COLLECTIONS.settings, 'site');
  const jobs = useCollectionQuery<SyncJob>(
    COLLECTIONS.syncJobs,
    [orderBy('startedAt', 'desc'), limit(10)],
    { key: 'dashboard-sync' },
  );

  const runSync = useRunSync();

  const enabledStores = React.useMemo<StoreSource[]>(() => {
    const stores = settings.data?.stores;
    if (!stores) return [];
    return STORE_SOURCES.filter((source) => stores[source]?.enabled);
  }, [settings.data]);

  /** Ultimo job per ciascun negozio. */
  const lastJobBySource = React.useMemo(() => {
    const map = new Map<string, SyncJob>();
    for (const job of jobs.data) {
      if (!map.has(job.source)) map.set(job.source, job);
    }
    return map;
  }, [jobs.data]);

  const loading = settings.loading || jobs.loading;
  const pendingSource = runSync.isPending ? runSync.variables?.source : undefined;

  const start = (source: StoreSource) => {
    runSync.mutate({ source, entities: QUICK_ENTITIES, fullResync: false });
  };

  const syncButton =
    enabledStores.length === 0 ? null : enabledStores.length === 1 ? (
      <Button
        size="sm"
        variant="outline"
        loading={runSync.isPending}
        disabled={!canRun || runSync.isPending}
        onClick={() => start(enabledStores[0]!)}
      >
        {runSync.isPending ? null : <RefreshCw aria-hidden="true" />}
        Sincronizza ora
      </Button>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" loading={runSync.isPending} disabled={!canRun || runSync.isPending}>
            {runSync.isPending ? null : <RefreshCw aria-hidden="true" />}
            Sincronizza ora
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {enabledStores.map((source) => (
            <DropdownMenuItem key={source} onSelect={() => start(source)}>
              <Store aria-hidden="true" />
              <span className="truncate">{SITE_SOURCE_LABELS[source]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <DashboardPanel
      className={className}
      icon={<Database />}
      title="Sincronizzazione sito"
      description="Clienti e ordini importati da alphaink.net e b2b.alphaink.net."
      actions={
        <>
          {canRun ? syncButton : null}
          {can('settings:read') ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/impostazioni">Configura</Link>
            </Button>
          ) : null}
        </>
      }
    >
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : enabledStores.length === 0 ? (
        <EmptyState
          compact
          icon={<Store />}
          title="Nessun negozio collegato"
          description="Attiva almeno un negozio PrestaShop nelle impostazioni per importare clienti e ordini."
          action={
            can('settings:write') ? (
              <Button size="sm" asChild>
                <Link href="/impostazioni">Collega un negozio</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {enabledStores.map((source) => {
            const store = settings.data?.stores?.[source];
            const job = lastJobBySource.get(source);
            const status = job?.status;
            const busy = pendingSource === source || status === 'running' || status === 'queued';

            return (
              <div key={source} className="rounded-lg border border-border bg-muted/25 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {store?.label || SITE_SOURCE_LABELS[source]}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {job?.startedAt
                        ? `Ultima esecuzione ${relativeTimeIt(job.finishedAt ?? job.startedAt)}`
                        : 'Mai sincronizzato'}
                    </p>
                  </div>
                  {status ? (
                    <Badge variant={STATUS_VARIANTS[status]}>
                      {busy ? (
                        <RefreshCw className="animate-spin" aria-hidden="true" />
                      ) : null}
                      {STATUS_LABELS[status]}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Da avviare</Badge>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-card px-2.5 py-2">
                    <dt className="text-muted-foreground">Contatti</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {formatNumber(importedCount(job, 'customers'))}
                    </dd>
                  </div>
                  <div className="rounded-md bg-card px-2.5 py-2">
                    <dt className="text-muted-foreground">Ordini</dt>
                    <dd className="font-semibold tabular-nums text-foreground">
                      {formatNumber(importedCount(job, 'orders'))}
                    </dd>
                  </div>
                </dl>

                {job?.error || store?.lastSyncError ? (
                  <p className="mt-2 flex items-start gap-1 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    <span className="line-clamp-2">{job?.error || store?.lastSyncError}</span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </DashboardPanel>
  );
}
