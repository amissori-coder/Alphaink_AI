import type { Metadata } from 'next';

import { CreateNewsletterForm } from '@/components/newsletter/create-newsletter-form';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = {
  title: 'Nuova newsletter',
  description:
    'Crea una bozza di newsletter partendo da un template AlphaInk oppure da un documento vuoto.',
};

export default function NuovaNewsletterPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Newsletter"
        title="Nuova newsletter"
        description="Assegna un nome, scrivi l’oggetto e scegli il punto di partenza: il contenuto si compone poi nell’editor a blocchi."
      />
      <CreateNewsletterForm />
    </div>
  );
}
