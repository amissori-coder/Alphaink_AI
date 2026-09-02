'use client';

/**
 * Selettore di immagini dell'editor.
 *
 * Tre modi per ottenere un'immagine:
 *  1. **Libreria** — griglia dei file già caricati (collezione `mediaAssets`).
 *  2. **Carica** — trascinamento o selezione di un file; il caricamento avviene
 *     direttamente su Cloud Storage con la *signed URL* restituita dalla
 *     callable `requestMediaUpload`, quindi senza limiti di payload e con
 *     avanzamento reale.
 *  3. **Da URL** — immagine già ospitata altrove (CDN del sito, per esempio).
 *
 * Prima del caricamento le dimensioni reali del file vengono lette in locale:
 * servono a impostare la larghezza del blocco e a evitare immagini enormi
 * ridotte via CSS, che nelle email pesano e basta.
 */

import { COLLECTIONS, LIMITS } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import {
  Check,
  Image as ImageIcon,
  Link2,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { callable } from '@/lib/firebase/client';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { toastError } from '@/lib/toast';
import { bytesToSize, cn } from '@/lib/utils';

import { fileNameFromUrl, isUsableUrl, normalizeUrl } from './utils';

// -----------------------------------------------------------------------------
// Tipi
// -----------------------------------------------------------------------------

/** Documento della collezione `mediaAssets`. */
export interface MediaAssetDoc {
  id: string;
  fileName: string;
  path: string;
  url: string;
  contentType: string;
  size: number;
  folder: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Risultato restituito al chiamante quando si conferma un'immagine. */
export interface MediaSelection {
  src: string;
  storagePath: string | null;
  width: number | null;
  height: number | null;
  alt: string;
}

/**
 * Risposta di `requestMediaUpload`. I nomi alternativi (`publicUrl`,
 * `storagePath`) sono accettati per non dipendere da una singola revisione
 * delle Functions.
 */
interface UploadTicket {
  assetId: string;
  uploadUrl: string;
  headers?: Record<string, string>;
  url?: string;
  path?: string;
  publicUrl?: string;
  storagePath?: string;
  expiresAt?: string;
}

export interface MediaPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: MediaSelection) => void;
  /** Immagine attualmente usata dal blocco, per pre-selezionarla. */
  currentSrc?: string | null;
  currentAlt?: string | null;
  /** Cartella logica di destinazione dei caricamenti. */
  folder?: string;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

/** Legge larghezza e altezza reali del file selezionato. */
function readImageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || file.type === 'image/svg+xml') {
      resolve({ width: null, height: null });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  });
}

/** Dimensioni di un'immagine remota, per il ramo "Da URL". */
function readRemoteSize(src: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ width: null, height: null });
      return;
    }
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve({ width: image.naturalWidth || null, height: image.naturalHeight || null });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = src;
  });
}

/** `PUT` del file sulla URL firmata, con avanzamento. */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url, true);
    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Caricamento non riuscito (codice ${request.status}).`));
    };
    request.onerror = () => reject(new Error('Caricamento interrotto: controlla la connessione.'));
    request.onabort = () => reject(new Error('Caricamento annullato.'));
    request.send(file);
  });
}

const requestUpload = callable<
  { fileName: string; contentType: string; size: number; folder?: string },
  UploadTicket
>('requestMediaUpload');

const deleteAsset = callable<{ assetId: string }, { deleted: boolean }>('deleteMediaAsset');

// -----------------------------------------------------------------------------
// Dialog
// -----------------------------------------------------------------------------

export function MediaPickerDialog({
  open,
  onOpenChange,
  onSelect,
  currentSrc,
  currentAlt,
  folder,
}: MediaPickerDialogProps) {
  const constraints = React.useMemo(() => [orderBy('createdAt', 'desc'), limitTo(150)], []);
  const { data: assets, loading, error } = useCollectionQuery<MediaAssetDoc>(
    COLLECTIONS.mediaAssets,
    constraints,
    { enabled: open },
  );

  const [tab, setTab] = React.useState<'libreria' | 'carica' | 'url'>('libreria');
  const [query, setQuery] = React.useState('');
  const [selection, setSelection] = React.useState<MediaSelection | null>(null);
  const [externalUrl, setExternalUrl] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [dragOver, setDragOver] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Riporta il dialog allo stato iniziale ogni volta che si apre.
  React.useEffect(() => {
    if (!open) return;
    setTab('libreria');
    setQuery('');
    setExternalUrl('');
    setProgress(0);
    setUploading(false);
    setSelection(
      currentSrc
        ? { src: currentSrc, storagePath: null, width: null, height: null, alt: currentAlt ?? '' }
        : null,
    );
  }, [open, currentSrc, currentAlt]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(
      (asset) =>
        asset.fileName.toLowerCase().includes(needle) ||
        (asset.alt ?? '').toLowerCase().includes(needle),
    );
  }, [assets, query]);

  const uploadFile = React.useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toastError(null, 'Formato non supportato: usa PNG, JPG, GIF, WebP o SVG.');
        return;
      }
      if (file.size > LIMITS.maxImageBytes) {
        toastError(
          null,
          `L’immagine supera il limite di ${Math.round(LIMITS.maxImageBytes / (1024 * 1024))} MB.`,
        );
        return;
      }

      setUploading(true);
      setProgress(0);
      // La callable crea il documento prima del caricamento: se la `PUT`
      // fallisce va rimosso, altrimenti la libreria mostra un'immagine rotta.
      let ticketId: string | null = null;
      try {
        const size = await readImageSize(file);
        const ticket = await requestUpload({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          folder,
        });
        ticketId = ticket.assetId;
        await putWithProgress(
          ticket.uploadUrl,
          file,
          ticket.headers ?? { 'Content-Type': file.type },
          setProgress,
        );
        ticketId = null;

        const src = ticket.url ?? ticket.publicUrl ?? '';
        if (!src) throw new Error('Il server non ha restituito l’indirizzo dell’immagine.');

        setSelection({
          src,
          storagePath: ticket.path ?? ticket.storagePath ?? null,
          width: size.width,
          height: size.height,
          alt: file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
        });
        setTab('libreria');
      } catch (uploadError) {
        toastError(uploadError, 'Caricamento dell’immagine non riuscito.');
        if (ticketId) {
          // Ripulitura di cortesia: un errore qui non aggiunge nulla per l'utente.
          await deleteAsset({ assetId: ticketId }).catch(() => undefined);
        }
      } finally {
        setUploading(false);
        setProgress(0);
      }
    },
    [folder],
  );

  const handleFiles = React.useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleRemoveAsset = React.useCallback(
    async (asset: MediaAssetDoc) => {
      setDeletingId(asset.id);
      try {
        await deleteAsset({ assetId: asset.id });
        setSelection((current) => (current?.src === asset.url ? null : current));
      } catch (deleteError) {
        toastError(deleteError, 'Impossibile eliminare l’immagine.');
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  const confirmExternal = React.useCallback(async () => {
    const normalized = normalizeUrl(externalUrl);
    if (!isUsableUrl(normalized)) {
      toastError(null, 'Inserisci un indirizzo http(s) valido.');
      return;
    }
    const size = await readRemoteSize(normalized);
    setSelection({
      src: normalized,
      storagePath: null,
      width: size.width,
      height: size.height,
      alt: fileNameFromUrl(normalized).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '),
    });
    setTab('libreria');
  }, [externalUrl]);

  const confirm = () => {
    if (!selection?.src) return;
    onSelect({ ...selection, alt: selection.alt.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[92vh] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Libreria immagini</DialogTitle>
          <DialogDescription>
            Scegli un’immagine già caricata, caricane una nuova o incolla l’indirizzo di
            un’immagine ospitata altrove.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <TabsList>
              <TabsTrigger value="libreria">
                <ImageIcon aria-hidden="true" />
                Libreria
              </TabsTrigger>
              <TabsTrigger value="carica">
                <Upload aria-hidden="true" />
                Carica
              </TabsTrigger>
              <TabsTrigger value="url">
                <Link2 aria-hidden="true" />
                Da URL
              </TabsTrigger>
            </TabsList>

            {tab === 'libreria' ? (
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cerca per nome…"
                aria-label="Cerca nella libreria"
                startIcon={<Search />}
                className="h-9 w-full sm:w-64"
              />
            ) : null}
          </div>

          {/* Libreria ---------------------------------------------------- */}
          <TabsContent value="libreria" className="mt-0">
            <ScrollArea className="h-[46vh] min-h-[280px]">
              <div className="p-5">
                {loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <Skeleton key={index} className="aspect-[4/3] w-full rounded-lg" />
                    ))}
                  </div>
                ) : error ? (
                  <EmptyState
                    icon={<X />}
                    title="Libreria non disponibile"
                    description={error.message}
                  />
                ) : filtered.length === 0 ? (
                  <EmptyState
                    icon={<ImageIcon />}
                    title={query ? 'Nessuna immagine trovata' : 'La libreria è vuota'}
                    description={
                      query
                        ? 'Prova con un altro nome oppure carica una nuova immagine.'
                        : 'Carica la prima immagine: resterà disponibile per tutte le newsletter.'
                    }
                    action={
                      <Button type="button" onClick={() => setTab('carica')}>
                        <Upload aria-hidden="true" />
                        Carica un’immagine
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {filtered.map((asset) => {
                      const active = selection?.src === asset.url;
                      return (
                        <div key={asset.id} className="group relative">
                          <button
                            type="button"
                            onClick={() =>
                              setSelection({
                                src: asset.url,
                                storagePath: asset.path ?? null,
                                width: asset.width ?? null,
                                height: asset.height ?? null,
                                alt: asset.alt ?? asset.fileName.replace(/\.[^.]+$/, ''),
                              })
                            }
                            onDoubleClick={() => {
                              setSelection({
                                src: asset.url,
                                storagePath: asset.path ?? null,
                                width: asset.width ?? null,
                                height: asset.height ?? null,
                                alt: asset.alt ?? asset.fileName.replace(/\.[^.]+$/, ''),
                              });
                            }}
                            aria-pressed={active}
                            className={cn(
                              'flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-all',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                              active
                                ? 'border-primary ring-2 ring-primary/30'
                                : 'border-border hover:border-primary/50 hover:shadow-card',
                            )}
                          >
                            <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={asset.url}
                                alt={asset.alt ?? asset.fileName}
                                loading="lazy"
                                className="size-full object-contain"
                              />
                              {active ? (
                                <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft">
                                  <Check className="size-3.5" aria-hidden="true" />
                                </span>
                              ) : null}
                            </span>
                            <span className="flex flex-col gap-0.5 px-2.5 py-2">
                              <span className="truncate text-xs font-medium text-foreground">
                                {asset.fileName}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {asset.width && asset.height
                                  ? `${asset.width}×${asset.height} · ${bytesToSize(asset.size)}`
                                  : bytesToSize(asset.size)}
                              </span>
                            </span>
                          </button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Elimina ${asset.fileName}`}
                            loading={deletingId === asset.id}
                            onClick={() => void handleRemoveAsset(asset)}
                            className="absolute left-1.5 top-1.5 size-7 bg-card/90 opacity-0 shadow-soft transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Caricamento ------------------------------------------------- */}
          <TabsContent value="carica" className="mt-0">
            <div className="p-5">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  handleFiles(event.dataTransfer.files);
                }}
                className={cn(
                  'flex h-[42vh] min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
                  dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/40',
                )}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">Caricamento in corso…</p>
                    <Progress value={progress} className="w-64" />
                    <p className="text-xs text-muted-foreground">{progress}%</p>
                  </>
                ) : (
                  <>
                    <span className="flex size-12 items-center justify-center rounded-full bg-card text-muted-foreground shadow-soft">
                      <Upload className="size-5" aria-hidden="true" />
                    </span>
                    <p className="text-sm font-medium text-foreground">
                      Trascina qui un’immagine
                    </p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      PNG, JPG, GIF, WebP o SVG fino a{' '}
                      {Math.round(LIMITS.maxImageBytes / (1024 * 1024))} MB. Per le email la
                      larghezza consigliata è 600&nbsp;px (1200&nbsp;px per gli schermi retina).
                    </p>
                    <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                      Scegli un file
                    </Button>
                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPT_ATTRIBUTE}
                      className="hidden"
                      onChange={(event) => {
                        handleFiles(event.target.files);
                        event.target.value = '';
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Da URL ------------------------------------------------------ */}
          <TabsContent value="url" className="mt-0">
            <div className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="media-url">Indirizzo dell’immagine</Label>
                <Input
                  id="media-url"
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void confirmExternal();
                    }
                  }}
                  placeholder="https://alphaink.net/immagini/promo.jpg"
                  startIcon={<Link2 />}
                />
                <p className="text-xs text-muted-foreground">
                  L’immagine deve restare raggiungibile pubblicamente: i client di posta la scaricano
                  ogni volta che l’email viene aperta.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => void confirmExternal()}>
                Usa questo indirizzo
              </Button>

              {selection?.src && !selection.storagePath ? (
                <div className="overflow-hidden rounded-lg border border-border bg-muted/40 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selection.src}
                    alt={selection.alt || 'Anteprima'}
                    className="mx-auto max-h-48 object-contain"
                  />
                </div>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-stretch gap-3 border-t border-border p-5 sm:items-end sm:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="media-alt">Testo alternativo</Label>
              <Input
                id="media-alt"
                value={selection?.alt ?? ''}
                disabled={!selection}
                onChange={(event) =>
                  setSelection((current) =>
                    current ? { ...current, alt: event.target.value } : current,
                  )
                }
                placeholder="Descrivi l’immagine per chi non la vede"
              />
            </div>
            <div className="space-y-1.5 sm:w-32">
              <Label htmlFor="media-width">Larghezza (px)</Label>
              <Input
                id="media-width"
                type="number"
                min={16}
                max={2400}
                value={selection?.width ?? ''}
                disabled={!selection}
                onChange={(event) =>
                  setSelection((current) =>
                    current
                      ? {
                          ...current,
                          width: event.target.value ? Number(event.target.value) : null,
                        }
                      : current,
                  )
                }
                placeholder="auto"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="button" onClick={confirm} disabled={!selection?.src}>
              <Check aria-hidden="true" />
              Usa immagine
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
