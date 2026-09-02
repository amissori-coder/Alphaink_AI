'use client';

/**
 * Impostazioni → Tracciamento e attribuzione.
 *
 * Decide come un ordine di PrestaShop viene collegato a una newsletter o a
 * un'automazione: modello di attribuzione, ampiezza delle finestre, precedenza
 * del coupon, stati ordine conteggiati, parametri UTM e click tracciati.
 */

import {
  ATTRIBUTION_MODEL_LABELS,
  REVENUE_ORDER_STATUSES,
  type AttributionModel,
  type OrderStatus,
  type TrackingSettings,
} from '@alphaink/shared';
import { BarChart3, Crosshair, Link2, MousePointerClick, Ticket } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth-context';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn, formatDateTimeIt } from '@/lib/utils';

import { saveTrackingSettings } from './api';
import {
  ATTRIBUTION_MODEL_HELP,
  ATTRIBUTION_MODEL_OPTIONS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_VALUES,
} from './constants';
import { trackingSettingsInputSchema, validate } from './schemas';
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
import type { FieldErrors, SaveTrackingSettingsInput } from './types';
import { useSettingsForm, useTrackingSettings } from './use-settings';

interface TrackingFormValues {
  model: AttributionModel;
  clickWindowDays: number;
  openWindowDays: number;
  couponOverridesModel: boolean;
  countStatuses: string[];
  subtractRefunds: boolean;
  autoUtm: boolean;
  utmSource: string;
  utmMedium: string;
  utmCampaignTemplate: string;
  useOwnClickTracking: boolean;
  clickTrackingDomain: string;
  excludeProxyOpens: boolean;
}

function toForm(settings: TrackingSettings): TrackingFormValues {
  return {
    model: settings.attribution.model,
    clickWindowDays: settings.attribution.clickWindowDays,
    openWindowDays: settings.attribution.openWindowDays,
    couponOverridesModel: settings.attribution.couponOverridesModel,
    countStatuses: [...settings.attribution.countStatuses],
    subtractRefunds: settings.attribution.subtractRefunds,
    autoUtm: settings.autoUtm,
    utmSource: settings.utmSource,
    utmMedium: settings.utmMedium,
    utmCampaignTemplate: settings.utmCampaignTemplate,
    useOwnClickTracking: settings.useOwnClickTracking,
    clickTrackingDomain: settings.clickTrackingDomain,
    excludeProxyOpens: settings.excludeProxyOpens,
  };
}

/** Esempio di link con i parametri applicati, per capire l'effetto a colpo d'occhio. */
function buildUtmPreview(form: TrackingFormValues): string {
  const base = 'https://alphaink.net/toner-hp-ce285a';
  if (!form.autoUtm) return base;
  const campaign = form.utmCampaignTemplate
    .replace(/\{\{\s*newsletter\.slug\s*\}\}/g, 'saldi-toner-marzo')
    .replace(/\{\{\s*newsletter\.name\s*\}\}/g, 'Saldi toner di marzo')
    .replace(/\{\{\s*automation\.key\s*\}\}/g, 'riacquisto-toner');
  const params = new URLSearchParams();
  if (form.utmSource) params.set('utm_source', form.utmSource);
  if (form.utmMedium) params.set('utm_medium', form.utmMedium);
  if (campaign) params.set('utm_campaign', campaign);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function TrackingSettingsPanel() {
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const { data: settings, loading, error } = useTrackingSettings();

  const { form, update, dirty, reset, commit } = useSettingsForm(settings, toForm);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);

  const preview = React.useMemo(() => buildUtmPreview(form), [form]);

  const toggleStatus = (status: OrderStatus, checked: boolean) => {
    update({
      countStatuses: checked
        ? Array.from(new Set([...form.countStatuses, status]))
        : form.countStatuses.filter((item) => item !== status),
    });
  };

  const handleSave = React.useCallback(async () => {
    const payload: SaveTrackingSettingsInput = {
      attribution: {
        model: form.model,
        clickWindowDays: form.clickWindowDays,
        openWindowDays: form.openWindowDays,
        couponOverridesModel: form.couponOverridesModel,
        countStatuses: form.countStatuses,
        subtractRefunds: form.subtractRefunds,
      },
      autoUtm: form.autoUtm,
      utmSource: form.utmSource.trim(),
      utmMedium: form.utmMedium.trim(),
      utmCampaignTemplate: form.utmCampaignTemplate.trim(),
      useOwnClickTracking: form.useOwnClickTracking,
      clickTrackingDomain: form.clickTrackingDomain.trim(),
      excludeProxyOpens: form.excludeProxyOpens,
    };

    const result = validate(trackingSettingsInputSchema, payload);
    if (!result.success) {
      setErrors(result.errors);
      toastError(null, 'Controlla i campi evidenziati in rosso.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await saveTrackingSettings(payload);
      commit();
      toastSuccess('Impostazioni di tracciamento salvate.');
    } catch (saveError) {
      toastError(saveError, 'Impossibile salvare le impostazioni di tracciamento.');
    } finally {
      setSaving(false);
    }
  }, [commit, form]);

  if (loading) return <SectionSkeleton rows={3} />;
  if (error) return <LoadError message={error.message} />;

  return (
    <div className="space-y-5">
      {!canWrite ? <ReadOnlyNotice /> : null}

      {/* --- Modello di attribuzione ---------------------------------------- */}
      <SettingsSection
        title="Modello di attribuzione"
        description="Regola con cui il fatturato di un ordine viene assegnato a una newsletter o a un’automazione."
        icon={<Crosshair />}
      >
        <RadioGroup
          value={form.model}
          onValueChange={(value) => update({ model: value as AttributionModel })}
          disabled={!canWrite}
          className="grid gap-3 lg:grid-cols-2"
        >
          {ATTRIBUTION_MODEL_OPTIONS.map((option) => (
            <label
              key={option.value}
              htmlFor={`modello-${option.value}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors',
                form.model === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
              )}
            >
              <RadioGroupItem id={`modello-${option.value}`} value={option.value} className="mt-0.5" />
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">
                  {ATTRIBUTION_MODEL_HELP[option.value]}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>

        <SettingsGrid>
          <SettingsField
            htmlFor="finestra-click"
            label={`Finestra di attribuzione dei click: ${form.clickWindowDays} giorni`}
            description="Un click più vecchio di così non viene più considerato."
            error={errors['attribution.clickWindowDays']}
          >
            <Slider
              id="finestra-click"
              min={1}
              max={90}
              step={1}
              value={[form.clickWindowDays]}
              onValueChange={([value]) => update({ clickWindowDays: value ?? 1 })}
              disabled={!canWrite}
              aria-label="Finestra di attribuzione dei click in giorni"
            />
          </SettingsField>

          <SettingsField
            htmlFor="finestra-apertura"
            label={`Finestra di attribuzione delle aperture: ${form.openWindowDays} giorni`}
            description="Di norma più corta dei click: un’apertura è un segnale più debole. Zero la disattiva."
            error={errors['attribution.openWindowDays']}
          >
            <Slider
              id="finestra-apertura"
              min={0}
              max={90}
              step={1}
              value={[form.openWindowDays]}
              onValueChange={([value]) => update({ openWindowDays: value ?? 0 })}
              disabled={!canWrite}
              aria-label="Finestra di attribuzione delle aperture in giorni"
            />
          </SettingsField>
        </SettingsGrid>

        <ToggleRow
          id="coupon-precedenza"
          label="Il codice coupon ha la precedenza"
          description="Se l’ordine contiene un coupon emesso dalla suite, l’attribuzione va a quell’invio anche in presenza di click più recenti."
          control={
            <Switch
              id="coupon-precedenza"
              checked={form.couponOverridesModel}
              onCheckedChange={(checked) => update({ couponOverridesModel: checked })}
              disabled={!canWrite}
              aria-label="Il codice coupon ha la precedenza"
            />
          }
        />
      </SettingsSection>

      {/* --- Ordini conteggiati --------------------------------------------- */}
      <SettingsSection
        title="Ordini conteggiati"
        description="Quali stati PrestaShop, una volta normalizzati, entrano nel fatturato attribuito."
        icon={<BarChart3 />}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {ORDER_STATUS_VALUES.map((status) => (
            <label
              key={status}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card p-2 text-sm transition-colors',
                form.countStatuses.includes(status) && 'border-primary/40 bg-primary/5',
              )}
            >
              <Checkbox
                checked={form.countStatuses.includes(status)}
                onCheckedChange={(checked) => toggleStatus(status, checked === true)}
                disabled={!canWrite}
                aria-label={ORDER_STATUS_LABELS[status]}
              />
              <span className="min-w-0 flex-1 truncate">{ORDER_STATUS_LABELS[status]}</span>
              {REVENUE_ORDER_STATUSES.includes(status) ? (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  consigliato
                </Badge>
              ) : null}
            </label>
          ))}
        </div>
        {errors['attribution.countStatuses'] ? (
          <p role="alert" className="text-xs text-destructive">
            {errors['attribution.countStatuses']}
          </p>
        ) : null}

        <ToggleRow
          id="sottrai-resi"
          label="Sottrai i resi dal fatturato attribuito"
          description="Gli ordini che passano a «Rimborsato» vengono scalati dai totali delle campagne."
          control={
            <Switch
              id="sottrai-resi"
              checked={form.subtractRefunds}
              onCheckedChange={(checked) => update({ subtractRefunds: checked })}
              disabled={!canWrite}
              aria-label="Sottrai i resi dal fatturato attribuito"
            />
          }
        />
      </SettingsSection>

      {/* --- UTM ------------------------------------------------------------ */}
      <SettingsSection
        title="Parametri UTM automatici"
        description="Aggiunti ai link delle email per riconoscere il traffico anche in Google Analytics."
        icon={<Link2 />}
      >
        <ToggleRow
          id="utm-automatici"
          label="Aggiungi automaticamente i parametri UTM"
          description="I link che hanno già parametri UTM non vengono modificati."
          control={
            <Switch
              id="utm-automatici"
              checked={form.autoUtm}
              onCheckedChange={(checked) => update({ autoUtm: checked })}
              disabled={!canWrite}
              aria-label="Aggiungi automaticamente i parametri UTM"
            />
          }
        />

        <SettingsGrid className="lg:grid-cols-3">
          <SettingsField htmlFor="utm-source" label="utm_source" error={errors.utmSource}>
            <Input
              id="utm-source"
              value={form.utmSource}
              onChange={(event) => update({ utmSource: event.target.value })}
              placeholder="newsletter"
              disabled={!canWrite || !form.autoUtm}
              invalid={Boolean(errors.utmSource)}
            />
          </SettingsField>
          <SettingsField htmlFor="utm-medium" label="utm_medium" error={errors.utmMedium}>
            <Input
              id="utm-medium"
              value={form.utmMedium}
              onChange={(event) => update({ utmMedium: event.target.value })}
              placeholder="email"
              disabled={!canWrite || !form.autoUtm}
              invalid={Boolean(errors.utmMedium)}
            />
          </SettingsField>
          <SettingsField
            htmlFor="utm-campaign"
            label="utm_campaign"
            description="Segnaposto disponibili: {{newsletter.slug}}, {{newsletter.name}}, {{automation.key}}."
            error={errors.utmCampaignTemplate}
          >
            <Input
              id="utm-campaign"
              value={form.utmCampaignTemplate}
              onChange={(event) => update({ utmCampaignTemplate: event.target.value })}
              placeholder="{{newsletter.slug}}"
              className="font-mono text-xs"
              disabled={!canWrite || !form.autoUtm}
              invalid={Boolean(errors.utmCampaignTemplate)}
            />
          </SettingsField>
        </SettingsGrid>

        <div className="space-y-1.5">
          <Label>Anteprima del link risultante</Label>
          <p className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
            {preview}
          </p>
        </div>
      </SettingsSection>

      {/* --- Click e aperture ------------------------------------------------ */}
      <SettingsSection
        title="Click e aperture"
        description="Come vengono misurati i click e cosa fare delle aperture generate dai proxy."
        icon={<MousePointerClick />}
      >
        <ToggleRow
          id="click-proprietario"
          label="Traccia i click con il nostro redirector"
          description="I link passano dalla Cloud Function trackClick: permette di attribuire gli acquisti anche senza cookie di terze parti."
          control={
            <Switch
              id="click-proprietario"
              checked={form.useOwnClickTracking}
              onCheckedChange={(checked) => update({ useOwnClickTracking: checked })}
              disabled={!canWrite}
              aria-label="Traccia i click con il nostro redirector"
            />
          }
        />

        <SettingsField
          htmlFor="dominio-click"
          label="Dominio dei link tracciati"
          description="Lascia vuoto per usare il dominio dell’applicazione. Un sottodominio AlphaInk (es. link.alphaink.net) migliora la reputazione e la fiducia dei destinatari."
          error={errors.clickTrackingDomain}
        >
          <Input
            id="dominio-click"
            value={form.clickTrackingDomain}
            onChange={(event) => update({ clickTrackingDomain: event.target.value })}
            placeholder="link.alphaink.net"
            disabled={!canWrite || !form.useOwnClickTracking}
            invalid={Boolean(errors.clickTrackingDomain)}
          />
        </SettingsField>

        <ToggleRow
          id="escludi-proxy"
          label="Escludi le aperture dai proxy Apple"
          description="Apple Mail Privacy Protection carica le immagini per conto dell’utente: contarle gonfia il tasso di apertura e falsa l’attribuzione «ultima apertura»."
          control={
            <Switch
              id="escludi-proxy"
              checked={form.excludeProxyOpens}
              onCheckedChange={(checked) => update({ excludeProxyOpens: checked })}
              disabled={!canWrite}
              aria-label="Escludi le aperture dai proxy Apple"
            />
          }
        />

        {form.model === 'last_open' && form.excludeProxyOpens ? (
          <Alert variant="warning">
            <Ticket aria-hidden="true" />
            <AlertTitle>Combinazione da valutare</AlertTitle>
            <AlertDescription>
              Il modello «{ATTRIBUTION_MODEL_LABELS.last_open}» si basa sulle aperture, ma quelle dei
              proxy Apple sono escluse: una parte degli ordini resterà senza attribuzione.
            </AlertDescription>
          </Alert>
        ) : null}
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
        />
      </div>
    </div>
  );
}
