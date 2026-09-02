'use client';

/**
 * Impostazioni → Sistema.
 *
 * Contiene le operazioni di manutenzione (creazione dei dati predefiniti), le
 * informazioni sull'ambiente in esecuzione e i collegamenti alla documentazione.
 *
 * Nota sui webhook: gli endpoint chiamati da Brevo e dal sito PrestaShop sono
 * Cloud Functions HTTP (`brevoWebhook`, `siteWebhook`), non route della web app.
 * Le route `/api/*` di Next.js servono solo alla stessa interfaccia (stato,
 * anteprima delle newsletter, esportazione contatti).
 */

import * as React from 'react';
import { BookOpen, Database, ExternalLink, HeartPulse, Info, Server, Sparkles } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/auth-context';
import { FUNCTIONS_REGION } from '@/lib/firebase/client';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDateTimeIt } from '@/lib/utils';

import { seedDefaults } from './api';
import { DOC_LINKS } from './constants';
import { CheckResult, SettingsSection } from './settings-shell';
import type { SeedDefaultsResult } from './types';

/** Versione dell'applicazione, allineata a `apps/web/package.json`. */
const APP_VERSION = '1.0.0';

interface HealthPayload {
  status: string;
  version?: string;
  environment?: string;
  timestamp?: string;
  firebase?: { projectId: string | null; configured: boolean };
  functions?: { region: string };
}

export function SystemSettingsPanel() {
  const { can } = useAuth();
  const canWrite = can('settings:write');

  const [overwriteTemplates, setOverwriteTemplates] = React.useState(false);
  const [includeAutomations, setIncludeAutomations] = React.useState(true);
  const [seeding, setSeeding] = React.useState(false);
  const [seedResult, setSeedResult] = React.useState<SeedDefaultsResult | null>(null);

  const [health, setHealth] = React.useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = React.useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = React.useState(false);

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'non configurato';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'non configurato';

  const runSeed = React.useCallback(async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      const result = await seedDefaults({ overwriteTemplates, includeAutomations });
      setSeedResult(result);
      toastSuccess(
        'Configurazione predefinita applicata.',
        `${result.templates.created.length} template creati, ${result.automations.created.length} automazioni create.`,
      );
    } catch (error) {
      toastError(error, 'Impossibile creare i dati predefiniti.');
    } finally {
      setSeeding(false);
    }
  }, [includeAutomations, overwriteTemplates]);

  const checkHealth = React.useCallback(async () => {
    setCheckingHealth(true);
    setHealthError(null);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Risposta ${response.status} dal servizio.`);
      setHealth((await response.json()) as HealthPayload);
    } catch (error) {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : 'Verifica non riuscita.');
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  return (
    <div className="space-y-5">
      {/* --- Dati predefiniti ---------------------------------------------- */}
      <SettingsSection
        title="Inizializza dati predefiniti"
        description="Crea ciò che manca senza toccare quello che esiste già: documenti di configurazione, template di sistema e automazioni AlphaInk."
        icon={<Sparkles />}
      >
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Operazione sicura e ripetibile</AlertTitle>
          <AlertDescription>
            L’operazione aggiunge solo gli elementi mancanti: impostazioni Brevo, sito, tracciamento e
            brand, i template di partenza e le automazioni predefinite (coupon prima stampante,
            pagamento abbandonato, carrello abbandonato, riacquisto toner e cartucce). Le newsletter, i
            contatti e le statistiche non vengono mai toccati.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={includeAutomations}
              onCheckedChange={(checked) => setIncludeAutomations(checked === true)}
              disabled={!canWrite || seeding}
              aria-label="Crea le automazioni predefinite"
            />
            <span>
              <span className="block font-medium text-foreground">Crea le automazioni predefinite</span>
              <span className="block text-xs text-muted-foreground">
                Vengono create disattivate: si attivano una per una dalla sezione Automazioni.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={overwriteTemplates}
              onCheckedChange={(checked) => setOverwriteTemplates(checked === true)}
              disabled={!canWrite || seeding}
              aria-label="Ripristina i template di sistema"
            />
            <span>
              <span className="block font-medium text-foreground">
                Ripristina il contenuto dei template di sistema
              </span>
              <span className="block text-xs text-muted-foreground">
                Sovrascrive le modifiche fatte ai template di partenza. I template creati da zero
                restano invariati.
              </span>
            </span>
          </label>
        </div>

        <Button onClick={() => void runSeed()} loading={seeding} disabled={!canWrite}>
          {seeding ? null : <Database aria-hidden="true" />}
          Inizializza dati predefiniti
        </Button>

        {seedResult ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium text-foreground">Esito dell’operazione</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                Impostazioni:{' '}
                {Object.entries(seedResult.settings)
                  .map(([docId, outcome]) => `${docId} ${outcome}`)
                  .join(' · ')}
              </li>
              <li>
                Template: {seedResult.templates.created.length} creati ·{' '}
                {seedResult.templates.updated.length} aggiornati ·{' '}
                {seedResult.templates.unchanged.length} invariati
              </li>
              <li>
                Automazioni: {seedResult.automations.created.length} create ·{' '}
                {seedResult.automations.existing.length} già presenti
              </li>
            </ul>
          </div>
        ) : null}
      </SettingsSection>

      {/* --- Ambiente ------------------------------------------------------- */}
      <SettingsSection
        title="Ambiente di esecuzione"
        description="Coordinate del progetto Firebase su cui sta girando questa istanza."
        icon={<Server />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void checkHealth()} loading={checkingHealth}>
            {checkingHealth ? null : <HeartPulse aria-hidden="true" />}
            Verifica stato
          </Button>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted-foreground">Versione applicazione</dt>
            <dd className="text-sm font-medium text-foreground">{APP_VERSION}</dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted-foreground">Progetto Firebase</dt>
            <dd className="truncate text-sm font-medium text-foreground" title={projectId}>
              {projectId}
            </dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted-foreground">Regione delle Functions</dt>
            <dd className="text-sm font-medium text-foreground">{FUNCTIONS_REGION}</dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-xs text-muted-foreground">Indirizzo pubblico</dt>
            <dd className="truncate text-sm font-medium text-foreground" title={appUrl}>
              {appUrl}
            </dd>
          </div>
        </dl>

        {health ? (
          <CheckResult
            ok={health.status === 'ok'}
            message={`Servizio ${health.status}${health.environment ? ` · ambiente ${health.environment}` : ''}${
              health.timestamp ? ` · ${formatDateTimeIt(health.timestamp)}` : ''
            }`}
          />
        ) : null}
        {healthError ? <CheckResult ok={false} message={healthError} /> : null}

        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Webhook in ingresso</AlertTitle>
          <AlertDescription>
            Le notifiche di Brevo e del sito PrestaShop arrivano alle Cloud Functions{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">brevoWebhook</code> e{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">siteWebhook</code> nella
            regione {FUNCTIONS_REGION}, non a questa applicazione web. Le route{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/*</code> servono solo
            l’interfaccia: stato del servizio, anteprima delle newsletter ed esportazione dei contatti.
          </AlertDescription>
        </Alert>
      </SettingsSection>

      {/* --- Documentazione -------------------------------------------------- */}
      <SettingsSection
        title="Documentazione"
        description="Riferimenti utili per configurare i servizi collegati."
        icon={<BookOpen />}
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {DOC_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex h-full flex-col gap-1 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {link.label}
                  <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </span>
                <span className="text-xs text-muted-foreground">{link.description}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">Next.js 15</Badge>
          <Badge variant="outline">Firebase Functions v2</Badge>
          <Badge variant="outline">Brevo API v3</Badge>
          <Badge variant="outline">PrestaShop</Badge>
        </div>
      </SettingsSection>
    </div>
  );
}
