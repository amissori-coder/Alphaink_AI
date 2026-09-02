'use client';

/**
 * Blocco HTML personalizzato.
 *
 * L'anteprima mostra il markup renderizzato dopo una ripulitura di sicurezza
 * lato client (script, iframe, gestori `on*`): l'editor gira nella stessa
 * pagina dell'applicazione e non deve eseguire nulla che arrivi dal contenuto.
 * La sanificazione autorevole resta quella del renderer, prima dell'invio.
 */

import type { HtmlBlockContent } from '@alphaink/shared';
import { Code2 } from 'lucide-react';
import * as React from 'react';

import { htmlToPlainText, sanitizePreviewHtml } from '../utils';
import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

export function HtmlBlock({ block, selected }: BlockViewProps) {
  const content = block.content as HtmlBlockContent & { type: 'html' };
  const safe = React.useMemo(() => sanitizePreviewHtml(content.html ?? ''), [content.html]);
  const empty = !htmlToPlainText(safe) && !/<(img|table|hr|br)\b/i.test(safe);

  if (empty) {
    return (
      <BlockPlaceholder
        icon={<Code2 />}
        title="HTML personalizzato"
        description="Incolla il tuo markup dal pannello a destra: script e attributi non sicuri vengono rimossi."
      />
    );
  }

  return (
    <div className="relative">
      <div dangerouslySetInnerHTML={{ __html: safe }} />
      {selected ? (
        <span className="absolute -top-2 right-0 rounded-md bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          HTML
        </span>
      ) : null}
    </div>
  );
}
