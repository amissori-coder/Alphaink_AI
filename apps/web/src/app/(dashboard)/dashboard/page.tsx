import type { Metadata } from 'next';

import { DashboardView } from '@/components/dashboard/dashboard-view';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Andamento di invii, aperture, click e fatturato attribuito alle newsletter e alle automazioni AlphaInk.',
};

export default function DashboardPage() {
  return <DashboardView />;
}
