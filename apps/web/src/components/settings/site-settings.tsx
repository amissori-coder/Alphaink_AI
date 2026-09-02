'use client';

/**
 * Impostazioni → Sito AlphaInk.
 *
 * Due riquadri gemelli per i negozi PrestaShop (B2C e B2B) più le regole
 * comuni: pianificazione della sincronizzazione, soglie di abbandono,
 * classificazione delle famiglie prodotto e cicli di riacquisto.
 *
 * I negozi si salvano singolarmente (vedi `StoreCard`); questa vista salva solo
 * la parte condivisa del documento `settings/site`.
 */

import {
  DEFAULT_TIMEZONE,
  SITE_SOURCE_LABELS,
  STORE_SOURCES,
  SYNC_ENTITIES,
  type SiteSettings,
  type StoreSource,
  type SyncEntity,
} from '@alphaink/shared';
import { CalendarClock, Info, Layers, ShoppingCart, Timer } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { useAuth } from '@/lib/auth-context';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';
import { cn, formatDateTimeIt } from '@/lib/utils';

import { saveSiteSettings } from './api';
import { CRON_PRESETS, SYNC_ENTITY_HINTS, SYNC_ENTITY_LABELS } from './constants';
import { FamilyRulesEditor, RepurchaseCyclesEditor } from './family-rules-editor';
import { siteGeneralFormSchema, validate, type SiteGeneralFormValues } from './schemas';
import {
  LoadError,
  ReadOnlyNotice,
  SaveBar,
  SectionSkeleton,
  SettingsField,
  SettingsGrid,
  SettingsSection,
  ToggleRow,
} from './settings-shell';
import { StoreCard } from './store-card';
import type { FieldErrors } from './types';
import { useSettingsForm, useSiteSettings, useSyncJobs } from './use-settings';

interface SiteFormValues extends Omit<SiteGeneralFormValues, 'abandonedPaymentAfterMinutes' | 'abandonedCartAfterMinutes'> {
  abandonedPaymentAfterMinutes: string;
  abandonedCartAfterMinutes: string;
}

function toForm(settings: SiteSettings): SiteFormValues {
  return {
    syncSchedule: {
      enabled: settings.syncSchedule.enabled,
      cron: settings.syncSchedule.cron,
      timezone: settings.syncSchedule.timezone || DEFAULT_TIMEZONE,
      entities: (settings.syncSchedule.entities as SyncEntity[]) ?? [],
    },
    familyRules: settings.familyRules.map((rule) => ({ ...rule })),
    repurchaseCycleDays: { ...settings.repurchaseCycleDays },
    abandonedPaymentAfterMinutes: String(settings.abandonedPaymentAfterMinutes),
    abandonedCartAfterMinutes: String(settings.abandonedCartAfterMinutes),
    defaultSource: settings.defaultSource,
  };
}

/** Minuti in un testo leggibile: "4 ore", "90 minuti". */
function describeMinutes(raw: string): string {
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} minuti`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = hours === 1 ? '1 ora' : `${hours} ore`;
  return rest === 0 ? hourLabel : `${hourLabel} e ${rest} minuti`;
}

export function SiteSettingsPanel() {
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const { data: settings, loading, error } = useSiteSettings();
  const { jobs, loading: jobsLoading } = useSyncJobs(60);

  const { form, update, dirty, reset, commit } = useSettingsForm(settings, toForm);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);

  const jobsByStore = React.useMemo(() => {
    const map: Record<StoreSource, typeof jobs> = { prestashop_b2c: [], prestashop_b2b: [] };
    for (const job of jobs) {
      const source = job.source as StoreSource;
      if (map[source] && map[source].length < 10) map[source].push(job);
    }
    return map;
  }, [jobs]);

  const cronIsPreset = CRON_PRESETS.some((preset) => preset.value === form.syncSchedule.cron);

  const updateSchedule = (patch: Partial<SiteFormValues['syncSchedule']>) => {
    update({ syncSchedule: { ...form.syncSchedule, ...patch } });
  };

  const toggleEntity = (entity: SyncEntity, checked: boolean) => {
    const current = form.syncSchedule.entities;
    updateSchedule({
      entities: checked
        ? Array.from(new Set([...current, entity]))
        : current.filter((item) => item !== entity),
    });
  };

  const handleSave = React.useCallback(async () => {
    const candidate = {
      ...form,
      abandonedPaymentAfterMinutes: Number(form.abandonedPaymentAfterMinutes),
      abandonedCartAfterMinutes: Number(form.abandonedCartAfterMinutes),
    };
    const result = validate(siteGeneralFormSchema, candidate);
    if (!result.success) {
      setErrors(result.errors);
      toastError(null, 'Controlla i campi evidenziati in rosso.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const response = await saveSiteSettings({
        syncSchedule: result.data.syncSchedule,
        familyRules: result.data.familyRules,
        repurchaseCycleDays: result.data.repurchaseCycleDays,
        abandonedPaymentAfterMinutes: result.data.abandonedPaymentAfterMinutes,
        abandonedCartAfterMinutes: result.data.abandonedCartAfterMinutes,
        defaultSource: result.data.defaultSource,
      });
      commit();
      for (const warning of response.warnings ?? []) toastWarning('Attenzione', warning);
      toastSuccess('Impostazioni del sito salvate.');
    } catch (saveError) {
      toastError(saveError, 'Impossibile salvare le impostazioni del sito.');
    } finally {
      setSaving(false);
    }
  }, [commit, form]);

  if (loading) return <SectionSkeleton rows={4} />;
  if (error) return <LoadError message={error.message} />;

  return (
    <div className="space-y-5">
      {!canWrite ? <ReadOnlyNotice /> : null}

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Due negozi, una sola piattaforma</AlertTitle>
        <AlertDescription>
          {SITE_SOURCE_LABELS.prestashop_b2c} e {SITE_SOURCE_LABELS.prestashop_b2b} girano entrambi su
          PrestaShop. Se condividono la stessa installazione in modalità multistore, indica in ciascun
          riquadro l’«Id shop multistore»; se sono installazioni separate, lascia il campo vuoto.
        </AlertDescription>
      </Alert>

      {STORE_SOURCES.map((source) => (
        <StoreCard
          key={source}
          source={source}
          store={settings.stores[source]}
          jobs={jobsByStore[source] ?? []}
          jobsLoading={jobsLoading}
          defaultEntities={form.syncSchedule.entities}
        />
      ))}

      {/* --- Pianificazione ------------------------------------------------- */}
      <SettingsSection
        title="Pianificazione della sincronizzazione"
        description="Ogni quanto la suite rilegge clienti, ordini e carrelli dai due negozi."
        icon={<CalendarClock />}
      >
        <ToggleRow
          id="sync-abilitata"
          label="Sincronizzazione automatica attiva"
          description="Se disattivata restano possibili solo le sincronizzazioni manuali."
          control={
            <Switch
              id="sync-abilitata"
              checked={form.syncSchedule.enabled}
              onCheckedChange={(checked) => updateSchedule({ enabled: checked })}
              disabled={!canWrite}
              aria-label="Sincronizzazione automatica attiva"
            />
          }
        />

        <SettingsGrid>
          <SettingsField
            htmlFor="sync-frequenza"
            label="Frequenza"
            description="Le esecuzioni seguono il fuso orario italiano."
            error={errors['syncSchedule.cron']}
          >
            <Select
              value={cronIsPreset ? form.syncSchedule.cron : 'personalizzata'}
              onValueChange={(value) => {
                if (value !== 'personalizzata') updateSchedule({ cron: value });
              }}
              disabled={!canWrite}
            >
              <SelectTrigger id="sync-frequenza" invalid={Boolean(errors['syncSchedule.cron'])}>
                <SelectValue placeholder="Scegli una frequenza" />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value="personalizzata">Espressione personalizzata…</SelectItem>
              </SelectContent>
            </Select>
          </SettingsField>

          <SettingsField
            htmlFor="sync-cron"
            label="Espressione cron"
            description={
              CRON_PRESETS.find((preset) => preset.value === form.syncSchedule.cron)?.description ??
              'Cinque campi: minuto, ora, giorno del mese, mese, giorno della settimana.'
            }
            error={errors['syncSchedule.cron']}
          >
            <Input
              id="sync-cron"
              value={form.syncSchedule.cron}
              onChange={(event) => updateSchedule({ cron: event.target.value })}
              placeholder="0 */6 * * *"
              className="font-mono text-sm"
              disabled={!canWrite}
              invalid={Boolean(errors['syncSchedule.cron'])}
            />
          </SettingsField>
        </SettingsGrid>

        <div className="space-y-2">
          <Label>Entità sincronizzate automaticamente</Label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {SYNC_ENTITIES.map((entity) => (
              <label
                key={entity}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card p-2 text-xs transition-colors',
                  form.syncSchedule.entities.includes(entity) && 'border-primary/40 bg-primary/5',
                )}
              >
                <Checkbox
                  checked={form.syncSchedule.entities.includes(entity)}
                  onCheckedChange={(checked) => toggleEntity(entity, checked === true)}
                  disabled={!canWrite}
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
          {errors['syncSchedule.entities'] ? (
            <p role="alert" className="text-xs text-destructive">
              {errors['syncSchedule.entities']}
            </p>
          ) : null}
        </div>

        <SettingsField
          htmlFor="sync-origine"
          label="Negozio predefinito"
          description="Usato quando un contatto o un ordine non dichiara la propria origine."
          error={errors.defaultSource}
        >
          <Select
            value={form.defaultSource}
            onValueChange={(value) => update({ defaultSource: value as StoreSource })}
            disabled={!canWrite}
          >
            <SelectTrigger id="sync-origine" className="sm:max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STORE_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {SITE_SOURCE_LABELS[source]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsSection>

      {/* --- Soglie di abbandono -------------------------------------------- */}
      <SettingsSection
        title="Soglie di abbandono"
        description="Quando un ordine non pagato o un carrello fermo diventano occasioni di recupero."
        icon={<ShoppingCart />}
      >
        <SettingsGrid>
          <SettingsField
            htmlFor="soglia-pagamento"
            label="Pagamento abbandonato dopo"
            description={`Un ordine non pagato attiva l’automazione dopo ${describeMinutes(form.abandonedPaymentAfterMinutes)}.`}
            error={errors.abandonedPaymentAfterMinutes}
          >
            <Input
              id="soglia-pagamento"
              type="number"
              inputMode="numeric"
              min={5}
              max={10080}
              step={5}
              value={form.abandonedPaymentAfterMinutes}
              onChange={(event) => update({ abandonedPaymentAfterMinutes: event.target.value })}
              disabled={!canWrite}
              invalid={Boolean(errors.abandonedPaymentAfterMinutes)}
              endIcon={<span className="text-xs text-muted-foreground">min</span>}
            />
          </SettingsField>

          <SettingsField
            htmlFor="soglia-carrello"
            label="Carrello abbandonato dopo"
            description={`Un carrello non convertito viene recuperato dopo ${describeMinutes(form.abandonedCartAfterMinutes)}.`}
            error={errors.abandonedCartAfterMinutes}
          >
            <Input
              id="soglia-carrello"
              type="number"
              inputMode="numeric"
              min={5}
              max={10080}
              step={15}
              value={form.abandonedCartAfterMinutes}
              onChange={(event) => update({ abandonedCartAfterMinutes: event.target.value })}
              disabled={!canWrite}
              invalid={Boolean(errors.abandonedCartAfterMinutes)}
              endIcon={<span className="text-xs text-muted-foreground">min</span>}
            />
          </SettingsField>
        </SettingsGrid>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Timer className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Le soglie sono controllate dallo scanner pianificato ogni 30 minuti: valori inferiori a
          30 minuti vengono comunque valutati alla prima esecuzione utile.
        </p>
      </SettingsSection>

      {/* --- Famiglie prodotto ---------------------------------------------- */}
      <SettingsSection
        title="Famiglie prodotto e riacquisti"
        description="Come i prodotti AlphaInk vengono classificati e ogni quanto un cliente è pronto a riordinare."
        icon={<Layers />}
      >
        <FamilyRulesEditor
          rules={form.familyRules}
          onChange={(rules) => update({ familyRules: rules })}
          disabled={!canWrite}
        />
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-sm font-medium text-foreground">Cicli di riacquisto per famiglia</p>
          <RepurchaseCyclesEditor
            value={form.repurchaseCycleDays}
            onChange={(value) => update({ repurchaseCycleDays: value })}
            disabled={!canWrite}
            errors={errors}
          />
        </div>
      </SettingsSection>

      <div className="sticky bottom-4 z-10 rounded-lg border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        <SaveBar
          dirty={dirty}
          saving={saving}
          disabled={!canWrite}
          onSave={() => void handleSave()}
          onReset={() => {
            reset();
            setErrors({});
          }}
          hint={
            settings.updatedAt ? `Ultimo salvataggio: ${formatDateTimeIt(settings.updatedAt)}` : undefined
          }
          saveLabel="Salva impostazioni comuni"
        />
      </div>
    </div>
  );
}
