'use client';

/**
 * Impostazioni → Brevo.
 *
 * Copre l'intero collegamento con il servizio di invio:
 *  - chiave API (mascherata: si mostra solo il suggerimento delle ultime cifre);
 *  - verifica della connessione con account, azienda, crediti e mittenti;
 *  - mittente predefinito e indirizzo di risposta;
 *  - sincronizzazione dei contatti verso una lista Brevo;
 *  - registrazione dei webhook che alimentano consegne, aperture e click;
 *  - limite di invii orari.
 *
 * La chiave non viene mai riletta dal server: viaggia solo in salita e finisce
 * in Secret Manager.
 */

import { formatNumber } from '@alphaink/shared';
import {
  BadgeCheck,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Link2,
  MailCheck,
  PlugZap,
  RefreshCw,
  Send,
  Users2,
  Webhook,
} from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/lib/auth-context';
import { FUNCTIONS_REGION } from '@/lib/firebase/client';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';
import { cn, formatDateTimeIt } from '@/lib/utils';

import { registerBrevoWebhooks, saveBrevoSettings, testBrevoConnection } from './api';
import { BREVO_API_KEY_STEPS, BREVO_WEBHOOK_EVENTS, BREVO_WEBHOOK_TYPE_LABELS } from './constants';
import { brevoSettingsInputSchema, validate } from './schemas';
import {
  CheckResult,
  ConfiguredBadge,
  CopyButton,
  ReadOnlyNotice,
  SaveBar,
  SectionSkeleton,
  SettingsField,
  SettingsGrid,
  SettingsSection,
  ToggleRow,
} from './settings-shell';
import type {
  FieldErrors,
  RegisterBrevoWebhooksResult,
  SaveBrevoSettingsInput,
  TestBrevoConnectionResult,
} from './types';
import { useBrevoSettings, useSettingsForm } from './use-settings';

interface BrevoFormValues {
  /** Vuoto quando si conserva la chiave già configurata. */
  apiKey: string;
  defaultSenderEmail: string;
  defaultReplyTo: string;
  syncContacts: boolean;
  defaultListId: string;
  maxSendsPerHour: string;
}

/** Numero da campo di testo: stringa vuota → `null`. */
function toOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function BrevoSettingsPanel() {
  const { can } = useAuth();
  const canWrite = can('settings:write');
  const { data: settings, loading, exists } = useBrevoSettings();

  const { form, update, dirty, reset, commit } = useSettingsForm(settings, (remote) => ({
    apiKey: '',
    defaultSenderEmail: remote.defaultSenderEmail ?? '',
    defaultReplyTo: remote.defaultReplyTo ?? '',
    syncContacts: remote.syncContacts,
    defaultListId: remote.defaultListId != null ? String(remote.defaultListId) : '',
    maxSendsPerHour: remote.maxSendsPerHour != null ? String(remote.maxSendsPerHour) : '',
  }));

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [registering, setRegistering] = React.useState(false);
  const [showKey, setShowKey] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestBrevoConnectionResult | null>(null);
  const [testError, setTestError] = React.useState<string | null>(null);
  const [webhookResult, setWebhookResult] = React.useState<RegisterBrevoWebhooksResult | null>(null);

  const senders = testResult?.senders ?? settings.senders;
  const credits = testResult?.credits ?? settings.credits ?? null;
  const accountEmail = testResult?.account.email ?? settings.accountEmail ?? null;
  const accountCompany = testResult?.account.companyName ?? settings.accountCompany ?? null;
  const webhooks = webhookResult?.webhooks ?? settings.webhooks;
  // Prima della registrazione mostriamo comunque l'indirizzo atteso: è
  // l'endpoint stabile della Cloud Function `brevoWebhook`.
  const expectedWebhookUrl = React.useMemo(() => {
    const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    return project ? `https://${FUNCTIONS_REGION}-${project}.cloudfunctions.net/brevoWebhook` : null;
  }, []);
  const webhookUrl = webhookResult?.url ?? webhooks[0]?.url ?? expectedWebhookUrl;
  const webhookSecretConfigured = webhookResult?.webhookSecretConfigured ?? settings.webhookSecretConfigured;

  const senderOptions: ComboboxOption[] = React.useMemo(
    () =>
      senders.map((sender) => ({
        value: sender.email,
        label: sender.email,
        description: sender.active ? `${sender.name} · verificato` : `${sender.name} · non verificato`,
        icon: sender.active ? <BadgeCheck className="size-4 text-success" /> : undefined,
      })),
    [senders],
  );

  const senderIsVerified =
    !form.defaultSenderEmail || senders.some((sender) => sender.email === form.defaultSenderEmail);

  /** Costruisce e valida il payload della callable. */
  const buildPayload = React.useCallback((): SaveBrevoSettingsInput | null => {
    const payload: SaveBrevoSettingsInput = {
      defaultSenderEmail: form.defaultSenderEmail.trim(),
      defaultReplyTo: form.defaultReplyTo.trim() || null,
      syncContacts: form.syncContacts,
      defaultListId: toOptionalNumber(form.defaultListId),
      maxSendsPerHour: toOptionalNumber(form.maxSendsPerHour),
    };
    const apiKey = form.apiKey.trim();
    if (apiKey) payload.apiKey = apiKey;

    const result = validate(brevoSettingsInputSchema, payload);
    if (!result.success) {
      setErrors(result.errors);
      return null;
    }
    setErrors({});
    return payload;
  }, [form]);

  const handleSave = React.useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      toastError(null, 'Controlla i campi evidenziati in rosso.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveBrevoSettings(payload);
      // La chiave non torna indietro: il campo si svuota e resta il suggerimento.
      commit({ ...form, apiKey: '' });
      if (result.warning) toastWarning('Impostazioni Brevo salvate', result.warning);
      else if (result.apiKeyStored) toastSuccess('Chiave API salvata e verificata su Brevo.');
      else toastSuccess('Impostazioni Brevo salvate.');
    } catch (error) {
      toastError(error, 'Impossibile salvare le impostazioni Brevo.');
    } finally {
      setSaving(false);
    }
  }, [buildPayload, commit, form]);

  const handleTest = React.useCallback(async () => {
    setTesting(true);
    setTestError(null);
    try {
      const apiKey = form.apiKey.trim();
      const result = await testBrevoConnection(apiKey ? { apiKey } : {});
      setTestResult(result);
      // Con una sola casella verificata è comodo proporla subito.
      if (!form.defaultSenderEmail && result.senders[0]) {
        update({ defaultSenderEmail: result.senders[0].email });
      }
      toastSuccess('Connessione a Brevo riuscita.', `Account ${result.account.email}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connessione a Brevo non riuscita.';
      setTestResult(null);
      setTestError(message);
      toastError(error, 'Connessione a Brevo non riuscita.');
    } finally {
      setTesting(false);
    }
  }, [form.apiKey, form.defaultSenderEmail, update]);

  const handleRegisterWebhooks = React.useCallback(async () => {
    setRegistering(true);
    try {
      const result = await registerBrevoWebhooks({});
      setWebhookResult(result);
      toastSuccess(
        'Webhook allineati su Brevo.',
        `${result.created} creati, ${result.updated} aggiornati.`,
      );
      if (!result.webhookSecretConfigured) {
        toastWarning(
          'Segreto dei webhook non configurato',
          'Imposta BREVO_WEBHOOK_SECRET nelle Cloud Functions per verificare la firma delle notifiche.',
        );
      }
    } catch (error) {
      toastError(error, 'Impossibile registrare i webhook su Brevo.');
    } finally {
      setRegistering(false);
    }
  }, []);

  if (loading) return <SectionSkeleton rows={3} />;

  return (
    <div className="space-y-5">
      {!canWrite ? <ReadOnlyNotice /> : null}

      {!exists ? (
        <Alert variant="warning">
          <PlugZap aria-hidden="true" />
          <AlertTitle>Configurazione Brevo non ancora creata</AlertTitle>
          <AlertDescription>
            Salva questa sezione oppure esegui «Inizializza dati predefiniti» dalla scheda Sistema per
            creare il documento delle impostazioni.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* --- Chiave API ---------------------------------------------------- */}
      <SettingsSection
        title="Chiave API Brevo"
        description="Serve per inviare le email, leggere i mittenti verificati e registrare i webhook."
        icon={<KeyRound />}
        actions={
          <>
            <ConfiguredBadge
              configured={settings.apiKeyConfigured}
              configuredLabel={
                settings.apiKeyHint ? `Chiave attiva · ${settings.apiKeyHint}` : 'Chiave attiva'
              }
              missingLabel="Nessuna chiave"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              loading={testing}
              disabled={!settings.apiKeyConfigured && !form.apiKey.trim()}
            >
              {testing ? null : <RefreshCw aria-hidden="true" />}
              Verifica connessione
            </Button>
          </>
        }
      >
        <SettingsField
          htmlFor="brevo-api-key"
          label="Chiave API v3"
          description={
            settings.apiKeyConfigured
              ? `Una chiave è già in servizio${settings.apiKeyHint ? ` (${settings.apiKeyHint})` : ''}. Lascia il campo vuoto per conservarla.`
              : 'Incolla la chiave che inizia con xkeysib-: viene salvata cifrata in Secret Manager e non sarà più visibile.'
          }
          error={errors.apiKey}
        >
          <Input
            id="brevo-api-key"
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={form.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            placeholder={settings.apiKeyConfigured ? '••••••••••••••••••••' : 'xkeysib-…'}
            disabled={!canWrite}
            invalid={Boolean(errors.apiKey)}
            endIcon={
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showKey ? 'Nascondi la chiave' : 'Mostra la chiave'}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        </SettingsField>

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="mb-2 text-sm font-medium text-foreground">Dove trovare la chiave</p>
          <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
            {BREVO_API_KEY_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Button variant="link" size="sm" className="mt-1 h-auto p-0" asChild>
            <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer noopener">
              Apri il pannello chiavi API di Brevo
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        </div>

        {testError ? <CheckResult ok={false} message={testError} /> : null}

        {accountEmail ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Account</p>
              <p className="truncate text-sm font-medium text-foreground">{accountEmail}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Azienda</p>
              <p className="truncate text-sm font-medium text-foreground">
                {accountCompany || 'Non indicata'}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Crediti email residui</p>
              <p className="text-sm font-medium text-foreground">
                {credits?.email != null ? formatNumber(credits.email) : 'Piano senza limite'}
                {credits?.sms != null ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    SMS: {formatNumber(credits.sms)}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}

        {settings.lastCheckedAt ? (
          <p className="text-xs text-muted-foreground">
            Ultima verifica: {formatDateTimeIt(settings.lastCheckedAt)}
            {settings.lastError ? (
              <span className="ml-2 text-destructive">Ultimo errore: {settings.lastError}</span>
            ) : null}
          </p>
        ) : null}
      </SettingsSection>

      {/* --- Mittenti ------------------------------------------------------ */}
      <SettingsSection
        title="Mittente predefinito"
        description="Solo gli indirizzi verificati su Brevo possono spedire: gli altri vengono rifiutati al momento dell’invio."
        icon={<MailCheck />}
      >
        <SettingsGrid>
          <SettingsField
            htmlFor="brevo-sender"
            label="Indirizzo mittente"
            required
            description="Usato da newsletter e automazioni quando non ne specificano uno."
            error={errors.defaultSenderEmail}
          >
            {senderOptions.length > 0 ? (
              <Combobox
                id="brevo-sender"
                options={senderOptions}
                value={form.defaultSenderEmail}
                onChange={(value) => update({ defaultSenderEmail: String(value) })}
                placeholder="Scegli un mittente verificato"
                searchPlaceholder="Cerca un indirizzo…"
                emptyMessage="Nessun mittente corrispondente."
                disabled={!canWrite}
                invalid={Boolean(errors.defaultSenderEmail)}
              />
            ) : (
              <Input
                id="brevo-sender"
                type="email"
                value={form.defaultSenderEmail}
                onChange={(event) => update({ defaultSenderEmail: event.target.value })}
                placeholder="newsletter@alphaink.net"
                disabled={!canWrite}
                invalid={Boolean(errors.defaultSenderEmail)}
              />
            )}
          </SettingsField>

          <SettingsField
            htmlFor="brevo-reply-to"
            label="Indirizzo di risposta"
            description="Dove arrivano le risposte dei clienti. Lascia vuoto per usare il mittente."
            error={errors.defaultReplyTo}
          >
            <Input
              id="brevo-reply-to"
              type="email"
              value={form.defaultReplyTo}
              onChange={(event) => update({ defaultReplyTo: event.target.value })}
              placeholder="info@alphaink.net"
              disabled={!canWrite}
              invalid={Boolean(errors.defaultReplyTo)}
            />
          </SettingsField>
        </SettingsGrid>

        {!senderIsVerified ? (
          <Alert variant="warning">
            <MailCheck aria-hidden="true" />
            <AlertTitle>Mittente non presente fra quelli verificati</AlertTitle>
            <AlertDescription>
              Verifica la connessione per aggiornare l’elenco, oppure aggiungi e conferma l’indirizzo
              nella sezione «Mittenti» di Brevo prima del primo invio.
            </AlertDescription>
          </Alert>
        ) : null}

        {senders.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {senders.map((sender) => (
              <Badge key={`${sender.id}-${sender.email}`} variant={sender.active ? 'success' : 'outline'}>
                {sender.active ? <BadgeCheck aria-hidden="true" /> : null}
                {sender.name} · {sender.email}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nessun mittente caricato: premi «Verifica connessione» per leggerli da Brevo.
          </p>
        )}
      </SettingsSection>

      {/* --- Contatti e limiti --------------------------------------------- */}
      <SettingsSection
        title="Sincronizzazione contatti e limiti"
        description="Allinea la rubrica AlphaInk con Brevo e protegge la reputazione del dominio."
        icon={<Users2 />}
      >
        <ToggleRow
          id="brevo-sync-contacts"
          label="Sincronizza i contatti su Brevo"
          description="Crea e aggiorna i contatti su Brevo con attributi, cluster e stato di iscrizione."
          control={
            <Switch
              id="brevo-sync-contacts"
              checked={form.syncContacts}
              onCheckedChange={(checked) => update({ syncContacts: checked })}
              disabled={!canWrite}
              aria-label="Sincronizza i contatti su Brevo"
            />
          }
        />

        <SettingsGrid>
          <SettingsField
            htmlFor="brevo-list-id"
            label="Lista Brevo predefinita"
            description="Id numerico della lista in cui finiscono i contatti sincronizzati (Contatti → Liste su Brevo)."
            error={errors.defaultListId}
          >
            <Input
              id="brevo-list-id"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={form.defaultListId}
              onChange={(event) => update({ defaultListId: event.target.value })}
              placeholder="Es. 12"
              disabled={!canWrite || !form.syncContacts}
              invalid={Boolean(errors.defaultListId)}
            />
          </SettingsField>

          <SettingsField
            htmlFor="brevo-max-sends"
            label="Limite invii all’ora"
            description="Rallenta le campagne molto grandi. Lascia vuoto per usare il limite del piano Brevo."
            error={errors.maxSendsPerHour}
          >
            <Input
              id="brevo-max-sends"
              type="number"
              inputMode="numeric"
              min={1}
              step={100}
              value={form.maxSendsPerHour}
              onChange={(event) => update({ maxSendsPerHour: event.target.value })}
              placeholder="Es. 5000"
              disabled={!canWrite}
              invalid={Boolean(errors.maxSendsPerHour)}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsSection>

      {/* --- Webhook ------------------------------------------------------- */}
      <SettingsSection
        title="Webhook di tracciamento"
        description="Brevo notifica consegne, aperture, click e disiscrizioni: senza webhook i report restano vuoti."
        icon={<Webhook />}
        actions={
          <>
            <ConfiguredBadge
              configured={webhookSecretConfigured}
              configuredLabel="Firma attiva"
              missingLabel="Firma non configurata"
            />
            <Button variant="outline" size="sm" onClick={handleRegisterWebhooks} loading={registering} disabled={!canWrite}>
              {registering ? null : <Link2 aria-hidden="true" />}
              Registra webhook
            </Button>
          </>
        }
      >
        {webhookUrl ? (
          <SettingsField
            htmlFor="brevo-webhook-url"
            label="URL configurato su Brevo"
            description="È l’endpoint della Cloud Function brevoWebhook, nella regione delle Functions: non serve incollarlo a mano su Brevo, il pulsante lo registra da solo."
          >
            <div className="flex items-center gap-2">
              <Input id="brevo-webhook-url" readOnly value={webhookUrl} className="font-mono text-xs" />
              <CopyButton value={webhookUrl} label="Copia l’URL del webhook" />
            </div>
          </SettingsField>
        ) : null}

        {webhooks.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Id</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead className="w-32 text-right">Eventi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <TableRow key={webhook.id}>
                    <TableCell className="font-mono text-xs">{webhook.id}</TableCell>
                    <TableCell className="text-sm">
                      {BREVO_WEBHOOK_TYPE_LABELS[webhook.type] ?? webhook.type}
                    </TableCell>
                    <TableCell className="max-w-[22rem] truncate font-mono text-xs" title={webhook.url}>
                      {webhook.url}
                    </TableCell>
                    <TableCell className="text-right text-sm">{webhook.events.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nessun webhook registrato. Premi «Registra webhook»: la suite crea o allinea gli endpoint
            transazionale e marketing su Brevo.
          </p>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Eventi raccolti</p>
          <div className="flex flex-wrap gap-1.5">
            {BREVO_WEBHOOK_EVENTS.map((event) => (
              <Badge key={event} variant="outline" className="font-mono text-[11px]">
                {event}
              </Badge>
            ))}
          </div>
        </div>

        {!webhookSecretConfigured ? (
          <Alert variant="warning">
            <Webhook aria-hidden="true" />
            <AlertTitle>Firma delle notifiche non attiva</AlertTitle>
            <AlertDescription>
              Imposta il segreto con{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                firebase functions:secrets:set BREVO_WEBHOOK_SECRET
              </code>{' '}
              per rifiutare le notifiche non firmate.
            </AlertDescription>
          </Alert>
        ) : null}
      </SettingsSection>

      <div className={cn('sticky bottom-4 z-10 rounded-lg border border-border bg-card/95 p-3 shadow-card backdrop-blur')}>
        <SaveBar
          dirty={dirty}
          saving={saving}
          disabled={!canWrite}
          onSave={handleSave}
          onReset={() => {
            reset();
            setErrors({});
          }}
          hint={
            settings.updatedAt
              ? `Ultimo salvataggio: ${formatDateTimeIt(settings.updatedAt)}`
              : undefined
          }
          extraActions={
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Send className="size-3.5" aria-hidden="true" />
              Le credenziali restano in Secret Manager
            </span>
          }
        />
      </div>
    </div>
  );
}
