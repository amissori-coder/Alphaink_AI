'use client';

/** Blocco menu di navigazione: voci separate da un carattere configurabile. */

import { ALPHAINK_PALETTE } from '@alphaink/shared';
import type { MenuBlockContent } from '@alphaink/shared';
import { Menu } from 'lucide-react';
import * as React from 'react';

import { typographyToStyle } from '../utils';
import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

export function MenuBlock({ block }: BlockViewProps) {
  const content = block.content as MenuBlockContent & { type: 'menu' };
  const items = (content.items ?? []).filter((item) => item && item.label);

  if (!items.length) {
    return (
      <BlockPlaceholder
        icon={<Menu />}
        title="Menu senza voci"
        description="Aggiungi le sezioni del sito che vuoi mettere in evidenza."
      />
    );
  }

  return (
    <div style={typographyToStyle(content.typography)}>
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 ? (
            <span style={{ padding: '0 8px', color: ALPHAINK_PALETTE.muted }}>
              {content.separator ?? '·'}
            </span>
          ) : null}
          <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
