'use client';

/**
 * Stato dell'editor email.
 *
 * Un unico `useReducer` governa documento, selezione, hover, cronologia,
 * viewport e pannello attivo: qualunque componente dell'editor legge e muta lo
 * stato attraverso `useEditor()`, senza passaggi di prop a catena.
 *
 * ## Cronologia
 * Ogni azione che modifica il documento salva la versione precedente in `past`
 * (massimo 50 passi). Le modifiche ad alta frequenza — la digitazione dentro un
 * blocco di testo, il trascinamento di uno slider — passano un `historyTag`:
 * due modifiche consecutive con la stessa etichetta entro un secondo occupano
 * un solo passo di cronologia, così l'annullamento torna indietro "a frasi" e
 * non carattere per carattere.
 *
 * ## Sincronizzazione con il contenitore
 * Il documento resta di proprietà del componente che ospita l'editor: ogni
 * variazione interna viene notificata con `onChange`, e un documento diverso
 * che arriva dall'esterno (caricamento, importazione da template, annullamento
 * remoto) sostituisce quello corrente. Il confronto è strutturale, così un
 * contenitore che rigenera l'oggetto a ogni render non provoca cicli.
 */

import type {
  BlockContent,
  BlockStyle,
  BlockType,
  EmailBlock,
  EmailColumn,
  EmailDocument,
  EmailGlobalStyles,
  EmailSection,
} from '@alphaink/shared';
import { blockId as newBlockId, randomId } from '@alphaink/shared';
import * as React from 'react';

import { createBlock, createSection } from './block-factory';

// -----------------------------------------------------------------------------
// Tipi dello stato
// -----------------------------------------------------------------------------

export type EditorViewport = 'desktop' | 'mobile';

/** Pannello attivo nella colonna di destra. */
export type EditorPanel = 'contenuto' | 'stile' | 'globale';

export type SelectionKind = 'none' | 'block' | 'section' | 'global';

export interface EditorSelection {
  kind: SelectionKind;
  sectionId: string | null;
  columnId: string | null;
  blockId: string | null;
}

export const EMPTY_SELECTION: EditorSelection = {
  kind: 'none',
  sectionId: null,
  columnId: null,
  blockId: null,
};

export interface EditorHover {
  sectionId: string | null;
  blockId: string | null;
}

export interface EditorState {
  document: EmailDocument;
  selection: EditorSelection;
  hover: EditorHover;
  past: EmailDocument[];
  future: EmailDocument[];
  viewport: EditorViewport;
  panel: EditorPanel;
  /** Etichetta dell'ultima modifica, per accorpare i passi di cronologia. */
  historyTag: string | null;
  historyAt: number;
}

/** Posizione di un blocco dentro il documento. */
export interface BlockLocation {
  sectionId: string;
  columnId: string;
  index: number;
}

export interface BlockTarget {
  sectionId: string;
  columnId: string;
  /** Posizione di inserimento; `null` = in coda. */
  index?: number | null;
}

// -----------------------------------------------------------------------------
// Azioni
// -----------------------------------------------------------------------------

export type EditorAction =
  | { type: 'setDocument'; document: EmailDocument; resetHistory?: boolean }
  | { type: 'addBlock'; blockType: BlockType; target: BlockTarget; block?: EmailBlock; select?: boolean }
  | { type: 'moveBlock'; blockId: string; target: BlockTarget }
  | { type: 'duplicateBlock'; blockId: string }
  | { type: 'removeBlock'; blockId: string }
  | { type: 'updateBlock'; blockId: string; content: Partial<BlockContent>; historyTag?: string }
  | { type: 'updateBlockStyle'; blockId: string; style: Partial<BlockStyle>; historyTag?: string }
  | { type: 'updateBlockMeta'; blockId: string; patch: Partial<Pick<EmailBlock, 'visibilityRule' | 'locked'>> }
  | { type: 'addSection'; index?: number | null; section?: EmailSection; select?: boolean }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'duplicateSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; index: number }
  | { type: 'setColumns'; sectionId: string; spans: number[] }
  | { type: 'updateSection'; sectionId: string; patch: Partial<EmailSection>; historyTag?: string }
  | { type: 'updateColumn'; sectionId: string; columnId: string; patch: Partial<EmailColumn>; historyTag?: string }
  | { type: 'updateGlobalStyles'; patch: Partial<EmailGlobalStyles>; historyTag?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; selection: Partial<EditorSelection> & { kind: SelectionKind } }
  | { type: 'setHover'; hover: Partial<EditorHover> }
  | { type: 'setViewport'; viewport: EditorViewport }
  | { type: 'setPanel'; panel: EditorPanel };

/** Passi di annullamento conservati. */
export const HISTORY_LIMIT = 50;

/** Finestra entro cui due modifiche con la stessa etichetta si fondono. */
const HISTORY_COALESCE_MS = 1000;

// -----------------------------------------------------------------------------
// Utilità sul documento
// -----------------------------------------------------------------------------

/** Copia profonda sicura: i documenti email sono sempre serializzabili in JSON. */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Confronto strutturale usato per evitare cicli di sincronizzazione. */
export function documentsEqual(a: EmailDocument | null, b: EmailDocument | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface FoundBlock {
  block: EmailBlock;
  section: EmailSection;
  column: EmailColumn;
  location: BlockLocation;
}

/** Cerca un blocco in tutto il documento restituendo anche la sua posizione. */
export function findBlock(doc: EmailDocument, blockId: string | null): FoundBlock | null {
  if (!blockId) return null;
  for (const section of doc.sections) {
    for (const column of section.columns) {
      const index = column.blocks.findIndex((block) => block.id === blockId);
      if (index >= 0) {
        return {
          block: column.blocks[index]!,
          section,
          column,
          location: { sectionId: section.id, columnId: column.id, index },
        };
      }
    }
  }
  return null;
}

export function findSection(doc: EmailDocument, sectionId: string | null): EmailSection | null {
  if (!sectionId) return null;
  return doc.sections.find((section) => section.id === sectionId) ?? null;
}

export function findColumn(
  doc: EmailDocument,
  sectionId: string | null,
  columnId: string | null,
): EmailColumn | null {
  const section = findSection(doc, sectionId);
  if (!section || !columnId) return null;
  return section.columns.find((column) => column.id === columnId) ?? null;
}

/** Numero totale di blocchi del documento (usato per i limiti e la UI). */
export function countBlocks(doc: EmailDocument): number {
  return doc.sections.reduce(
    (total, section) =>
      total + section.columns.reduce((sum, column) => sum + column.blocks.length, 0),
    0,
  );
}

function mapSections(
  doc: EmailDocument,
  fn: (section: EmailSection) => EmailSection,
): EmailDocument {
  return { ...doc, sections: doc.sections.map(fn) };
}

function mapColumns(
  section: EmailSection,
  fn: (column: EmailColumn) => EmailColumn,
): EmailSection {
  return { ...section, columns: section.columns.map(fn) };
}

/** Applica una trasformazione al blocco indicato, ovunque si trovi. */
function mapBlock(
  doc: EmailDocument,
  blockId: string,
  fn: (block: EmailBlock) => EmailBlock,
): EmailDocument {
  return mapSections(doc, (section) =>
    mapColumns(section, (column) => {
      if (!column.blocks.some((block) => block.id === blockId)) return column;
      return {
        ...column,
        blocks: column.blocks.map((block) => (block.id === blockId ? fn(block) : block)),
      };
    }),
  );
}

/** Rimuove un blocco restituendo documento e blocco estratto. */
function extractBlock(
  doc: EmailDocument,
  blockId: string,
): { document: EmailDocument; block: EmailBlock | null } {
  let removed: EmailBlock | null = null;
  const next = mapSections(doc, (section) =>
    mapColumns(section, (column) => {
      const index = column.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return column;
      removed = column.blocks[index]!;
      const blocks = [...column.blocks];
      blocks.splice(index, 1);
      return { ...column, blocks };
    }),
  );
  return { document: next, block: removed };
}

/** Inserisce un blocco nella colonna indicata alla posizione richiesta. */
function insertBlock(doc: EmailDocument, target: BlockTarget, block: EmailBlock): EmailDocument {
  return mapSections(doc, (section) => {
    if (section.id !== target.sectionId) return section;
    return mapColumns(section, (column) => {
      if (column.id !== target.columnId) return column;
      const blocks = [...column.blocks];
      const index =
        target.index === null || target.index === undefined
          ? blocks.length
          : Math.max(0, Math.min(target.index, blocks.length));
      blocks.splice(index, 0, block);
      return { ...column, blocks };
    });
  });
}

/** Duplicato con identificatori nuovi, pronto per essere inserito. */
export function cloneBlock(block: EmailBlock): EmailBlock {
  return { ...deepClone(block), id: newBlockId(block.type) };
}

export function cloneSection(section: EmailSection): EmailSection {
  const copy = deepClone(section);
  return {
    ...copy,
    id: `sez_${randomId(8)}`,
    columns: copy.columns.map((column) => ({
      ...column,
      id: `col_${randomId(8)}`,
      blocks: column.blocks.map((block) => cloneBlock(block)),
    })),
  };
}

/**
 * Riporta un elenco di span alla somma di 12 dodicesimi: i preset sono già
 * coerenti, ma una modifica manuale potrebbe non esserlo.
 */
function normalizeSpans(spans: number[]): number[] {
  const cleaned = spans
    .map((span) => Math.max(1, Math.min(12, Math.round(span))))
    .slice(0, 4);
  if (!cleaned.length) return [12];
  const total = cleaned.reduce((sum, span) => sum + span, 0);
  if (total === 12) return cleaned;
  // Riproporziona mantenendo almeno 1 dodicesimo per colonna.
  const scaled = cleaned.map((span) => Math.max(1, Math.round((span / total) * 12)));
  let delta = 12 - scaled.reduce((sum, span) => sum + span, 0);
  let cursor = 0;
  while (delta !== 0 && scaled.length) {
    const index = cursor % scaled.length;
    const next = scaled[index]! + (delta > 0 ? 1 : -1);
    if (next >= 1 && next <= 12) {
      scaled[index] = next;
      delta += delta > 0 ? -1 : 1;
    }
    cursor += 1;
    if (cursor > 100) break;
  }
  return scaled;
}

/** Colonna vuota con le impostazioni predefinite. */
function emptyColumn(span: number): EmailColumn {
  return {
    id: `col_${randomId(8)}`,
    span,
    blocks: [],
    verticalAlign: 'top',
    backgroundColor: null,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * Cambia il numero di colonne di una sezione conservando i contenuti: le
 * colonne in eccesso confluiscono nell'ultima colonna mantenuta, così nessun
 * blocco viene perso per errore.
 */
function applyColumnPreset(section: EmailSection, spans: number[]): EmailSection {
  const normalized = normalizeSpans(spans);
  const existing = section.columns;
  const columns: EmailColumn[] = [];

  for (let i = 0; i < normalized.length; i += 1) {
    const source = existing[i];
    columns.push(
      source
        ? { ...source, span: normalized[i]! }
        : emptyColumn(normalized[i]!),
    );
  }

  if (existing.length > normalized.length) {
    const overflow = existing.slice(normalized.length).flatMap((column) => column.blocks);
    if (overflow.length) {
      const last = columns[columns.length - 1]!;
      columns[columns.length - 1] = { ...last, blocks: [...last.blocks, ...overflow] };
    }
  }

  return { ...section, columns };
}

// -----------------------------------------------------------------------------
// Reducer
// -----------------------------------------------------------------------------

/** Registra il documento corrente nella cronologia e applica quello nuovo. */
function commit(state: EditorState, next: EmailDocument, historyTag?: string): EditorState {
  if (next === state.document) return state;
  const now = Date.now();
  const coalesce =
    Boolean(historyTag) &&
    state.historyTag === historyTag &&
    now - state.historyAt < HISTORY_COALESCE_MS;

  const past = coalesce
    ? state.past
    : [...state.past, state.document].slice(-HISTORY_LIMIT);

  return {
    ...state,
    document: next,
    past,
    future: [],
    historyTag: historyTag ?? null,
    historyAt: now,
  };
}

/** Selezione ripulita quando l'elemento selezionato non esiste più. */
function pruneSelection(state: EditorState): EditorState {
  const { selection, document } = state;
  if (selection.kind === 'block' && !findBlock(document, selection.blockId)) {
    return { ...state, selection: EMPTY_SELECTION, panel: 'contenuto' };
  }
  if (selection.kind === 'section' && !findSection(document, selection.sectionId)) {
    return { ...state, selection: EMPTY_SELECTION, panel: 'contenuto' };
  }
  return state;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setDocument': {
      if (documentsEqual(state.document, action.document)) return state;
      const next: EditorState = {
        ...state,
        document: action.document,
        past: action.resetHistory ? [] : [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: action.resetHistory ? [] : state.future,
        historyTag: null,
        historyAt: Date.now(),
      };
      return pruneSelection(next);
    }

    case 'addBlock': {
      const block = action.block ?? createBlock(action.blockType);
      const document = insertBlock(state.document, action.target, block);
      if (document === state.document) return state;
      const committed = commit(state, document);
      if (action.select === false) return committed;
      return {
        ...committed,
        selection: {
          kind: 'block',
          sectionId: action.target.sectionId,
          columnId: action.target.columnId,
          blockId: block.id,
        },
        panel: 'contenuto',
      };
    }

    case 'moveBlock': {
      const found = findBlock(state.document, action.blockId);
      if (!found) return state;

      const sameColumn =
        found.location.sectionId === action.target.sectionId &&
        found.location.columnId === action.target.columnId;

      // Nella stessa colonna l'indice di destinazione va corretto perché la
      // rimozione fa scalare di uno tutte le posizioni successive.
      let index =
        action.target.index === null || action.target.index === undefined
          ? null
          : action.target.index;
      if (sameColumn && index !== null && index > found.location.index) index -= 1;
      if (sameColumn && index === found.location.index) return state;

      const extracted = extractBlock(state.document, action.blockId);
      if (!extracted.block) return state;
      const document = insertBlock(
        extracted.document,
        { ...action.target, index },
        extracted.block,
      );
      return {
        ...commit(state, document),
        selection: {
          kind: 'block',
          sectionId: action.target.sectionId,
          columnId: action.target.columnId,
          blockId: action.blockId,
        },
      };
    }

    case 'duplicateBlock': {
      const found = findBlock(state.document, action.blockId);
      if (!found) return state;
      const copy = cloneBlock(found.block);
      const document = insertBlock(
        state.document,
        {
          sectionId: found.location.sectionId,
          columnId: found.location.columnId,
          index: found.location.index + 1,
        },
        copy,
      );
      return {
        ...commit(state, document),
        selection: {
          kind: 'block',
          sectionId: found.location.sectionId,
          columnId: found.location.columnId,
          blockId: copy.id,
        },
      };
    }

    case 'removeBlock': {
      const extracted = extractBlock(state.document, action.blockId);
      if (!extracted.block) return state;
      const committed = commit(state, extracted.document);
      return pruneSelection(committed);
    }

    case 'updateBlock': {
      const document = mapBlock(state.document, action.blockId, (block) => ({
        ...block,
        content: { ...block.content, ...action.content } as BlockContent,
      }));
      return commit(state, document, action.historyTag);
    }

    case 'updateBlockStyle': {
      const document = mapBlock(state.document, action.blockId, (block) => ({
        ...block,
        style: { ...block.style, ...action.style },
      }));
      return commit(state, document, action.historyTag);
    }

    case 'updateBlockMeta': {
      const document = mapBlock(state.document, action.blockId, (block) => ({
        ...block,
        ...action.patch,
      }));
      return commit(state, document);
    }

    case 'addSection': {
      const section = action.section ?? createSection();
      const sections = [...state.document.sections];
      const index =
        action.index === null || action.index === undefined
          ? sections.length
          : Math.max(0, Math.min(action.index, sections.length));
      sections.splice(index, 0, section);
      const committed = commit(state, { ...state.document, sections });
      if (action.select === false) return committed;
      return {
        ...committed,
        selection: { kind: 'section', sectionId: section.id, columnId: null, blockId: null },
        panel: 'contenuto',
      };
    }

    case 'removeSection': {
      // L'ultima sezione non si elimina: un documento senza sezioni non è valido.
      if (state.document.sections.length <= 1) return state;
      const sections = state.document.sections.filter((section) => section.id !== action.sectionId);
      if (sections.length === state.document.sections.length) return state;
      const committed = commit(state, { ...state.document, sections });
      return pruneSelection({ ...committed, selection: EMPTY_SELECTION });
    }

    case 'duplicateSection': {
      const index = state.document.sections.findIndex((section) => section.id === action.sectionId);
      if (index < 0) return state;
      const copy = cloneSection(state.document.sections[index]!);
      const sections = [...state.document.sections];
      sections.splice(index + 1, 0, copy);
      return {
        ...commit(state, { ...state.document, sections }),
        selection: { kind: 'section', sectionId: copy.id, columnId: null, blockId: null },
      };
    }

    case 'moveSection': {
      const from = state.document.sections.findIndex((section) => section.id === action.sectionId);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(action.index, state.document.sections.length - 1));
      if (from === to) return state;
      const sections = [...state.document.sections];
      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved!);
      return commit(state, { ...state.document, sections });
    }

    case 'setColumns': {
      const document = mapSections(state.document, (section) =>
        section.id === action.sectionId ? applyColumnPreset(section, action.spans) : section,
      );
      const committed = commit(state, document);
      return pruneSelection(committed);
    }

    case 'updateSection': {
      const document = mapSections(state.document, (section) =>
        section.id === action.sectionId ? { ...section, ...action.patch } : section,
      );
      return commit(state, document, action.historyTag);
    }

    case 'updateColumn': {
      const document = mapSections(state.document, (section) => {
        if (section.id !== action.sectionId) return section;
        return mapColumns(section, (column) =>
          column.id === action.columnId ? { ...column, ...action.patch } : column,
        );
      });
      return commit(state, document, action.historyTag);
    }

    case 'updateGlobalStyles': {
      const document: EmailDocument = {
        ...state.document,
        globalStyles: { ...state.document.globalStyles, ...action.patch },
      };
      return commit(state, document, action.historyTag);
    }

    case 'undo': {
      if (!state.past.length) return state;
      const past = [...state.past];
      const previous = past.pop()!;
      const next: EditorState = {
        ...state,
        document: previous,
        past,
        future: [state.document, ...state.future].slice(0, HISTORY_LIMIT),
        historyTag: null,
        historyAt: 0,
      };
      return pruneSelection(next);
    }

    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      const nextState: EditorState = {
        ...state,
        document: next!,
        past: [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: rest,
        historyTag: null,
        historyAt: 0,
      };
      return pruneSelection(nextState);
    }

    case 'select': {
      const selection: EditorSelection = {
        kind: action.selection.kind,
        sectionId: action.selection.sectionId ?? null,
        columnId: action.selection.columnId ?? null,
        blockId: action.selection.blockId ?? null,
      };
      if (
        selection.kind === state.selection.kind &&
        selection.sectionId === state.selection.sectionId &&
        selection.columnId === state.selection.columnId &&
        selection.blockId === state.selection.blockId
      ) {
        return state;
      }
      return {
        ...state,
        selection,
        panel: selection.kind === 'global' ? 'globale' : 'contenuto',
      };
    }

    case 'setHover': {
      const hover: EditorHover = {
        sectionId: action.hover.sectionId ?? null,
        blockId: action.hover.blockId ?? null,
      };
      if (hover.sectionId === state.hover.sectionId && hover.blockId === state.hover.blockId) {
        return state;
      }
      return { ...state, hover };
    }

    case 'setViewport':
      return state.viewport === action.viewport ? state : { ...state, viewport: action.viewport };

    case 'setPanel':
      return state.panel === action.panel ? state : { ...state, panel: action.panel };

    default:
      return state;
  }
}

export function createInitialState(document: EmailDocument): EditorState {
  return {
    document,
    selection: EMPTY_SELECTION,
    hover: { sectionId: null, blockId: null },
    past: [],
    future: [],
    viewport: 'desktop',
    panel: 'contenuto',
    historyTag: null,
    historyAt: 0,
  };
}

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

export interface EditorActions {
  addBlock: (blockType: BlockType, target: BlockTarget, block?: EmailBlock) => void;
  moveBlock: (blockId: string, target: BlockTarget) => void;
  duplicateBlock: (blockId: string) => void;
  removeBlock: (blockId: string) => void;
  updateBlock: (blockId: string, content: Partial<BlockContent>, historyTag?: string) => void;
  updateBlockStyle: (blockId: string, style: Partial<BlockStyle>, historyTag?: string) => void;
  updateBlockMeta: (
    blockId: string,
    patch: Partial<Pick<EmailBlock, 'visibilityRule' | 'locked'>>,
  ) => void;
  addSection: (index?: number | null, section?: EmailSection) => void;
  removeSection: (sectionId: string) => void;
  duplicateSection: (sectionId: string) => void;
  moveSection: (sectionId: string, index: number) => void;
  setColumns: (sectionId: string, spans: number[]) => void;
  updateSection: (sectionId: string, patch: Partial<EmailSection>, historyTag?: string) => void;
  updateColumn: (
    sectionId: string,
    columnId: string,
    patch: Partial<EmailColumn>,
    historyTag?: string,
  ) => void;
  updateGlobalStyles: (patch: Partial<EmailGlobalStyles>, historyTag?: string) => void;
  replaceDocument: (document: EmailDocument, resetHistory?: boolean) => void;
  undo: () => void;
  redo: () => void;
  select: (selection: Partial<EditorSelection> & { kind: SelectionKind }) => void;
  selectBlock: (blockId: string, sectionId: string, columnId: string) => void;
  selectSection: (sectionId: string) => void;
  clearSelection: () => void;
  setHover: (hover: Partial<EditorHover>) => void;
  setViewport: (viewport: EditorViewport) => void;
  setPanel: (panel: EditorPanel) => void;
}

export interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  actions: EditorActions;
  canUndo: boolean;
  canRedo: boolean;
  /** Chiede al contenitore di salvare (Ctrl/Cmd+S o pulsante "Salva"). */
  requestSave: () => void;
  /** Valori di esempio per i merge tag mostrati in anteprima nel canvas. */
  mergeTagContext: Record<string, string>;
}

const EditorContext = React.createContext<EditorContextValue | null>(null);

export interface EditorProviderProps {
  document: EmailDocument;
  onChange: (document: EmailDocument) => void;
  onSaveRequested?: () => void;
  mergeTagContext?: Record<string, string>;
  children: React.ReactNode;
}

export function EditorProvider({
  document,
  onChange,
  onSaveRequested,
  mergeTagContext,
  children,
}: EditorProviderProps) {
  const [state, dispatch] = React.useReducer(editorReducer, document, createInitialState);

  // Riferimenti stabili: gli effetti non devono ripartire a ogni render del
  // contenitore, altrimenti l'editor perde la selezione mentre si digita.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = React.useRef(onSaveRequested);
  onSaveRef.current = onSaveRequested;
  const stateRef = React.useRef(state);
  stateRef.current = state;

  // Il documento appena montato è già quello del contenitore: non va rinotificato.
  const lastNotified = React.useRef(document);

  React.useEffect(() => {
    if (state.document === lastNotified.current) return;
    lastNotified.current = state.document;
    onChangeRef.current(state.document);
  }, [state.document]);

  // Documento sostituito dall'esterno (caricamento, import, reset).
  React.useEffect(() => {
    if (documentsEqual(document, stateRef.current.document)) {
      lastNotified.current = stateRef.current.document;
      return;
    }
    lastNotified.current = document;
    dispatch({ type: 'setDocument', document });
  }, [document]);

  const actions = React.useMemo<EditorActions>(
    () => ({
      addBlock: (blockType, target, block) =>
        dispatch({ type: 'addBlock', blockType, target, block }),
      moveBlock: (blockId, target) => dispatch({ type: 'moveBlock', blockId, target }),
      duplicateBlock: (blockId) => dispatch({ type: 'duplicateBlock', blockId }),
      removeBlock: (blockId) => dispatch({ type: 'removeBlock', blockId }),
      updateBlock: (blockId, content, historyTag) =>
        dispatch({ type: 'updateBlock', blockId, content, historyTag }),
      updateBlockStyle: (blockId, style, historyTag) =>
        dispatch({ type: 'updateBlockStyle', blockId, style, historyTag }),
      updateBlockMeta: (blockId, patch) => dispatch({ type: 'updateBlockMeta', blockId, patch }),
      addSection: (index, section) => dispatch({ type: 'addSection', index, section }),
      removeSection: (sectionId) => dispatch({ type: 'removeSection', sectionId }),
      duplicateSection: (sectionId) => dispatch({ type: 'duplicateSection', sectionId }),
      moveSection: (sectionId, index) => dispatch({ type: 'moveSection', sectionId, index }),
      setColumns: (sectionId, spans) => dispatch({ type: 'setColumns', sectionId, spans }),
      updateSection: (sectionId, patch, historyTag) =>
        dispatch({ type: 'updateSection', sectionId, patch, historyTag }),
      updateColumn: (sectionId, columnId, patch, historyTag) =>
        dispatch({ type: 'updateColumn', sectionId, columnId, patch, historyTag }),
      updateGlobalStyles: (patch, historyTag) =>
        dispatch({ type: 'updateGlobalStyles', patch, historyTag }),
      replaceDocument: (nextDocument, resetHistory) =>
        dispatch({ type: 'setDocument', document: nextDocument, resetHistory }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      select: (selection) => dispatch({ type: 'select', selection }),
      selectBlock: (blockId, sectionId, columnId) =>
        dispatch({ type: 'select', selection: { kind: 'block', blockId, sectionId, columnId } }),
      selectSection: (sectionId) =>
        dispatch({ type: 'select', selection: { kind: 'section', sectionId } }),
      clearSelection: () => dispatch({ type: 'select', selection: { kind: 'none' } }),
      setHover: (hover) => dispatch({ type: 'setHover', hover }),
      setViewport: (viewport) => dispatch({ type: 'setViewport', viewport }),
      setPanel: (panel) => dispatch({ type: 'setPanel', panel }),
    }),
    [],
  );

  const requestSave = React.useCallback(() => {
    onSaveRef.current?.();
  }, []);

  const value = React.useMemo<EditorContextValue>(
    () => ({
      state,
      dispatch,
      actions,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      requestSave,
      mergeTagContext: mergeTagContext ?? {},
    }),
    [state, actions, requestSave, mergeTagContext],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/** Accesso allo stato dell'editor. Va usato dentro `<EditorProvider>`. */
export function useEditor(): EditorContextValue {
  const context = React.useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor deve essere usato dentro <EditorProvider>.');
  }
  return context;
}

/** Blocco attualmente selezionato, con la sua posizione nel documento. */
export function useSelectedBlock(): FoundBlock | null {
  const { state } = useEditor();
  return React.useMemo(
    () => (state.selection.kind === 'block' ? findBlock(state.document, state.selection.blockId) : null),
    [state.document, state.selection],
  );
}

/** Sezione attualmente selezionata (anche quando la selezione è su un blocco). */
export function useSelectedSection(): EmailSection | null {
  const { state } = useEditor();
  return React.useMemo(
    () => findSection(state.document, state.selection.sectionId),
    [state.document, state.selection.sectionId],
  );
}
