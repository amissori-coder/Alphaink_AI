'use client';

/**
 * Elementi condivisi dai renderer dei blocchi: segnaposto per i contenuti non
 * ancora configurati e testo con merge tag evidenziati.
 */

import { MERGE_TAG_PATTERN } from '@alphaink/shared';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { useEditor } from '../editor-store';
import { mergeTagLabel, mergeTagPreviewValue } from '../utils';

// -----------------------------------------------------------------------------
// Segnaposto
// -----------------------------------------------------------------------------

export interface BlockPlaceholderProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Azione mostrata come pulsante testuale (es. "Scegli un'immagine"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Proporzione dell'area, per i segnaposto immagine. */
  ratio?: string;
  className?: string;
}

/**
 * Area tratteggiata mostrata quando un blocco non ha ancora contenuto.
 * Non finisce mai nell'email: il renderer omette i blocchi incompleti.
 */
export function BlockPlaceholder({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  ratio,
  className,
}: BlockPlaceholderProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center',
        className,
      )}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-sm font-semibold text-slate-600">{title}</span>
      {description ? (
        <span className="max-w-[26rem] text-xs leading-snug text-slate-400">{description}</span>
      ) : null}
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          className="mt-1 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-sky-600 shadow-sm transition-colors hover:bg-sky-50"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Testo con merge tag
// -----------------------------------------------------------------------------

export interface MergeTagTextProps {
  value: string;
  /** Testo mostrato quando il valore è vuoto. */
  placeholder?: string;
  className?: string;
}

/**
 * Mostra un testo sostituendo i merge tag con il valore di anteprima ed
 * evidenziandoli: si legge la frase finale senza perdere di vista i campi
 * dinamici.
 */
export function MergeTagText({ value, placeholder, className }: MergeTagTextProps) {
  const { mergeTagContext } = useEditor();

  const parts = React.useMemo(() => {
    const source = value ?? '';
    if (!source) return [] as Array<{ text: string; tag: string | null; key: string }>;
    const pattern = new RegExp(MERGE_TAG_PATTERN.source, 'g');
    const result: Array<{ text: string; tag: string | null; key: string }> = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = pattern.exec(source)) !== null) {
      if (match.index > cursor) {
        result.push({ text: source.slice(cursor, match.index), tag: null, key: `t${index++}` });
      }
      result.push({
        text: mergeTagPreviewValue(match[1] ?? '', mergeTagContext),
        tag: match[0],
        key: `m${index++}`,
      });
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) {
      result.push({ text: source.slice(cursor), tag: null, key: `t${index++}` });
    }
    return result;
  }, [value, mergeTagContext]);

  if (!value) {
    return placeholder ? (
      <span className={cn('italic opacity-40', className)}>{placeholder}</span>
    ) : null;
  }

  if (parts.length === 0) return <span className={className}>{value}</span>;

  return (
    <span className={className}>
      {parts.map((part) =>
        part.tag ? (
          <span key={part.key} className="ai-merge-tag" title={`${mergeTagLabel(part.tag)} — ${part.tag}`}>
            {part.text || part.tag}
          </span>
        ) : (
          <React.Fragment key={part.key}>{part.text}</React.Fragment>
        ),
      )}
    </span>
  );
}
