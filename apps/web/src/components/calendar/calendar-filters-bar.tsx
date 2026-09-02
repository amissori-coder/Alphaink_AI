'use client';

import type { Cluster, NewsletterCategory, NewsletterStatus } from '@alphaink/shared';
import { ChevronDown, FilterX, Layers, Repeat2, Tag, Users } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn, formatNumber } from '@/lib/utils';

import { CATEGORY_OPTIONS, EMPTY_FILTERS, STATUS_OPTIONS } from './constants';
import type { CalendarFilters } from './types';
import { countActiveFilters, statusColor } from './utils';

export interface CalendarFiltersBarProps {
  filters: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  clusters: Cluster[];
  tagOptions: string[];
  /** Voci totali dell'intervallo e voci visibili dopo i filtri. */
  totalCount: number;
  visibleCount: number;
  className?: string;
}

interface MultiSelectProps {
  label: string;
  icon: React.ReactNode;
  options: Array<{ value: string; label: string; color?: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}

function MultiSelectDropdown({ label, icon, options, selected, onChange }: MultiSelectProps) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {icon}
          {label}
          {selected.length > 0 ? (
            <Badge variant="default" className="px-1.5 py-0 text-[10px] leading-4">
              {selected.length}
            </Badge>
          ) : null}
          <ChevronDown className="opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={() => toggle(option.value)}
            onSelect={(event) => event.preventDefault()}
          >
            <span className="flex items-center gap-2">
              {option.color ? (
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
              ) : null}
              {option.label}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Azzera selezione</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Contenitore con icona ed etichetta accessibile per i campi con ricerca. */
function FilterField({
  id,
  label,
  icon,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center rounded-md border border-input bg-card pl-2 shadow-soft [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
      {icon}
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Barra dei filtri: stato, categoria, cluster, tag e automazioni. */
export function CalendarFiltersBar({
  filters,
  onChange,
  clusters,
  tagOptions,
  totalCount,
  visibleCount,
  className,
}: CalendarFiltersBarProps) {
  const active = countActiveFilters(filters);

  const statusOptions = React.useMemo(
    () => STATUS_OPTIONS.map((option) => ({ ...option, color: statusColor(option.value) })),
    [],
  );

  const clusterOptions = React.useMemo<ComboboxOption[]>(
    () =>
      clusters.map((cluster) => ({
        value: cluster.id,
        label: cluster.name,
        description:
          cluster.sendableCount > 0 ? `${formatNumber(cluster.sendableCount)} contattabili` : undefined,
        icon: (
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: cluster.color }}
          />
        ),
      })),
    [clusters],
  );

  const tagComboOptions = React.useMemo<ComboboxOption[]>(
    () => tagOptions.map((tag) => ({ value: tag, label: tag })),
    [tagOptions],
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <MultiSelectDropdown
        label="Stato"
        icon={<Layers aria-hidden="true" />}
        options={statusOptions}
        selected={filters.statuses}
        onChange={(next) => onChange({ ...filters, statuses: next as NewsletterStatus[] })}
      />

      <MultiSelectDropdown
        label="Categoria"
        icon={<Tag aria-hidden="true" />}
        options={CATEGORY_OPTIONS}
        selected={filters.categories}
        onChange={(next) => onChange({ ...filters, categories: next as NewsletterCategory[] })}
      />

      <FilterField id="filtro-cluster" label="Cluster" icon={<Users aria-hidden="true" />}>
        <Combobox
          id="filtro-cluster"
          multiple
          options={clusterOptions}
          value={filters.clusterIds}
          onChange={(value) =>
            onChange({ ...filters, clusterIds: Array.isArray(value) ? value : [value] })
          }
          placeholder="Cluster"
          searchPlaceholder="Cerca cluster…"
          emptyMessage="Nessun cluster disponibile."
          className="h-8 w-32 border-0 bg-transparent px-2 shadow-none"
          contentClassName="w-72"
        />
      </FilterField>

      <FilterField id="filtro-tag" label="Tag" icon={<Tag aria-hidden="true" />}>
        <Combobox
          id="filtro-tag"
          multiple
          options={tagComboOptions}
          value={filters.tags}
          onChange={(value) => onChange({ ...filters, tags: Array.isArray(value) ? value : [value] })}
          placeholder="Tag"
          searchPlaceholder="Cerca tag…"
          emptyMessage="Nessun tag nelle newsletter del periodo."
          className="h-8 w-28 border-0 bg-transparent px-2 shadow-none"
          contentClassName="w-64"
        />
      </FilterField>

      <div className="flex items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1 shadow-soft">
        <Switch
          id="filtro-automazioni"
          checked={filters.showAutomations}
          onCheckedChange={(checked) => onChange({ ...filters, showAutomations: checked })}
        />
        <Label htmlFor="filtro-automazioni" className="cursor-pointer text-xs font-medium">
          <Repeat2 className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
          Automazioni
        </Label>
      </div>

      {active > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="text-muted-foreground"
        >
          <FilterX aria-hidden="true" />
          Azzera filtri
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
            {active}
          </Badge>
        </Button>
      ) : null}

      <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
        {visibleCount === totalCount
          ? `${formatNumber(totalCount)} ${totalCount === 1 ? 'voce' : 'voci'} nel periodo`
          : `${formatNumber(visibleCount)} di ${formatNumber(totalCount)} voci`}
      </p>
    </div>
  );
}
