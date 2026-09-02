import type { Metadata } from 'next';

import { NewsletterComparison } from '@/components/analytics/newsletter-comparison';

export const metadata: Metadata = {
  title: 'Confronto newsletter',
  description:
    'Confronta fino a cinque newsletter inviate su volumi, tassi di apertura e click, ordini e fatturato attribuito.',
};

export default function ConfrontoNewsletterPage() {
  return <NewsletterComparison />;
}
