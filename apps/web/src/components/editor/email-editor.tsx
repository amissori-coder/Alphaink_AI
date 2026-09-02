'use client';

/**
 * Editor di newsletter a blocchi.
 *
 * Mette insieme i quattro pezzi dell'interfaccia — barra superiore, palette dei
 * blocchi, canvas e pannello proprietà — e coordina il trascinamento con
 * @dnd-kit, le scorciatoie da tastiera e le finestre di anteprima, importazione
 * ed esportazione.
 *
 * Il documento resta di proprietà del chiamante: l'editor non salva nulla da
 * sé, notifica ogni modifica con `onChange` e chiede il salvataggio con
 * `onSaveRequested` quando si preme il pulsante "Salva".
 */

import { BLOCK_LABELS, slugify } from '@alphaink/shared';
import type { BlockType, EmailDocument } from '@alphaink/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Blocks, GripVertical, Settings2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { callable } from '@/lib/firebase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { BLOCK_ICONS, BlockLibrary } from './block-library';
import type { LibraryDragData } from './block-library';
import { createBlock, createSection } from './block-factory';
import { Canvas } from './canvas';
import type { BlockDragData, BlockSlotData, SectionSlotData } from './canvas';
import { EditorProvider, findBlock, useEditor } from './editor-store';
import { Inspector } from './inspector';
import { PreviewDialog } from './preview-dialog';
import { TemplatePickerDialog } from './template-picker';
import { EditorToolbar } from './toolbar';

// -----------------------------------------------------------------------------
// API pubblica
// -----------------------------------------------------------------------------

export interface EmailEditorProps {
  document: EmailDocument;
  onChange: (doc: EmailDocument) => void;
  onSaveRequested?: () => void;
  subject: string;
  preheader: string;
  onSubjectChange: (v: string) => void;
  onPreheaderChange: (v: string) => void;
  mergeTagContext?: Record<string, string>;
  className?: string;

  // --- Estensioni facoltative -----------------------------------------------
  /** Newsletter già salvata: abilita l'invio di prova e l'anteprima con dati reali. */
  newsletterId?: string | null;
  /** Nome della campagna, usato per il file HTML esportato. */
  newsletterName?: string | null;
  /** Apre il flusso di invio di prova del contenitore. */
  onSendTestRequested?: () => void;
  /** Mostra il pulsante "Salva" in stato di caricamento. */
  saving?: boolean;
}

// -----------------------------------------------------------------------------
// Scorciatoie da tastiera
// -----------------------------------------------------------------------------

/**
 * Rilevamento delle collisioni.
 *
 * Le zone di rilascio sono strisce sottili fra un blocco e l'altro: `pointerWithin`
 * dà la precisione necessaria quando il puntatore le tocca davvero, mentre
 * `closestCenter` evita che un rilascio a metà di un blocco finisca nel vuoto.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

/** Vero quando l'evento arriva da un campo di testo o da un blocco modificabile. */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Scorciatoie dell'editor: annulla, ripristina, elimina il blocco selezionato,
 * deseleziona.
 *
 * Il salvataggio con Ctrl/Cmd+S non è gestito qui: appartiene alla pagina che
 * ospita l'editor (è lei a conoscere lo stato del salvataggio) e intercettarlo
 * anche qui produrrebbe due richieste per ogni pressione.
 */
function useEditorShortcuts() {
  const { actions, state } = useEditor();
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const editable = isEditableTarget(event.target);

      // Dentro a un campo di testo annulla/ripristina appartengono al campo.
      if (meta && !editable && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (meta && !editable && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        actions.redo();
        return;
      }

      if (!editable && (event.key === 'Delete' || event.key === 'Backspace')) {
        const selection = stateRef.current.selection;
        if (selection.kind === 'block' && selection.blockId) {
          event.preventDefault();
          actions.removeBlock(selection.blockId);
        }
        return;
      }

      if (event.key === 'Escape' && !editable) {
        actions.clearSelection();
      }
    };

    window.document.addEventListener('keydown', handler);
    return () => window.document.removeEventListener('keydown', handler);
  }, [actions]);
}

// -----------------------------------------------------------------------------
// Esportazione HTML
// -----------------------------------------------------------------------------

interface ExportResult {
  html: string;
  subject: string;
}

const renderForExport = callable<
  {
    newsletterId?: string | null;
    document: EmailDocument;
    subject: string;
    preheader: string;
  },
  ExportResult
>('renderNewsletterPreview', { timeoutMs: 120_000 });

/** Scarica una stringa come file, senza dipendenze esterne. */
function downloadFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  // Il revoke immediato interromperebbe il download su alcuni browser.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -----------------------------------------------------------------------------
// Guscio dell'editor
// -----------------------------------------------------------------------------

type EditorShellProps = Omit<EmailEditorProps, 'document' | 'onChange' | 'mergeTagContext'>;

function EditorShell({
  subject,
  preheader,
  onSubjectChange,
  onPreheaderChange,
  className,
  newsletterId,
  newsletterName,
  onSendTestRequested,
  onSaveRequested,
  saving,
}: EditorShellProps) {
  const { state, actions } = useEditor();
  useEditorShortcuts();

  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [templatesOpen, setTemplatesOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [dragged, setDragged] = React.useState<{ label: string; type: BlockType } | null>(null);

  const sensors = useSensors(
    // Una piccola soglia distingue il clic (selezione) dal trascinamento.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as LibraryDragData | BlockDragData | undefined;
    if (!data) return;
    if (data.kind === 'library') {
      setDragged({ label: BLOCK_LABELS[data.blockType], type: data.blockType });
      return;
    }
    const found = findBlock(state.document, data.blockId);
    const type = (found?.block.content?.type ?? found?.block.type ?? 'text') as BlockType;
    setDragged({ label: BLOCK_LABELS[type] ?? 'Blocco', type });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragged(null);
    const { active, over } = event;
    if (!over) return;

    const source = active.data.current as LibraryDragData | BlockDragData | undefined;
    const target = over.data.current as BlockSlotData | SectionSlotData | undefined;
    if (!source || !target) return;

    if (target.kind === 'block-slot') {
      if (source.kind === 'library') {
        actions.addBlock(
          source.blockType,
          { sectionId: target.sectionId, columnId: target.columnId, index: target.index },
          createBlock(source.blockType),
        );
      } else {
        actions.moveBlock(source.blockId, {
          sectionId: target.sectionId,
          columnId: target.columnId,
          index: target.index,
        });
      }
      return;
    }

    if (target.kind === 'section-slot') {
      if (source.kind === 'library') {
        actions.addSection(
          target.index,
          createSection({ spans: [12], blocks: [[createBlock(source.blockType)]] }),
        );
        return;
      }
      // Blocco esistente: si crea la sezione e poi vi si sposta dentro il blocco.
      const section = createSection({ spans: [12] });
      const column = section.columns[0];
      if (!column) return;
      actions.addSection(target.index, section);
      actions.moveBlock(source.blockId, {
        sectionId: section.id,
        columnId: column.id,
        index: 0,
      });
    }
  };

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      const result = await renderForExport({
        newsletterId: newsletterId ?? null,
        document: state.document,
        subject,
        preheader,
      });
      const base = slugify(newsletterName || subject || 'newsletter') || 'newsletter';
      downloadFile(`${base}.html`, result.html, 'text/html;charset=utf-8');
      toastSuccess('HTML esportato.');
    } catch (error) {
      toastError(error, 'Esportazione dell’HTML non riuscita.');
    } finally {
      setExporting(false);
    }
  }, [newsletterId, newsletterName, preheader, state.document, subject]);

  const handleImportTemplate = React.useCallback(
    (document: EmailDocument, template: { name: string }) => {
      actions.replaceDocument(document);
      actions.clearSelection();
      toastSuccess(`Template «${template.name}» importato.`);
    },
    [actions],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background', className)}>
      <EditorToolbar
        subject={subject}
        preheader={preheader}
        onSubjectChange={onSubjectChange}
        onPreheaderChange={onPreheaderChange}
        onPreview={() => setPreviewOpen(true)}
        onExportHtml={() => void handleExport()}
        onImportTemplate={() => setTemplatesOpen(true)}
        onSendTest={onSendTestRequested}
        onSave={onSaveRequested}
        saving={saving}
        exporting={exporting}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragged(null)}
      >
        {/* Comandi dei pannelli sugli schermi stretti. */}
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Blocks aria-hidden="true" />
                Blocchi
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[19rem] p-0 sm:max-w-sm">
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle>Blocchi e sezioni</SheetTitle>
              </SheetHeader>
              <div className="h-[calc(100%-4.5rem)]">
                <BlockLibrary />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Settings2 aria-hidden="true" />
                Proprietà
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[21rem] p-0 sm:max-w-sm">
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle>Proprietà</SheetTitle>
              </SheetHeader>
              <div className="h-[calc(100%-4.5rem)]">
                <Inspector />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-60 shrink-0 overflow-hidden border-r border-border lg:block xl:w-64">
            <BlockLibrary />
          </aside>

          <main className="min-w-0 flex-1 overflow-hidden">
            <Canvas />
          </main>

          <aside className="hidden w-80 shrink-0 overflow-hidden border-l border-border lg:block">
            <Inspector />
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragged ? (
            <div className="pointer-events-none flex items-center gap-2 rounded-lg border border-primary/40 bg-card px-3 py-2 shadow-popover">
              <GripVertical className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="flex size-6 items-center justify-center rounded bg-muted text-muted-foreground [&_svg]:size-3.5">
                {BLOCK_ICONS[dragged.type]}
              </span>
              <span className="text-xs font-semibold text-foreground">{dragged.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <PreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        document={state.document}
        subject={subject}
        preheader={preheader}
        newsletterId={newsletterId ?? null}
      />

      <TemplatePickerDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onImport={handleImportTemplate}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Componente esportato
// -----------------------------------------------------------------------------

/**
 * Editor completo di una newsletter.
 *
 * ```tsx
 * <EmailEditor
 *   document={newsletter.document}
 *   onChange={setDocument}
 *   subject={subject}
 *   preheader={preheader}
 *   onSubjectChange={setSubject}
 *   onPreheaderChange={setPreheader}
 *   onSaveRequested={save}
 * />
 * ```
 */
export function EmailEditor({
  document: emailDocument,
  onChange,
  mergeTagContext,
  ...rest
}: EmailEditorProps) {
  return (
    <EditorProvider
      document={emailDocument}
      onChange={onChange}
      onSaveRequested={rest.onSaveRequested}
      mergeTagContext={mergeTagContext}
    >
      <EditorShell {...rest} />
    </EditorProvider>
  );
}
