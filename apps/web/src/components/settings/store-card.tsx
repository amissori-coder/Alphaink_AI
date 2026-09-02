'use client';

/**
 * Riquadro di configurazione di un negozio PrestaShop.
 *
 * I due negozi AlphaInk — B2C (alphaink.net) e B2B (b2b.alphaink.net) — girano
 * entrambi su PrestaShop e usano lo stesso riquadro. Possono essere due
 * installazioni distinte oppure due shop della stessa installazione in
 * multistore: nel secondo caso si valorizza «Id shop multistore».
 *
 * Ogni negozio si salva per conto proprio: `saveSiteSettings` accetta una patch
 * parziale, quindi non si rischia di sovrascrivere l'altro negozio.
 */

import {
  PRESTASHOP_MODE_LABELS,
  SITE_SOURCE_LABELS,
  SYNC_ENTITIES,
  type PrestaShopStoreSettings,
  type StoreSource,
  type SyncEntity,
  type SyncJob,
} from '@alphaink/shared';
import {
  Database,
  ExternalLink,
  Globe,
  KeyRound,
  Play,
  RefreshCw,
  ShieldCheck,
  Store,
} from 'lucide-react';
import * as React from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAuth } from '@/lib/auth-context';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';
import { cn, formatDateTimeIt, formatNumber } from '@/lib/utils';

import { cancelSiteSync, runSiteSync, saveSiteSettings } from './api';
import { SYNC_ENTITY_HINTS, SYNC_ENTITY_LABELS } from './constants';
import { CustomerGroupMapping, OrderStateMapping } from './mapping-editors';
import { storeSettingsFormSchema, validate, type StoreSettingsFormValues } from './schemas';
import {
  CheckResult,
  ConfiguredBadge,
  SaveBar,
  SettingsField,
  SettingsGrid,
  SettingsSection,
} from './settings-shell';
import { SyncHistory } from './sync-history';
import type {
  ConnectionCheck,
  FieldErrors,
  RunSiteSyncResult,
  SaveSiteSettingsInput,
} from './types';
import { useSettingsForm } from './use-settings';

interface StoreFormValues extends Omit<StoreSettingsFormValues, 'multistoreShopId' | 'languageId' | 'wsKey' | 'dbPassword'> {
  /** Testi liberi finché non si salva: i numeri sono convertiti al submit. */
  multistoreShopId: string;
  languageId: string;
  wsKey: string;
  dbPassword: string;
}

function toForm(store: PrestaShopStoreSettings): StoreFormValues {
  return {
    enabled: store.enabled,
    label: store.label,
    baseUrl: store.baseUrl,
    mode: store.mode,
    multistoreShopId: store.multistoreShopId != null ? String(store.multistoreShopId) : '',
    tablePrefix: store.tablePrefix,
    defaultSegment: store.defaultSegment,
    languageId: String(store.languageId),
    customerGroupMapping: { ...store.customerGroupMapping },
    orderStateMapping: { ...store.orderStateMapping },
    wsKey: '',
    dbPassword: '',
  };
}

export interface StoreCardProps {
  source: StoreSource;
  store: PrestaShopStoreSettings;
  /** Job di sincronizzazione già filtrati per questo negozio. */
  jobs: SyncJob[];
  jobsLoading?: boolean;
  /** Entità proposte per la sincronizzazione manuale (dalla pianificazione). */
  defaultEntities: SyncEntity[];
}

export function StoreCard({ source, store, jobs, jobsLoading, defaultEntities }: StoreCardProps) {
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const canSync = can('sync:run');

  const { form, update, dirty, reset, commit } = useSettingsForm(store, toForm);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [check, setCheck] = React.useState<ConnectionCheck | null>(null);

  const [entities, setEntities] = React.useState<SyncEntity[]>(defaultEntities);
  const [fullResync, setFullResync] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<RunSiteSyncResult | null>(null);
  const [cancellingJobId, setCancellingJobId] = React.useState<string | null>(null);

  // La pianificazione è la fonte delle entità proposte finché l'utente non sceglie.
  const defaultsSignature = defaultEntities.join(',');
  React.useEffect(() => {
    setEntities(defaultEntities.length > 0 ? defaultEntities : ['customers', 'orders']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsSignature]);

  const idPrefix = `negozio-${source}`;
  const isMysql = form.mode === 'mysql';
  const runningJob = jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? null;

  /** Converte il modulo nella patch attesa dalla callable. */
  const buildPatch = React.useCallback(() => {
    const candidate = {
      enabled: form.enabled,
      label: form.label.trim(),
      baseUrl: form.baseUrl.trim(),
      mode: form.mode,
      multistoreShopId: form.multistoreShopId.trim() ? Number(form.multistoreShopId) : null,
      tablePrefix: form.tablePrefix.trim(),
      defaultSegment: form.defaultSegment,
      languageId: Number(form.languageId),
      customerGroupMapping: form.customerGroupMapping,
      orderStateMapping: form.orderStateMapping,
      ...(form.wsKey.trim() ? { wsKey: form.wsKey.trim() } : {}),
      ...(form.dbPassword.trim() ? { dbPassword: form.dbPassword.trim() } : {}),
    };

    const result = validate(storeSettingsFormSchema, candidate);
    if (!result.success) {
      setErrors(result.errors);
      return null;
    }
    setErrors({});
    return result.data;
  }, [form]);

  const save = React.useCallback(
    async (withTest: boolean) => {
      const patch = buildPatch();
      if (!patch) {
        toastError(null, 'Controlla i campi evidenziati in rosso.');
        return;
      }
      if (withTest) setVerifying(true);
      else setSaving(true);
      try {
        // Patch di un solo negozio: l'altro resta intatto.
        const stores: NonNullable<SaveSiteSettingsInput['stores']> = {};
        stores[source] = patch;
        const result = await saveSiteSettings({ stores, testConnection: withTest });
        // Le credenziali non tornano indietro: i campi si svuotano.
        commit({ ...form, wsKey: '', dbPassword: '' });
        setCheck(result.checks?.[source] ?? null);

        for (const warning of result.warnings ?? []) toastWarning('Attenzione', warning);
        if (withTest) {
          const outcome = result.checks?.[source];
          if (outcome?.ok) toastSuccess('Connessione riuscita.', outcome.message);
          else if (outcome) toastError(null, outcome.message);
          else toastSuccess('Impostazioni del negozio salvate.');
        } else {
          toastSuccess('Impostazioni del negozio salvate.');
        }
      } catch (error) {
        toastError(error, 'Impossibile salvare la configurazione del negozio.');
      } finally {
        setSaving(false);
        setVerifying(false);
      }
    },
    [buildPatch, commit, form, source],
  );

  const handleSync = React.useCallback(async () => {
    if (entities.length === 0) {
      toastError(null, 'Seleziona almeno un’entità da sincronizzare.');
      return;
    }
    setSyncing(true);
    setLastRun(null);
    try {
      const result = await runSiteSync({ source, entities, fullResync });
      setLastRun(result);
      if (result.status === 'success') {
        toastSuccess('Sincronizzazione completata.');
      } else if (result.status === 'partial' || result.resumeRequired) {
        toastWarning(
          'Sincronizzazione parziale',
          'Il tempo massimo è stato raggiunto: riavviala per proseguire dal punto in cui si è fermata.',
        );
      } else if (result.error) {
        toastError(null, result.error);
      }
    } catch (error) {
      toastError(error, 'Sincronizzazione non riuscita.');
    } finally {
      setSyncing(false);
    }
  }, [entities, fullResync, source]);

  const handleCancel = React.useCallback(async (jobId: string) => {
    setCancellingJobId(jobId);
    try {
      await cancelSiteSync({ jobId });
      toastSuccess('Interruzione richiesta: il job si fermerà al prossimo blocco.');
    } catch (error) {
      toastError(error, 'Impossibile interrompere la sincronizzazione.');
    } finally {
      setCancellingJobId(null);
    }
  }, []);

  const toggleEntity = (entity: SyncEntity, checked: boolean) => {
    setEntities((current) =>
      checked ? Array.from(new Set([...current, entity])) : current.filter((item) => item !== entity),
    );
  };

  return (
    <SettingsSection
      title={SITE_SOURCE_LABELS[source]}
      description={
        source === 'prestashop_b2b'
          ? 'Negozio riservato ai rivenditori: i clienti nascono con segmento B2B.'
          : 'Negozio al pubblico: i clienti nascono con segmento B2C.'
      }
      icon={<Store />}
      actions={
        <>
          <ConfiguredBadge
            configured={store.credentialsConfigured}
            configuredLabel="Credenziali presenti"
            missingLabel="Credenziali mancanti"
          />
          <Badge variant={form.enabled ? 'success' : 'outline'}>
            {form.enabled ? 'Attivo' : 'Disattivato'}
          </Badge>
          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
            disabled={!canWrite}
            aria-label={`Abilita ${SITE_SOURCE_LABELS[source]}`}
          />
        </>
      }
      footer={
        <SaveBar
          dirty={dirty}
          saving={saving}
          disabled={!canWrite}
          onSave={() => void save(false)}
          onReset={() => {
            reset();
            setErrors({});
            setCheck(null);
          }}
          hint={
            store.lastSyncAt
              ? `Ultima sincronizzazione: ${formatDateTimeIt(store.lastSyncAt)}`
              : 'Nessuna sincronizzazione eseguita.'
          }
          saveLabel="Salva negozio"
          extraActions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void save(true)}
              loading={verifying}
              disabled={!canWrite}
            >
              {verifying ? null : <ShieldCheck aria-hidden="true" />}
              Salva e verifica
            </Button>
          }
        />
      }
    >
      <SettingsGrid>
        <SettingsField
          htmlFor={`${idPrefix}-label`}
          label="Nome del negozio"
          description="Etichetta mostrata in report, cluster e cronologia."
          error={errors.label}
        >
          <Input
            id={`${idPrefix}-label`}
            value={form.label}
            onChange={(event) => update({ label: event.target.value })}
            disabled={!canWrite}
            invalid={Boolean(errors.label)}
          />
        </SettingsField>

        <SettingsField
          htmlFor={`${idPrefix}-base-url`}
          label="Indirizzo del sito"
          required
          description="URL completo della vetrina, senza barra finale."
          error={errors.baseUrl}
        >
          <Input
            id={`${idPrefix}-base-url`}
            type="url"
            inputMode="url"
            value={form.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="https://alphaink.net"
            disabled={!canWrite}
            invalid={Boolean(errors.baseUrl)}
            startIcon={<Globe className="size-4" />}
          />
        </SettingsField>
      </SettingsGrid>

      {/* --- Modalità di lettura ------------------------------------------- */}
      <div className="space-y-2">
        <Label>Modalità di lettura dei dati</Label>
        <ToggleGroup
          type="single"
          value={form.mode}
          onValueChange={(value) => {
            if (value === 'webservice' || value === 'mysql') update({ mode: value });
          }}
          className="w-full sm:w-auto"
          aria-label="Modalità di lettura dei dati PrestaShop"
        >
          <ToggleGroupItem value="webservice" disabled={!canWrite} className="flex-1 sm:flex-none">
            <Globe aria-hidden="true" />
            {PRESTASHOP_MODE_LABELS.webservice}
          </ToggleGroupItem>
          <ToggleGroupItem value="mysql" disabled={!canWrite} className="flex-1 sm:flex-none">
            <Database aria-hidden="true" />
            {PRESTASHOP_MODE_LABELS.mysql}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {isMysql
            ? 'Lettura diretta dal database in sola lettura: molto più veloce sul primo caricamento di clienti e ordini. Host, utente e nome del database si configurano come parametri delle Cloud Functions.'
            : 'API ufficiale di PrestaShop: si attiva da Parametri avanzati → Webservice creando una chiave con permessi di lettura su clienti, ordini, carrelli e prodotti.'}
        </p>
      </div>

      {/* --- Credenziali ---------------------------------------------------- */}
      <SettingsField
        htmlFor={isMysql ? `${idPrefix}-db-password` : `${idPrefix}-ws-key`}
        label={isMysql ? 'Password del database' : 'Chiave Webservice'}
        description={
          store.credentialsConfigured
            ? 'Una credenziale è già salvata in Secret Manager: lascia vuoto per conservarla.'
            : 'Inserisci la credenziale: viene verificata, salvata in Secret Manager e mai scritta su Firestore.'
        }
        error={isMysql ? errors.dbPassword : errors.wsKey}
      >
        <Input
          id={isMysql ? `${idPrefix}-db-password` : `${idPrefix}-ws-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={isMysql ? form.dbPassword : form.wsKey}
          onChange={(event) =>
            isMysql ? update({ dbPassword: event.target.value }) : update({ wsKey: event.target.value })
          }
          placeholder={store.credentialsConfigured ? '••••••••••••' : isMysql ? 'Password MySQL' : 'Chiave API PrestaShop'}
          disabled={!canWrite}
          invalid={Boolean(isMysql ? errors.dbPassword : errors.wsKey)}
          startIcon={<KeyRound className="size-4" />}
        />
      </SettingsField>

      {check ? <CheckResult ok={check.ok} message={check.message} /> : null}

      {store.lastSyncError ? (
        <Alert variant="destructive">
          <RefreshCw aria-hidden="true" />
          <AlertTitle>Ultima sincronizzazione con errori</AlertTitle>
          <AlertDescription>{store.lastSyncError}</AlertDescription>
        </Alert>
      ) : null}

      {/* --- Parametri tecnici ---------------------------------------------- */}
      <SettingsGrid className="lg:grid-cols-4">
        <SettingsField
          htmlFor={`${idPrefix}-multistore`}
          label="Id shop multistore"
          description="Vuoto se l’installazione è dedicata a questo negozio."
          error={errors.multistoreShopId}
        >
          <Input
            id={`${idPrefix}-multistore`}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={form.multistoreShopId}
            onChange={(event) => update({ multistoreShopId: event.target.value })}
            placeholder="Es. 2"
            disabled={!canWrite}
            invalid={Boolean(errors.multistoreShopId)}
          />
        </SettingsField>

        <SettingsField
          htmlFor={`${idPrefix}-prefix`}
          label="Prefisso tabelle"
          description="Predefinito di PrestaShop: ps_"
          error={errors.tablePrefix}
        >
          <Input
            id={`${idPrefix}-prefix`}
            value={form.tablePrefix}
            onChange={(event) => update({ tablePrefix: event.target.value })}
            placeholder="ps_"
            disabled={!canWrite || !isMysql}
            invalid={Boolean(errors.tablePrefix)}
          />
        </SettingsField>

        <SettingsField
          htmlFor={`${idPrefix}-lingua`}
          label="Id lingua"
          description="1 nelle installazioni italiane."
          error={errors.languageId}
        >
          <Input
            id={`${idPrefix}-lingua`}
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            step={1}
            value={form.languageId}
            onChange={(event) => update({ languageId: event.target.value })}
            disabled={!canWrite}
            invalid={Boolean(errors.languageId)}
          />
        </SettingsField>

        <SettingsField
          htmlFor={`${idPrefix}-segmento`}
          label="Segmento predefinito"
          description="Usato quando il gruppo cliente non è mappato."
          error={errors.defaultSegment}
        >
          <Select
            value={form.defaultSegment}
            onValueChange={(value) => update({ defaultSegment: value as 'b2c' | 'b2b' })}
            disabled={!canWrite}
          >
            <SelectTrigger id={`${idPrefix}-segmento`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="b2c">B2C — clienti al pubblico</SelectItem>
              <SelectItem value="b2b">B2B — rivenditori</SelectItem>
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsGrid>

      {/* --- Mappe e cronologia --------------------------------------------- */}
      <Accordion type="multiple" className="rounded-lg border border-border px-4">
        <AccordionItem value="gruppi">
          <AccordionTrigger>Mappatura gruppi cliente → segmento</AccordionTrigger>
          <AccordionContent>
            <CustomerGroupMapping
              value={form.customerGroupMapping}
              onChange={(value) => update({ customerGroupMapping: value })}
              disabled={!canWrite}
              defaultSegment={form.defaultSegment}
              idPrefix={idPrefix}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="stati">
          <AccordionTrigger>Mappatura stati ordine PrestaShop</AccordionTrigger>
          <AccordionContent>
            <OrderStateMapping
              value={form.orderStateMapping}
              onChange={(value) => update({ orderStateMapping: value })}
              disabled={!canWrite}
              idPrefix={idPrefix}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cronologia" className="border-b-0">
          <AccordionTrigger>Cronologia sincronizzazioni ({jobs.length})</AccordionTrigger>
          <AccordionContent>
            <SyncHistory
              jobs={jobs}
              loading={jobsLoading}
              onCancel={(jobId) => void handleCancel(jobId)}
              cancellingJobId={cancellingJobId}
              canCancel={canSync}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* --- Sincronizzazione manuale ---------------------------------------- */}
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Sincronizza ora</p>
            <p className="text-xs text-muted-foreground">
              Scarica i dati aggiornati da PrestaShop senza attendere la pianificazione.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={fullResync}
                onCheckedChange={(checked) => setFullResync(checked === true)}
                disabled={!canSync || syncing}
                aria-label="Sincronizzazione completa"
              />
              Ricarico completo
            </label>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSync()}
              loading={syncing}
              disabled={!canSync || !form.enabled || Boolean(runningJob)}
            >
              {syncing ? null : <Play aria-hidden="true" />}
              Sincronizza ora
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SYNC_ENTITIES.map((entity) => (
            <label
              key={entity}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card p-2 text-xs transition-colors',
                entities.includes(entity) && 'border-primary/40 bg-primary/5',
              )}
              title={SYNC_ENTITY_HINTS[entity]}
            >
              <Checkbox
                checked={entities.includes(entity)}
                onCheckedChange={(checked) => toggleEntity(entity, checked === true)}
                disabled={!canSync || syncing}
                aria-label={SYNC_ENTITY_LABELS[entity]}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{SYNC_ENTITY_LABELS[entity]}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {SYNC_ENTITY_HINTS[entity]}
                </span>
              </span>
            </label>
          ))}
        </div>

        {syncing || runningJob ? (
          <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="absolute inset-y-0 left-0 w-1/3 -translate-x-full animate-shimmer rounded-full bg-primary" />
            </div>
            <p className="text-xs text-muted-foreground">
              Sincronizzazione in corso: puoi lasciare la pagina, il job prosegue sul server.
            </p>
          </div>
        ) : null}

        {lastRun ? (
          <div className="mt-3 space-y-2">
            <CheckResult
              ok={lastRun.status === 'success'}
              message={
                lastRun.error ??
                `Job ${lastRun.jobId}: ${Object.entries(lastRun.counts)
                  .map(
                    ([entity, counts]) =>
                      `${SYNC_ENTITY_LABELS[entity as SyncEntity] ?? entity} ${formatNumber(counts.fetched)} letti / ${formatNumber(counts.created)} nuovi`,
                  )
                  .join(' · ')}`
              }
            />
            {lastRun.warnings?.map((warning) => (
              <p key={warning} className="text-xs text-warning-foreground">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Serve aiuto con la chiave Webservice?{' '}
        <a
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          href="https://devdocs.prestashop-project.org/8/webservice/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Guida ufficiale PrestaShop
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </p>
    </SettingsSection>
  );
}
