import type { Metadata } from 'next';

import { NewsletterDetail } from '@/components/newsletter/newsletter-detail';

export const metadata: Metadata = {
  title: 'Scheda newsletter',
  description:
    'Anteprima, pubblico, pianificazione e report di una singola newsletter AlphaInk.',
};

export default async function NewsletterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NewsletterDetail newsletterId={id} />;
}
