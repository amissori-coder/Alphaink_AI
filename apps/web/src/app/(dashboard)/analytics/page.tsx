import type { Metadata } from 'next';

import { AnalyticsView } from '@/components/analytics/analytics-view';

export const metadata: Metadata = {
  title: 'Analytics',
  description:
    'Consegne, aperture, click, fatturato attribuito e momento migliore di invio delle comunicazioni AlphaInk.',
};

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
