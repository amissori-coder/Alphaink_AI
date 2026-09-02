import type { Metadata } from 'next';

import { ClusterList } from '@/components/clusters/cluster-list';

export const metadata: Metadata = {
  title: 'Cluster',
  description:
    'Segmenti dinamici e statici dei contatti AlphaInk: regole di appartenenza, conteggi e sincronizzazione con Brevo.',
};

export default function ClusterPage() {
  return <ClusterList />;
}
