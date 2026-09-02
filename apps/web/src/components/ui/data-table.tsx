'use client';

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn, formatNumber } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface DataTableColumn<T> {
  /** Identificatore univoco della colonna. */
  id: string;
  /** Intestazione mostrata in tabella. */
  header: React.ReactNode;
  /** Contenuto della cella. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Valore usato per l'ordinamento; abilita il click sull'intestazione. */
  sortValue?: (row: T) => string | number | boolean | null | undefined;
  /** Testo usato dalla ricerca rapida. */
  searchValue?: (row: T) => string;
  /** Allineamento del contenuto. */
  align?: 'left' | 'center' | 'right';
  /** Classi aggiuntive per header e celle. */
  className?: string;
  headerClassName?: string;
  /** Nasconde la colonna sotto il breakpoint md. */
  hideOnMobile?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  /** Chiave univoca di riga. */
  getRowId: (row: T, index: number) => string;
  loading?: boolean;
  /** Titolo dello stato vuoto. */
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  /** Abilita le checkbox di selezione. */
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Righe per pagina; `0` disattiva la paginazione. */
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Mostra il campo di ricerca rapida sulle colonne con `searchValue`. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Ordinamento iniziale. */
  defaultSort?: { columnId: string; direction: SortDirection };
  /** Click su una riga (non scatta sulle checkbox). */
  onRowClick?: (row: T) => void;
  /** Classi aggiuntive per la riga. */
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  /** Barra di strumenti mostrata a destra della ricerca. */
  toolbar?: React.ReactNode;
}

const ALIGN_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * Tabella generica con ordinamento, ricerca, selezione e paginazione lato client.
 * Pensata per elenchi di poche migliaia di righe già presenti in memoria.
 */
function DataTable<T>({
  data,
  columns,
  getRowId,
  loading = false,
  emptyTitle = 'Nessun elemento',
  emptyDescription,
  emptyAction,
  emptyIcon,
  selectable = false,
  selectedIds,
  onSelectionChange,
  pageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  searchable = false,
  searchPlaceholder = 'Cerca…',
  defaultSort,
  onRowClick,
  rowClassName,
  className,
  toolbar,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ columnId: string; direction: SortDirection } | null>(
    defaultSort ?? null,
  );
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [size, setSize] = React.useState(pageSize);
  const [internalSelection, setInternalSelection] = React.useState<string[]>([]);

  const selection = selectedIds ?? internalSelection;
  const setSelection = React.useCallback(
    (ids: string[]) => {
      if (onSelectionChange) onSelectionChange(ids);
      if (!selectedIds) setInternalSelection(ids);
    },
    [onSelectionChange, selectedIds],
  );

  // Ricerca rapida sulle colonne che espongono `searchValue`.
  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query || !searchable) return data;
    const searchable_columns = columns.filter((column) => column.searchValue);
    if (searchable_columns.length === 0) return data;
    return data.filter((row) =>
      searchable_columns.some((column) => column.searchValue!(row).toLowerCase().includes(query)),
    );
  }, [data, search, searchable, columns]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((item) => item.id === sort.columnId);
    if (!column?.sortValue) return filtered;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      const a = column.sortValue!(left);
      const b = column.sortValue!(right);
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * factor;
      return String(a).localeCompare(String(b), 'it', { numeric: true, sensitivity: 'base' }) * factor;
    });
  }, [filtered, sort, columns]);

  const paginated = React.useMemo(() => {
    if (!size) return sorted;
    const start = page * size;
    return sorted.slice(start, start + size);
  }, [sorted, page, size]);

  const pageCount = size ? Math.max(1, Math.ceil(sorted.length / size)) : 1;

  // Se il filtro riduce le righe, riporta la pagina in un intervallo valido.
  React.useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  const visibleIds = paginated.map((row, index) => getRowId(row, index));
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selection.includes(id));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelection(selection.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelection(Array.from(new Set([...selection, ...visibleIds])));
    }
  };

  const toggleRow = (id: string) => {
    setSelection(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
  };

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!column.sortValue) return;
    setSort((current) => {
      if (current?.columnId !== column.id) return { columnId: column.id, direction: 'asc' };
      if (current.direction === 'asc') return { columnId: column.id, direction: 'desc' };
      return null;
    });
  };

  const showToolbar = searchable || Boolean(toolbar);

  return (
    <div className={cn('space-y-3', className)}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {searchable ? (
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              startIcon={<Search />}
              className="h-9 w-full max-w-xs"
            />
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card shadow-card">
        {loading ? (
          <div className="p-4">
            <SkeletonTable rows={Math.min(size || 5, 6)} columns={columns.length || 4} />
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            className="border-0 bg-transparent"
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {selectable ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false
                      }
                      onCheckedChange={toggleAllVisible}
                      aria-label="Seleziona tutte le righe visibili"
                    />
                  </TableHead>
                ) : null}
                {columns.map((column) => {
                  const active = sort?.columnId === column.id;
                  const SortIcon = !active
                    ? ChevronsUpDown
                    : sort!.direction === 'asc'
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <TableHead
                      key={column.id}
                      style={column.width ? { width: column.width } : undefined}
                      className={cn(
                        ALIGN_CLASSES[column.align ?? 'left'],
                        column.hideOnMobile && 'hidden md:table-cell',
                        column.headerClassName,
                      )}
                      aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active && 'text-foreground',
                          )}
                        >
                          {column.header}
                          <SortIcon className="size-3" aria-hidden="true" />
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody>
              {paginated.map((row, index) => {
                const id = getRowId(row, index);
                const isSelected = selection.includes(id);
                return (
                  <TableRow
                    key={id}
                    data-state={isSelected ? 'selected' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
                  >
                    {selectable ? (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(id)}
                          aria-label="Seleziona riga"
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          ALIGN_CLASSES[column.align ?? 'left'],
                          column.hideOnMobile && 'hidden md:table-cell',
                          column.className,
                        )}
                      >
                        {column.cell(row, index)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!loading && sorted.length > 0 && size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {formatNumber(sorted.length)} {sorted.length === 1 ? 'elemento' : 'elementi'}
              {selectable && selection.length > 0 ? ` · ${formatNumber(selection.length)} selezionati` : ''}
            </span>
            <Select
              value={String(size)}
              onValueChange={(next) => {
                setSize(Number(next));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[5.5rem]" aria-label="Righe per pagina">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option} / pag.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span>
              Pagina {page + 1} di {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0}
              aria-label="Pagina precedente"
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              disabled={page >= pageCount - 1}
              aria-label="Pagina successiva"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
DataTable.displayName = 'DataTable';

export { DataTable };
