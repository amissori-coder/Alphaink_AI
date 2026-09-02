'use client';

import { CLUSTER_TYPE_LABELS } from '@alphaink/shared';
import type { Cluster, DocId } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import {
  CircleAlert,
  Layers,
  Search,
  ShieldMinus,
  TriangleAlert,
  UserRoundMinus,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { isFirebaseConfigured } from '@/lib/firebase/client';
import { cn, formatNumber } from '@/lib/utils';

import { estimateAudience } from './api';
import {
  AUDIENCE_REASON_LABELS,
  ESTIMATE_DEBOUNCE_MS,
  ROUTES,
  estimateQueryKey,
} from './constants';
import { ContactMultiSelect } from './contact-search';
import type { AudienceCriteria, AudienceEstimate, AudienceExclusionReason } from './types';
import { useClusters } from './use-newsletter-data';

export interface AudiencePickerProps {
  value: AudienceCriteria;
  onChange: (value: AudienceCriteria) => void;
  disabled?: boolean;
  className?: string;
  /** Riceve la stima ogni volta che viene ricalcolata. */
  onEstimate?: (estimate: AudienceEstimate | null) => void;
}

/** Firma stabile dei criteri: guida il ricalcolo della stima. */
function audienceSignature(audience: AudienceCriteria): string {
  return JSON.stringify({
    c: [...audience.clusterIds].sort(),
    x: [...audience.excludeClusterIds].sort(),
    i: [...audience.includeContactIds].sort(),
    e: [...audience.excludeContactIds].sort(),
    sc: audience.suppressIfContactedWithinDays ?? null,
    sp: audience.suppressIfPurchasedWithinDays ?? null,
  });
}

function normalizeDays(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 1), 365);
}

/**
 * Selettore del pubblico di una newsletter.
 *
 * Unione dei cluster inclusi, sottrazione dei cluster esclusi, aggiunte e
 * rimozioni puntuali di singoli contatti, più le regole di soppressione
 * temporali. Il riquadro di riepilogo interroga `estimateAudience` con un
 * ritardo, così ogni spunta non genera una chiamata.
 */
export function AudiencePicker({
  value,
  onChange,
  disabled = false,
  className,
  onEstimate,
}: AudiencePickerProps) {
  const clusters = useClusters();
  const [clusterSearch, setClusterSearch] = React.useState('');

  const available = React.useMemo(
    () => (clusters.data ?? []).filter((cluster) => !cluster.archived),
    [clusters.data],
  );

  const filteredClusters = React.useMemo(() => {
    const term = clusterSearch.trim().toLowerCase();
    if (!term) return available;
    return available.filter(
      (cluster) =>
        cluster.name.toLowerCase().includes(term) ||
        (cluster.description ?? '').toLowerCase().includes(term),
    );
  }, [available, clusterSearch]);

  const clusterById = React.useMemo(() => {
    const map = new Map<string, Cluster>();
    for (const cluster of available) map.set(cluster.id, cluster);
    return map;
  }, [available]);

  // --- stima con ritardo ----------------------------------------------------
  // I criteri "in volo" sono una copia congelata dopo la pausa di digitazione:
  // chiave di cache e corpo della richiesta restano così sempre allineati.
  const signature = audienceSignature(value);
  const criteriaRef = React.useRef(value);
  criteriaRef.current = value;

  const [settled, setSettled] = React.useState<AudienceCriteria>(value);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(criteriaRef.current), ESTIMATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [signature]);

  const hasCriteria = value.clusterIds.length > 0 || value.includeContactIds.length > 0;
  const settledHasCriteria = settled.clusterIds.length > 0 || settled.includeContactIds.length > 0;

  const estimate = useQuery<AudienceEstimate, Error>({
    queryKey: estimateQueryKey(audienceSignature(settled)),
    queryFn: () => estimateAudience({ audience: settled }),
    enabled: settledHasCriteria && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });

  // La notifica al genitore passa da un riferimento: un callback ricreato a
  // ogni render non deve far ripartire l'effetto all'infinito.
  const estimateData = estimate.data;
  const onEstimateRef = React.useRef(onEstimate);
  onEstimateRef.current = onEstimate;
  React.useEffect(() => {
    onEstimateRef.current?.(estimateData ?? null);
  }, [estimateData]);

  const patch = (changes: Partial<AudienceCriteria>) => onChange({ ...value, ...changes });

  const toggleCluster = (clusterId: DocId) => {
    const selected = value.clusterIds.includes(clusterId);
    patch({
      clusterIds: selected
        ? value.clusterIds.filter((id) => id !== clusterId)
        : [...value.clusterIds, clusterId],
      // Un cluster non può essere incluso ed escluso allo stesso tempo.
      excludeClusterIds: selected
        ? value.excludeClusterIds
        : value.excludeClusterIds.filter((id) => id !== clusterId),
    });
  };

  const excludeOptions: ComboboxOption[] = available
    .filter((cluster) => !value.clusterIds.includes(cluster.id))
    .map((cluster) => ({
      value: cluster.id,
      label: cluster.name,
      description: `${formatNumber(cluster.sendableCount)} contattabili`,
      icon: (
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: cluster.color }}
          aria-hidden="true"
        />
      ),
    }));

  const selectedTotal = value.clusterIds.reduce(
    (sum, id) => sum + (clusterById.get(id)?.sendableCount ?? 0),
    0,
  );

  const reasons = Object.entries(estimateData?.reasons ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]));

  return (
    <div className={cn('grid gap-4 lg:grid-cols-3', className)}>
      <div className="space-y-4 lg:col-span-2">
        {/* Cluster inclusi ------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="size-4 text-primary" aria-hidden="true" />
              Cluster inclusi
            </CardTitle>
            <CardDescription>
              I contatti dei cluster selezionati vengono uniti fra loro, senza duplicati.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {available.length > 6 ? (
              <Input
                value={clusterSearch}
                onChange={(event) => setClusterSearch(event.target.value)}
                placeholder="Filtra i cluster…"
                startIcon={<Search />}
                aria-label="Filtra i cluster"
                disabled={disabled}
              />
            ) : null}

            {clusters.loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : clusters.error ? (
              <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {clusters.error.message}
              </p>
            ) : available.length === 0 ? (
              <EmptyState
                compact
                icon={<Layers />}
                title="Nessun cluster disponibile"
                description="Crea un segmento per scegliere a chi inviare la newsletter."
                action={
                  <Button asChild size="sm">
                    <Link href={ROUTES.clusters}>Vai ai cluster</Link>
                  </Button>
                }
              />
            ) : filteredClusters.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nessun cluster corrisponde a “{clusterSearch.trim()}”.
              </p>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                {filteredClusters.map((cluster) => {
                  const checked = value.clusterIds.includes(cluster.id);
                  const inputId = `cluster-${cluster.id}`;
                  return (
                    <li key={cluster.id}>
                      <label
                        htmlFor={inputId}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border border-border p-2.5 transition-colors',
                          checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/50',
                          disabled && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <Checkbox
                          id={inputId}
                          checked={checked}
                          onCheckedChange={() => toggleCluster(cluster.id)}
                          disabled={disabled}
                        />
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cluster.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {cluster.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {CLUSTER_TYPE_LABELS[cluster.type]}
                            {cluster.description ? ` · ${cluster.description}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold tabular-nums text-foreground">
                            {formatNumber(cluster.sendableCount)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            su {formatNumber(cluster.contactCount)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Esclusioni ------------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldMinus className="size-4 text-primary" aria-hidden="true" />
              Esclusioni e aggiunte puntuali
            </CardTitle>
            <CardDescription>
              Le esclusioni si applicano dopo l’unione dei cluster e vincono sempre sulle inclusioni.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pubblico-cluster-esclusi">Cluster da escludere</Label>
              <Combobox
                id="pubblico-cluster-esclusi"
                multiple
                options={excludeOptions}
                value={value.excludeClusterIds}
                onChange={(next) => patch({ excludeClusterIds: next as string[] })}
                placeholder="Nessun cluster escluso"
                searchPlaceholder="Cerca un cluster…"
                emptyMessage="Nessun cluster disponibile."
                disabled={disabled || available.length === 0}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pubblico-contatti-inclusi" className="flex items-center gap-1.5">
                  <UserRoundPlus className="size-3.5" aria-hidden="true" />
                  Contatti da includere
                </Label>
                <ContactMultiSelect
                  id="pubblico-contatti-inclusi"
                  value={value.includeContactIds}
                  onChange={(ids) => patch({ includeContactIds: ids })}
                  placeholder="Aggiungi singoli contatti…"
                  disabled={disabled}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pubblico-contatti-esclusi" className="flex items-center gap-1.5">
                  <UserRoundMinus className="size-3.5" aria-hidden="true" />
                  Contatti da escludere
                </Label>
                <ContactMultiSelect
                  id="pubblico-contatti-esclusi"
                  value={value.excludeContactIds}
                  onChange={(ids) => patch({ excludeContactIds: ids })}
                  placeholder="Escludi singoli contatti…"
                  disabled={disabled}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Soppressioni ---------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regole di soppressione</CardTitle>
            <CardDescription>
              Proteggono i contatti dalle email troppo ravvicinate e dagli sconti inutili.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SuppressionRow
              id="soppressione-contattati"
              label="Escludi chi ha già ricevuto un’email"
              description="Utile per non insistere su chi è stato appena raggiunto da un’altra campagna."
              unit="giorni"
              value={value.suppressIfContactedWithinDays ?? null}
              defaultDays={7}
              disabled={disabled}
              onChange={(days) => patch({ suppressIfContactedWithinDays: days })}
            />
            <SuppressionRow
              id="soppressione-acquisti"
              label="Escludi chi ha già acquistato"
              description="Evita di offrire uno sconto a chi ha appena completato un ordine."
              unit="giorni"
              value={value.suppressIfPurchasedWithinDays ?? null}
              defaultDays={30}
              disabled={disabled}
              onChange={(days) => patch({ suppressIfPurchasedWithinDays: days })}
            />
          </CardContent>
        </Card>
      </div>

      {/* Riepilogo --------------------------------------------------------- */}
      <Card className="h-fit lg:sticky lg:top-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" aria-hidden="true" />
            Destinatari stimati
          </CardTitle>
          <CardDescription>
            Calcolo eseguito sui dati attuali della rubrica: al momento dell’invio può variare.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasCriteria ? (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Seleziona almeno un cluster oppure aggiungi dei contatti per vedere la stima.
            </p>
          ) : estimate.isFetching && !estimateData ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Calcolo dei destinatari…
            </div>
          ) : estimate.error ? (
            <div className="space-y-3">
              <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {estimate.error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void estimate.refetch()}
              >
                Riprova
              </Button>
            </div>
          ) : estimateData ? (
            <>
              <div>
                <p className="text-3xl font-semibold tabular-nums text-foreground">
                  {formatNumber(estimateData.recipients)}
                </p>
                <p className="text-sm text-muted-foreground">
                  destinatari contattabili
                  {estimate.isFetching ? ' · aggiornamento…' : ''}
                </p>
              </div>

              <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Somma dei cluster scelti</dt>
                  <dd className="tabular-nums text-foreground">{formatNumber(selectedTotal)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Contatti esclusi</dt>
                  <dd className="tabular-nums text-foreground">
                    {formatNumber(estimateData.excludedCount)}
                  </dd>
                </div>
              </dl>

              {reasons.length > 0 ? (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Motivi delle esclusioni
                  </p>
                  <ul className="space-y-1 text-sm">
                    {reasons.map(([reason, count]) => (
                      <li key={reason} className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">
                          {AUDIENCE_REASON_LABELS[reason as AudienceExclusionReason] ?? reason}
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground">
                          {formatNumber(Number(count))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {estimateData.warnings.length > 0 ? (
                <ul className="space-y-1.5 border-t border-border pt-3">
                  {estimateData.warnings.map((warning) => (
                    <li
                      key={warning}
                      className="flex items-start gap-2 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning-foreground"
                    >
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {value.excludeClusterIds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                  {value.excludeClusterIds.map((id) => (
                    <Badge key={id} variant="outline">
                      − {clusterById.get(id)?.name ?? 'Cluster rimosso'}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Calcolo dei destinatari…
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface SuppressionRowProps {
  id: string;
  label: string;
  description: string;
  unit: string;
  value: number | null;
  defaultDays: number;
  disabled?: boolean;
  onChange: (days: number | null) => void;
}

/** Riga con interruttore e numero di giorni per una regola di soppressione. */
function SuppressionRow({
  id,
  label,
  description,
  unit,
  value,
  defaultDays,
  disabled,
  onChange,
}: SuppressionRowProps) {
  const active = value !== null && value !== undefined;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {active ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={365}
              value={value ?? defaultDays}
              onChange={(event) => onChange(normalizeDays(event.target.value) ?? defaultDays)}
              className="h-9 w-20"
              disabled={disabled}
              aria-label={`${label}: numero di giorni`}
            />
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
        ) : null}
        <Switch
          id={id}
          checked={active}
          onCheckedChange={(checked) => onChange(checked ? defaultDays : null)}
          disabled={disabled}
          aria-label={label}
        />
      </div>
    </div>
  );
}
