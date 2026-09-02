import type { Metadata } from 'next';

import { ContactsList } from '@/components/contacts/contacts-list';

export const metadata: Metadata = {
  title: 'Contatti',
  description:
    'Rubrica dei clienti AlphaInk B2C e B2B: stato di iscrizione, storico d’acquisto, engagement e cluster di appartenenza.',
};

export default function ContattiPage() {
  return <ContactsList />;
}
