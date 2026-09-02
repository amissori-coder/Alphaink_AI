'use client';

/**
 * Blocco coupon.
 *
 * Riproduce il riquadro del renderer: cornice colorata, sconto, descrizione,
 * codice in carattere monospaziato, scadenza e pulsante. Con `dynamic` attivo
 * il codice è generato per ogni destinatario e in anteprima resta il merge tag
 * `{{coupon.code}}`.
 */

import { ALPHAINK_PALETTE } from '@alphaink/shared';
import type { CouponBlockContent } from '@alphaink/shared';
import { TicketPercent } from 'lucide-react';
import * as React from 'react';

import { formatDateIt } from '@/lib/utils';

import { BlockPlaceholder, MergeTagText } from './shared';
import type { BlockViewProps } from './types';

export function CouponBlock({ block }: BlockViewProps) {
  const content = block.content as CouponBlockContent & { type: 'coupon' };
  const code = content.dynamic ? '{{coupon.code}}' : (content.code ?? '').trim();
  const borderStyle = content.borderStyle === 'solid' ? 'solid' : 'dashed';

  if (!code) {
    return (
      <BlockPlaceholder
        icon={<TicketPercent />}
        title="Coupon senza codice"
        description="Inserisci un codice fisso oppure attiva il codice generato per ogni destinatario."
      />
    );
  }

  return (
    <div
      style={{
        padding: '24px 20px',
        backgroundColor: content.backgroundColor,
        border: `2px ${borderStyle} ${ALPHAINK_PALETTE.cyan}`,
        borderRadius: '10px',
        textAlign: 'center',
      }}
    >
      {content.discountLabel ? (
        <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1.2, color: content.textColor }}>
          <MergeTagText value={content.discountLabel} />
        </div>
      ) : null}

      {content.description ? (
        <div
          style={{
            fontSize: '14px',
            lineHeight: 1.5,
            color: content.textColor,
            paddingTop: '4px',
          }}
        >
          <MergeTagText value={content.description} />
        </div>
      ) : null}

      <div style={{ paddingTop: '12px' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
            fontSize: '18px',
            fontWeight: 700,
            letterSpacing: '2px',
            color: content.textColor,
            backgroundColor: '#FFFFFF',
            border: `1px ${borderStyle} ${ALPHAINK_PALETTE.muted}`,
            borderRadius: '6px',
          }}
        >
          <MergeTagText value={code} />
        </span>
      </div>

      {content.expiresAt ? (
        <div
          style={{
            fontSize: '12px',
            lineHeight: 1.4,
            color: ALPHAINK_PALETTE.muted,
            paddingTop: '8px',
          }}
        >
          Valido fino al {formatDateIt(content.expiresAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        </div>
      ) : null}

      {content.ctaLabel ? (
        <div style={{ paddingTop: '14px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '11px 22px',
              fontSize: '15px',
              fontWeight: 700,
              color: '#FFFFFF',
              backgroundColor: ALPHAINK_PALETTE.cyan,
              borderRadius: '6px',
            }}
          >
            {content.ctaLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
