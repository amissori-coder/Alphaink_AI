'use client';

/**
 * Blocco spazio.
 *
 * Nell'email è una cella vuota alta N pixel: nell'editor la stessa altezza è
 * resa con una tratteggiatura leggera, visibile solo mentre il blocco è
 * selezionato o sotto il puntatore, così il canvas resta pulito.
 */

import type { SpacerBlockContent } from '@alphaink/shared';
import * as React from 'react';

import { cn } from '@/lib/utils';

import type { BlockViewProps } from './types';

export function SpacerBlock({ block, selected }: BlockViewProps) {
  const content = block.content as SpacerBlockContent & { type: 'spacer' };
  const height = Math.max(1, Math.round(content.height || 16));

  return (
    <div
      style={{ height: `${height}px` }}
      className={cn(
        'group/spacer flex items-center justify-center rounded-sm transition-colors',
        selected ? 'bg-sky-50' : 'hover:bg-slate-50',
      )}
    >
      <span
        className={cn(
          'select-none text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover/spacer:opacity-100',
        )}
      >
        {height} px
      </span>
    </div>
  );
}
