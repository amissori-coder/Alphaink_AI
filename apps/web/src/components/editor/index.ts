/**
 * API pubblica dell'editor di newsletter.
 *
 * Le rotte della web app importano da qui: `EmailEditor` è l'unico componente
 * necessario per avere l'editor completo, il resto è esposto per gli usi
 * particolari (anteprima autonoma, selettore immagini in un'altra pagina,
 * inserimento di merge tag in un campo di testo).
 */

export { EmailEditor } from './email-editor';
export type { EmailEditorProps } from './email-editor';

// --- Composizione ------------------------------------------------------------
export { EditorProvider, useEditor, useSelectedBlock, useSelectedSection } from './editor-store';
export type {
  BlockLocation,
  BlockTarget,
  EditorAction,
  EditorActions,
  EditorContextValue,
  EditorHover,
  EditorPanel,
  EditorSelection,
  EditorState,
  EditorViewport,
  FoundBlock,
  SelectionKind,
} from './editor-store';
export { countBlocks, findBlock, findColumn, findSection } from './editor-store';

export { BlockLibrary, BLOCK_GROUPS, BLOCK_HINTS, BLOCK_ICONS } from './block-library';
export type { BlockGroup, BlockLibraryProps, LibraryDragData } from './block-library';

export { Canvas, MOBILE_WIDTH } from './canvas';
export type { BlockDragData, BlockSlotData, CanvasProps, SectionSlotData } from './canvas';

export { EditorToolbar } from './toolbar';
export type { EditorToolbarProps } from './toolbar';

export { Inspector } from './inspector';
export type { InspectorProps } from './inspector';

// --- Finestre riutilizzabili -------------------------------------------------
export { MediaPickerDialog } from './media-picker';
export type { MediaAssetDoc, MediaPickerDialogProps, MediaSelection } from './media-picker';

export { MergeTagMenu, MERGE_TAG_GROUP_LABELS, MERGE_TAG_GROUP_ORDER } from './merge-tag-menu';
export type { MergeTagGroup, MergeTagMenuProps } from './merge-tag-menu';

export { PreviewDialog } from './preview-dialog';
export type {
  NewsletterPreviewResult,
  PreviewDialogProps,
  PreviewWarning,
  PreviewWarningSeverity,
} from './preview-dialog';

export { TemplatePickerDialog } from './template-picker';
export type { TemplatePickerDialogProps } from './template-picker';

// --- Modello -----------------------------------------------------------------
export { PRESET_SECTIONS, createBlock, createSection, defaultContent, presetSectionById } from './block-factory';
export type { PresetSection, PresetSectionId } from './block-factory';

export { BlockView } from './blocks';
export type { BlockViewProps } from './blocks';

export {
  columnWidths,
  hasMergeTag,
  htmlToPlainText,
  isUsableUrl,
  mergeTagLabel,
  normalizeUrl,
  resolveMergeTags,
  sanitizePreviewHtml,
  spacingToCss,
  typographyToStyle,
} from './utils';
