'use client';

import { COLLECTIONS, formatNumber } from '@alphaink/shared';
import type { Cluster, FilterGroup } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import { Filter, Layers, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import { newRuleTree } from '@/components/clusters/constants';
import { RuleBuilder } from '@/components/clusters/rule-builder';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { cn } from '@/lib/utils';

import type { AutomationPayload } from './types';

export interface AudienceTabProps {
  draft: AutomationPayload;
  disabled?: boolean;
  onChange: (patch: Partial<AutomationPayload>) => void;
  className?: string;
}

/**
 * Scheda "Pubblico": chi può ricevere l'automazione.
 *
 * Il trigger decide *quando* si viene arruolati, queste regole decidono *se*
 * l'invio parte davvero: sono valutate al momento della spedizione, non
 * dell'arruolamento.
 */
export function AudienceTab({ draft, disabled = false, onChange, className }: AudienceTabProps) {
  const fieldId = React.useId();

  const { data: clusters } = useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limitTo(300)],
    { key: 'automazioni-cluster' },
  );

  const clusterOptions: ComboboxOption[] = React.useMemo(
    () =>
      clusters
        .filter((cluster) => !cluster.archived)
        .map((cluster) => ({
          value: cluster.id,
          label: cluster.name,
          description: `${formatNumber(cluster.sendableCount ?? 0)} contattabili`,
          icon: (
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: cluster.color }}
              aria-hidden="true"
            />
          ),
        })),
    [clusters],
  );

  const filterActive = Boolean(draft.audienceFilter);

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4 text-primary" aria-hidden="true" />
            Filtro aggiuntivo sul destinatario
          </CardTitle>
          <CardDescription>
            Condizioni valutate poco prima dell’invio: se non sono soddisfatte l’email non parte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Switch
              id={`${fieldId}-filter`}
              checked={filterActive}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ audienceFilter: checked ? newRuleTree() : null })
              }
            />
            <div className="min-w-0">
              <Label htmlFor={`${fieldId}-filter`} className="text-sm">
                Applica un filtro
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Senza filtro l’automazione considera tutti i contatti contattabili che superano il
                trigger.
              </p>
            </div>
          </div>

          {filterActive && draft.audienceFilter ? (
            <RuleBuilder
              value={draft.audienceFilter as FilterGroup}
              disabled={disabled}
              clusterOptions={clusterOptions}
              onChange={(next) => onChange({ audienceFilter: next })}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-primary" aria-hidden="true" />
            Cluster da escludere
          </CardTitle>
          <CardDescription>
            Chi appartiene a questi segmenti non riceve mai l’automazione, anche se il trigger
            scatta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor={`${fieldId}-exclude`} className="sr-only">
            Cluster esclusi
          </Label>
          <Combobox
            id={`${fieldId}-exclude`}
            multiple
            options={clusterOptions}
            value={draft.excludeClusterIds}
            disabled={disabled}
            placeholder="Nessuna esclusione"
            searchPlaceholder="Cerca un cluster…"
            emptyMessage="Nessun cluster disponibile."
            onChange={(next) =>
              onChange({ excludeClusterIds: Array.isArray(next) ? next : [next] })
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Limiti anti-saturazione
          </CardTitle>
          <CardDescription>
            Proteggono la casella del cliente e la reputazione del dominio di invio.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-cooldown`}>Attesa fra due esecuzioni</Label>
            <Input
              id={`${fieldId}-cooldown`}
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              step={1}
              value={String(draft.cooldownDays)}
              disabled={disabled}
              endIcon={<span className="text-xs">giorni</span>}
              className="tabular-nums"
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onChange({
                  cooldownDays: Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 3650) : 0,
                });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Lo stesso contatto non viene riarruolato prima di questo intervallo. Zero disattiva
              il limite.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-max-year`}>Massimo invii per contatto all’anno</Label>
            <Input
              id={`${fieldId}-max-year`}
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={draft.maxPerContactPerYear === null || draft.maxPerContactPerYear === undefined ? '' : String(draft.maxPerContactPerYear)}
              disabled={disabled}
              placeholder="Nessun limite"
              className="tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (!raw) {
                  onChange({ maxPerContactPerYear: null });
                  return;
                }
                const parsed = Number.parseInt(raw, 10);
                onChange({
                  maxPerContactPerYear: Number.isFinite(parsed)
                    ? Math.min(Math.max(parsed, 1), 365)
                    : null,
                });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Tetto complessivo delle email di questa automazione nei dodici mesi.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
