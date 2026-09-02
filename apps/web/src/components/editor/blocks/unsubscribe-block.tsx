'use client';

/**
 * Blocco di disiscrizione.
 *
 * È obbligatorio per legge e per la reputazione di invio: il renderer sostituisce
 * i link con gli indirizzi firmati per il singolo destinatario, qui restano
 * indicativi.
 */

import { ALPHAINK_PALETTE } from '@alphaink/shared';
import type { UnsubscribeBlockContent } from '@alphaink/shared';
import * as React from 'react';

import { typographyToStyle } from '../utils';
import type { BlockViewProps } from './types';

export function UnsubscribeBlock({ block }: BlockViewProps) {
  const content = block.content as UnsubscribeBlockContent & { type: 'unsubscribe' };
  const linkStyle: React.CSSProperties = {
    color: content.typography.color || ALPHAINK_PALETTE.muted,
    textDecoration: 'underline',
  };

  return (
    <div style={typographyToStyle(content.typography)}>
      {content.text ? (
        <>
          {content.text}
          <br />
        </>
      ) : null}
      <span style={linkStyle}>{content.linkLabel || 'Disiscriviti'}</span>
      {content.showPreferencesLink ? (
        <>
          <span style={{ padding: '0 6px', color: ALPHAINK_PALETTE.muted }}>|</span>
          <span style={linkStyle}>{content.preferencesLabel || 'Gestisci le preferenze'}</span>
        </>
      ) : null}
    </div>
  );
}
