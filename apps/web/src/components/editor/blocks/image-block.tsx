'use client';

/**
 * Blocco immagine.
 *
 * Senza sorgente mostra un segnaposto che apre la libreria media; con
 * un'immagine, la resa è quella dell'email (larghezza vincolata alla colonna,
 * `display:block`, raggio degli angoli). Il doppio clic riapre la libreria.
 */

import type { ImageBlockContent } from '@alphaink/shared';
import { ImageIcon, RefreshCw, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { useEditor } from '../editor-store';
import { MediaPickerDialog } from '../media-picker';
import type { MediaSelection } from '../media-picker';
import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

export function ImageBlock({ block, width, selected }: BlockViewProps) {
  const { actions } = useEditor();
  const content = block.content as ImageBlockContent & { type: 'image' };
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [broken, setBroken] = React.useState(false);

  React.useEffect(() => setBroken(false), [content.src]);

  const applySelection = (selection: MediaSelection) => {
    actions.updateBlock(block.id, {
      src: selection.src,
      storagePath: selection.storagePath,
      alt: selection.alt || content.alt,
      // La larghezza reale non supera mai quella della colonna.
      width: selection.width ? Math.min(selection.width, width) : content.width ?? null,
    });
  };

  const displayWidth = content.width && content.width > 0 ? Math.min(content.width, width) : width;
  const align = block.style.align ?? 'left';
  const margin = align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0';

  return (
    <>
      {content.src && !broken ? (
        <div className="group relative" onDoubleClick={() => setPickerOpen(true)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.src}
            alt={content.alt}
            width={displayWidth}
            onError={() => setBroken(true)}
            style={{
              display: 'block',
              width: `${displayWidth}px`,
              maxWidth: '100%',
              height: 'auto',
              borderRadius: content.borderRadius ? `${content.borderRadius}px` : undefined,
              margin,
            }}
          />
          {selected ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPickerOpen(true);
              }}
              className={cn(
                'absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-md bg-slate-900/85 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg',
                'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
              )}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Sostituisci
            </button>
          ) : null}
          {!content.alt ? (
            <span
              title="Aggiungi un testo alternativo: molti client bloccano le immagini."
              className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 shadow-sm"
            >
              <TriangleAlert className="size-3" aria-hidden="true" />
              Alt mancante
            </span>
          ) : null}
        </div>
      ) : (
        <BlockPlaceholder
          icon={<ImageIcon />}
          ratio="16 / 9"
          title={broken ? 'Immagine non raggiungibile' : 'Nessuna immagine'}
          description={
            broken
              ? 'L’indirizzo non risponde: scegli un altro file oppure ricarica l’immagine.'
              : 'Scegli un file dalla libreria o caricane uno nuovo.'
          }
          actionLabel="Scegli un’immagine"
          onAction={() => setPickerOpen(true)}
        />
      )}

      <MediaPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={applySelection}
        currentSrc={content.src || null}
        currentAlt={content.alt}
      />
    </>
  );
}
