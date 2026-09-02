'use client';

import type {
  Cluster,
  EngagementTier,
  ProductFamily,
  SiteSource,
  SubscriptionStatus,
} from '@alphaink/shared';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn, formatNumber } from '@/lib/utils';

import {
  FAMILY_OPTIONS,
  SEGMENT_OPTIONS,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  TIER_OPTIONS,
} from './constants';
import { EMPTY_FILTERS, type ContactFilters } from './types';

/** Numero di criteri attivi, mostrato sul pulsante dei filtri avanzati. */
export function countActiveFilters(filters: ContactFilters): number {
  let count = 0;
  if (filters.term.trim()) count += 1;
  if (filters.status.length > 0) count += 1;
  if (filters.segment.length > 0) count += 1;
  if (filters.source.length > 0) count += 1;
  if (filters.clusterIds.length > 0) count += 1;
  if (filters.tiers.length > 0) count += 1;
  if (filters.minSpent !== null || filters.maxSpent !== null) count += 1;
  if (filters.families.length > 0) count += 1;
  if (filters.onlyBuyers) count += 1;
  return count;
}

/** Numero di criteri presenti solo nel pannello avanzato. */
function countAdvanced(filters: ContactFilters): number {
  let count = 0;
  if (filters.source.length > 0) count += 1;
  if (filters.tiers.length > 0) count += 1;
  if (filters.minSpent !== null || filters.maxSpent !== null) count += 1;
  if (filters.families.length > 0) count += 1;
  if (filters.onlyBuyers) count += 1;
  return count;
}

export interface ContactFiltersBarProps {
  filters: ContactFilters;
  onChange: (filters: ContactFilters) => void;
  clusters: Cluster[];
  /** Numero di righe che superano i filtri, mostrato accanto ai comandi. */
  resultCount: number;
  totalCount: number;
  loading?: boolean;
  className?: string;
}

/**
 * Barra dei filtri della rubrica.
 *
 * I criteri usati tutti i giorni (ricerca, stato, segmento, cluster) stanno in
 * linea; quelli più specifici finiscono in un pannello a scomparsa, così la
 * barra resta leggibile anche su schermi stretti.
 */
export function ContactFiltersBar({
  filters,
  onChange,
  clusters,
  resultCount,
  totalCount,
  loading = false,
  className,
}: ContactFiltersBarProps) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const update = (patch: Partial<ContactFilters>) => onChange({ ...filters, ...patch });

  const clusterOptions: ComboboxOption[] = React.useMemo(
    () =>
      clusters
        .filter((cluster) => !cluster.archived)
        .map((cluster) => ({
          value: cluster.id,
          label: cluster.name,
          description: `${formatNumber(cluster.contactCount)} contatti`,
        })),
    [clusters],
  );

  const advancedCount = countAdvanced(filters);
  const activeCount = countActiveFilters(filters);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.term}
          onChange={(event) => update({ term: event.target.value })}
          placeholder="Cerca per email, nome o azienda…"
          startIcon={<Search aria-hidden="true" />}
          aria-label="Cerca fra i contatti"
          className="w-full sm:w-80"
        />

        <Combobox
          multiple
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(next) => update({ status: next as SubscriptionStatus[] })}
          placeholder="Stato"
          searchPlaceholder="Cerca uno stato…"
          emptyMessage="Nessuno stato."
          className="h-9 w-[9.5rem]"
          contentClassName="min-w-[15rem]"
        />

        <Combobox
          multiple
          options={SEGMENT_OPTIONS}
          value={filters.segment}
          onChange={(next) => update({ segment: next as Array<'b2c' | 'b2b'> })}
          placeholder="Segmento"
          searchPlaceholder="Cerca…"
          emptyMessage="Nessun segmento."
          className="h-9 w-[9.5rem]"
          contentClassName="min-w-[14rem]"
        />

        <Combobox
          multiple
          options={clusterOptions}
          value={filters.clusterIds}
          onChange={(next) => update({ clusterIds: next as string[] })}
          disabled={clusterOptions.length === 0}
          placeholder="Cluster"
          searchPlaceholder="Cerca un cluster…"
          emptyMessage="Nessun cluster."
          className="h-9 w-[10rem]"
          contentClassName="min-w-[16rem]"
        />

        <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={advancedCount > 0 ? 'default' : 'outline'}
              size="sm"
              className="h-9"
              aria-expanded={advancedOpen}
            >
              <SlidersHorizontal aria-hidden="true" />
              Altri filtri
              {advancedCount > 0 ? (
                <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 text-xs">
                  {advancedCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(24rem,92vw)] space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="filtro-sorgente">Sorgente</Label>
              <Combobox
                id="filtro-sorgente"
                multiple
                options={SOURCE_OPTIONS}
                value={filters.source}
                onChange={(next) => update({ source: next as SiteSource[] })}
                placeholder="Tutte le sorgenti"
                searchPlaceholder="Cerca una sorgente…"
                emptyMessage="Nessuna sorgente."
                className="h-9 w-full"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="filtro-engagement">Livello di engagement</Label>
              <Combobox
                id="filtro-engagement"
                multiple
                options={TIER_OPTIONS}
                value={filters.tiers}
                onChange={(next) => update({ tiers: next as EngagementTier[] })}
                placeholder="Tutti i livelli"
                searchPlaceholder="Cerca un livello…"
                emptyMessage="Nessun livello."
                className="h-9 w-full"
              />
            </div>

            <Separator />

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium leading-none text-foreground">
                Spesa totale
              </legend>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={10}
                  value={filters.minSpent ?? ''}
                  placeholder="da"
                  aria-label="Spesa totale minima in euro"
                  onChange={(event) =>
                    update({
                      minSpent: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground">—</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={10}
                  value={filters.maxSpent ?? ''}
                  placeholder="a"
                  aria-label="Spesa totale massima in euro"
                  onChange={(event) =>
                    update({
                      maxSpent: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                  className="w-full"
                />
                <span className="text-sm text-muted-foreground">€</span>
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="filtro-famiglie">Ha acquistato</Label>
              <Combobox
                id="filtro-famiglie"
                multiple
                options={FAMILY_OPTIONS}
                value={filters.families}
                onChange={(next) => update({ families: next as ProductFamily[] })}
                placeholder="Qualsiasi famiglia"
                searchPlaceholder="Cerca una famiglia…"
                emptyMessage="Nessuna famiglia."
                className="h-9 w-full"
              />
              <p className="text-xs text-muted-foreground">
                Il contatto deve avere almeno un ordine in una delle famiglie scelte.
              </p>
            </div>

            <label className="flex items-start gap-2">
              <Checkbox
                checked={filters.onlyBuyers}
                onCheckedChange={(checked) => update({ onlyBuyers: checked === true })}
                aria-label="Solo chi ha già acquistato"
                className="mt-0.5"
              />
              <span className="text-sm text-foreground">Solo chi ha già acquistato</span>
            </label>

            <div className="flex justify-between gap-2 border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...filters,
                    source: [],
                    tiers: [],
                    minSpent: null,
                    maxSpent: null,
                    families: [],
                    onlyBuyers: false,
                  })
                }
              >
                Azzera questi filtri
              </Button>
              <Button size="sm" onClick={() => setAdvancedOpen(false)}>
                Applica
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...EMPTY_FILTERS })}>
            <X aria-hidden="true" />
            Azzera tutto
          </Button>
        ) : null}

        <span className="ml-auto whitespace-nowrap text-sm text-muted-foreground">
          {loading
            ? 'Caricamento…'
            : activeCount > 0
              ? `${formatNumber(resultCount)} di ${formatNumber(totalCount)} contatti`
              : `${formatNumber(totalCount)} contatti`}
        </span>
      </div>

      {advancedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.source.map((source) => (
            <Badge key={source} variant="secondary">
              Sorgente: {SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source}
            </Badge>
          ))}
          {filters.tiers.map((tier) => (
            <Badge key={tier} variant="secondary">
              Engagement: {TIER_OPTIONS.find((option) => option.value === tier)?.label ?? tier}
            </Badge>
          ))}
          {filters.minSpent !== null || filters.maxSpent !== null ? (
            <Badge variant="secondary">
              Spesa{' '}
              {filters.minSpent !== null ? `da ${formatNumber(filters.minSpent)} €` : ''}
              {filters.minSpent !== null && filters.maxSpent !== null ? ' ' : ''}
              {filters.maxSpent !== null ? `fino a ${formatNumber(filters.maxSpent)} €` : ''}
            </Badge>
          ) : null}
          {filters.families.map((family) => (
            <Badge key={family} variant="secondary">
              Ha comprato:{' '}
              {FAMILY_OPTIONS.find((option) => option.value === family)?.label ?? family}
            </Badge>
          ))}
          {filters.onlyBuyers ? <Badge variant="secondary">Solo acquirenti</Badge> : null}
        </div>
      ) : null}
    </div>
  );
}
