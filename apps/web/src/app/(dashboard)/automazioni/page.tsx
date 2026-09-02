import type { Metadata } from 'next';

import { AutomationsList } from '@/components/automations/automations-list';

export const metadata: Metadata = {
  title: 'Automazioni',
  description:
    'Coupon stampante, recupero dei pagamenti abbandonati e promemoria di riacquisto: stato, metriche e configurazione dei flussi automatici AlphaInk.',
};

export default function AutomazioniPage() {
  return <AutomationsList />;
}
