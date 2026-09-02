import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SettingsView } from '@/components/settings/settings-view';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Impostazioni',
  description:
    'Configurazione della suite AlphaInk: Brevo, negozi PrestaShop B2C e B2B, tracciamento e attribuzione, identità visiva, utenti e manutenzione.',
};

/** Scheletro mostrato finché la scheda attiva non è nota (query string). */
function SettingsFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-2xl" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function ImpostazioniPage() {
  // `SettingsView` legge la scheda attiva da `useSearchParams`: durante il
  // rendering statico serve un confine di sospensione.
  return (
    <Suspense fallback={<SettingsFallback />}>
      <SettingsView />
    </Suspense>
  );
}
