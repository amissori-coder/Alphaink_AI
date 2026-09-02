'use client';

/**
 * Griglia di prodotti.
 *
 * Con `dynamicSource` valorizzato i prodotti sono risolti al momento
 * dell'invio, diversi per ogni destinatario: l'editor lo dichiara con una
 * fascia informativa e mostra comunque le schede statiche come struttura di
 * riferimento.
 */

import type { ProductGridBlockContent } from '@alphaink/shared';
import { LayoutGrid, Sparkles } from 'lucide-react';
import * as React from 'react';

import { useEditor } from '../editor-store';
import { ProductCard } from './product-block';
import { BlockPlaceholder } from './shared';
import type { BlockViewProps } from './types';

/** Etichette delle sorgenti dinamiche. */
export const DYNAMIC_SOURCE_LABELS: Record<
  NonNullable<ProductGridBlockContent['dynamicSource']>['type'],
  string
> = {
  bestsellers: 'I più venduti',
  new_arrivals: 'Novità in catalogo',
  category: 'Categoria del sito',
  recommended_for_contact: 'Consigliati per il contatto',
  compatible_with_printer: 'Compatibili con la stampante del contatto',
};

const GAP = 16;

export function ProductGridBlock({ block, width }: BlockViewProps) {
  const { state } = useEditor();
  const content = block.content as ProductGridBlockContent & { type: 'product_grid' };
  const columns = content.columns === 3 ? 3 : 2;
  const products = content.products ?? [];
  const cellWidth = Math.max(80, Math.floor((width - GAP * (columns - 1)) / columns));

  if (!products.length) {
    return (
      <BlockPlaceholder
        icon={<LayoutGrid />}
        title="Griglia senza prodotti"
        description={
          content.dynamicSource
            ? 'I prodotti verranno scelti automaticamente all’invio: aggiungi comunque una scheda di riserva.'
            : 'Aggiungi i prodotti dal pannello a destra.'
        }
      />
    );
  }

  return (
    <div>
      {content.dynamicSource ? (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-medium text-sky-700">
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Prodotti dinamici · {DYNAMIC_SOURCE_LABELS[content.dynamicSource.type]} (max{' '}
            {content.dynamicSource.limit})
          </span>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: `${GAP}px`,
        }}
      >
        {products.map((product, index) => (
          <ProductCard
            key={`${product.sku || product.name}-${index}`}
            product={product}
            width={cellWidth}
            layout="vertical"
            globalStyles={state.document.globalStyles}
          />
        ))}
      </div>
    </div>
  );
}
