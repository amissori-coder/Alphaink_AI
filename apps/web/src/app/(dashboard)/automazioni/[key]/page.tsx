import type { Metadata } from 'next';

import { AutomationDetail } from '@/components/automations/automation-detail';

export const metadata: Metadata = {
  title: 'Configurazione automazione',
  description:
    'Flusso, pubblico, programmazione, mittente e statistiche di una singola automazione AlphaInk.',
};

export default async function AutomazioneDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <AutomationDetail automationId={key} />;
}
