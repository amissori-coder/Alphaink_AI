'use client';

/**
 * Blocco titolo.
 *
 * Quando è selezionato il testo si modifica direttamente sul canvas (solo testo
 * semplice: il renderer esegue l'escape del titolo). Quando non lo è, i merge
 * tag vengono risolti con i valori di anteprima, così si legge il titolo come
 * lo vedrà il destinatario.
 */

import type { HeadingBlockContent } from '@alphaink/shared';
import * as React from 'react';

import { useEditor } from '../editor-store';
import { typographyToStyle } from '../utils';
import { MergeTagText } from './shared';
import type { BlockViewProps } from './types';

export function HeadingBlock({ block, selected }: BlockViewProps) {
  const { actions, state } = useEditor();
  const content = block.content as HeadingBlockContent & { type: 'heading' };
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Il testo corrente in un riferimento: la callback che monta il nodo deve
  // restare stabile, altrimenti React lo rimonterebbe a ogni battitura
  // riportando il cursore all'inizio.
  const textRef = React.useRef(content.text);
  textRef.current = content.text;

  const attachNode = React.useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    if (!node) return;
    node.innerText = textRef.current;
    // Il nodo compare quando il blocco viene selezionato: portarci il cursore
    // (in fondo al testo) evita il secondo clic per iniziare a scrivere.
    node.focus();
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selection) return;
    const range = window.document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const level = ([1, 2, 3, 4] as const).includes(content.level) ? content.level : 2;
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';

  const style = {
    ...typographyToStyle(content.typography),
    color: content.typography.color || state.document.globalStyles.headingColor,
  };

  // Allinea il nodo modificabile quando il testo cambia dall'esterno
  // (annulla/ripristina, ispettore, importazione di un template).
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof document !== 'undefined' && document.activeElement === node) return;
    if (node.innerText !== content.text) node.innerText = content.text;
  }, [content.text, selected]);

  if (!selected) {
    return (
      <Tag style={style} className="ai-heading break-words">
        <MergeTagText value={content.text} placeholder="Titolo vuoto — fai clic per scrivere." />
      </Tag>
    );
  }

  return (
    <Tag style={style} className="ai-heading break-words">
      <div
        ref={attachNode}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Testo del titolo"
        spellCheck
        className="outline-none"
        onInput={() =>
          actions.updateBlock(
            block.id,
            { text: ref.current?.innerText ?? '' },
            `titolo:${block.id}`,
          )
        }
        onKeyDown={(event) => {
          // A capo e tabulazione non hanno senso in un titolo di una sola riga.
          if (event.key === 'Enter' || event.key === 'Tab') event.preventDefault();
        }}
        onPaste={(event) => {
          // Incolla sempre testo semplice: l'HTML del titolo verrebbe scartato.
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain').replace(/\s+/g, ' ');
          if (typeof document !== 'undefined') document.execCommand('insertText', false, text);
        }}
      />
    </Tag>
  );
}
