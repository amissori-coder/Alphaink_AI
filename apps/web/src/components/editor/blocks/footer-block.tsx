'use client';

/**
 * Blocco piè di pagina: ragione sociale, indirizzo e riga fiscale.
 * L'HTML aggiuntivo è mostrato dopo la ripulitura di sicurezza.
 */

import type { FooterBlockContent } from '@alphaink/shared';
import * as React from 'react';

import { sanitizePreviewHtml, typographyToStyle } from '../utils';
import type { BlockViewProps } from './types';

export function FooterBlock({ block }: BlockViewProps) {
  const content = block.content as FooterBlockContent & { type: 'footer' };
  const extra = React.useMemo(
    () => sanitizePreviewHtml(content.extraHtml ?? ''),
    [content.extraHtml],
  );

  return (
    <div style={typographyToStyle(content.typography)}>
      {content.companyName ? <strong>{content.companyName}</strong> : null}
      {content.address ? (
        <>
          {content.companyName ? <br /> : null}
          {content.address}
        </>
      ) : null}
      {content.vatLine ? (
        <>
          <br />
          {content.vatLine}
        </>
      ) : null}
      {extra ? <div style={{ paddingTop: '8px' }} dangerouslySetInnerHTML={{ __html: extra }} /> : null}
    </div>
  );
}
