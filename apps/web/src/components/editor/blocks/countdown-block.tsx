'use client';

/**
 * Blocco conto alla rovescia.
 *
 * L'email è statica: il valore viene fotografato al momento del render, poco
 * prima della spedizione. L'anteprima calcola il residuo rispetto ad adesso e
 * segnala se la scadenza è già passata, perché in quel caso il renderer
 * mostrerebbe "Offerta scaduta".
 */

import type { CountdownBlockContent } from '@alphaink/shared';
import { TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { MergeTagText } from './shared';
import type { BlockViewProps } from './types';

function Box({ value, unit, accent }: { value: number; unit: string; accent: string }) {
  return (
    <div
      style={{
        minWidth: '64px',
        padding: '12px 14px',
        backgroundColor: accent,
        borderRadius: '8px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '28px', fontWeight: 800, lineHeight: 1, color: '#FFFFFF' }}>{value}</div>
      <div
        style={{
          fontSize: '11px',
          fontWeight: 600,
          lineHeight: 1,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: '#FFFFFF',
          paddingTop: '6px',
        }}
      >
        {unit}
      </div>
    </div>
  );
}

export function CountdownBlock({ block }: BlockViewProps) {
  const content = block.content as CountdownBlockContent & { type: 'countdown' };
  const align = block.style.align ?? 'center';

  const end = new Date(content.endsAt);
  const valid = !Number.isNaN(end.getTime());
  const diff = valid ? end.getTime() - Date.now() : 0;
  const totalHours = Math.max(0, Math.floor(diff / 3_600_000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  const boxes: React.ReactNode[] = [];
  if (content.showDays !== false) {
    boxes.push(
      <Box key="giorni" value={days} unit={days === 1 ? 'giorno' : 'giorni'} accent={content.accentColor} />,
    );
  }
  if (content.showHours) {
    boxes.push(<Box key="ore" value={hours} unit={hours === 1 ? 'ora' : 'ore'} accent={content.accentColor} />);
  }
  if (!boxes.length) {
    boxes.push(
      <Box key="giorni" value={days} unit={days === 1 ? 'giorno' : 'giorni'} accent={content.accentColor} />,
    );
  }

  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <div>
      {content.label ? (
        <div
          style={{
            fontSize: '14px',
            fontWeight: 600,
            lineHeight: 1.4,
            paddingBottom: '10px',
            textAlign: align === 'justify' ? 'left' : align,
          }}
        >
          <MergeTagText value={content.label} />
        </div>
      ) : null}

      {!valid || diff <= 0 ? (
        <div
          style={{ textAlign: align === 'justify' ? 'left' : align }}
          className="flex flex-col items-center gap-1"
        >
          <span style={{ fontSize: '18px', fontWeight: 700, color: content.accentColor }}>
            Offerta scaduta
          </span>
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <TriangleAlert className="size-3" aria-hidden="true" />
            {valid ? 'La scadenza è già passata' : 'Data di scadenza non valida'}
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '12px', justifyContent: justify }}>{boxes}</div>
      )}
    </div>
  );
}
