'use client';

/**
 * Editor delle due mappe di un negozio PrestaShop:
 *
 *  - **gruppi cliente → segmento**: il nome del gruppo PrestaShop decide se il
 *    contatto è B2C o B2B (i nomi sono liberi, quindi la mappa è editabile);
 *  - **stati ordine → stati normalizzati**: gli id degli stati PrestaShop sono
 *    personalizzabili installazione per installazione, per questo la mappa
 *    parte da `DEFAULT_PRESTASHOP_ORDER_STATES` ma resta modificabile.
 */

import { DEFAULT_PRESTASHOP_ORDER_STATES, type OrderStatus } from '@alphaink/shared';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import * as React from 'react';

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { ORDER_STATUS_LABELS, ORDER_STATUS_VALUES, PRESTASHOP_STATE_HINTS } from './constants';

// -----------------------------------------------------------------------------
// Gruppi cliente → segmento
// -----------------------------------------------------------------------------

export interface CustomerGroupMappingProps {
  value: Record<string, 'b2c' | 'b2b'>;
  onChange: (value: Record<string, 'b2c' | 'b2b'>) => void;
  disabled?: boolean;
  /** Segmento proposto per le nuove righe. */
  defaultSegment: 'b2c' | 'b2b';
  idPrefix: string;
}

export function CustomerGroupMapping({
  value,
  onChange,
  disabled,
  defaultSegment,
  idPrefix,
}: CustomerGroupMappingProps) {
  const [newGroup, setNewGroup] = React.useState('');
  const entries = React.useMemo(
    () => Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'it')),
    [value],
  );

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    onChange({ ...value, [name]: defaultSegment });
    setNewGroup('');
  };

  const removeGroup = (name: string) => {
    const next = { ...value };
    delete next[name];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Nessun gruppo mappato: tutti i clienti di questo negozio riceveranno il segmento predefinito.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([group, segment]) => (
            <li key={group} className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm"
                title={group}
              >
                {group}
              </span>
              <Select
                value={segment}
                onValueChange={(next) => onChange({ ...value, [group]: next as 'b2c' | 'b2b' })}
                disabled={disabled}
              >
                <SelectTrigger className="w-28" aria-label={`Segmento del gruppo ${group}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="b2c">B2C</SelectItem>
                  <SelectItem value="b2b">B2B</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeGroup(group)}
                disabled={disabled}
                aria-label={`Rimuovi il gruppo ${group}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`${idPrefix}-nuovo-gruppo`} className="text-xs text-muted-foreground">
            Nome del gruppo su PrestaShop
          </Label>
          <Input
            id={`${idPrefix}-nuovo-gruppo`}
            value={newGroup}
            onChange={(event) => setNewGroup(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addGroup();
              }
            }}
            placeholder="Es. Rivenditori"
            disabled={disabled}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addGroup} disabled={disabled || !newGroup.trim()}>
          <Plus aria-hidden="true" />
          Aggiungi
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Stati ordine PrestaShop → stati normalizzati
// -----------------------------------------------------------------------------

export interface OrderStateMappingProps {
  value: Record<string, OrderStatus>;
  onChange: (value: Record<string, OrderStatus>) => void;
  disabled?: boolean;
  idPrefix: string;
}

export function OrderStateMapping({ value, onChange, disabled, idPrefix }: OrderStateMappingProps) {
  const [newId, setNewId] = React.useState('');

  const entries = React.useMemo(
    () =>
      Object.entries(value).sort(
        ([a], [b]) => (Number(a) || Number.MAX_SAFE_INTEGER) - (Number(b) || Number.MAX_SAFE_INTEGER),
      ),
    [value],
  );

  const addState = () => {
    const id = newId.trim();
    if (!id || value[id]) return;
    onChange({ ...value, [id]: 'pending' });
    setNewId('');
  };

  const removeState = (id: string) => {
    const next = { ...value };
    delete next[id];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-20">Id</TableHead>
              <TableHead>Stato su PrestaShop</TableHead>
              <TableHead className="w-56">Stato normalizzato</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([stateId, status]) => (
              <TableRow key={stateId}>
                <TableCell className="font-mono text-xs">{stateId}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {PRESTASHOP_STATE_HINTS[stateId] ?? 'Stato personalizzato'}
                </TableCell>
                <TableCell>
                  <Select
                    value={status}
                    onValueChange={(next) => onChange({ ...value, [stateId]: next as OrderStatus })}
                    disabled={disabled}
                  >
                    <SelectTrigger aria-label={`Stato normalizzato per l’id ${stateId}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDER_STATUS_VALUES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {ORDER_STATUS_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeState(stateId)}
                    disabled={disabled}
                    aria-label={`Rimuovi la mappatura dello stato ${stateId}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1">
          <Label htmlFor={`${idPrefix}-nuovo-stato`} className="text-xs text-muted-foreground">
            Id stato PrestaShop
          </Label>
          <Input
            id={`${idPrefix}-nuovo-stato`}
            type="number"
            inputMode="numeric"
            min={1}
            value={newId}
            onChange={(event) => setNewId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addState();
              }
            }}
            placeholder="Es. 14"
            disabled={disabled}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addState} disabled={disabled || !newId.trim()}>
          <Plus aria-hidden="true" />
          Aggiungi stato
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...DEFAULT_PRESTASHOP_ORDER_STATES })}
          disabled={disabled}
        >
          <RotateCcw aria-hidden="true" />
          Ripristina stati di fabbrica
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Gli stati non mappati vengono ignorati dal calcolo del fatturato: se AlphaInk ha creato stati
        personalizzati su PrestaShop, aggiungili qui con il loro id numerico.
      </p>
    </div>
  );
}
