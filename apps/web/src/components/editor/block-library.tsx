'use client';

/**
 * Palette laterale dell'editor.
 *
 * Tre modi per costruire l'email, in ordine di libertà crescente:
 *  - **Blocchi** — mattoncini singoli, trascinabili nel punto esatto del canvas
 *    (o inseribili con un clic dopo l'elemento selezionato);
 *  - **Layout** — preset di colonne che creano una nuova sezione;
 *  - **Sezioni pronte** — composizioni complete (copertina, prodotto, coupon…)
 *    da personalizzare invece che da costruire.
 */

import { BLOCK_LABELS, COLUMN_PRESETS } from '@alphaink/shared';
import type { BlockType, EmailSection } from '@alphaink/shared';
import { useDraggable } from '@dnd-kit/core';
import {
  Blocks,
  Braces,
  Code2,
  Columns2,
  Columns3,
  Columns4,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  MailX,
  Menu as MenuIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Package,
  PanelBottom,
  Rows3,
  Share2,
  TicketPercent,
  Timer,
  Type,
  Video,
} from 'lucide-react';
import * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { PRESET_SECTIONS, createBlock, createSection } from './block-factory';
import type { BlockTarget } from './editor-store';
import { findBlock, useEditor } from './editor-store';
import { spansLabel } from './utils';

// -----------------------------------------------------------------------------
// Catalogo
// -----------------------------------------------------------------------------

export const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  heading: <Type />,
  text: <Rows3 />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
  video: <Video />,
  social: <Share2 />,
  product: <Package />,
  product_grid: <LayoutGrid />,
  coupon: <TicketPercent />,
  countdown: <Timer />,
  divider: <Minus />,
  spacer: <MoveVertical />,
  menu: <MenuIcon />,
  footer: <PanelBottom />,
  unsubscribe: <MailX />,
  html: <Code2 />,
};

export interface BlockGroup {
  id: string;
  label: string;
  types: BlockType[];
}

/** Raggruppamento della palette, pensato per l'ordine d'uso reale. */
export const BLOCK_GROUPS: BlockGroup[] = [
  { id: 'contenuto', label: 'Contenuto', types: ['heading', 'text', 'image', 'button', 'video', 'social'] },
  { id: 'commercio', label: 'Commercio', types: ['product', 'product_grid', 'coupon', 'countdown'] },
  { id: 'struttura', label: 'Struttura', types: ['divider', 'spacer', 'menu', 'footer', 'unsubscribe'] },
  { id: 'avanzato', label: 'Avanzato', types: ['html'] },
];

/** Descrizione breve mostrata nel suggerimento di ogni blocco. */
export const BLOCK_HINTS: Record<BlockType, string> = {
  heading: 'Titolo di sezione, con livello e tipografia dedicati.',
  text: 'Paragrafo modificabile sul canvas, con grassetto, link e merge tag.',
  image: 'Immagine dalla libreria o da un indirizzo esterno.',
  button: 'Invito all’azione ben visibile, compatibile con Outlook.',
  video: 'Miniatura cliccabile che porta al video: le email non lo riproducono.',
  social: 'Collegamenti ai profili social dell’azienda.',
  product: 'Scheda prodotto con immagine, prezzo e pulsante d’acquisto.',
  product_grid: 'Due o tre prodotti affiancati, anche scelti in automatico.',
  coupon: 'Codice sconto in evidenza, fisso o generato per destinatario.',
  countdown: 'Giorni e ore mancanti alla scadenza, calcolati all’invio.',
  divider: 'Linea di separazione fra due contenuti.',
  spacer: 'Spazio verticale controllato.',
  menu: 'Menu di navigazione con le categorie principali.',
  footer: 'Dati aziendali richiesti dalla normativa.',
  unsubscribe: 'Link di disiscrizione e preferenze: obbligatorio.',
  html: 'Markup personalizzato, ripulito dai tag non sicuri.',
};

const PRESET_ICONS: Record<number, React.ReactNode> = {
  1: <Rows3 />,
  2: <Columns2 />,
  3: <Columns3 />,
  4: <Columns4 />,
};

/** Identificatore dnd-kit di un elemento trascinabile dalla palette. */
export const LIBRARY_DRAG_PREFIX = 'libreria:';

export interface LibraryDragData {
  kind: 'library';
  blockType: BlockType;
}

// -----------------------------------------------------------------------------
// Elementi trascinabili
// -----------------------------------------------------------------------------

interface BlockCardProps {
  blockType: BlockType;
  onInsert: (blockType: BlockType) => void;
}

function BlockCard({ blockType, onInsert }: BlockCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${LIBRARY_DRAG_PREFIX}${blockType}`,
    data: { kind: 'library', blockType } satisfies LibraryDragData,
  });

  return (
    <SimpleTooltip content={BLOCK_HINTS[blockType]} side="right">
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => onInsert(blockType)}
        {...listeners}
        {...attributes}
        className={cn(
          'flex cursor-grab flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2 py-3 text-center transition-all',
          'hover:-translate-y-px hover:border-primary/50 hover:shadow-card active:cursor-grabbing',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isDragging && 'opacity-40',
        )}
      >
        <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
          {BLOCK_ICONS[blockType]}
        </span>
        <span className="text-[11px] font-medium leading-tight text-foreground">
          {BLOCK_LABELS[blockType]}
        </span>
      </button>
    </SimpleTooltip>
  );
}

/** Miniatura schematica di una sezione pronta. */
function PresetPreview({ layout }: { layout: Array<{ rows: string[] }> }) {
  return (
    <span className="flex w-full gap-1 rounded-md bg-muted/70 p-1.5">
      {layout.map((column, columnIndex) => (
        <span key={columnIndex} className="flex flex-1 flex-col gap-1">
          {column.rows.map((row, rowIndex) => (
            <span
              key={rowIndex}
              className={cn(
                'block rounded-sm',
                row === 'image' && 'h-5 bg-slate-300',
                row === 'title' && 'h-2 bg-slate-400',
                row === 'text' && 'h-1.5 bg-slate-300',
                row === 'button' && 'mx-auto h-2.5 w-2/3 rounded bg-sky-400',
                row === 'chip' && 'mx-auto h-3 w-3/4 rounded bg-fuchsia-300',
                row === 'line' && 'h-px bg-slate-300',
              )}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Pannello
// -----------------------------------------------------------------------------

export interface BlockLibraryProps {
  className?: string;
}

export function BlockLibrary({ className }: BlockLibraryProps) {
  const { state, actions } = useEditor();

  /**
   * Punto di inserimento per il clic (il trascinamento sceglie da sé):
   * subito dopo il blocco selezionato, altrimenti in fondo alla sezione
   * selezionata, altrimenti in fondo al documento.
   */
  const insertTarget = React.useCallback((): BlockTarget | null => {
    const { document: doc, selection } = state;
    if (selection.kind === 'block') {
      const found = findBlock(doc, selection.blockId);
      if (found) {
        return {
          sectionId: found.location.sectionId,
          columnId: found.location.columnId,
          index: found.location.index + 1,
        };
      }
    }
    const section =
      (selection.sectionId ? doc.sections.find((item) => item.id === selection.sectionId) : null) ??
      doc.sections[doc.sections.length - 1];
    const column = section?.columns[0];
    if (!section || !column) return null;
    return { sectionId: section.id, columnId: column.id, index: null };
  }, [state]);

  const handleInsertBlock = React.useCallback(
    (blockType: BlockType) => {
      const target = insertTarget();
      if (target) {
        actions.addBlock(blockType, target, createBlock(blockType));
        return;
      }
      // Documento senza sezioni utilizzabili: se ne crea una attorno al blocco.
      actions.addSection(null, createSection({ spans: [12], blocks: [[createBlock(blockType)]] }));
    },
    [actions, insertTarget],
  );

  const handleAddLayout = React.useCallback(
    (spans: number[]) => {
      const index = state.selection.sectionId
        ? state.document.sections.findIndex((section) => section.id === state.selection.sectionId) + 1
        : null;
      actions.addSection(index, createSection({ spans }));
    },
    [actions, state.document.sections, state.selection.sectionId],
  );

  const handleAddPreset = React.useCallback(
    (build: () => EmailSection) => {
      const index = state.selection.sectionId
        ? state.document.sections.findIndex((section) => section.id === state.selection.sectionId) + 1
        : null;
      actions.addSection(index, build());
    },
    [actions, state.document.sections, state.selection.sectionId],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-card', className)}>
      <Tabs defaultValue="blocchi" className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="blocchi" className="flex-1">
              <Blocks aria-hidden="true" />
              Blocchi
            </TabsTrigger>
            <TabsTrigger value="sezioni" className="flex-1">
              <LayoutTemplate aria-hidden="true" />
              Sezioni
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="blocchi" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-3">
              {BLOCK_GROUPS.map((group) => (
                <section key={group.id}>
                  <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {group.types.map((blockType) => (
                      <BlockCard key={blockType} blockType={blockType} onInsert={handleInsertBlock} />
                    ))}
                  </div>
                </section>
              ))}

              <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                <Braces className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Trascina un blocco nel punto desiderato oppure fai clic per inserirlo dopo
                  l’elemento selezionato.
                </span>
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="sezioni" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-5 p-3">
              <section>
                <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Layout a colonne
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {COLUMN_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleAddLayout(preset.spans)}
                      className={cn(
                        'flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-2.5 text-left transition-all',
                        'hover:-translate-y-px hover:border-primary/50 hover:shadow-card',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      )}
                    >
                      <span className="flex w-full gap-1">
                        {preset.spans.map((span, index) => (
                          <span
                            key={index}
                            className="h-6 rounded-sm bg-muted"
                            style={{ flexGrow: span, flexBasis: 0 }}
                          />
                        ))}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
                        {PRESET_ICONS[preset.spans.length] ?? <Rows3 />}
                        {preset.label}
                        <span className="text-muted-foreground">· {spansLabel(preset.spans)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Sezioni pronte
                </h3>
                <div className="space-y-2">
                  {PRESET_SECTIONS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleAddPreset(preset.build)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border border-border bg-card p-2.5 text-left transition-all',
                        'hover:-translate-y-px hover:border-primary/50 hover:shadow-card',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      )}
                    >
                      <span className="w-16 shrink-0">
                        <PresetPreview layout={preset.layout} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">
                          {preset.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {preset.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
