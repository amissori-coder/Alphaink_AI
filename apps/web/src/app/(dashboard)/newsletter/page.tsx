import type { Metadata } from 'next';

import { NewsletterList } from '@/components/newsletter/newsletter-list';

export const metadata: Metadata = {
  title: 'Newsletter',
  description:
    'Bozze, campagne pianificate e newsletter inviate di AlphaInk, con aperture, click, ordini e fatturato attribuito.',
};

export default function NewsletterPage() {
  return <NewsletterList />;
}
