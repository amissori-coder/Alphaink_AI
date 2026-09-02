'use client';

/**
 * Contenitore dell'area Impostazioni.
 *
 * Una sola pagina con sei schede; la scheda attiva è riflessa nella query
 * `?sezione=` così un collegamento diretto (o un aggiornamento della pagina)
 * riapre esattamente dove si era rimasti.
 */

import { ShieldAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';

import { BrandingSettingsPanel } from './branding-settings';
import { BrevoSettingsPanel } from './brevo-settings';
import { SETTINGS_TABS, isSettingsTab } from './constants';
import { SiteSettingsPanel } from './site-settings';
import { SystemSettingsPanel } from './system-settings';
import { TrackingSettingsPanel } from './tracking-settings';
import type { SettingsTab } from './types';
import { UsersSettingsPanel } from './users-settings';

const PANELS: Record<SettingsTab, React.ComponentType> = {
  brevo: BrevoSettingsPanel,
  sito: SiteSettingsPanel,
  tracciamento: TrackingSettingsPanel,
  brand: BrandingSettingsPanel,
  utenti: UsersSettingsPanel,
  sistema: SystemSettingsPanel,
};

export function SettingsView() {
  const { can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get('sezione');
  const active: SettingsTab = isSettingsTab(requested) ? requested : 'brevo';

  const handleChange = React.useCallback(
    (value: string) => {
      if (!isSettingsTab(value)) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('sezione', value);
      // `replace` evita di riempire la cronologia a ogni cambio di scheda.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!can('settings:read')) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Impostazioni"
          description="Configurazione di Brevo, sincronizzazione del sito, tracciamento, brand e utenti."
        />
        <Alert variant="destructive">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Accesso non consentito</AlertTitle>
          <AlertDescription>
            Il tuo ruolo non consente di consultare le impostazioni di AlphaInk.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const activeTab = SETTINGS_TABS.find((tab) => tab.id === active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impostazioni"
        description={activeTab?.description ?? 'Configurazione della suite newsletter AlphaInk.'}
        eyebrow="Sistema"
      />

      <Tabs value={active} onValueChange={handleChange} className="space-y-4">
        <TabsList variant="underline" className="w-full overflow-x-auto">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                <Icon aria-hidden="true" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SETTINGS_TABS.map((tab) => {
          const Panel = PANELS[tab.id];
          return (
            <TabsContent key={tab.id} value={tab.id} className="mt-4 focus-visible:ring-0">
              {/* I pannelli sono montati solo quando la scheda è attiva:
                  evita sottoscrizioni Firestore inutili. */}
              {active === tab.id ? <Panel /> : null}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
