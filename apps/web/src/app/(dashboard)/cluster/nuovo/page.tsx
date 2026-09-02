import type { Metadata } from 'next';

import { ClusterEditor } from '@/components/clusters/cluster-editor';

export const metadata: Metadata = {
  title: 'Nuovo cluster',
  description:
    'Crea un segmento di contatti AlphaInk combinando condizioni su anagrafica, acquisti ed engagement.',
};

export default function NuovoClusterPage() {
  return <ClusterEditor />;
}
