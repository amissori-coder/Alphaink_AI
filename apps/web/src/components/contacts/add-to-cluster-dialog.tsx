'use client';

import type { Cluster } from '@alphaink/shared';
import { Info, Layers, Plus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatNumber } from '@/lib/utils';

import { ROUTES } from './constants';

export interface AddToClusterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contatti da aggiungere. */
  contactIds: string[];
  clusters: Cluster[];
  busy: boolean;
  onConfirm: (cluster: Cluster) => Promise<boolean>;
}

/**
 * Aggiunge i contatti selezionati a un cluster **statico**.
 *
 * I cluster dinamici non compaiono di proposito: la loro appartenenza è decisa
 * dalle regole e verrebbe sovrascritta al primo ricalcolo.
 */
export function AddToClusterDialog({
  open,
  onOpenChange,
  contactIds,
  clusters,
  busy,
  onConfirm,
}: AddToClusterDialogProps) {
  const [selected, setSelected] = React.useState<string>('');

  const statici = React.useMemo(
    () => clusters.filter((cluster) => cluster.type === 'static' && !cluster.archived),
    [clusters],
  );

  React.useEffect(() => {
    if (!open) setSelected('');
  }, [open]);

  const target = statici.find((cluster) => cluster.id === selected) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aggiungi a un cluster</DialogTitle>
          <DialogDescription>
            {contactIds.length === 1
              ? 'Il contatto selezionato verrà aggiunto all’elenco fisso del cluster.'
              : `I ${formatNumber(contactIds.length)} contatti selezionati verranno aggiunti all’elenco fisso del cluster.`}
          </DialogDescription>
        </DialogHeader>

        {statici.length === 0 ? (
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>Nessun cluster statico disponibile</AlertTitle>
            <AlertDescription>
              Solo i cluster statici hanno un elenco di contatti modificabile a mano. Creane uno
              scegliendo “Statico (elenco fisso)” come tipo.
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-72 rounded-md border border-border">
            <RadioGroup
              value={selected}
              onValueChange={setSelected}
              className="divide-y divide-border"
              aria-label="Cluster di destinazione"
            >
              {statici.map((cluster) => {
                const id = `cluster-${cluster.id}`;
                const already = (cluster.contactIds ?? []).filter((entry) =>
                  contactIds.includes(entry),
                ).length;
                return (
                  <div key={cluster.id} className="flex items-start gap-3 px-3 py-2.5">
                    <RadioGroupItem value={cluster.id} id={id} className="mt-1" />
                    <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-normal">
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cluster.color }}
                          aria-hidden="true"
                        />
                        <span className="truncate text-sm font-medium text-foreground">
                          {cluster.name}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatNumber(cluster.contactCount)} contatti
                        {already > 0
                          ? ` · ${formatNumber(already)} dei selezionati sono già dentro`
                          : ''}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="ghost">
            <Link href={`${ROUTES.clusters}/nuovo`}>
              <Plus aria-hidden="true" />
              Nuovo cluster
            </Link>
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button
              disabled={!target || busy || contactIds.length === 0}
              loading={busy}
              onClick={async () => {
                if (!target) return;
                const done = await onConfirm(target);
                if (done) onOpenChange(false);
              }}
            >
              <Layers aria-hidden="true" />
              Aggiungi
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
