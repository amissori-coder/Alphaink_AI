'use client';

/**
 * Libreria media.
 *
 * Griglia dei file caricati su Cloud Storage con ricerca, filtro per cartella,
 * caricamento multiplo con trascinamento e avanzamento reale, scheda di
 * dettaglio, copia dell'indirizzo ed eliminazione con conferma.
 *
 * Il caricamento avviene in due passi: la callable `requestMediaUpload` crea il
 * documento e restituisce una signed URL, poi il browser esegue la `PUT`
 * direttamente su Storage. Se la `PUT` fallisce il documento appena creato
 * viene rimosso, altrimenti la libreria mostrerebbe un'immagine rotta.
 */

import { COLLECTIONS } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import {
  AlertCircle,
  Check,
  Copy,
  FolderOpen,
  Images,
  Info,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as React from 'react';

import type { MediaAssetDoc } from '@/components/editor/media-picker';
import { useUsersList } from '@/components/settings/use-settings';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { toastError, toastSuccess } from '@/lib/toast';
import { bytesToSize, cn, formatDateIt, formatNumber } from '@/lib/utils';

import { AssetDetailsDialog } from './asset-details-dialog';
import {
  ACCEPT_ATTRIBUTE,
  DEFAULT_FOLDERS,
  MAX_UPLOAD_BYTES,
  deleteMediaAsset,
  fileExtension,
  putWithProgress,
  requestMediaUpload,
  validateFile,
} from './upload';

/** Numero massimo di file letti in una sola sottoscrizione. */
const ASSETS_LIMIT = 300;

/**
 * Documento della collezione `mediaAssets` con i campi di audit.
 * `MediaAssetDoc` (usato dall'editor) descrive solo ciò che serve a scegliere
 * un'immagine: qui interessa anche sapere chi l'ha caricata.
 */
interface MediaAssetRow extends MediaAssetDoc {
  createdBy?: string | null;
  updatedBy?: string | null;
}

type SortMode = 'recenti' | 'nome' | 'peso';

interface UploadTask {
  id: string;
  fileName: string;
  size: number;
  progress: number;
  status: 'in-attesa' | 'in-corso' | 'completato' | 'errore';
  error?: string;
}

export function MediaLibrary() {
  const { can, appUser, role } = useAuth();
  const canWrite = can('media:write');
  const canDelete = role === 'admin' || role === 'owner';

  const constraints = React.useMemo(
    () => [orderBy('createdAt', 'desc'), limitTo(ASSETS_LIMIT)],
    [],
  );
  const { data: assets, loading, error } = useCollectionQuery<MediaAssetRow>(
    COLLECTIONS.mediaAssets,
    constraints,
    { key: 'libreria-media' },
  );

  // I nomi di chi ha caricato sono leggibili solo da amministratori e proprietari.
  const { users } = useUsersList(role === 'admin' || role === 'owner');
  const userNames = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) map.set(user.id, user.displayName || user.email);
    return map;
  }, [users]);

  const [query, setQuery] = React.useState('');
  const [folder, setFolder] = React.useState('tutte');
  const [sort, setSort] = React.useState<SortMode>('recenti');
  const [uploadFolder, setUploadFolder] = React.useState('media');
  const [dragOver, setDragOver] = React.useState(false);
  const [tasks, setTasks] = React.useState<UploadTask[]>([]);
  const [selected, setSelected] = React.useState<MediaAssetRow | null>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<MediaAssetRow | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dragCounter = React.useRef(0);
  /** Funzioni di annullamento delle `PUT` ancora in volo, per attività. */
  const abortsRef = React.useRef(new Map<string, () => void>());

  React.useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  /** Cartelle esistenti più quelle proposte, senza duplicati. */
  const folders = React.useMemo(() => {
    const found = new Set<string>(DEFAULT_FOLDERS);
    for (const asset of assets) if (asset.folder) found.add(asset.folder);
    return Array.from(found).sort((a, b) => a.localeCompare(b, 'it'));
  }, [assets]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = assets.filter((asset) => {
      if (folder !== 'tutte' && (asset.folder || 'media') !== folder) return false;
      if (!needle) return true;
      return (
        asset.fileName.toLowerCase().includes(needle) ||
        (asset.alt ?? '').toLowerCase().includes(needle) ||
        (asset.folder ?? '').toLowerCase().includes(needle)
      );
    });

    return rows.sort((a, b) => {
      if (sort === 'nome') return a.fileName.localeCompare(b.fileName, 'it');
      if (sort === 'peso') return (b.size ?? 0) - (a.size ?? 0);
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [assets, folder, query, sort]);

  const totalBytes = React.useMemo(
    () => assets.reduce((total, asset) => total + (asset.size ?? 0), 0),
    [assets],
  );

  const updateTask = React.useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }, []);

  /** Carica un singolo file: ticket, PUT con avanzamento, pulizia in caso d'errore. */
  const uploadOne = React.useCallback(
    async (file: File, taskId: string) => {
      updateTask(taskId, { status: 'in-corso' });
      const invalid = validateFile(file);
      if (invalid) {
        updateTask(taskId, { status: 'errore', error: invalid, progress: 0 });
        return false;
      }

      let createdAssetId: string | null = null;
      try {
        const ticket = await requestMediaUpload({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          folder: uploadFolder,
        });
        createdAssetId = ticket.assetId;

        await putWithProgress(
          ticket.uploadUrl,
          file,
          ticket.headers ?? { 'Content-Type': file.type },
          (percent) => updateTask(taskId, { progress: percent }),
          (abort) => abortsRef.current.set(taskId, abort),
        );

        createdAssetId = null;
        updateTask(taskId, { status: 'completato', progress: 100 });
        return true;
      } catch (uploadError) {
        updateTask(taskId, {
          status: 'errore',
          error: uploadError instanceof Error ? uploadError.message : 'Caricamento non riuscito.',
        });
        if (createdAssetId) {
          // Pulitura di cortesia: senza file caricato il documento è inutile.
          await deleteMediaAsset({ assetId: createdAssetId }).catch(() => undefined);
        }
        return false;
      } finally {
        abortsRef.current.delete(taskId);
      }
    },
    [updateTask, uploadFolder],
  );

  const handleFiles = React.useCallback(
    async (fileList: FileList | File[] | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;
      if (!canWrite) {
        toastError(null, 'Non hai i permessi per caricare file.');
        return;
      }

      const created: UploadTask[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        size: file.size,
        progress: 0,
        status: 'in-attesa',
      }));
      setTasks((current) => [...created, ...current]);

      let done = 0;
      // Caricamento in sequenza: l'avanzamento resta leggibile e non si satura
      // la banda in upload con più file grandi insieme.
      for (const [index, file] of files.entries()) {
        const task = created[index];
        if (!task) continue;
        const ok = await uploadOne(file, task.id);
        if (ok) done += 1;
      }

      if (done > 0) {
        toastSuccess(
          done === 1 ? 'File caricato.' : `${formatNumber(done)} file caricati.`,
          'Sono già disponibili nell’editor delle newsletter.',
        );
      }
    },
    [canWrite, uploadOne],
  );

  const handleDelete = React.useCallback(async (asset: MediaAssetRow) => {
    setDeletingId(asset.id);
    try {
      await deleteMediaAsset({ assetId: asset.id });
      toastSuccess('File eliminato.');
      setDetailsOpen(false);
      setSelected(null);
    } catch (deleteError) {
      toastError(deleteError, 'Impossibile eliminare il file.');
      throw deleteError;
    } finally {
      setDeletingId(null);
    }
  }, []);

  const copyUrl = React.useCallback(async (asset: MediaAssetRow) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
    } catch {
      toastError(null, 'Copia non riuscita: apri i dettagli e seleziona l’indirizzo.');
    }
  }, []);

  // --- Trascinamento -------------------------------------------------------
  const onDragEnter = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current += 1;
    if (event.dataTransfer?.types?.includes('Files')) setDragOver(true);
  };
  const onDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setDragOver(false);
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    void handleFiles(event.dataTransfer?.files ?? null);
  };

  const activeTasks = tasks.filter(
    (task) => task.status === 'in-corso' || task.status === 'in-attesa',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media"
        description="Immagini e file usati nei contenuti delle email AlphaInk."
        eyebrow="Analisi e risorse"
        actions={
          <>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {formatNumber(assets.length)} file · {bytesToSize(totalBytes)}
            </span>
            <Button onClick={() => inputRef.current?.click()} disabled={!canWrite}>
              <Upload aria-hidden="true" />
              Carica file
            </Button>
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files);
          // Permette di ricaricare lo stesso file una seconda volta.
          event.target.value = '';
        }}
      />

      {/* --- Barra strumenti ------------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1">
          <Label htmlFor="media-ricerca" className="text-xs text-muted-foreground">
            Cerca
          </Label>
          <Input
            id="media-ricerca"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome del file, testo alternativo, cartella…"
            startIcon={<Search className="size-4" />}
          />
        </div>

        <div className="w-44 space-y-1">
          <Label htmlFor="media-cartella" className="text-xs text-muted-foreground">
            Cartella
          </Label>
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger id="media-cartella">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutte">Tutte le cartelle</SelectItem>
              {folders.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-40 space-y-1">
          <Label htmlFor="media-ordine" className="text-xs text-muted-foreground">
            Ordina per
          </Label>
          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger id="media-ordine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recenti">Più recenti</SelectItem>
              <SelectItem value="nome">Nome</SelectItem>
              <SelectItem value="peso">Peso</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-44 space-y-1">
          <Label htmlFor="media-destinazione" className="text-xs text-muted-foreground">
            Cartella di destinazione
          </Label>
          <Select value={uploadFolder} onValueChange={setUploadFolder} disabled={!canWrite}>
            <SelectTrigger id="media-destinazione">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {folders.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!canWrite ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Sola lettura</AlertTitle>
          <AlertDescription>
            Puoi consultare la libreria ma non caricare o eliminare file: serve il permesso di
            redattore.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Impossibile caricare la libreria</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* --- Coda di caricamento -------------------------------------------- */}
      {tasks.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Caricamenti{activeTasks.length > 0 ? ` (${activeTasks.length} in corso)` : ''}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTasks((current) =>
                  current.filter(
                    (task) => task.status === 'in-corso' || task.status === 'in-attesa',
                  ),
                )
              }
              disabled={activeTasks.length === tasks.length}
            >
              <X aria-hidden="true" />
              Pulisci elenco
            </Button>
          </div>
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-foreground" title={task.fileName}>
                    {task.fileName}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{bytesToSize(task.size)}</span>
                  {task.status === 'in-corso' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      onClick={() => abortsRef.current.get(task.id)?.()}
                      aria-label={`Annulla il caricamento di ${task.fileName}`}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  ) : null}
                  <span
                    className={cn(
                      'shrink-0 font-medium',
                      task.status === 'errore' && 'text-destructive',
                      task.status === 'completato' && 'text-success',
                      (task.status === 'in-corso' || task.status === 'in-attesa') &&
                        'text-muted-foreground',
                    )}
                  >
                    {task.status === 'in-attesa'
                      ? 'In attesa'
                      : task.status === 'in-corso'
                        ? `${task.progress}%`
                        : task.status === 'completato'
                          ? 'Completato'
                          : 'Errore'}
                  </span>
                </div>
                <Progress
                  value={task.status === 'errore' ? 100 : task.progress}
                  size="sm"
                  tone={
                    task.status === 'errore'
                      ? 'destructive'
                      : task.status === 'completato'
                        ? 'success'
                        : 'primary'
                  }
                  aria-label={`Avanzamento del caricamento di ${task.fileName}`}
                />
                {task.error ? <p className="text-xs text-destructive">{task.error}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* --- Griglia con zona di trascinamento ------------------------------- */}
      <div
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'relative rounded-lg border border-dashed border-transparent transition-colors',
          dragOver && canWrite && 'border-primary bg-primary/5',
        )}
      >
        {dragOver && canWrite ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80">
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Upload className="size-4" aria-hidden="true" />
              Rilascia i file per caricarli in «{uploadFolder}»
            </p>
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-52 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Images />}
            title={assets.length === 0 ? 'Libreria vuota' : 'Nessun file corrisponde ai filtri'}
            description={
              assets.length === 0
                ? `Trascina qui le immagini oppure usa «Carica file». Formati accettati: PNG, JPG, GIF, WebP e SVG fino a ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`
                : 'Prova a cambiare la ricerca o a scegliere un’altra cartella.'
            }
            action={
              assets.length === 0 && canWrite ? (
                <Button onClick={() => inputRef.current?.click()}>
                  <Upload aria-hidden="true" />
                  Carica il primo file
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setFolder('tutte');
                  }}
                >
                  <FolderOpen aria-hidden="true" />
                  Azzera i filtri
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((asset) => (
              <li key={asset.id}>
                <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card transition-colors hover:border-primary/40">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(asset);
                      setDetailsOpen(true);
                    }}
                    className="relative flex h-36 items-center justify-center overflow-hidden bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Apri i dettagli di ${asset.fileName}`}
                  >
                    <img
                      src={asset.url}
                      alt={asset.alt ?? asset.fileName}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                    <Badge variant="outline" className="absolute left-2 top-2 bg-card/90 text-[10px]">
                      {fileExtension(asset.fileName, asset.contentType)}
                    </Badge>
                  </button>

                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="truncate text-sm font-medium text-foreground" title={asset.fileName}>
                      {asset.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                      {bytesToSize(asset.size)} · {formatDateIt(asset.createdAt)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {asset.folder || 'media'}
                      {asset.createdBy ? ` · ${userNames.get(asset.createdBy) ?? (asset.createdBy === appUser?.id ? 'tu' : 'utente')}` : ''}
                    </p>

                    <div className="mt-auto flex items-center gap-1 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => void copyUrl(asset)}
                      >
                        {copiedId === asset.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copiedId === asset.id ? 'Copiato' : 'Copia URL'}
                      </Button>
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(asset)}
                          disabled={deletingId === asset.id}
                          aria-label={`Elimina ${asset.fileName}`}
                        >
                          {deletingId === asset.id ? (
                            <Loader2 className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 aria-hidden="true" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>

      {assets.length >= ASSETS_LIMIT ? (
        <p className="text-xs text-muted-foreground">
          Sono mostrati i {formatNumber(ASSETS_LIMIT)} file più recenti: usa la ricerca per trovare i
          più vecchi.
        </p>
      ) : null}

      <AssetDetailsDialog
        asset={selected}
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setSelected(null);
        }}
        uploaderName={
          selected?.createdBy
            ? userNames.get(selected.createdBy) ??
              (selected.createdBy === appUser?.id ? appUser?.displayName || appUser?.email : null)
            : null
        }
        canDelete={canDelete}
        deleting={deletingId === selected?.id}
        onDelete={(asset) => setPendingDelete(asset)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Eliminare il file?"
        description={
          pendingDelete
            ? `«${pendingDelete.fileName}» verrà rimosso da Storage. Le email già inviate che lo usano mostreranno un’immagine mancante.`
            : undefined
        }
        confirmLabel="Elimina"
        destructive
        loading={deletingId !== null}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await handleDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
