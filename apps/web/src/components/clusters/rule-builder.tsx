'use client';

import type {
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  FilterValue,
} from '@alphaink/shared';
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Layers,
  Plus,
  Trash2,
  Ban,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import {
  FIELD_DEFINITIONS,
  FIELD_GROUP_LABELS,
  FIELD_GROUP_ORDER,
  MAX_CONDITIONS_PER_GROUP,
  MAX_GROUP_DEPTH,
  OPERATORS_BY_KIND,
  defaultValueFor,
  fieldDefinitionFor,
  newCondition,
  newGroup,
  operatorLabel,
} from './constants';
import type { FieldDefinition } from './types';
import { ConditionValueInput } from './value-input';

// -----------------------------------------------------------------------------
// Manipolazione immutabile dell'albero
// -----------------------------------------------------------------------------

/** Sposta un elemento dell'array di una posizione, restituendo una copia. */
function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

/** Numero complessivo di condizioni presenti nell'albero. */
export function countConditions(tree: FilterGroup): number {
  return (
    tree.conditions.length +
    tree.groups.reduce((total, child) => total + countConditions(child), 0)
  );
}

/** Profondità dell'albero: 1 per il solo gruppo radice. */
export function treeDepth(tree: FilterGroup): number {
  if (tree.groups.length === 0) return 1;
  return 1 + Math.max(...tree.groups.map((child) => treeDepth(child)));
}

// -----------------------------------------------------------------------------
// Selettore del campo, raggruppato per area
// -----------------------------------------------------------------------------

const FIELD_OPTIONS: ComboboxOption[] = FIELD_GROUP_ORDER.flatMap((groupId) =>
  FIELD_DEFINITIONS.filter((definition) => definition.group === groupId).map((definition) => ({
    value: definition.field,
    label: definition.label,
    group: FIELD_GROUP_LABELS[groupId],
    description: definition.hint,
  })),
);

// -----------------------------------------------------------------------------
// Riga di una condizione
// -----------------------------------------------------------------------------

interface ConditionRowProps {
  condition: FilterCondition;
  index: number;
  total: number;
  combinator: 'and' | 'or';
  clusterOptions: ComboboxOption[];
  disabled: boolean;
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}

function ConditionRow({
  condition,
  index,
  total,
  combinator,
  clusterOptions,
  disabled,
  onChange,
  onRemove,
  onMove,
}: ConditionRowProps) {
  const definition: FieldDefinition = fieldDefinitionFor(condition.field);
  const operators = OPERATORS_BY_KIND[definition.kind];

  const operatorOptions: ComboboxOption[] = React.useMemo(
    () =>
      operators.map((operator) => ({
        value: operator,
        label: operatorLabel(operator, definition.kind),
      })),
    [operators, definition.kind],
  );

  const handleFieldChange = (nextField: string) => {
    const nextDefinition = fieldDefinitionFor(nextField);
    const allowed = OPERATORS_BY_KIND[nextDefinition.kind];
    // Se l'operatore corrente non ha senso sul nuovo campo si ripiega sul primo.
    const nextOperator: FilterOperator = allowed.includes(condition.operator)
      ? condition.operator
      : (allowed[0] ?? 'eq');
    onChange({
      ...condition,
      field: nextField as FilterField,
      operator: nextOperator,
      value: defaultValueFor(nextDefinition.kind, nextOperator),
      value2: undefined,
      attributeKey: nextField === 'customAttribute' ? (condition.attributeKey ?? '') : undefined,
    });
  };

  const handleOperatorChange = (nextOperator: string) => {
    const operator = nextOperator as FilterOperator;
    onChange({
      ...condition,
      operator,
      value: defaultValueFor(definition.kind, operator),
      value2: undefined,
    });
  };

  const handleValueChange = (value: FilterValue, value2?: FilterValue) => {
    onChange({ ...condition, value, value2 });
  };

  return (
    <li className="rounded-lg border border-border bg-card p-3 shadow-soft">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 hidden w-10 shrink-0 text-center text-[11px] font-semibold uppercase tracking-wide sm:block',
            index === 0 ? 'text-muted-foreground' : 'text-primary',
          )}
          aria-hidden="true"
        >
          {index === 0 ? 'Se' : combinator === 'and' ? 'E' : 'O'}
        </span>

        <div className="grid min-w-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <Label className="sr-only" htmlFor={`campo-${condition.id}`}>
              Campo della condizione
            </Label>
            <Combobox
              id={`campo-${condition.id}`}
              options={FIELD_OPTIONS}
              value={condition.field}
              onChange={(next) => handleFieldChange(next as string)}
              disabled={disabled}
              placeholder="Scegli un campo"
              searchPlaceholder="Cerca un campo…"
              emptyMessage="Nessun campo corrispondente."
              className="h-9 w-full"
              contentClassName="min-w-[20rem]"
            />
          </div>

          <div className="min-w-0">
            <Label className="sr-only" htmlFor={`operatore-${condition.id}`}>
              Operatore
            </Label>
            <Combobox
              id={`operatore-${condition.id}`}
              options={operatorOptions}
              value={condition.operator}
              onChange={(next) => handleOperatorChange(next as string)}
              disabled={disabled}
              placeholder="Operatore"
              searchPlaceholder="Cerca un operatore…"
              emptyMessage="Nessun operatore disponibile."
              className="h-9 w-full"
              contentClassName="min-w-[16rem]"
            />
          </div>

          <div className="min-w-0">
            <ConditionValueInput
              definition={definition}
              operator={condition.operator}
              value={condition.value}
              value2={condition.value2}
              onChange={handleValueChange}
              dynamicOptions={definition.kind === 'cluster' ? clusterOptions : undefined}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <SimpleTooltip content="Sposta su">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled || index === 0}
              onClick={() => onMove(-1)}
              aria-label="Sposta la condizione più in alto"
            >
              <ChevronUp aria-hidden="true" />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="Sposta giù">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled || index === total - 1}
              onClick={() => onMove(1)}
              aria-label="Sposta la condizione più in basso"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="Elimina la condizione">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              onClick={onRemove}
              aria-label="Elimina la condizione"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </SimpleTooltip>
        </div>
      </div>

      {condition.field === 'customAttribute' ? (
        <div className="mt-2 sm:pl-12">
          <Label className="text-xs" htmlFor={`attributo-${condition.id}`}>
            Nome dell’attributo
          </Label>
          <Input
            id={`attributo-${condition.id}`}
            value={condition.attributeKey ?? ''}
            disabled={disabled}
            placeholder="es. codice_cliente"
            onChange={(event) => onChange({ ...condition, attributeKey: event.target.value })}
            className="mt-1 max-w-xs"
          />
        </div>
      ) : null}

      {definition.hint ? (
        <p className="mt-2 text-xs text-muted-foreground sm:pl-12">{definition.hint}</p>
      ) : null}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Gruppo di regole (ricorsivo)
// -----------------------------------------------------------------------------

interface RuleGroupEditorProps {
  group: FilterGroup;
  depth: number;
  isRoot: boolean;
  clusterOptions: ComboboxOption[];
  disabled: boolean;
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
  onMove?: (delta: number) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

function RuleGroupEditor({
  group,
  depth,
  isRoot,
  clusterOptions,
  disabled,
  onChange,
  onRemove,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
}: RuleGroupEditorProps) {
  const conditionsFull = group.conditions.length >= MAX_CONDITIONS_PER_GROUP;
  const canNest = depth < MAX_GROUP_DEPTH;
  const isEmpty = group.conditions.length === 0 && group.groups.length === 0;

  const setCombinator = (value: string) => {
    if (value !== 'and' && value !== 'or') return;
    onChange({ ...group, combinator: value });
  };

  return (
    <fieldset
      className={cn(
        'rounded-lg border p-3',
        group.negate ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/30',
        !isRoot && 'shadow-soft',
      )}
    >
      <legend className="sr-only">
        {isRoot ? 'Gruppo principale di regole' : `Sottogruppo di regole, livello ${depth}`}
      </legend>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {!isRoot ? (
            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isRoot ? 'Corrispondono i contatti che soddisfano' : 'Sottogruppo'}
          </span>
          <ToggleGroup
            type="single"
            value={group.combinator}
            onValueChange={(value) => (value ? setCombinator(value) : undefined)}
            disabled={disabled}
            aria-label="Modo di combinare le condizioni"
            className="h-8"
          >
            <ToggleGroupItem value="and" className="h-8 px-3 text-xs">
              Tutte (E)
            </ToggleGroupItem>
            <ToggleGroupItem value="or" className="h-8 px-3 text-xs">
              Almeno una (O)
            </ToggleGroupItem>
          </ToggleGroup>

          <SimpleTooltip
            content={
              group.negate
                ? 'Il gruppo è negato: corrispondono i contatti che NON lo soddisfano.'
                : 'Nega il gruppo: corrisponderanno i contatti che non lo soddisfano.'
            }
          >
            <Button
              type="button"
              variant={group.negate ? 'destructive' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ ...group, negate: !group.negate })}
              aria-pressed={Boolean(group.negate)}
            >
              <Ban aria-hidden="true" />
              {group.negate ? 'Negato' : 'Nega'}
            </Button>
          </SimpleTooltip>
        </div>

        {!isRoot ? (
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled || !canMoveUp}
              onClick={() => onMove?.(-1)}
              aria-label="Sposta il gruppo più in alto"
            >
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={disabled || !canMoveDown}
              onClick={() => onMove?.(1)}
              aria-label="Sposta il gruppo più in basso"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={disabled}
              onClick={onRemove}
              aria-label="Elimina il gruppo"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      {isEmpty ? (
        <p className="rounded-md border border-dashed border-border bg-card px-3 py-4 text-center text-sm text-muted-foreground">
          {isRoot
            ? 'Nessuna condizione: il cluster comprenderebbe tutti i contatti della rubrica.'
            : 'Sottogruppo vuoto: non filtra nulla. Aggiungi una condizione oppure eliminalo.'}
        </p>
      ) : null}

      {group.conditions.length > 0 ? (
        <ul className="space-y-2">
          {group.conditions.map((condition, index) => (
            <ConditionRow
              key={condition.id}
              condition={condition}
              index={index}
              total={group.conditions.length}
              combinator={group.combinator}
              clusterOptions={clusterOptions}
              disabled={disabled}
              onChange={(next) =>
                onChange({
                  ...group,
                  conditions: group.conditions.map((item) =>
                    item.id === condition.id ? next : item,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...group,
                  conditions: group.conditions.filter((item) => item.id !== condition.id),
                })
              }
              onMove={(delta) =>
                onChange({ ...group, conditions: moveItem(group.conditions, index, delta) })
              }
            />
          ))}
        </ul>
      ) : null}

      {group.groups.length > 0 ? (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {group.groups.map((child, index) => (
            <RuleGroupEditor
              key={child.id}
              group={child}
              depth={depth + 1}
              isRoot={false}
              clusterOptions={clusterOptions}
              disabled={disabled}
              canMoveUp={index > 0}
              canMoveDown={index < group.groups.length - 1}
              onChange={(next) =>
                onChange({
                  ...group,
                  groups: group.groups.map((item) => (item.id === child.id ? next : item)),
                })
              }
              onRemove={() =>
                onChange({ ...group, groups: group.groups.filter((item) => item.id !== child.id) })
              }
              onMove={(delta) => onChange({ ...group, groups: moveItem(group.groups, index, delta) })}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || conditionsFull}
          onClick={() => onChange({ ...group, conditions: [...group.conditions, newCondition()] })}
        >
          <Plus aria-hidden="true" />
          Aggiungi condizione
        </Button>
        <SimpleTooltip
          content={
            canNest
              ? 'Un sottogruppo permette di mischiare E e O (es. toner OPPURE cartucce, ma solo B2B).'
              : `Profondità massima raggiunta (${MAX_GROUP_DEPTH} livelli).`
          }
        >
          <span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !canNest}
              onClick={() =>
                onChange({
                  ...group,
                  groups: [
                    ...group.groups,
                    { ...newGroup(group.combinator === 'and' ? 'or' : 'and'), conditions: [newCondition()] },
                  ],
                })
              }
            >
              <Layers aria-hidden="true" />
              Aggiungi sottogruppo
            </Button>
          </span>
        </SimpleTooltip>
        {conditionsFull ? (
          <p className="self-center text-xs text-muted-foreground">
            Massimo {MAX_CONDITIONS_PER_GROUP} condizioni per gruppo.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

// -----------------------------------------------------------------------------
// Costruttore completo
// -----------------------------------------------------------------------------

export interface RuleBuilderProps {
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  /** Cluster selezionabili nelle condizioni "appartiene al cluster". */
  clusterOptions?: ComboboxOption[];
  disabled?: boolean;
  className?: string;
}

/**
 * Costruttore visuale delle regole di un cluster dinamico.
 *
 * L'albero è manipolato in modo immutabile: ogni modifica risale fino alla
 * radice e produce un nuovo `FilterGroup`, così l'anteprima in debounce può
 * confrontare le versioni per capire quando rilanciare il conteggio.
 */
export function RuleBuilder({
  value,
  onChange,
  clusterOptions = [],
  disabled = false,
  className,
}: RuleBuilderProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <RuleGroupEditor
        group={value}
        depth={1}
        isRoot
        clusterOptions={clusterOptions}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
