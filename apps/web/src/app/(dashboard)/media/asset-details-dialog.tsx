'use client';

/**
 * Scheda di dettaglio di un file della libreria: anteprima grande, metadati,
 * indirizzo pubblico da copiare ed eliminazione.
 */

import { Check, Copy, ExternalLink, Trash2 } from 'lucide-react';
import * as React from 'react';

import type { MediaAssetDoc } from '@/components/editor/media-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bytesToSize, formatDateTimeIt } from '@/lib/utils';

import { fileExtension } from './upload';

export interface AssetDetailsDialogProps {
  asset: MediaAssetDoc | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome leggibile di chi ha caricato il file, se risolvibile. */
  uploaderName?: string | null;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (asset: MediaAssetDoc) => void;
}

export function AssetDetailsDialog({
  asset,
  open,
  onOpenChange,
  uploaderName,
  canDelete,
  deleting,
  onDelete,
}: AssetDetailsDialogProps) {
  const [copied, setCopied] = React.useState(false);
  // Le dimensioni non sono sempre salvate sul documento: quando mancano si
  // leggono dall'immagine appena caricata nell'anteprima.
  const [measured, setMeasured] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  React.useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  React.useEffect(() => {
    setMeasured(null);
  }, [asset?.id]);

  if (!asset) return null;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopied(true);
    } catch {
      // Contesto non sicuro: l'indirizzo resta selezionabile dal campo.
      setCopied(false);
    }
  };

  const width = asset.width ?? measured?.width ?? null;
  const height = asset.height ?? measured?.height ?? null;
  const dimensions = width && height ? `${width} × ${height} px` : 'Non disponibili';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.fileName}</DialogTitle>
          <DialogDescription>
            Dettagli del file e indirizzo da usare nei contenuti delle email.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-h-[14rem] items-center justify-center overflow-hidden rounded-lg border border-border bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] p-3">
            <img
              src={asset.url}
              alt={asset.alt ?? asset.fileName}
              className="max-h-[22rem] max-w-full object-contain"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight) {
                  setMeasured({ width: image.naturalWidth, height: image.naturalHeight });
                }
              }}
            />
          </div>

          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Formato</dt>
              <dd className="flex items-center gap-2">
                <Badge variant="outline">{fileExtension(asset.fileName, asset.contentType)}</Badge>
                <span className="text-muted-foreground">{asset.contentType}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dimensioni</dt>
              <dd className="font-medium text-foreground">{dimensions}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Peso</dt>
              <dd className="font-medium text-foreground">{bytesToSize(asset.size)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cartella</dt>
              <dd className="font-medium text-foreground">{asset.folder || 'media'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Caricato il</dt>
              <dd className="font-medium text-foreground">{formatDateTimeIt(asset.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Caricato da</dt>
              <dd className="truncate font-medium text-foreground" title={uploaderName ?? undefined}>
                {uploaderName || 'Non disponibile'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Percorso su Storage</dt>
              <dd className="break-all font-mono text-xs text-muted-foreground">{asset.path}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="media-url">Indirizzo pubblico</Label>
          <div className="flex items-center gap-2">
            <Input id="media-url" readOnly value={asset.url} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyUrl}
              aria-label="Copia l’indirizzo del file"
              title="Copia l’indirizzo del file"
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
            <Button type="button" variant="outline" size="icon" asChild>
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Apri il file in una nuova scheda"
                title="Apri il file in una nuova scheda"
              >
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>

        <DialogFooter>
          {canDelete ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDelete(asset)}
              loading={deleting}
            >
              {deleting ? null : <Trash2 aria-hidden="true" />}
              Elimina file
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
