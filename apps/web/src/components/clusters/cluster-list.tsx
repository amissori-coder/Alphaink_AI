'use client';

import { CLUSTER_TYPE_LABELS } from '@alphaink/shared';
import type { Cluster, ClusterType } from '@alphaink/shared';
import { AlertTriangle, Filter, Layers, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth-context';
import { cn, formatNumber } from '@/lib/utils';

import { CLUSTER_TYPE_OPTIONS, ROUTES } from './constants';
import { ClusterCard } from './cluster-card';
import { SuggestedClusters } from './suggested-clusters';
import type { SuggestedCluster } from './types';
import { useClusterActions } from './use-cluster-actions';
import { useClusters } from './use-clusters-data';

type SortKey = 'name' | 'size' | 'sendable' | 'recent';

const SORT_OPTIONS: ComboboxOption[] = [
  { value: 'name', label: 'Nome (A-Z)' },
  { value: 'size', label: 'Più contatti' },
  { value: 'sendable', label: 'Più contattabili' },
  { value: 'recent', label: 'Ricalcolati di recente' },
];

/** Timestamp dell'ultimo ricalcolo, 0 se mai eseguito. */
function computedAt(cluster: Cluster): number {
  const parsed = cluster.lastComputedAt ? Date.parse(cluster.lastComputedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Elenco dei cluster a schede, con filtri, ordinamento e segmenti consigliati.
 * I dati arrivano in tempo reale dalla collezione Firestore: i conteggi si
 * aggiornano da soli mentre il job di ricalcolo lavora.
 */
export function ClusterList() {
  const { can } = useAuth();
  const canWrite = can('clusters:write');

  const { data, loading, error } = useClusters();
  const actions = useClusterActions();

  const [term, setTerm] = React.useState('');
  const [types, setTypes] = React.useState<ClusterType[]>([]);
  const [onlyBrevo, setOnlyBrevo] = React.useState(false);
  const [sort, setSort] = React.useState<SortKey>('name');
  const [deleteTarget, setDeleteTarget] = React.useState<Cluster | null>(null);
  const [forceDelete, setForceDelete] = React.useState(false);
  const [pendingSuggestion, setPendingSuggestion] = React.useState<string | null>(null);

  const visible = React.useMemo(() => data.filter((cluster) => !cluster.archived), [data]);

  const totals = React.useMemo(
    () =>
      visible.reduce(
        (accumulator, cluster) => ({
          clusters: accumulator.clusters + 1,
          contacts: accumulator.contacts + (cluster.contactCount || 0),
          sendable: accumulator.sendable + (cluster.sendableCount || 0),
          brevo: accumulator.brevo + (cluster.syncToBrevo ? 1 : 0),
        }),
        { clusters: 0, contacts: 0, sendable: 0, brevo: 0 },
      ),
    [visible],
  );

  const filtersActive = term.trim().length > 0 || types.length > 0 || onlyBrevo;

  const rows = React.useMemo(() => {
    const needle = term.trim().toLowerCase();
    const filtered = visible.filter((cluster) => {
      if (types.length > 0 && !types.includes(cluster.type)) return false;
      if (onlyBrevo && !cluster.syncToBrevo) return false;
      if (needle) {
        const haystack = `${cluster.name} ${cluster.description ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case 'size':
        sorted.sort((left, right) => right.contactCount - left.contactCount);
        break;
      case 'sendable':
        sorted.sort((left, right) => right.sendableCount - left.sendableCount);
        break;
      case 'recent':
        sorted.sort((left, right) => computedAt(right) - computedAt(left));
        break;
      default:
        sorted.sort((left, right) => left.name.localeCompare(right.name, 'it'));
        break;
    }
    return sorted;
  }, [visible, term, types, onlyBrevo, sort]);

  const resetFilters = () => {
    setTerm('');
    setTypes([]);
    setOnlyBrevo(false);
  };

  const createSuggested = async (suggestion: SuggestedCluster) => {
    setPendingSuggestion(suggestion.key);
    try {
      await actions.save({
        name: suggestion.name,
        description: suggestion.description,
        type: 'dynamic',
        color: suggestion.color,
        rules: suggestion.rules,
        contactIds: [],
        siteGroupName: null,
        brevoListId: null,
        autoRefresh: true,
        syncToBrevo: false,
        recompute: true,
      });
    } finally {
      setPendingSuggestion(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cluster"
        description="Segmenti dinamici e statici della rubrica AlphaInk, usati come pubblico delle newsletter e delle automazioni."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href={ROUTES.create}>
                <Plus aria-hidden="true" />
                Nuovo cluster
              </Link>
            </Button>
          ) : null
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Errore di caricamento</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cluster attivi" value={formatNumber(totals.clusters)} loading={loading} />
        <StatCard
          label="Contatti segmentati"
          value={formatNumber(totals.contacts)}
          hint="somma dei cluster, con sovrapposizioni"
          loading={loading}
        />
        <StatCard
          label="Contattabili"
          value={formatNumber(totals.sendable)}
          hint="iscritti raggiungibili via email"
          loading={loading}
        />
        <StatCard
          label="Sincronizzati su Brevo"
          value={formatNumber(totals.brevo)}
          hint="rispecchiati come lista"
          loading={loading}
        />
      </div>

      <SuggestedClusters
        existing={visible}
        canWrite={canWrite}
        pendingKey={pendingSuggestion}
        onCreate={(suggestion) => void createSuggested(suggestion)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Cerca per nome o descrizione…"
          startIcon={<Search aria-hidden="true" />}
          aria-label="Cerca fra i cluster"
          className="w-full sm:w-72"
        />
        <Combobox
          multiple
          options={CLUSTER_TYPE_OPTIONS}
          value={types}
          onChange={(next) => setTypes(next as ClusterType[])}
          placeholder="Tipo"
          searchPlaceholder="Cerca un tipo…"
          emptyMessage="Nessun tipo."
          className="h-9 w-[11rem]"
          contentClassName="min-w-[16rem]"
        />
        <Combobox
          options={SORT_OPTIONS}
          value={sort}
          onChange={(next) => setSort(next as SortKey)}
          clearable={false}
          placeholder="Ordina"
          searchPlaceholder="Cerca…"
          emptyMessage="Nessun criterio."
          className="h-9 w-[13rem]"
          contentClassName="min-w-[14rem]"
        />
        <label
          className={cn(
            'flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm',
            onlyBrevo && 'border-primary/40 bg-primary/5',
          )}
        >
          <Switch
            checked={onlyBrevo}
            onCheckedChange={setOnlyBrevo}
            aria-label="Mostra solo i cluster sincronizzati su Brevo"
          />
          <span className="whitespace-nowrap text-muted-foreground">Solo su Brevo</span>
        </label>
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Azzera
          </Button>
        ) : null}
        <span className="ml-auto text-sm text-muted-foreground">
          {loading ? '—' : `${formatNumber(rows.length)} di ${formatNumber(visible.length)}`}
        </span>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={
            filtersActive ? 'Nessun cluster con questi filtri' : 'Non hai ancora creato cluster'
          }
          description={
            filtersActive
              ? 'Prova ad allargare la selezione: togli i tipi scelti oppure svuota la ricerca.'
              : 'Un cluster raccoglie i contatti che soddisfano certe regole — per esempio chi ha comprato toner negli ultimi due mesi. Serve a scegliere il pubblico di una newsletter senza rifare i filtri ogni volta.'
          }
          action={
            filtersActive ? (
              <Button variant="outline" onClick={resetFilters}>
                <Filter aria-hidden="true" />
                Azzera i filtri
              </Button>
            ) : canWrite ? (
              <Button asChild>
                <Link href={ROUTES.create}>
                  <Plus aria-hidden="true" />
                  Crea il primo cluster
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((cluster) => (
            <li key={cluster.id} className="min-w-0">
              <ClusterCard
                cluster={cluster}
                canWrite={canWrite}
                busy={actions.pendingId === cluster.id}
                onDuplicate={() => void actions.duplicate(cluster)}
                onRecompute={() => void actions.recompute(cluster)}
                onDelete={() => {
                  setForceDelete(false);
                  setDeleteTarget(cluster);
                }}
                onToggleBrevoSync={(next) => void actions.toggleBrevoSync(cluster, next)}
                onUseInNewsletter={() => actions.useInNewsletter(cluster.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(null))}
        title="Eliminare il cluster?"
        description={
          deleteTarget ? (
            <span className="space-y-2">
              <span className="block">
                {`“${deleteTarget.name}” (${CLUSTER_TYPE_LABELS[deleteTarget.type]}) verrà rimosso e i ${formatNumber(
                  deleteTarget.contactCount,
                )} contatti non vi apparterranno più. I contatti non vengono eliminati.`}
              </span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={forceDelete}
                  onChange={(event) => setForceDelete(event.target.checked)}
                  className="size-4 rounded border-input"
                />
                Elimina anche se è usato da newsletter o automazioni
              </label>
            </span>
          ) : undefined
        }
        confirmLabel="Elimina"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          const done = await actions.remove(deleteTarget, forceDelete);
          if (done) setDeleteTarget(null);
          else throw new Error('Eliminazione non riuscita.');
        }}
      />
    </div>
  );
}
