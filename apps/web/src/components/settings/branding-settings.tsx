'use client';

/**
 * Impostazioni → Brand.
 *
 * Dati aziendali, logo, palette, font, collegamenti social e testi legali usati
 * da tutte le email: l'editor a blocchi e il motore di rendering leggono da qui
 * i valori predefiniti. La colonna di destra mostra l'anteprima dal vivo.
 */

import { DEFAULT_BRANDING, type BrandingSettings } from '@alphaink/shared';
import {
  Building,
  Image as ImageIcon,
  Palette,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  Type,
} from 'lucide-react';
import * as React from 'react';

import { MediaPickerDialog } from '@/components/editor/media-picker';
import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/ui/color-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDateTimeIt } from '@/lib/utils';

import { saveBrandingSettings } from './api';
import { BRAND_PALETTE_FIELDS, FONT_OPTIONS, SOCIAL_NETWORK_OPTIONS } from './constants';
import { EmailBrandPreview } from './email-brand-preview';
import { brandingFormSchema, validate, type BrandingFormValues } from './schemas';
import {
  LoadError,
  ReadOnlyNotice,
  SaveBar,
  SectionSkeleton,
  SettingsField,
  SettingsGrid,
  SettingsSection,
} from './settings-shell';
import type { FieldErrors, SaveBrandingSettingsInput } from './types';
import { useBrandingSettings, useSettingsForm } from './use-settings';

type LogoField = 'logoUrl' | 'logoDarkUrl' | 'faviconUrl';

function toForm(settings: BrandingSettings): BrandingFormValues {
  return {
    companyName: settings.companyName,
    legalName: settings.legalName,
    address: settings.address,
    vatNumber: settings.vatNumber,
    supportEmail: settings.supportEmail,
    supportPhone: settings.supportPhone ?? '',
    websiteUrl: settings.websiteUrl,
    logoUrl: settings.logoUrl ?? null,
    logoDarkUrl: settings.logoDarkUrl ?? null,
    faviconUrl: settings.faviconUrl ?? null,
    palette: { ...settings.palette },
    fonts: { ...settings.fonts },
    socialLinks: settings.socialLinks.map((link) => ({ ...link })),
    legalFooterHtml: settings.legalFooterHtml,
    unsubscribeText: settings.unsubscribeText,
  };
}

/** Riquadro di un'immagine di brand: anteprima, scelta dalla libreria, rimozione. */
function LogoPicker({
  id,
  label,
  description,
  value,
  onChange,
  disabled,
  dark,
}: {
  id: string;
  label: string;
  description: string;
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  dark?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <div
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border"
          style={dark ? { backgroundColor: '#0F172A' } : undefined}
        >
          {value ? (
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            id={id}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value.trim() || null)}
            placeholder="https://…"
            disabled={disabled}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
              <ImageIcon aria-hidden="true" />
              Scegli file
            </Button>
            {value ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} disabled={disabled}>
                <Trash2 aria-hidden="true" />
                Rimuovi
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>

      <MediaPickerDialog
        open={open}
        onOpenChange={setOpen}
        currentSrc={value}
        folder="brand"
        onSelect={(selection) => {
          onChange(selection.src);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function BrandingSettingsPanel() {
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const { data: settings, loading, error } = useBrandingSettings();

  const { form, update, dirty, reset, commit } = useSettingsForm(settings, toForm);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);

  const setLogo = (field: LogoField, url: string | null) => update({ [field]: url } as Partial<BrandingFormValues>);

  const updateSocial = (index: number, patch: Partial<{ network: string; url: string }>) => {
    update({
      socialLinks: form.socialLinks.map((link, position) =>
        position === index ? { ...link, ...patch } : link,
      ),
    });
  };

  const handleSave = React.useCallback(async () => {
    const candidate = {
      ...form,
      supportPhone: form.supportPhone?.trim() ? form.supportPhone.trim() : null,
    };
    const result = validate(brandingFormSchema, candidate);
    if (!result.success) {
      setErrors(result.errors);
      toastError(null, 'Controlla i campi evidenziati in rosso.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await saveBrandingSettings(result.data as SaveBrandingSettingsInput);
      commit();
      toastSuccess('Identità visiva salvata.');
    } catch (saveError) {
      toastError(saveError, 'Impossibile salvare l’identità visiva.');
    } finally {
      setSaving(false);
    }
  }, [commit, form]);

  if (loading) return <SectionSkeleton rows={4} />;
  if (error) return <LoadError message={error.message} />;

  return (
    <div className="space-y-5">
      {!canWrite ? <ReadOnlyNotice /> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {/* --- Dati aziendali ------------------------------------------- */}
          <SettingsSection
            title="Dati aziendali"
            description="Compaiono nel footer di ogni email: sono obbligatori per la conformità alle norme sul commercio elettronico."
            icon={<Building />}
          >
            <SettingsGrid>
              <SettingsField htmlFor="brand-nome" label="Nome commerciale" required error={errors.companyName}>
                <Input
                  id="brand-nome"
                  value={form.companyName}
                  onChange={(event) => update({ companyName: event.target.value })}
                  disabled={!canWrite}
                  invalid={Boolean(errors.companyName)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-ragione" label="Ragione sociale" error={errors.legalName}>
                <Input
                  id="brand-ragione"
                  value={form.legalName}
                  onChange={(event) => update({ legalName: event.target.value })}
                  disabled={!canWrite}
                  invalid={Boolean(errors.legalName)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-indirizzo" label="Indirizzo" wide error={errors.address}>
                <Input
                  id="brand-indirizzo"
                  value={form.address}
                  onChange={(event) => update({ address: event.target.value })}
                  placeholder="Via, numero civico, CAP, città"
                  disabled={!canWrite}
                  invalid={Boolean(errors.address)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-piva" label="Partita IVA" error={errors.vatNumber}>
                <Input
                  id="brand-piva"
                  value={form.vatNumber}
                  onChange={(event) => update({ vatNumber: event.target.value })}
                  placeholder="IT01234567890"
                  disabled={!canWrite}
                  invalid={Boolean(errors.vatNumber)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-sito" label="Sito web" required error={errors.websiteUrl}>
                <Input
                  id="brand-sito"
                  type="url"
                  value={form.websiteUrl}
                  onChange={(event) => update({ websiteUrl: event.target.value })}
                  placeholder="https://alphaink.net"
                  disabled={!canWrite}
                  invalid={Boolean(errors.websiteUrl)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-email" label="Email di assistenza" required error={errors.supportEmail}>
                <Input
                  id="brand-email"
                  type="email"
                  value={form.supportEmail}
                  onChange={(event) => update({ supportEmail: event.target.value })}
                  placeholder="info@alphaink.net"
                  disabled={!canWrite}
                  invalid={Boolean(errors.supportEmail)}
                />
              </SettingsField>

              <SettingsField htmlFor="brand-telefono" label="Telefono" error={errors.supportPhone}>
                <Input
                  id="brand-telefono"
                  type="tel"
                  value={form.supportPhone ?? ''}
                  onChange={(event) => update({ supportPhone: event.target.value })}
                  placeholder="+39 000 0000000"
                  disabled={!canWrite}
                  invalid={Boolean(errors.supportPhone)}
                />
              </SettingsField>
            </SettingsGrid>
          </SettingsSection>

          {/* --- Immagini -------------------------------------------------- */}
          <SettingsSection
            title="Logo e icone"
            description="Le immagini vengono caricate nella libreria media e servite da Firebase Storage."
            icon={<ImageIcon />}
          >
            <SettingsGrid>
              <LogoPicker
                id="brand-logo"
                label="Logo principale"
                description="Usato nell’intestazione delle email su fondo chiaro. Consigliato PNG con sfondo trasparente, altezza 64 px."
                value={form.logoUrl}
                onChange={(url) => setLogo('logoUrl', url)}
                disabled={!canWrite}
              />
              <LogoPicker
                id="brand-logo-scuro"
                label="Logo per fondi scuri"
                description="Variante usata dai client di posta in modalità scura."
                value={form.logoDarkUrl}
                onChange={(url) => setLogo('logoDarkUrl', url)}
                disabled={!canWrite}
                dark
              />
              <LogoPicker
                id="brand-favicon"
                label="Favicon"
                description="Icona usata dalle pagine pubbliche (disiscrizione, preferenze, anteprima web)."
                value={form.faviconUrl}
                onChange={(url) => setLogo('faviconUrl', url)}
                disabled={!canWrite}
              />
            </SettingsGrid>
          </SettingsSection>

          {/* --- Palette --------------------------------------------------- */}
          <SettingsSection
            title="Palette dei colori"
            description="Valori predefiniti dei blocchi email. L’anteprima a destra si aggiorna mentre scegli."
            icon={<Palette />}
            actions={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => update({ palette: { ...DEFAULT_BRANDING.palette } })}
                disabled={!canWrite}
              >
                <RotateCcw aria-hidden="true" />
                Ripristina palette AlphaInk
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {BRAND_PALETTE_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`colore-${field.key}`}>{field.label}</Label>
                  <ColorPicker
                    value={form.palette[field.key]}
                    onChange={(color) => update({ palette: { ...form.palette, [field.key]: color } })}
                    disabled={!canWrite}
                    label={`Scegli il colore ${field.label.toLowerCase()}`}
                  />
                  <p className="text-xs text-muted-foreground">{field.hint}</p>
                  {errors[`palette.${field.key}`] ? (
                    <p role="alert" className="text-xs text-destructive">
                      {errors[`palette.${field.key}`]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </SettingsSection>

          {/* --- Tipografia ------------------------------------------------ */}
          <SettingsSection
            title="Tipografia"
            description="Nei client di posta vale solo un piccolo insieme di font: quelli elencati hanno la resa più affidabile."
            icon={<Type />}
          >
            <SettingsGrid>
              <SettingsField htmlFor="font-titoli" label="Font dei titoli" error={errors['fonts.heading']}>
                <Select
                  value={form.fonts.heading}
                  onValueChange={(value) => update({ fonts: { ...form.fonts, heading: value } })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="font-titoli">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>

              <SettingsField htmlFor="font-testo" label="Font del testo" error={errors['fonts.body']}>
                <Select
                  value={form.fonts.body}
                  onValueChange={(value) => update({ fonts: { ...form.fonts, body: value } })}
                  disabled={!canWrite}
                >
                  <SelectTrigger id="font-testo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>
            </SettingsGrid>
          </SettingsSection>

          {/* --- Social ---------------------------------------------------- */}
          <SettingsSection
            title="Collegamenti social"
            description="Mostrati dal blocco «Social» e nel footer predefinito."
            icon={<Share2 />}
          >
            {form.socialLinks.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                Nessun collegamento configurato.
              </p>
            ) : (
              <ul className="space-y-2">
                {form.socialLinks.map((link, index) => (
                  <li key={`${link.network}-${index}`} className="flex flex-wrap items-start gap-2">
                    <Select
                      value={link.network}
                      onValueChange={(value) => updateSocial(index, { network: value })}
                      disabled={!canWrite}
                    >
                      <SelectTrigger className="w-40" aria-label="Rete social">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOCIAL_NETWORK_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="min-w-[16rem] flex-1 space-y-1">
                      <Input
                        value={link.url}
                        onChange={(event) => updateSocial(index, { url: event.target.value })}
                        placeholder="https://www.facebook.com/alphaink"
                        disabled={!canWrite}
                        invalid={Boolean(errors[`socialLinks.${index}.url`])}
                        aria-label={`Indirizzo del profilo ${link.network}`}
                      />
                      {errors[`socialLinks.${index}.url`] ? (
                        <p role="alert" className="text-xs text-destructive">
                          {errors[`socialLinks.${index}.url`]}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        update({ socialLinks: form.socialLinks.filter((_, position) => position !== index) })
                      }
                      disabled={!canWrite}
                      aria-label={`Rimuovi il collegamento ${link.network}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                update({ socialLinks: [...form.socialLinks, { network: 'facebook', url: '' }] })
              }
              disabled={!canWrite || form.socialLinks.length >= 12}
            >
              <Plus aria-hidden="true" />
              Aggiungi collegamento
            </Button>
          </SettingsSection>

          {/* --- Testi legali ---------------------------------------------- */}
          <SettingsSection
            title="Footer legale e disiscrizione"
            description="Testi allegati a ogni invio. Il collegamento di disiscrizione viene aggiunto automaticamente."
            icon={<Type />}
          >
            <SettingsField
              htmlFor="footer-legale"
              label="Footer legale (HTML)"
              description="Accetta HTML semplice: paragrafi, grassetto, collegamenti. Script e stili vengono rimossi."
              error={errors.legalFooterHtml}
            >
              <Textarea
                id="footer-legale"
                value={form.legalFooterHtml}
                onChange={(event) => update({ legalFooterHtml: event.target.value })}
                rows={4}
                className="font-mono text-xs"
                disabled={!canWrite}
                invalid={Boolean(errors.legalFooterHtml)}
              />
            </SettingsField>

            <SettingsField
              htmlFor="testo-disiscrizione"
              label="Testo di disiscrizione"
              required
              description="Frase che precede il collegamento «Disiscriviti»."
              error={errors.unsubscribeText}
            >
              <Input
                id="testo-disiscrizione"
                value={form.unsubscribeText}
                onChange={(event) => update({ unsubscribeText: event.target.value })}
                disabled={!canWrite}
                invalid={Boolean(errors.unsubscribeText)}
              />
            </SettingsField>
          </SettingsSection>
        </div>

        {/* --- Anteprima ---------------------------------------------------- */}
        <div className="xl:sticky xl:top-20 xl:h-fit">
          <p className="mb-2 text-sm font-medium text-foreground">Anteprima dell’email</p>
          <EmailBrandPreview
            values={{
              companyName: form.companyName,
              logoUrl: form.logoUrl,
              websiteUrl: form.websiteUrl,
              address: form.address,
              legalName: form.legalName,
              vatNumber: form.vatNumber,
              supportEmail: form.supportEmail,
              palette: form.palette,
              fonts: form.fonts,
              legalFooterHtml: form.legalFooterHtml,
              unsubscribeText: form.unsubscribeText,
              socialLinks: form.socialLinks,
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Esempio indicativo: i contenuti reali arrivano dall’editor a blocchi, ma colori, font e
            footer sono quelli configurati qui.
          </p>
        </div>
      </div>

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
