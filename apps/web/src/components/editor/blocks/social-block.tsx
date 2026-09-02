'use client';

/**
 * Blocco social.
 *
 * L'anteprima riproduce il comportamento del renderer: senza un CDN di icone
 * configurato nel brand, i profili sono resi come pillole testuali. Rendono
 * ovunque, restano leggibili con le immagini bloccate e sono accessibili agli
 * screen reader.
 */

import { ALPHAINK_PALETTE } from '@alphaink/shared';
import type { SocialBlockContent, SocialNetwork } from '@alphaink/shared';
import { Share2 } from 'lucide-react';
import * as React from 'react';

import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  x: 'X',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Sito web',
};

export function SocialBlock({ block }: BlockViewProps) {
  const content = block.content as SocialBlockContent & { type: 'social' };
  const items = (content.items ?? []).filter((item) => item && item.url);
  const align = block.style.align ?? 'center';
  const style = content.iconStyle || 'color';
  const filled = style !== 'light' && style !== 'outline';
  const background = style === 'dark' ? ALPHAINK_PALETTE.key : ALPHAINK_PALETTE.cyan;

  if (!items.length) {
    return (
      <BlockPlaceholder
        icon={<Share2 />}
        title="Nessun profilo social"
        description="Aggiungi i tuoi profili dal pannello a destra."
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `${Math.max(0, content.spacing ?? 8)}px`,
        justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
      }}
    >
      {items.map((item, index) => (
        <span
          key={`${item.network}-${index}`}
          style={{
            display: 'inline-block',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1,
            borderRadius: '999px',
            color: filled ? '#FFFFFF' : ALPHAINK_PALETTE.key,
            backgroundColor: filled ? background : 'transparent',
            border: filled ? undefined : `1px solid ${ALPHAINK_PALETTE.muted}`,
            whiteSpace: 'nowrap',
          }}
        >
          {SOCIAL_LABELS[item.network] ?? item.network}
        </span>
      ))}
    </div>
  );
}
