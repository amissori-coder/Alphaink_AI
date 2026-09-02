'use client';

/**
 * Blocco video.
 *
 * I client di posta non riproducono video: si mostra la miniatura cliccabile e,
 * se richiesto, una riga di invito sotto. L'anteprima rispecchia esattamente
 * questa resa.
 */

import type { VideoBlockContent } from '@alphaink/shared';
import { Play, Video } from 'lucide-react';
import * as React from 'react';

import { useEditor } from '../editor-store';
import { isUsableUrl } from '../utils';
import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

export function VideoBlock({ block, width }: BlockViewProps) {
  const { state } = useEditor();
  const content = block.content as VideoBlockContent & { type: 'video' };
  const ready = isUsableUrl(content.url) && isUsableUrl(content.thumbnailUrl);

  if (!ready) {
    return (
      <BlockPlaceholder
        icon={<Video />}
        ratio="16 / 9"
        title="Video da configurare"
        description="Indica l’indirizzo del video e la miniatura da mostrare nell’email."
      />
    );
  }

  return (
    <div>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.thumbnailUrl}
          alt={content.alt || 'Guarda il video'}
          width={width}
          style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', borderRadius: '8px' }}
        />
      </div>
      {content.showPlayIcon ? (
        <div
          style={{
            paddingTop: '10px',
            fontSize: '14px',
            fontWeight: 600,
            lineHeight: 1.4,
            textAlign: 'center',
            color: state.document.globalStyles.linkColor,
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Play className="size-3.5" aria-hidden="true" />
            {content.alt || 'Guarda il video'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
