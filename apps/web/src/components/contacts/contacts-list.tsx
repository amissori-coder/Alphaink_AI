'use client';

import { displayNameFor } from '@alphaink/shared';
import type { Cluster, Contact } from '@alphaink/shared';
import {
  AlertTriangle,
  ChevronDown,
  FileDown,
  Layers,
  MailX,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useAuth } from '@/lib/auth-context';
import { cn, formatCurrency, formatDateIt, formatNumber } from '@/lib/utils';

import { AddToClusterDialog } from './add-to-cluster-dialog';
import { ContactFiltersBar, countActiveFilters } from './contact-filters';
import { ContactFormDialog } from './contact-form-dialog';
import {
  CONTACTS_MAX_LIMIT,
  CONTACTS_PAGE_SIZE,
  CONTACTS_PAGE_STEP,
  ROUTES,
  TABLE_PAGE_SIZE,
} from './constants';
import { EngagementMeter } from './engagement-meter';
import { ExportDialog } from './export-dialog';
import { ImportDialog } from './import-dialog';
import { SegmentBadge, SourceBadge, SubscriptionStatusBadge } from './status-badge';
import { SyncDialog } from './sync-dialog';
import { EMPTY_FILTERS, type ContactFilters } from './types';
import { useContactActions } from './use-contact-actions';
import { useContactClusters, useContactEmailSearch, useContacts } from './use-contacts-data';

/** Tutti i cluster a cui il contatto appartiene, manuali e calcolati. */
function clusterIdsOf(contact: Contact): string[] {
  return [...(contact.clusterIds ?? []), ...(contact.dynamicClusterIds ?? [])];
}

/** Testo su cui lavora la ricerca rapida lato client. */
function searchableText(contact: Contact): string {
  return [contact.email, contact.firstName, contact.lastName, contact.company, contact.vatNumber]
    .filter(Boolean)
    .join(' ');
}

/** Applica tutti i criteri della barra dei filtri a un singolo contatto. */
function matches(contact: Contact, filters: ContactFilters): boolean {
  if (filters.status.length > 0 && !filters.status.includes(contact.status)) return false;
  if (filters.segment.length > 0 && !filters.segment.includes(contact.segment)) return false;
  if (filters.source.length > 0 && !filters.source.includes(contact.source)) return false;
  if (filters.tiers.length > 0 && !filters.tiers.includes(contact.engagement.engagementTier)) {
    return false;
  }
  if (filters.clusterIds.length > 0) {
    const own = new Set(clusterIdsOf(contact));
    if (!filters.clusterIds.some((id) => own.has(id))) return false;
  }
  if (filters.onlyBuyers && (contact.stats.ordersCount ?? 0) <= 0) return false;

  const spent = contact.stats.totalSpent ?? 0;
  if (filters.minSpent !== null && spent < filters.minSpent) return false;
  if (filters.maxSpent !== null && spent > filters.maxSpent) return false;

  if (filters.families.length > 0) {
    const byFamily = contact.stats.ordersByFamily ?? {};
    const bought = filters.families.some((family) => (byFamily[family] ?? 0) > 0);
    if (!bought) return false;
  }

  const term = filters.term.trim().toLowerCase();
  if (term && !searchableText(contact).toLowerCase().includes(term)) return false;

  return true;
}

/**
 * Rubrica dei contatti AlphaInk.
 *
 * L'elenco è una sottoscrizione in tempo reale con un tetto: su decine di
 * migliaia di indirizzi tenere tutto in memoria non è sostenibile. Quando il
 * tetto viene raggiunto e si cerca qualcosa, alla lista locale si uniscono i
 * risultati di una ricerca per prefisso lato server, così nessun contatto
 * risulta irraggiungibile.
 */
export function ContactsList() {
  const { can } = useAuth();
  const canWrite = can('contacts:write');
  const canExport = can('contacts:export');
  const canSync = can('sync:run');
  const canWriteClusters = can('clusters:write');

  const [limit, setLimit] = React.useState(CONTACTS_PAGE_SIZE);
  const { data: local, loading, error } = useContacts(limit);
  const { data: clusters } = useContactClusters();
  const actions = useContactActions();

  const [filters, setFilters] = React.useState<ContactFilters>({ ...EMPTY_FILTERS });
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [clusterOpen, setClusterOpen] = React.useState(false);
  const [unsubscribeOpen, setUnsubscribeOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Contact | null>(null);

  // La lista locale è troncata: la ricerca deve poter arrivare oltre il tetto.
  const truncated = local.length >= limit;
  const remoteSearch = useContactEmailSearch(filters.term, truncated && filters.term.length >= 2);

  const contacts = React.useMemo(() => {
    if (!remoteSearch.data || remoteSearch.data.length === 0) return local;
    const byId = new Map(local.map((contact) => [contact.id, contact]));
    for (const contact of remoteSearch.data) {
      if (!byId.has(contact.id)) byId.set(contact.id, contact);
    }
    return Array.from(byId.values());
  }, [local, remoteSearch.data]);

  const counters = React.useMemo(
    () =>
      contacts.reduce(
        (accumulator, contact) => ({
          total: accumulator.total + 1,
          subscribed: accumulator.subscribed + (contact.status === 'subscribed' ? 1 : 0),
          unsubscribed: accumulator.unsubscribed + (contact.status === 'unsubscribed' ? 1 : 0),
          bounced:
            accumulator.bounced +
            (contact.status === 'bounced' || contact.status === 'blocked' ? 1 : 0),
          pending: accumulator.pending + (contact.status === 'pending' ? 1 : 0),
        }),
        { total: 0, subscribed: 0, unsubscribed: 0, bounced: 0, pending: 0 },
      ),
    [contacts],
  );

  const rows = React.useMemo(
    () => contacts.filter((contact) => matches(contact, filters)),
    [contacts, filters],
  );

  const clusterById = React.useMemo(() => {
    const map = new Map<string, Cluster>();
    for (const cluster of clusters) map.set(cluster.id, cluster);
    return map;
  }, [clusters]);

  const selectedContacts = React.useMemo(() => {
    const wanted = new Set(selectedIds);
    return contacts.filter((contact) => wanted.has(contact.id));
  }, [contacts, selectedIds]);

  const filtersActive = countActiveFilters(filters) > 0;

  const columns: DataTableColumn<Contact>[] = [
    {
      id: 'contatto',
      header: 'Contatto',
      width: '24%',
      sortValue: (row) => row.emailNormalized || row.email.toLowerCase(),
      searchValue: (row) => searchableText(row),
      cell: (row) => {
        const name = displayNameFor({
          firstName: row.firstName ?? null,
          lastName: row.lastName ?? null,
          company: row.company ?? null,
          email: row.email,
        });
        return (
          <div className="min-w-0">
            <Link
              href={ROUTES.detail(row.id)}
              className="block truncate font-medium text-foreground hover:underline"
            >
              {name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">{row.email}</span>
          </div>
        );
      },
    },
    {
      id: 'azienda',
      header: 'Azienda',
      hideOnMobile: true,
      sortValue: (row) => (row.company ?? '').toLowerCase(),
      cell: (row) =>
        row.company ? (
          <span className="block max-w-[12rem] truncate text-foreground">{row.company}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'segmento',
      header: 'Segmento',
      sortValue: (row) => row.segment,
      cell: (row) => <SegmentBadge segment={row.segment} />,
    },
    {
      id: 'stato',
      header: 'Stato',
      sortValue: (row) => row.status,
      cell: (row) => <SubscriptionStatusBadge status={row.status} />,
    },
    {
      id: 'sorgente',
      header: 'Sorgente',
      hideOnMobile: true,
      sortValue: (row) => row.source,
      cell: (row) => <SourceBadge source={row.source} />,
    },
    {
      id: 'ordini',
      header: 'Ordini',
      align: 'right',
      sortValue: (row) => row.stats.ordersCount ?? 0,
      cell: (row) =>
        (row.stats.ordersCount ?? 0) > 0 ? (
          <span className="font-medium tabular-nums text-foreground">
            {formatNumber(row.stats.ordersCount)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'spesa',
      header: 'Spesa totale',
      align: 'right',
      sortValue: (row) => row.stats.totalSpent ?? 0,
      cell: (row) =>
        (row.stats.totalSpent ?? 0) > 0 ? (
          <span className="font-medium tabular-nums text-success">
            {formatCurrency(row.stats.totalSpent, 'EUR')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'ultimo-ordine',
      header: 'Ultimo ordine',
      hideOnMobile: true,
      sortValue: (row) => (row.stats.lastOrderAt ? Date.parse(row.stats.lastOrderAt) : 0),
      cell: (row) =>
        row.stats.lastOrderAt ? (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDateIt(row.stats.lastOrderAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'engagement',
      header: 'Engagement',
      hideOnMobile: true,
      sortValue: (row) => row.engagement.engagementScore ?? 0,
      cell: (row) => <EngagementMeter engagement={row.engagement} />,
    },
    {
      id: 'cluster',
      header: 'Cluster',
      hideOnMobile: true,
      sortValue: (row) => clusterIdsOf(row).length,
      cell: (row) => {
        const own = clusterIdsOf(row)
          .map((id) => clusterById.get(id))
          .filter((cluster): cluster is Cluster => Boolean(cluster));
        if (own.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="flex max-w-[14rem] flex-wrap gap-1">
            {own.slice(0, 2).map((cluster) => (
              <Link key={cluster.id} href={ROUTES.clusterDetail(cluster.id)}>
                <Badge
                  variant="outline"
                  className="max-w-[7rem] hover:bg-muted"
                  style={{ borderColor: `${cluster.color}66` }}
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cluster.color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{cluster.name}</span>
                </Badge>
              </Link>
            ))}
            {own.length > 2 ? (
              <span className="text-[11px] text-muted-foreground">+{own.length - 2}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'azioni',
      header: <span className="sr-only">Azioni</span>,
      align: 'right',
      width: '3.5rem',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Azioni per ${row.email}`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link href={ROUTES.detail(row.id)}>
                <UserRound aria-hidden="true" />
                Apri la scheda
              </Link>
            </DropdownMenuItem>
            {canWrite ? (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    setEditing(row);
                    setFormOpen(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                  Modifica
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {row.status === 'subscribed' ? (
                  <DropdownMenuItem onSelect={() => void actions.unsubscribe(row)}>
                    <MailX aria-hidden="true" />
                    Disiscrivi
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                  <Trash2 aria-hidden="true" />
                  Elimina
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contatti"
        description="Rubrica unica dei clienti B2C e B2B: stato di iscrizione, storico d’acquisto e reattività alle email."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canSync ? (
              <Button variant="outline" onClick={() => setSyncOpen(true)}>
                <RefreshCw
                  className={cn(actions.pending === 'sync' && 'animate-spin')}
                  aria-hidden="true"
                />
                Sincronizza dal sito
              </Button>
            ) : null}
            {canExport ? (
              <Button variant="outline" onClick={() => setExportOpen(true)}>
                <FileDown aria-hidden="true" />
                Esporta
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload aria-hidden="true" />
                  Importa CSV
                </Button>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus aria-hidden="true" />
                  Nuovo contatto
                </Button>
              </>
            ) : null}
          </div>
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
        <StatCard
          label="Contatti in rubrica"
          value={formatNumber(counters.total)}
          hint={truncated ? `primi ${formatNumber(limit)} caricati` : 'tutti caricati'}
          loading={loading}
        />
        <StatCard
          label="Iscritti"
          value={formatNumber(counters.subscribed)}
          hint="raggiungibili con una newsletter"
          loading={loading}
        />
        <StatCard
          label="Disiscritti"
          value={formatNumber(counters.unsubscribed)}
          hint="hanno revocato il consenso"
          loading={loading}
        />
        <StatCard
          label="Bounce e bloccati"
          value={formatNumber(counters.bounced)}
          hint="indirizzi non recapitabili"
          loading={loading}
        />
      </div>

      <ContactFiltersBar
        filters={filters}
        onChange={setFilters}
        clusters={clusters}
        resultCount={rows.length}
        totalCount={counters.total}
        loading={loading}
      />

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium text-foreground">
            {formatNumber(selectedIds.length)}{' '}
            {selectedIds.length === 1 ? 'contatto selezionato' : 'contatti selezionati'}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canWriteClusters ? (
              <Button variant="outline" size="sm" onClick={() => setClusterOpen(true)}>
                <Layers aria-hidden="true" />
                Aggiungi a un cluster
              </Button>
            ) : null}
            {canExport ? (
              <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                <FileDown aria-hidden="true" />
                Esporta selezione
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setUnsubscribeOpen(true)}
              >
                <MailX aria-hidden="true" />
                Disiscrivi
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              <X aria-hidden="true" />
              Deseleziona
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable<Contact>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={loading}
        selectable={canWrite || canExport || canWriteClusters}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        pageSize={TABLE_PAGE_SIZE}
        defaultSort={{ columnId: 'contatto', direction: 'asc' }}
        emptyIcon={<Users />}
        emptyTitle={
          filtersActive ? 'Nessun contatto con questi filtri' : 'La rubrica è ancora vuota'
        }
        emptyDescription={
          filtersActive
            ? 'Prova ad allargare la selezione: togli qualche stato, segmento o cluster dai filtri.'
            : 'I contatti arrivano dalla sincronizzazione con i due negozi PrestaShop, da un file CSV oppure inseriti a mano.'
        }
        emptyAction={
          filtersActive ? (
            <Button variant="outline" onClick={() => setFilters({ ...EMPTY_FILTERS })}>
              <X aria-hidden="true" />
              Azzera i filtri
            </Button>
          ) : canSync ? (
            <Button onClick={() => setSyncOpen(true)}>
              <RefreshCw aria-hidden="true" />
              Sincronizza dal sito
            </Button>
          ) : null
        }
      />

      {truncated && limit < CONTACTS_MAX_LIMIT ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-4 text-center">
          <p className="text-sm text-muted-foreground">
            Sono caricati i primi {formatNumber(limit)} contatti in ordine alfabetico di email. La
            ricerca per indirizzo interroga comunque l’intera rubrica.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((current) => Math.min(current + CONTACTS_PAGE_STEP, CONTACTS_MAX_LIMIT))}
          >
            <ChevronDown aria-hidden="true" />
            Carica altri {formatNumber(CONTACTS_PAGE_STEP)}
          </Button>
        </div>
      ) : null}

      {/* ------------------------------ Dialoghi ------------------------------ */}

      <ContactFormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setEditing(null);
        }}
        contact={editing}
        clusters={clusters}
        busy={actions.pending === 'save'}
        onSubmit={actions.save}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} clusters={clusters} />

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        clusters={clusters}
        busy={actions.pending === 'export'}
        selectedCount={selectedIds.length}
        initial={{
          clusterId: filters.clusterIds[0] ?? null,
          status: filters.status.length > 0 ? filters.status : undefined,
          segment: filters.segment.length === 1 ? filters.segment[0] : null,
          source: filters.source.length === 1 ? filters.source[0] : null,
        }}
        onConfirm={actions.exportCsv}
      />

      <SyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        busy={actions.pending === 'sync'}
        onConfirm={actions.sync}
      />

      <AddToClusterDialog
        open={clusterOpen}
        onOpenChange={setClusterOpen}
        contactIds={selectedIds}
        clusters={clusters}
        busy={actions.pending?.startsWith('cluster:') ?? false}
        onConfirm={async (cluster) => {
          const done = await actions.addToCluster(cluster, selectedIds);
          if (done) setSelectedIds([]);
          return done;
        }}
      />

      <ConfirmDialog
        open={unsubscribeOpen}
        onOpenChange={setUnsubscribeOpen}
        title={
          selectedIds.length === 1
            ? 'Disiscrivere il contatto?'
            : `Disiscrivere ${formatNumber(selectedIds.length)} contatti?`
        }
        description="I contatti smetteranno di ricevere newsletter e automazioni e verranno aggiunti alla blocklist Brevo. Per rimetterli in lista servirà un nuovo consenso documentato."
        confirmLabel="Disiscrivi"
        destructive
        loading={actions.pending === 'unsubscribe-many'}
        onConfirm={async () => {
          const done = await actions.unsubscribeMany(selectedContacts);
          if (done === 0) throw new Error('Nessun contatto disiscritto.');
          setSelectedIds([]);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(null))}
        title="Eliminare definitivamente il contatto?"
        description={
          deleteTarget
            ? `${deleteTarget.email} verrà rimosso dalla rubrica insieme alla sua cronologia di invii. Gli ordini restano registrati. Se vuoi solo smettere di scrivergli, usa “Disiscrivi”.`
            : undefined
        }
        confirmLabel="Elimina"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          const done = await actions.remove(deleteTarget, true);
          if (done) setDeleteTarget(null);
          else throw new Error('Eliminazione non riuscita.');
        }}
      />
    </div>
  );
}
