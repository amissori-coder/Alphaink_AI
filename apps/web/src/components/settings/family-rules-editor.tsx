'use client';

/**
 * Regole di classificazione dei prodotti nelle famiglie AlphaInk e cicli di
 * riacquisto stimati.
 *
 * Le regole sono valutate in ordine di priorità decrescente: la prima che
 * corrisponde vince. I pattern accettano `*` come jolly (es. `TN-*`,
 * `*cartucc*`) e sono confrontati senza distinzione fra maiuscole e minuscole.
 */

import {
  DEFAULT_FAMILY_RULES,
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  PRODUCT_FAMILIES,
  PRODUCT_FAMILY_LABELS,
  randomId,
  type FamilyRule,
  type ProductFamily,
} from '@alphaink/shared';
import { GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import * as React from 'react';

import { ChipsInput } from '@/components/clusters/value-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// -----------------------------------------------------------------------------
// Regole di famiglia
// -----------------------------------------------------------------------------

export interface FamilyRulesEditorProps {
  rules: FamilyRule[];
  onChange: (rules: FamilyRule[]) => void;
  disabled?: boolean;
}

export function FamilyRulesEditor({ rules, onChange, disabled }: FamilyRulesEditorProps) {
  const sorted = React.useMemo(
    () => [...rules].sort((a, b) => b.priority - a.priority),
    [rules],
  );

  const updateRule = (id: string, patch: Partial<FamilyRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((rule) => rule.id !== id));
  };

  const addRule = () => {
    const lowest = rules.reduce((min, rule) => Math.min(min, rule.priority), 100);
    onChange([
      ...rules,
      {
        id: `regola-${randomId(6)}`,
        family: 'altro',
        priority: Math.max(0, lowest - 10),
        categoryPatterns: [],
        skuPatterns: [],
        namePatterns: [],
      },
    ]);
  };

  return (
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nessuna regola: tutti i prodotti finiranno nella famiglia «Altro» e le automazioni di
          riacquisto useranno il ciclo generico.
        </p>
      ) : null}

      {sorted.map((rule) => (
        <div key={rule.id} className={cn('rounded-lg border border-border bg-card p-4', disabled && 'opacity-80')}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <GripVertical className="mb-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

            <div className="w-44 space-y-1">
              <Label htmlFor={`famiglia-${rule.id}`} className="text-xs text-muted-foreground">
                Famiglia
              </Label>
              <Select
                value={rule.family}
                onValueChange={(value) => updateRule(rule.id, { family: value })}
                disabled={disabled}
              >
                <SelectTrigger id={`famiglia-${rule.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_FAMILIES.map((family: ProductFamily) => (
                    <SelectItem key={family} value={family}>
                      {PRODUCT_FAMILY_LABELS[family]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-32 space-y-1">
              <Label htmlFor={`priorita-${rule.id}`} className="text-xs text-muted-foreground">
                Priorità
              </Label>
              <Input
                id={`priorita-${rule.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                step={10}
                value={String(rule.priority)}
                onChange={(event) =>
                  updateRule(rule.id, { priority: Number(event.target.value) || 0 })
                }
                disabled={disabled}
              />
            </div>

            <p className="mb-2 flex-1 text-xs text-muted-foreground">
              Valutata prima delle regole con priorità più bassa.
            </p>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5"
              onClick={() => removeRule(rule.id)}
              disabled={disabled}
              aria-label={`Elimina la regola ${PRODUCT_FAMILY_LABELS[rule.family as ProductFamily] ?? rule.family}`}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Percorsi categoria</Label>
              <ChipsInput
                values={rule.categoryPatterns}
                onChange={(values) => updateRule(rule.id, { categoryPatterns: values })}
                disabled={disabled}
                placeholder="Es. *toner*"
                ariaLabel="Pattern sui percorsi categoria"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Codici SKU</Label>
              <ChipsInput
                values={rule.skuPatterns}
                onChange={(values) => updateRule(rule.id, { skuPatterns: values })}
                disabled={disabled}
                placeholder="Es. TN-*"
                ariaLabel="Pattern sugli SKU"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nomi prodotto</Label>
              <ChipsInput
                values={rule.namePatterns}
                onChange={(values) => updateRule(rule.id, { namePatterns: values })}
                disabled={disabled}
                placeholder="Es. *cartuccia*"
                ariaLabel="Pattern sui nomi prodotto"
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={disabled}>
          <Plus aria-hidden="true" />
          Aggiungi regola
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_FAMILY_RULES.map((rule) => ({ ...rule })))}
          disabled={disabled}
        >
          <RotateCcw aria-hidden="true" />
          Ripristina regole predefinite
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cicli di riacquisto
// -----------------------------------------------------------------------------

export interface RepurchaseCyclesEditorProps {
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
}

export function RepurchaseCyclesEditor({
  value,
  onChange,
  disabled,
  errors,
}: RepurchaseCyclesEditorProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRODUCT_FAMILIES.map((family) => {
          const fieldId = `ciclo-${family}`;
          const error = errors?.[`repurchaseCycleDays.${family}`];
          return (
            <div key={family} className="space-y-1">
              <Label htmlFor={fieldId} className="text-xs text-muted-foreground">
                {PRODUCT_FAMILY_LABELS[family]}
              </Label>
              <Input
                id={fieldId}
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={5}
                value={String(value[family] ?? DEFAULT_REPURCHASE_CYCLE_DAYS[family])}
                onChange={(event) =>
                  onChange({ ...value, [family]: Number(event.target.value) || 0 })
                }
                disabled={disabled}
                invalid={Boolean(error)}
                endIcon={<span className="text-xs text-muted-foreground">gg</span>}
              />
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange({ ...DEFAULT_REPURCHASE_CYCLE_DAYS })}
        disabled={disabled}
      >
        <RotateCcw aria-hidden="true" />
        Ripristina cicli predefiniti
      </Button>
      <p className="text-xs text-muted-foreground">
        Sono i giorni dopo i quali un cliente viene considerato pronto a riordinare: l’automazione
        «Riacquisto» usa questi valori quando il prodotto non ha una stima propria.
      </p>
    </div>
  );
}
