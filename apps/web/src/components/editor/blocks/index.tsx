'use client';

/**
 * Dispatcher dei renderer di blocco.
 *
 * Come nel motore di rendering delle Functions, il tipo autorevole è quello del
 * **contenuto**: `block.type` potrebbe essere rimasto indietro dopo una
 * conversione, e seguirlo mostrerebbe un blocco diverso da quello che finirà
 * nell'email.
 */

import type { BlockType } from '@alphaink/shared';
import { HelpCircle } from 'lucide-react';
import * as React from 'react';

import { ButtonBlock } from './button-block';
import { CountdownBlock } from './countdown-block';
import { CouponBlock } from './coupon-block';
import { DividerBlock } from './divider-block';
import { FooterBlock } from './footer-block';
import { HeadingBlock } from './heading-block';
import { HtmlBlock } from './html-block';
import { ImageBlock } from './image-block';
import { MenuBlock } from './menu-block';
import { ProductBlock } from './product-block';
import { ProductGridBlock } from './product-grid-block';
import { BlockPlaceholder } from './shared';
import { SocialBlock } from './social-block';
import { SpacerBlock } from './spacer-block';
import { TextBlock } from './text-block';
import type { BlockViewProps } from './types';
import { UnsubscribeBlock } from './unsubscribe-block';
import { VideoBlock } from './video-block';

const RENDERERS: Record<BlockType, React.ComponentType<BlockViewProps>> = {
  text: TextBlock,
  heading: HeadingBlock,
  image: ImageBlock,
  button: ButtonBlock,
  divider: DividerBlock,
  spacer: SpacerBlock,
  social: SocialBlock,
  video: VideoBlock,
  html: HtmlBlock,
  product: ProductBlock,
  product_grid: ProductGridBlock,
  coupon: CouponBlock,
  countdown: CountdownBlock,
  menu: MenuBlock,
  footer: FooterBlock,
  unsubscribe: UnsubscribeBlock,
};

/** Rende un blocco con il componente corrispondente al suo tipo. */
export function BlockView(props: BlockViewProps) {
  const type = (props.block.content?.type ?? props.block.type) as BlockType;
  const Component = RENDERERS[type];

  if (!Component) {
    return (
      <BlockPlaceholder
        icon={<HelpCircle />}
        title="Blocco non riconosciuto"
        description={`Tipo «${String(type)}»: verrà ignorato nell’invio. Eliminalo o sostituiscilo.`}
      />
    );
  }

  return <Component {...props} />;
}

export { ButtonBlock } from './button-block';
export { CountdownBlock } from './countdown-block';
export { CouponBlock } from './coupon-block';
export { DividerBlock } from './divider-block';
export { FooterBlock } from './footer-block';
export { HeadingBlock } from './heading-block';
export { HtmlBlock } from './html-block';
export { ImageBlock } from './image-block';
export { MenuBlock } from './menu-block';
export { ProductBlock, ProductCard, discountPercent } from './product-block';
export { DYNAMIC_SOURCE_LABELS, ProductGridBlock } from './product-grid-block';
export { BlockPlaceholder, MergeTagText } from './shared';
export { SOCIAL_LABELS, SocialBlock } from './social-block';
export { SpacerBlock } from './spacer-block';
export { TextBlock } from './text-block';
export { UnsubscribeBlock } from './unsubscribe-block';
export { VideoBlock } from './video-block';
export type { BlockViewProps } from './types';
