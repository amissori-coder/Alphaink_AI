'use client';

import type { Cluster, SiteSource, SubscriptionStatus } from '@alphaink/shared';
import { Download, FileDown, Info } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/utils';

import { SOURCE_OPTIONS, STATUS_OPTIONS } from './constants';
import type { ExportContactsInput } from './types';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: Cluster[];
  busy: boolean;
  /** Numero di contatti attualmente selezionati nell'elenco, se presenti. */
  selectedCount?: number;
  /** Filtri correnti dell'elenco, proposti come punto di partenza. */
  initial?: Partial<ExportContactsInput>;
  onConfirm: (input: ExportContactsInput) => Promise<string | null>;
}

/**
 * Esportazione dei contatti in CSV.
 *
 * Il file viene generato dalle Cloud Functions su Firebase Storage e
 * restituito come URL firmata valida un'ora: l'anagrafica non deve restare
 * raggiungibile con un link permanente.
 */
export function ExportDialog({
  open,
  onOpenChange,
  clusters,
  busy,
  selectedCount = 0,
  initial,
  onConfirm,
}: ExportDialogProps) {
  const [clusterId, setClusterId] = React.useState<string>('');
  const [statuses, setStatuses] = React.useState<SubscriptionStatus[]>([]);
  const [segment, setSegment] = React.useState<string>('');
  const [source, setSource] = React.useState<string>('');
  const [onlySendable, setOnlySendable] = React.useState(false);
  const [downloadUrl, setDownloadUrl] = React.useState<string | null>(null);

  // I filtri dell'elenco vengono riproposti solo all'apertura del dialogo.
  // `initial` arriva come oggetto nuovo a ogni render del genitore: tenerlo
  // fra le dipendenze azzererebbe le scelte dell'utente a ogni ridisegno.
  const initialRef = React.useRef(initial);
  initialRef.current = initial;

  React.useEffect(() => {
    if (!open) return;
    const values = initialRef.current;
    setDownloadUrl(null);
    setClusterId(values?.clusterId ?? '');
    setStatuses(values?.status ?? []);
    setSegment(values?.segment ?? '');
    setSource(values?.source ?? '');
    setOnlySendable(values?.onlySendable ?? false);
  }, [open]);

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

  const handleExport = async () => {
    const url = await onConfirm({
      clusterId: clusterId || null,
      status: statuses.length > 0 ? statuses : undefined,
      segment: segment === 'b2c' || segment === 'b2b' ? segment : null,
      source: (source as SiteSource) || null,
      onlySendable,
    });
    setDownloadUrl(url);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Esporta i contatti in CSV</DialogTitle>
          <DialogDescription>
            Il file usa il punto e virgola come separatore e il BOM UTF-8: Excel in italiano lo apre
            correttamente senza importazione guidata.
          </DialogDescription>
        </DialogHeader>

        {selectedCount > 0 ? (
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>La selezione non viene usata qui</AlertTitle>
            <AlertDescription>
              Hai {formatNumber(selectedCount)} contatti selezionati nell’elenco. L’esportazione
              lavora sui filtri qui sotto: per esportare solo la selezione usa “Esporta selezione”
              nella barra delle azioni di gruppo.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="export-cluster">Cluster</Label>
            <Combobox
              id="export-cluster"
              options={clusterOptions}
              value={clusterId}
              onChange={(next) => setClusterId(next as string)}
              clearable
              placeholder="Tutti i contatti"
              searchPlaceholder="Cerca un cluster…"
              emptyMessage="Nessun cluster."
              className="h-9 w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-stato">Stato di iscrizione</Label>
            <Combobox
              id="export-stato"
              multiple
              options={STATUS_OPTIONS}
              value={statuses}
              onChange={(next) => setStatuses(next as SubscriptionStatus[])}
              placeholder="Tutti gli stati"
              searchPlaceholder="Cerca uno stato…"
              emptyMessage="Nessuno stato."
              className="h-9 w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-segmento">Segmento</Label>
            <Combobox
              id="export-segmento"
              options={[
                { value: 'b2c', label: 'B2C — privati' },
                { value: 'b2b', label: 'B2B — rivenditori' },
              ]}
              value={segment}
              onChange={(next) => setSegment(next as string)}
              clearable
              placeholder="Tutti"
              searchPlaceholder="Cerca…"
              emptyMessage="Nessun segmento."
              className="h-9 w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-sorgente">Sorgente</Label>
            <Combobox
              id="export-sorgente"
              options={SOURCE_OPTIONS}
              value={source}
              onChange={(next) => setSource(next as string)}
              clearable
              placeholder="Tutte"
              searchPlaceholder="Cerca una sorgente…"
              emptyMessage="Nessuna sorgente."
              className="h-9 w-full"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <Checkbox
            checked={onlySendable}
            onCheckedChange={(checked) => setOnlySendable(checked === true)}
            aria-label="Esporta solo i contatti contattabili"
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Solo contatti contattabili
            </span>
            <span className="block text-xs text-muted-foreground">
              Esclude disiscritti, bounce e indirizzi bloccati: è il file giusto da caricare su un
              altro strumento di invio.
            </span>
          </span>
        </label>

        {downloadUrl ? (
          <Alert variant="success">
            <FileDown aria-hidden="true" />
            <AlertTitle>File pronto</AlertTitle>
            <AlertDescription className="space-y-2">
              <span className="block">
                Il collegamento resta valido per un’ora. Dopo la scadenza basta rilanciare
                l’esportazione.
              </span>
              <Button asChild size="sm">
                <a href={downloadUrl} download rel="noopener noreferrer" target="_blank">
                  <Download aria-hidden="true" />
                  Scarica il CSV
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {downloadUrl ? 'Chiudi' : 'Annulla'}
          </Button>
          <Button loading={busy} disabled={busy} onClick={() => void handleExport()}>
            <FileDown aria-hidden="true" />
            {downloadUrl ? 'Rigenera il file' : 'Genera il file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
