'use client';

import { SITE_SOURCE_LABELS } from '@alphaink/shared';
import type { SyncEntity } from '@alphaink/shared';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import type { RunSyncInput } from './types';

type StoreSource = RunSyncInput['source'];

/** Entità sincronizzabili proposte dalla rubrica, con la loro ricaduta pratica. */
const ENTITY_CHOICES: Array<{ entity: SyncEntity; label: string; hint: string }> = [
  {
    entity: 'customers',
    label: 'Clienti',
    hint: 'Anagrafica, consensi newsletter e gruppo cliente.',
  },
  {
    entity: 'orders',
    label: 'Ordini',
    hint: 'Aggiorna spesa, famiglie acquistate e date di riacquisto.',
  },
  {
    entity: 'customer_groups',
    label: 'Gruppi cliente',
    hint: 'Necessario per i cluster che rispecchiano un gruppo di PrestaShop.',
  },
  {
    entity: 'carts',
    label: 'Carrelli abbandonati',
    hint: 'Alimenta le automazioni di recupero carrello.',
  },
];

export interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: (input: RunSyncInput) => Promise<boolean>;
}

/**
 * Avvio manuale della sincronizzazione da uno dei due negozi PrestaShop.
 *
 * Il job schedulato gira comunque ogni ora: questo dialogo serve quando si
 * vuole vedere subito in rubrica una modifica appena fatta sul sito, oppure
 * per un riallineamento completo dopo un intervento sul catalogo.
 */
export function SyncDialog({ open, onOpenChange, busy, onConfirm }: SyncDialogProps) {
  const [source, setSource] = React.useState<StoreSource>('prestashop_b2c');
  const [entities, setEntities] = React.useState<SyncEntity[]>(['customers', 'orders']);
  const [fullResync, setFullResync] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSource('prestashop_b2c');
    setEntities(['customers', 'orders']);
    setFullResync(false);
  }, [open]);

  const toggle = (entity: SyncEntity, checked: boolean) => {
    setEntities((current) =>
      checked ? Array.from(new Set([...current, entity])) : current.filter((item) => item !== entity),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Sincronizza dal sito</DialogTitle>
          <DialogDescription>
            Legge i dati aggiornati da PrestaShop e li riporta in rubrica. La sincronizzazione è
            incrementale: parte dall’ultimo punto raggiunto.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Negozio</legend>
          <RadioGroup
            value={source}
            onValueChange={(next) => setSource(next as StoreSource)}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(['prestashop_b2c', 'prestashop_b2b'] as StoreSource[]).map((store) => (
              <div
                key={store}
                className="flex items-start gap-3 rounded-md border border-border p-3"
              >
                <RadioGroupItem value={store} id={`sync-${store}`} className="mt-0.5" />
                <Label htmlFor={`sync-${store}`} className="cursor-pointer font-normal">
                  <span className="block text-sm font-medium text-foreground">
                    {store === 'prestashop_b2c' ? 'B2C' : 'B2B'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {SITE_SOURCE_LABELS[store]}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Dati da sincronizzare</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ENTITY_CHOICES.map((choice) => (
              <label
                key={choice.entity}
                className="flex items-start gap-3 rounded-md border border-border p-3"
              >
                <Checkbox
                  checked={entities.includes(choice.entity)}
                  onCheckedChange={(checked) => toggle(choice.entity, checked === true)}
                  aria-label={choice.label}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{choice.label}</span>
                  <span className="block text-xs text-muted-foreground">{choice.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <Checkbox
            checked={fullResync}
            onCheckedChange={(checked) => setFullResync(checked === true)}
            aria-label="Rileggi tutto dall’inizio"
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Rileggi tutto dall’inizio
            </span>
            <span className="block text-xs text-muted-foreground">
              Ignora il punto di ripresa e rilegge l’intero archivio. Serve dopo un intervento sul
              database del sito, ma su cataloghi grandi può richiedere diversi minuti.
            </span>
          </span>
        </label>

        {fullResync ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Operazione lunga</AlertTitle>
            <AlertDescription>
              La rilettura completa può superare il tempo massimo di una singola esecuzione: in quel
              caso il lavoro riprende in automatico dal job schedulato.
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            disabled={busy || entities.length === 0}
            loading={busy}
            onClick={async () => {
              const done = await onConfirm({
                source,
                entities: entities as RunSyncInput['entities'],
                fullResync,
              });
              if (done) onOpenChange(false);
            }}
          >
            <RefreshCw aria-hidden="true" />
            Avvia la sincronizzazione
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
