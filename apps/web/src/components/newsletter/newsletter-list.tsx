'use client';

import {
  ALPHAINK_PALETTE,
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_COLORS,
} from '@alphaink/shared';
import type { Newsletter, NewsletterCategory, NewsletterStatus } from '@alphaink/shared';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  CalendarX2,
  Copy,
  Eye,
  Filter,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
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
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth-context';
import { cn, formatCurrency, formatDateTimeIt, formatNumber, formatPercent } from '@/lib/utils';

import {
  ALL_STATUSES,
  CANCELLABLE_STATUSES,
  CATEGORY_OPTIONS,
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  ROUTES,
  SCHEDULABLE_STATUSES,
  STATUS_OPTIONS,
} from './constants';
import { NewNewsletterDialog } from './new-newsletter-dialog';
import { PreviewDialog } from './newsletter-preview';
import { ScheduleDialog } from './schedule-dialog';
import { StatusBadge } from './status-badge';
import { useNewsletterActions } from './use-newsletter-actions';
import { useNewsletters } from './use-newsletter-data';

/** Miniatura della newsletter: immagine generata oppure segnaposto colorato. */
function Thumbnail({ newsletter }: { newsletter: Newsletter }) {
  const tint = newsletter.color || NEWSLETTER_STATUS_COLORS[newsletter.status] || ALPHAINK_PALETTE.cyan;

  if (newsletter.thumbnailUrl) {
    return (
      <img
        src={newsletter.thumbnailUrl}
        alt=""
        className="size-10 shrink-0 rounded-md border border-border object-cover object-top"
        loading="lazy"
      />
    );
  }

  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border"
      style={{ backgroundColor: `${tint}1A` }}
      aria-hidden="true"
    >
      <Mail className="size-4" style={{ color: tint }} />
    </span>
  );
}

/** Data più significativa in base allo stato. */
function scheduleTimestamp(newsletter: Newsletter): number {
  const raw = newsletter.sentAt ?? newsletter.schedule?.sendAt ?? null;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function audienceSize(newsletter: Newsletter): number {
  return newsletter.stats.recipients || newsletter.audience?.estimatedRecipients || 0;
}

/**
 * Elenco delle newsletter: tabella con ricerca, filtri, ordinamento e azioni
 * per riga. I dati arrivano in tempo reale dalla collezione Firestore.
 */
export function NewsletterList() {
  const { can } = useAuth();
  const canWrite = can('newsletter:write');
  const canSchedule = can('newsletter:schedule');

  const { data, loading, error } = useNewsletters();
  const actions = useNewsletterActions();

  const [statuses, setStatuses] = React.useState<NewsletterStatus[]>([]);
  const [categories, setCategories] = React.useState<NewsletterCategory[]>([]);
  const [tags, setTags] = React.useState<string[]>([]);
  const [showArchived, setShowArchived] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [previewTarget, setPreviewTarget] = React.useState<Newsletter | null>(null);
  const [scheduleTarget, setScheduleTarget] = React.useState<Newsletter | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Newsletter | null>(null);

  const tagOptions: ComboboxOption[] = React.useMemo(() => {
    const counters = new Map<string, number>();
    for (const newsletter of data) {
      for (const tag of newsletter.tags ?? []) {
        counters.set(tag, (counters.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counters.entries())
      .sort((left, right) => left[0].localeCompare(right[0], 'it'))
      .map(([tag, count]) => ({
        value: tag,
        label: tag,
        description: `${count} newsletter`,
      }));
  }, [data]);

  const filtersActive =
    statuses.length > 0 || categories.length > 0 || tags.length > 0 || showArchived;

  const rows = React.useMemo(
    () =>
      data.filter((newsletter) => {
        if (Boolean(newsletter.archived) !== showArchived) return false;
        if (statuses.length > 0 && !statuses.includes(newsletter.status)) return false;
        if (categories.length > 0) {
          if (!newsletter.category || !categories.includes(newsletter.category)) return false;
        }
        if (tags.length > 0) {
          const own = newsletter.tags ?? [];
          if (!tags.some((tag) => own.includes(tag))) return false;
        }
        return true;
      }),
    [data, showArchived, statuses, categories, tags],
  );

  const resetFilters = () => {
    setStatuses([]);
    setCategories([]);
    setTags([]);
    setShowArchived(false);
  };

  const columns: DataTableColumn<Newsletter>[] = [
    {
      id: 'name',
      header: 'Nome',
      width: '30%',
      sortValue: (row) => row.name.toLowerCase(),
      searchValue: (row) => `${row.name} ${row.subject} ${(row.tags ?? []).join(' ')}`,
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Thumbnail newsletter={row} />
          <div className="min-w-0">
            <Link
              href={ROUTES.detail(row.id)}
              className="block truncate font-medium text-foreground hover:underline"
            >
              {row.name}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">{row.subject}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              {row.category ? (
                <Badge variant="outline">{NEWSLETTER_CATEGORY_LABELS[row.category]}</Badge>
              ) : null}
              {(row.tags ?? []).slice(0, 2).map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
              {(row.tags ?? []).length > 2 ? (
                <span className="text-[11px] text-muted-foreground">
                  +{(row.tags ?? []).length - 2}
                </span>
              ) : null}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Stato',
      sortValue: (row) => ALL_STATUSES.indexOf(row.status),
      cell: (row) => (
        <div className="space-y-1">
          <StatusBadge status={row.status} />
          {row.status === 'failed' && row.failureReason ? (
            <p className="max-w-[14rem] truncate text-[11px] text-destructive" title={row.failureReason}>
              {row.failureReason}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'audience',
      header: 'Pubblico',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => audienceSize(row),
      cell: (row) => {
        const size = audienceSize(row);
        return (
          <div className="tabular-nums">
            <span className="font-medium text-foreground">{formatNumber(size)}</span>
            <span className="block text-[11px] text-muted-foreground">
              {row.stats.recipients > 0 ? 'destinatari' : 'stimati'}
            </span>
          </div>
        );
      },
    },
    {
      id: 'date',
      header: 'Programmata / Inviata',
      hideOnMobile: true,
      sortValue: (row) => scheduleTimestamp(row),
      cell: (row) => {
        if (row.sentAt) {
          return (
            <div>
              <span className="text-foreground">{formatDateTimeIt(row.sentAt)}</span>
              <span className="block text-[11px] text-muted-foreground">inviata</span>
            </div>
          );
        }
        if (row.schedule?.sendAt) {
          return (
            <div>
              <span className="text-foreground">{formatDateTimeIt(row.schedule.sendAt)}</span>
              <span className="block text-[11px] text-muted-foreground">
                {row.schedule.throttle
                  ? `a scaglioni di ${formatNumber(row.schedule.throttle.batchSize)}`
                  : 'programmata'}
              </span>
            </div>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: 'opens',
      header: 'Aperture',
      align: 'right',
      sortValue: (row) => row.stats.openRate,
      cell: (row) =>
        row.stats.delivered > 0 ? (
          <div className="tabular-nums">
            <span className="font-medium text-foreground">{formatPercent(row.stats.openRate)}</span>
            <span className="block text-[11px] text-muted-foreground">
              {formatNumber(row.stats.uniqueOpened)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'clicks',
      header: 'Click',
      align: 'right',
      sortValue: (row) => row.stats.clickRate,
      cell: (row) =>
        row.stats.delivered > 0 ? (
          <div className="tabular-nums">
            <span className="font-medium text-foreground">{formatPercent(row.stats.clickRate)}</span>
            <span className="block text-[11px] text-muted-foreground">
              {formatNumber(row.stats.uniqueClicked)}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'orders',
      header: 'Ordini',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.stats.orders,
      cell: (row) =>
        row.stats.orders > 0 ? (
          <span className="font-medium tabular-nums text-foreground">
            {formatNumber(row.stats.orders)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'revenue',
      header: 'Fatturato',
      align: 'right',
      hideOnMobile: true,
      sortValue: (row) => row.stats.revenue,
      cell: (row) =>
        row.stats.revenue > 0 ? (
          <span className="font-medium tabular-nums text-success">
            {formatCurrency(row.stats.revenue, row.stats.currency || 'EUR')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Azioni</span>,
      align: 'right',
      width: '3.5rem',
      cell: (row) => {
        const busy = actions.pendingId === row.id;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Azioni per ${row.name}`}
                disabled={busy}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {canWrite && EDITABLE_STATUSES.includes(row.status) ? (
                <DropdownMenuItem onSelect={() => actions.openEditor(row.id)}>
                  <Pencil aria-hidden="true" />
                  Modifica
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setPreviewTarget(row)}>
                <Eye aria-hidden="true" />
                Anteprima
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.openDetail(row.id)}>
                <Mail aria-hidden="true" />
                Apri la scheda
              </DropdownMenuItem>

              {canWrite ? (
                <DropdownMenuItem onSelect={() => void actions.duplicate(row)}>
                  <Copy aria-hidden="true" />
                  Duplica
                </DropdownMenuItem>
              ) : null}

              {canSchedule && SCHEDULABLE_STATUSES.includes(row.status) ? (
                <DropdownMenuItem onSelect={() => setScheduleTarget(row)}>
                  <CalendarClock aria-hidden="true" />
                  {row.schedule?.sendAt ? 'Ripianifica' : 'Pianifica'}
                </DropdownMenuItem>
              ) : null}

              {canSchedule && CANCELLABLE_STATUSES.includes(row.status) ? (
                <DropdownMenuItem onSelect={() => void actions.cancelSchedule(row)}>
                  <CalendarX2 aria-hidden="true" />
                  Annulla la programmazione
                </DropdownMenuItem>
              ) : null}

              {canWrite ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void actions.setArchived(row, !row.archived)}>
                    {row.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    {row.archived ? 'Ripristina' : 'Archivia'}
                  </DropdownMenuItem>
                  {DELETABLE_STATUSES.includes(row.status) ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                      <Trash2 aria-hidden="true" />
                      Elimina
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Newsletter"
        description="Bozze, campagne pianificate e invii conclusi, con i risultati di ciascuna spedizione."
        actions={
          canWrite ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Nuova newsletter
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      <DataTable<Newsletter>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        loading={loading}
        searchable
        searchPlaceholder="Cerca per nome, oggetto o etichetta…"
        defaultSort={{ columnId: 'date', direction: 'desc' }}
        pageSize={25}
        emptyIcon={<Mail />}
        emptyTitle={
          filtersActive
            ? 'Nessuna newsletter con questi filtri'
            : showArchived
              ? 'Nessuna newsletter archiviata'
              : 'Non hai ancora creato newsletter'
        }
        emptyDescription={
          filtersActive
            ? 'Prova ad allargare la selezione: puoi togliere gli stati, le categorie o le etichette scelte.'
            : 'Parti da un template pronto oppure componi l’email da zero con l’editor a blocchi. Il pubblico si sceglie fra i cluster della rubrica.'
        }
        emptyAction={
          filtersActive ? (
            <Button variant="outline" onClick={resetFilters}>
              <Filter aria-hidden="true" />
              Azzera i filtri
            </Button>
          ) : canWrite ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Crea la prima newsletter
            </Button>
          ) : null
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              multiple
              options={STATUS_OPTIONS}
              value={statuses}
              onChange={(next) => setStatuses(next as NewsletterStatus[])}
              placeholder="Stato"
              searchPlaceholder="Cerca uno stato…"
              emptyMessage="Nessuno stato."
              className="h-9 w-[9.5rem]"
              contentClassName="min-w-[14rem]"
            />
            <Combobox
              multiple
              options={CATEGORY_OPTIONS}
              value={categories}
              onChange={(next) => setCategories(next as NewsletterCategory[])}
              placeholder="Categoria"
              searchPlaceholder="Cerca una categoria…"
              emptyMessage="Nessuna categoria."
              className="h-9 w-[10.5rem]"
              contentClassName="min-w-[14rem]"
            />
            <Combobox
              multiple
              options={tagOptions}
              value={tags}
              onChange={(next) => setTags(next as string[])}
              placeholder="Etichette"
              searchPlaceholder="Cerca un’etichetta…"
              emptyMessage="Nessuna etichetta in uso."
              disabled={tagOptions.length === 0}
              className="h-9 w-[10rem]"
              contentClassName="min-w-[14rem]"
            />
            <label
              className={cn(
                'flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm',
                showArchived && 'border-primary/40 bg-primary/5',
              )}
            >
              <Switch
                checked={showArchived}
                onCheckedChange={setShowArchived}
                aria-label="Mostra le newsletter archiviate"
              />
              <span className="whitespace-nowrap text-muted-foreground">Archiviate</span>
            </label>
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Azzera
              </Button>
            ) : null}
          </div>
        }
      />

      <NewNewsletterDialog open={createOpen} onOpenChange={setCreateOpen} />

      <PreviewDialog
        open={previewTarget !== null}
        onOpenChange={(next) => (next ? undefined : setPreviewTarget(null))}
        newsletterId={previewTarget?.id ?? null}
        newsletterName={previewTarget?.name}
      />

      <ScheduleDialog
        open={scheduleTarget !== null}
        onOpenChange={(next) => (next ? undefined : setScheduleTarget(null))}
        newsletter={scheduleTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => (next ? undefined : setDeleteTarget(null))}
        title="Eliminare definitivamente la newsletter?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” e tutti i dati collegati verranno rimossi. L’operazione non è reversibile: se vuoi conservarne lo storico, archiviala invece di eliminarla.`
            : undefined
        }
        confirmLabel="Elimina"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          const done = await actions.remove(deleteTarget);
          if (done) setDeleteTarget(null);
          else throw new Error('Eliminazione non riuscita.');
        }}
      />
    </div>
  );
}
