'use client';

/**
 * Blocco pulsante.
 *
 * Riproduce la resa "bulletproof" del renderer: contenitore centrato secondo
 * l'allineamento del blocco, padding orizzontale e verticale espliciti, raggio
 * e bordo facoltativi. Se manca un indirizzo valido il pulsante è segnalato,
 * perché il renderer lo scarterebbe con un errore bloccante.
 */

import type { ButtonBlockContent } from '@alphaink/shared';
import { TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { borderToCss, isUsableUrl } from '../utils';
import { MergeTagText } from './shared';
import type { BlockViewProps } from './types';

export function ButtonBlock({ block }: BlockViewProps) {
  const content = block.content as ButtonBlockContent & { type: 'button' };
  const align = block.style.align ?? 'center';
  const invalidHref = !isUsableUrl(content.href) && !content.href.trim().startsWith('{{');

  return (
    <div style={{ textAlign: align === 'justify' ? 'left' : align }}>
      <span
        style={{
          display: content.fullWidth ? 'block' : 'inline-block',
          width: content.fullWidth ? '100%' : undefined,
          padding: `${content.paddingY}px ${content.paddingX}px`,
          fontSize: `${content.fontSize}px`,
          fontWeight: content.fontWeight,
          lineHeight: 1.2,
          color: content.textColor,
          backgroundColor: content.backgroundColor,
          borderRadius: `${content.borderRadius}px`,
          border: borderToCss(content.border),
          textAlign: 'center',
          textDecoration: 'none',
        }}
      >
        <MergeTagText value={content.label} placeholder="Etichetta del pulsante" />
      </span>

      {invalidHref ? (
        <span className="mt-1.5 flex items-center justify-center gap-1 text-[11px] font-medium text-amber-600">
          <TriangleAlert className="size-3" aria-hidden="true" />
          Indirizzo mancante o non valido
        </span>
      ) : null}
    </div>
  );
}
