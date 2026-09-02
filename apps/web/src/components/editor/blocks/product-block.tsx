'use client';

/**
 * Blocco prodotto e scheda prodotto riutilizzabile.
 *
 * La scheda replica la struttura del renderer: badge sconto, nome, prezzo con
 * eventuale prezzo barrato e pulsante d'acquisto. Il layout orizzontale mette
 * l'immagine a sinistra (38% della larghezza), quello verticale in alto.
 */

import { ALPHAINK_PALETTE, DEFAULT_CURRENCY } from '@alphaink/shared';
import type { EmailGlobalStyles, ProductBlockContent } from '@alphaink/shared';
import { Package } from 'lucide-react';
import * as React from 'react';

import { formatCurrency } from '@/lib/utils';

import { useEditor } from '../editor-store';
import { isUsableUrl } from '../utils';
import { MergeTagText } from './shared';
import type { BlockViewProps } from './types';

/** Percentuale di sconto, se il prezzo pieno è superiore a quello attuale. */
export function discountPercent(product: ProductBlockContent): number | null {
  if (!product.compareAtPrice || product.compareAtPrice <= product.price) return null;
  return Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100);
}

export interface ProductCardProps {
  product: ProductBlockContent;
  width: number;
  layout: 'horizontal' | 'vertical';
  globalStyles: EmailGlobalStyles;
}

/** Scheda prodotto usata dal blocco singolo e dalla griglia. */
export function ProductCard({ product, width, layout, globalStyles }: ProductCardProps) {
  const percent = discountPercent(product);
  const hasImage = isUsableUrl(product.imageUrl);
  const imageWidth = layout === 'horizontal' ? Math.round(width * 0.38) : width;

  const image = hasImage ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={product.imageUrl}
      alt={product.name || product.sku || 'Prodotto'}
      style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', borderRadius: '8px' }}
    />
  ) : (
    <div
      className="flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400"
      style={{ aspectRatio: '1 / 1' }}
    >
      <Package className="size-5" aria-hidden="true" />
    </div>
  );

  const details = (
    <div>
      {product.showDiscountBadge && percent !== null ? (
        <div style={{ paddingBottom: '6px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 8px',
              fontSize: '12px',
              fontWeight: 700,
              lineHeight: 1,
              color: '#FFFFFF',
              backgroundColor: ALPHAINK_PALETTE.magenta,
              borderRadius: '4px',
            }}
          >
            -{percent}%
          </span>
        </div>
      ) : null}

      <div
        style={{
          fontSize: '16px',
          fontWeight: 600,
          lineHeight: 1.4,
          color: globalStyles.headingColor,
        }}
      >
        <MergeTagText value={product.name} placeholder="Nome del prodotto" />
      </div>

      {product.showPrice ? (
        <div
          style={{
            fontSize: '18px',
            fontWeight: 700,
            color: globalStyles.textColor,
            paddingTop: '6px',
          }}
        >
          {formatCurrency(product.price ?? 0, product.currency || DEFAULT_CURRENCY)}
          {product.compareAtPrice && product.compareAtPrice > product.price ? (
            <span
              style={{
                color: ALPHAINK_PALETTE.muted,
                textDecoration: 'line-through',
                fontSize: '13px',
                paddingLeft: '8px',
              }}
            >
              {formatCurrency(product.compareAtPrice, product.currency || DEFAULT_CURRENCY)}
            </span>
          ) : null}
        </div>
      ) : null}

      {product.ctaLabel ? (
        <div style={{ paddingTop: '10px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '9px 18px',
              fontSize: '14px',
              fontWeight: 600,
              lineHeight: 1.2,
              color: '#FFFFFF',
              backgroundColor: ALPHAINK_PALETTE.cyan,
              borderRadius: '6px',
            }}
          >
            {product.ctaLabel}
          </span>
        </div>
      ) : null}
    </div>
  );

  if (layout === 'horizontal') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ width: `${imageWidth}px`, flex: `0 0 ${imageWidth}px` }}>{image}</div>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>{details}</div>
      </div>
    );
  }

  return (
    <div>
      <div>{image}</div>
      <div style={{ paddingTop: '10px' }}>{details}</div>
    </div>
  );
}

export function ProductBlock({ block, width }: BlockViewProps) {
  const { state } = useEditor();
  const content = block.content as ProductBlockContent & { type: 'product' };

  return (
    <ProductCard
      product={content}
      width={width}
      layout={content.layout === 'vertical' ? 'vertical' : 'horizontal'}
      globalStyles={state.document.globalStyles}
    />
  );
}
