'use client';

/** Blocco separatore: linea orizzontale con spessore, stile e larghezza. */

import type { DividerBlockContent } from '@alphaink/shared';
import * as React from 'react';

import type { BlockViewProps } from './types';

export function DividerBlock({ block }: BlockViewProps) {
  const content = block.content as DividerBlockContent & { type: 'divider' };
  const align = block.style.align ?? 'center';
  const width = Math.min(100, Math.max(1, content.widthPercent || 100));

  return (
    <div
      style={{
        width: `${width}%`,
        marginLeft: align === 'center' ? 'auto' : align === 'right' ? 'auto' : 0,
        marginRight: align === 'center' ? 'auto' : 0,
        borderTop: `${content.thickness || 1}px ${content.style || 'solid'} ${content.color}`,
        fontSize: 0,
        lineHeight: 0,
      }}
    />
  );
}
