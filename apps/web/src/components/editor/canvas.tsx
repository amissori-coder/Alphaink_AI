'use client';

/**
 * Area di lavoro dell'editor.
 *
 * Il canvas ricalca la struttura del renderer — sezione a tutta larghezza,
 * contenitore di `contentWidth`, colonne, blocchi — così ciò che si vede qui è
 * ciò che arriverà nella casella di posta. Le uniche differenze sono gli
 * strumenti di modifica: contorni di selezione, barre contestuali e zone di
 * rilascio, tutti elementi che non entrano mai nell'HTML dell'email.
 *
 * ## Nessun salto di layout durante il trascinamento
 * Le zone di rilascio fra un blocco e l'altro sono alte 16 px ma compensate da
 * un margine negativo equivalente: occupano zero spazio reale, quindi il
 * documento non "salta" quando inizia un trascinamento.
 */

import { BLOCK_LABELS } from '@alphaink/shared';
import type { EmailBlock, EmailColumn, EmailSection } from '@alphaink/shared';
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  EyeOff,
  GripVertical,
  Monitor,
  Plus,
  Settings2,
  Smartphone,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { createSection } from './block-factory';
import { BlockView } from './blocks';
import { useEditor } from './editor-store';
import { borderToCss, columnWidths, spacingToCss } from './utils';

// -----------------------------------------------------------------------------
// Identificatori dnd-kit
// -----------------------------------------------------------------------------

export const BLOCK_DRAG_PREFIX = 'blocco:';
export const BLOCK_SLOT_PREFIX = 'slot:';
export const SECTION_SLOT_PREFIX = 'sezione:';

export interface BlockDragData {
  kind: 'block';
  blockId: string;
  sectionId: string;
  columnId: string;
  index: number;
}

export interface BlockSlotData {
  kind: 'block-slot';
  sectionId: string;
  columnId: string;
  index: number;
}

export interface SectionSlotData {
  kind: 'section-slot';
  index: number;
}

/** Larghezza del canvas in anteprima mobile: iPhone SE/13 mini. */
export const MOBILE_WIDTH = 375;

/** Margine attorno al foglio, per far vedere il colore di sfondo del corpo. */
const PAGE_GUTTER = 32;

// -----------------------------------------------------------------------------
// Stili dell'editor (non finiscono mai nell'email)
// -----------------------------------------------------------------------------

const EDITOR_CSS = `
.email-canvas-sheet .ai-prose { outline: none; }
.email-canvas-sheet .ai-prose p { margin: 0; }
.email-canvas-sheet .ai-prose p + p { margin-top: 0.65em; }
.email-canvas-sheet .ai-prose ul,
.email-canvas-sheet .ai-prose ol { margin: 0.35em 0; padding-left: 1.35em; }
.email-canvas-sheet .ai-prose ul { list-style: disc; }
.email-canvas-sheet .ai-prose ol { list-style: decimal; }
.email-canvas-sheet .ai-prose li p { margin: 0; }
.email-canvas-sheet .ai-prose a { color: var(--ai-link-color, #0086BC); text-decoration: underline; }
.email-canvas-sheet .ai-heading { margin: 0; }
.email-canvas-sheet .ai-merge-tag {
  background-color: rgba(0, 174, 239, 0.16);
  color: #0075a3;
  border-radius: 4px;
  padding: 0 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.email-drop-slot { position: relative; height: 16px; margin: -8px 0; z-index: 5; }
.email-drop-slot > span {
  position: absolute;
  inset: 7px 0 auto;
  display: block;
  height: 2px;
  border-radius: 9999px;
  opacity: 0;
  transform: scaleX(0.6);
  transition: opacity 120ms ease, transform 120ms ease;
  background-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.18);
}
.email-drop-slot[data-over='true'] > span { opacity: 1; transform: scaleX(1); }
.email-drop-slot[data-active='true'] > span { opacity: 0.28; transform: scaleX(0.94); }
`;

function EditorStyles() {
  return <style>{EDITOR_CSS}</style>;
}

// -----------------------------------------------------------------------------
// Zone di rilascio
// -----------------------------------------------------------------------------

function BlockDropSlot({ sectionId, columnId, index }: BlockSlotData) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({
    id: `${BLOCK_SLOT_PREFIX}${sectionId}:${columnId}:${index}`,
    data: { kind: 'block-slot', sectionId, columnId, index } satisfies BlockSlotData,
  });

  return (
    <div
      ref={setNodeRef}
      className="email-drop-slot"
      data-active={active ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}

/**
 * Zona di rilascio fra due sezioni: rilasciando qui si crea una sezione nuova.
 * È posizionata in modo assoluto e alta zero nel flusso, così comparire durante
 * il trascinamento non sposta di un pixel il documento.
 */
function SectionDropSlot({ index }: SectionSlotData) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({
    id: `${SECTION_SLOT_PREFIX}${index}`,
    data: { kind: 'section-slot', index } satisfies SectionSlotData,
  });

  return (
    <div className="relative z-30 h-0">
      {active ? (
        <div ref={setNodeRef} className="absolute inset-x-8 -top-3 flex h-6 items-center">
          <span
            className={cn(
              'flex h-6 w-full items-center justify-center rounded-full border border-dashed text-[10px] font-semibold transition-all',
              isOver
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-primary/20 bg-transparent text-transparent',
            )}
          >
            Nuova sezione
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Colonna senza blocchi: area tratteggiata che accetta il rilascio. */
function EmptyColumnDrop({ sectionId, columnId }: { sectionId: string; columnId: string }) {
  const { active } = useDndContext();
  const { setNodeRef, isOver } = useDroppable({
    id: `${BLOCK_SLOT_PREFIX}${sectionId}:${columnId}:0`,
    data: { kind: 'block-slot', sectionId, columnId, index: 0 } satisfies BlockSlotData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[72px] items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center text-[11px] font-medium transition-colors',
        isOver
          ? 'border-primary bg-primary/10 text-primary'
          : active
            ? 'border-primary/40 bg-primary/5 text-primary/70'
            : 'border-slate-300 bg-slate-50/80 text-slate-400',
      )}
    >
      Trascina qui un blocco
    </div>
  );
}

// -----------------------------------------------------------------------------
// Barre contestuali
// -----------------------------------------------------------------------------

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Colora l'azione come distruttiva al passaggio del puntatore. */
  danger?: boolean;
}

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ label, onClick, disabled, danger, children, className, ...rest }, ref) => (
    <SimpleTooltip content={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-[5px] transition-colors [&_svg]:size-3.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-35',
          danger
            ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </SimpleTooltip>
  ),
);
ToolbarButton.displayName = 'ToolbarButton';

// -----------------------------------------------------------------------------
// Blocco
// -----------------------------------------------------------------------------

interface BlockShellProps {
  block: EmailBlock;
  section: EmailSection;
  column: EmailColumn;
  index: number;
  total: number;
  width: number;
}

function BlockShell({ block, section, column, index, total, width }: BlockShellProps) {
  const { state, actions } = useEditor();
  const selected = state.selection.kind === 'block' && state.selection.blockId === block.id;
  const hovered = state.hover.blockId === block.id;

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `${BLOCK_DRAG_PREFIX}${block.id}`,
    data: {
      kind: 'block',
      blockId: block.id,
      sectionId: section.id,
      columnId: column.id,
      index,
    } satisfies BlockDragData,
    disabled: block.locked,
  });

  const hiddenHere =
    (state.viewport === 'mobile' && block.style.hideOnMobile) ||
    (state.viewport === 'desktop' && block.style.hideOnDesktop);

  const border = block.style.border && block.style.border.style !== 'none' ? block.style.border : null;
  const innerWidth = Math.max(
    40,
    width - (block.style.padding?.left ?? 0) - (block.style.padding?.right ?? 0),
  );

  const move = (delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex > total - 1) return;
    actions.moveBlock(block.id, {
      sectionId: section.id,
      columnId: column.id,
      // Verso il basso l'indice tiene conto della rimozione preventiva.
      index: delta > 0 ? nextIndex + 1 : nextIndex,
    });
  };

  return (
    <div
      ref={setNodeRef}
      className="email-block"
      data-selected={selected ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      style={{
        padding: spacingToCss(block.style.padding),
        backgroundColor: block.style.backgroundColor ?? undefined,
        textAlign: block.style.align ?? undefined,
        border: borderToCss(border),
        borderRadius: border?.radius ? `${border.radius}px` : undefined,
        wordBreak: 'break-word',
        opacity: hiddenHere ? 0.45 : undefined,
      }}
      onMouseEnter={() => actions.setHover({ sectionId: section.id, blockId: block.id })}
      onMouseLeave={() => actions.setHover({ sectionId: section.id, blockId: null })}
      onClick={(event) => {
        event.stopPropagation();
        actions.selectBlock(block.id, section.id, column.id);
      }}
    >
      {selected || hovered ? (
        <div className="email-block-toolbar" onClick={(event) => event.stopPropagation()}>
          <span className="mr-0.5 hidden max-w-[8rem] truncate px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:inline">
            {BLOCK_LABELS[(block.content?.type ?? block.type) as keyof typeof BLOCK_LABELS] ?? block.type}
          </span>
          <ToolbarButton
            ref={setActivatorNodeRef}
            label="Trascina per spostare"
            disabled={block.locked}
            {...listeners}
            {...attributes}
          >
            <GripVertical />
          </ToolbarButton>
          <ToolbarButton label="Sposta su" disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp />
          </ToolbarButton>
          <ToolbarButton label="Sposta giù" disabled={index === total - 1} onClick={() => move(1)}>
            <ArrowDown />
          </ToolbarButton>
          <ToolbarButton label="Duplica" onClick={() => actions.duplicateBlock(block.id)}>
            <Copy />
          </ToolbarButton>
          <ToolbarButton
            label="Impostazioni"
            onClick={() => {
              actions.selectBlock(block.id, section.id, column.id);
              actions.setPanel('stile');
            }}
          >
            <Settings2 />
          </ToolbarButton>
          <ToolbarButton label="Elimina" danger onClick={() => actions.removeBlock(block.id)}>
            <Trash2 />
          </ToolbarButton>
        </div>
      ) : null}

      {hiddenHere ? (
        <span className="absolute left-1 top-1 z-10 inline-flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <EyeOff className="size-3" aria-hidden="true" />
          {state.viewport === 'mobile' ? 'Nascosto su mobile' : 'Nascosto su desktop'}
        </span>
      ) : null}

      <BlockView block={block} width={innerWidth} selected={selected} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Colonna
// -----------------------------------------------------------------------------

interface ColumnViewProps {
  section: EmailSection;
  column: EmailColumn;
  width: number;
}

function ColumnView({ section, column, width }: ColumnViewProps) {
  const innerWidth = Math.max(
    40,
    width - (column.padding?.left ?? 0) - (column.padding?.right ?? 0),
  );

  return (
    <div
      style={{
        backgroundColor: column.backgroundColor ?? undefined,
        padding: spacingToCss(column.padding),
      }}
    >
      {column.blocks.length === 0 ? (
        <EmptyColumnDrop sectionId={section.id} columnId={column.id} />
      ) : (
        <>
          <BlockDropSlot kind="block-slot" sectionId={section.id} columnId={column.id} index={0} />
          {column.blocks.map((block, index) => (
            <React.Fragment key={block.id}>
              <BlockShell
                block={block}
                section={section}
                column={column}
                index={index}
                total={column.blocks.length}
                width={innerWidth}
              />
              <BlockDropSlot
                kind="block-slot"
                sectionId={section.id}
                columnId={column.id}
                index={index + 1}
              />
            </React.Fragment>
          ))}
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sezione
// -----------------------------------------------------------------------------

interface SectionViewProps {
  section: EmailSection;
  index: number;
  total: number;
  contentWidth: number;
}

function SectionView({ section, index, total, contentWidth }: SectionViewProps) {
  const { state, actions } = useEditor();
  const gs = state.document.globalStyles;
  const selected = state.selection.kind === 'section' && state.selection.sectionId === section.id;
  // Gli strumenti della sezione lasciano il passo a quelli del blocco: due barre
  // sovrapposte nello stesso angolo sarebbero solo confusione.
  const active = selected || (state.hover.sectionId === section.id && !state.hover.blockId);

  const innerWidth = Math.max(
    120,
    contentWidth - (section.padding?.left ?? 0) - (section.padding?.right ?? 0),
  );
  const widths = columnWidths(section, innerWidth);
  const border = section.border && section.border.style !== 'none' ? section.border : null;

  const stacked = state.viewport === 'mobile' && section.stackOnMobile !== false;
  const columns =
    stacked && section.reverseOnMobile && section.columns.length === 2
      ? [...section.columns].reverse()
      : section.columns;

  const backgroundImage = section.backgroundImage?.src
    ? {
        backgroundImage: `url('${section.backgroundImage.src}')`,
        backgroundSize: section.backgroundImage.size,
        backgroundRepeat: section.backgroundImage.repeat ? 'repeat' : 'no-repeat',
        backgroundPosition: 'center center',
      }
    : {};

  return (
    <div
      className="group/section relative"
      onMouseEnter={() => actions.setHover({ sectionId: section.id, blockId: state.hover.blockId })}
      onMouseLeave={() => actions.setHover({ sectionId: null, blockId: null })}
      style={{ backgroundColor: section.fullWidthBackgroundColor ?? gs.backgroundColor }}
    >
      {/* Contorno di selezione della sezione, fuori dal flusso per non spostare nulla. */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-sm ring-inset transition-all',
          selected
            ? 'ring-2 ring-primary/70'
            : active
              ? 'ring-1 ring-primary/30'
              : 'ring-0 ring-transparent',
        )}
      />

      {active ? (
        <div
          className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-popover"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sezione {index + 1}
          </span>
          <ToolbarButton
            label="Sposta su"
            disabled={index === 0}
            onClick={() => actions.moveSection(section.id, index - 1)}
          >
            <ArrowUp />
          </ToolbarButton>
          <ToolbarButton
            label="Sposta giù"
            disabled={index === total - 1}
            onClick={() => actions.moveSection(section.id, index + 1)}
          >
            <ArrowDown />
          </ToolbarButton>
          <ToolbarButton label="Duplica sezione" onClick={() => actions.duplicateSection(section.id)}>
            <Copy />
          </ToolbarButton>
          <ToolbarButton
            label="Colonne e stile"
            onClick={() => {
              actions.selectSection(section.id);
              actions.setPanel('stile');
            }}
          >
            <Columns3 />
          </ToolbarButton>
          <ToolbarButton
            label="Elimina sezione"
            danger
            disabled={total <= 1}
            onClick={() => actions.removeSection(section.id)}
          >
            <Trash2 />
          </ToolbarButton>
        </div>
      ) : null}

      <div
        style={{
          width: `${contentWidth}px`,
          maxWidth: '100%',
          margin: '0 auto',
          backgroundColor: section.backgroundColor ?? gs.contentBackgroundColor,
          border: borderToCss(border),
          borderRadius: border?.radius ? `${border.radius}px` : undefined,
          padding: spacingToCss(section.padding),
          ...backgroundImage,
        }}
        onClick={(event) => {
          event.stopPropagation();
          actions.selectSection(section.id);
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: stacked ? 'column' : 'row',
            gap: 0,
            alignItems: 'stretch',
          }}
        >
          {columns.map((column) => {
            const originalIndex = section.columns.indexOf(column);
            const width = stacked ? innerWidth : (widths[originalIndex] ?? innerWidth);
            return (
              <div
                key={column.id}
                style={{
                  width: stacked ? '100%' : `${width}px`,
                  flex: stacked ? '1 1 auto' : `0 0 ${width}px`,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent:
                    column.verticalAlign === 'middle'
                      ? 'center'
                      : column.verticalAlign === 'bottom'
                        ? 'flex-end'
                        : 'flex-start',
                }}
              >
                <ColumnView section={section} column={column} width={width} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Aggiunta rapida di una sezione sotto a quella corrente. */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          actions.addSection(index + 1, createSection());
        }}
        className={cn(
          'absolute -bottom-3 left-1/2 z-20 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft transition-all',
          'opacity-0 hover:border-primary hover:text-primary group-hover/section:opacity-100 focus-visible:opacity-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-label="Aggiungi una sezione sotto"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Canvas
// -----------------------------------------------------------------------------

export interface CanvasProps {
  className?: string;
}

export function Canvas({ className }: CanvasProps) {
  const { state, actions } = useEditor();
  const gs = state.document.globalStyles;
  const mobile = state.viewport === 'mobile';
  const contentWidth = mobile ? MOBILE_WIDTH : gs.contentWidth;
  const pageWidth = mobile ? MOBILE_WIDTH : gs.contentWidth + PAGE_GUTTER * 2;

  // La variabile CSS colora i link dentro al testo ricco, che non conosce gli
  // stili globali del documento.
  const sheetStyle = {
    maxWidth: `${pageWidth}px`,
    backgroundColor: gs.backgroundColor,
    fontFamily: gs.fontFamily,
    fontSize: `${gs.baseFontSize}px`,
    lineHeight: gs.baseLineHeight,
    color: gs.textColor,
    '--ai-link-color': gs.linkColor,
  } as React.CSSProperties;

  return (
    <div
      className={cn('email-canvas h-full', className)}
      onClick={() => actions.clearSelection()}
      onMouseLeave={() => actions.setHover({ sectionId: null, blockId: null })}
    >
      <EditorStyles />

      <div className="email-canvas-sheet transition-[max-width] duration-200" style={sheetStyle}>
        <div className="relative py-0.5">
          <SectionDropSlot kind="section-slot" index={0} />

          {state.document.sections.map((section, index) => (
            <React.Fragment key={section.id}>
              <SectionView
                section={section}
                index={index}
                total={state.document.sections.length}
                contentWidth={contentWidth}
              />
              <SectionDropSlot kind="section-slot" index={index + 1} />
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-4 flex items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground">
        {mobile ? <Smartphone className="size-3.5" aria-hidden="true" /> : <Monitor className="size-3.5" aria-hidden="true" />}
        {mobile
          ? `Anteprima mobile · ${MOBILE_WIDTH} px`
          : `Larghezza contenuto · ${gs.contentWidth} px`}
      </div>
    </div>
  );
}
