import type { Metadata } from 'next';

import { ClusterEditor } from '@/components/clusters/cluster-editor';

export const metadata: Metadata = {
  title: 'Modifica cluster',
  description:
    'Costruttore visuale delle regole di un cluster AlphaInk, con anteprima live del numero di contatti.',
};

export default async function ClusterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClusterEditor clusterId={id} />;
}
