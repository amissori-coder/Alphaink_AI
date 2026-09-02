import type { Metadata } from 'next';

import { ContactDetail } from '@/components/contacts/contact-detail';

export const metadata: Metadata = {
  title: 'Scheda contatto',
  description:
    'Anagrafica, consensi, metriche commerciali, stampanti possedute e cronologia completa di un contatto AlphaInk.',
};

export default async function ContattoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContactDetail contactId={id} />;
}
