'use client';

import { isValidEmail, normalizeEmail } from '@alphaink/shared';
import type { Cluster, Contact, SubscriptionStatus } from '@alphaink/shared';
import { AlertTriangle, Save } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/utils';

import { ChipsInput } from '@/components/clusters/value-input';

import { SEGMENT_OPTIONS, STATUS_OPTIONS } from './constants';
import type { UpsertContactInput } from './types';

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  vatNumber: string;
  language: string;
  segment: 'b2c' | 'b2b';
  status: SubscriptionStatus;
  tags: string[];
  clusterIds: string[];
  notes: string;
  allowResubscribe: boolean;
  consentSource: string;
}

function emptyForm(): FormState {
  return {
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    company: '',
    vatNumber: '',
    language: 'it',
    segment: 'b2c',
    status: 'subscribed',
    tags: [],
    clusterIds: [],
    notes: '',
    allowResubscribe: false,
    consentSource: '',
  };
}

function toForm(contact: Contact): FormState {
  return {
    email: contact.email,
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    phone: contact.phone ?? '',
    company: contact.company ?? '',
    vatNumber: contact.vatNumber ?? '',
    language: contact.language || 'it',
    segment: contact.segment === 'b2b' ? 'b2b' : 'b2c',
    status: contact.status,
    tags: contact.tags ?? [],
    clusterIds: contact.clusterIds ?? [],
    notes: contact.notes ?? '',
    allowResubscribe: false,
    consentSource: contact.consentSource ?? '',
  };
}

export interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contatto da modificare; assente in creazione. */
  contact?: Contact | null;
  clusters: Cluster[];
  busy: boolean;
  onSubmit: (input: UpsertContactInput) => Promise<Contact | null>;
}

/**
 * Modulo di creazione e modifica di un contatto.
 *
 * La riattivazione di un disiscritto richiede una spunta esplicita più
 * l'origine del consenso: è un requisito GDPR, non una comodità della UI.
 */
export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  clusters,
  busy,
  onSubmit,
}: ContactFormDialogProps) {
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [emailError, setEmailError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm(contact ? toForm(contact) : emptyForm());
    setEmailError(null);
  }, [open, contact]);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const clusterOptions: ComboboxOption[] = React.useMemo(
    () =>
      clusters
        .filter((cluster) => cluster.type === 'static' && !cluster.archived)
        .map((cluster) => ({
          value: cluster.id,
          label: cluster.name,
          description: `${formatNumber(cluster.contactCount)} contatti`,
        })),
    [clusters],
  );

  // Un contatto uscito dalla lista torna iscritto solo con consenso documentato.
  const wasOptedOut =
    contact != null && (contact.status === 'unsubscribed' || contact.status === 'blocked');
  const isResubscribing = wasOptedOut && form.status === 'subscribed';
  const consentMissing = isResubscribing && form.consentSource.trim().length < 3;

  const handleSubmit = async () => {
    const email = normalizeEmail(form.email);
    if (!email || !isValidEmail(email)) {
      setEmailError('Inserisci un indirizzo email valido.');
      return;
    }
    if (consentMissing) return;

    const payload: UpsertContactInput = {
      contactId: contact?.id,
      email,
      firstName: form.firstName.trim() || null,
      lastName: form.lastName.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      vatNumber: form.vatNumber.trim() || null,
      language: form.language.trim().slice(0, 5) || 'it',
      segment: form.segment,
      tags: form.tags,
      clusterIds: form.clusterIds,
      status: form.status,
      notes: form.notes.trim() || null,
      source: contact?.source ?? 'manual',
      allowResubscribe: isResubscribing ? form.allowResubscribe : false,
      consentSource: form.consentSource.trim() || null,
    };

    const saved = await onSubmit(payload);
    if (saved) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent size="lg" className="max-h-[92vh]">
        <DialogHeader>
          <DialogTitle>{contact ? 'Modifica contatto' : 'Nuovo contatto'}</DialogTitle>
          <DialogDescription>
            {contact
              ? 'Le modifiche vengono propagate a Brevo alla prossima sincronizzazione dei contatti.'
              : 'L’indirizzo email è la chiave di deduplica: se esiste già, il contatto viene aggiornato invece di essere duplicato.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="contatto-email">Email</Label>
            <Input
              id="contatto-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              invalid={Boolean(emailError)}
              disabled={busy}
              placeholder="nome@azienda.it"
              onChange={(event) => {
                update({ email: event.target.value });
                setEmailError(null);
              }}
              aria-describedby={emailError ? 'contatto-email-errore' : undefined}
            />
            {emailError ? (
              <p id="contatto-email-errore" className="text-xs text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contatto-nome">Nome</Label>
              <Input
                id="contatto-nome"
                value={form.firstName}
                disabled={busy}
                autoComplete="given-name"
                onChange={(event) => update({ firstName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-cognome">Cognome</Label>
              <Input
                id="contatto-cognome"
                value={form.lastName}
                disabled={busy}
                autoComplete="family-name"
                onChange={(event) => update({ lastName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-azienda">Azienda</Label>
              <Input
                id="contatto-azienda"
                value={form.company}
                disabled={busy}
                autoComplete="organization"
                onChange={(event) => update({ company: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-piva">Partita IVA</Label>
              <Input
                id="contatto-piva"
                value={form.vatNumber}
                disabled={busy}
                onChange={(event) => update({ vatNumber: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-telefono">Telefono</Label>
              <Input
                id="contatto-telefono"
                type="tel"
                value={form.phone}
                disabled={busy}
                autoComplete="tel"
                onChange={(event) => update({ phone: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-lingua">Lingua</Label>
              <Combobox
                id="contatto-lingua"
                options={[
                  { value: 'it', label: 'Italiano' },
                  { value: 'en', label: 'Inglese' },
                ]}
                value={form.language}
                onChange={(next) => update({ language: next as string })}
                clearable={false}
                disabled={busy}
                placeholder="Lingua"
                searchPlaceholder="Cerca…"
                emptyMessage="Nessuna lingua."
                className="h-9 w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-segmento">Segmento</Label>
              <Combobox
                id="contatto-segmento"
                options={SEGMENT_OPTIONS}
                value={form.segment}
                onChange={(next) => update({ segment: next as 'b2c' | 'b2b' })}
                clearable={false}
                disabled={busy}
                placeholder="Segmento"
                searchPlaceholder="Cerca…"
                emptyMessage="Nessun segmento."
                className="h-9 w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contatto-stato">Stato di iscrizione</Label>
              <Combobox
                id="contatto-stato"
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(next) => update({ status: next as SubscriptionStatus })}
                clearable={false}
                disabled={busy}
                placeholder="Stato"
                searchPlaceholder="Cerca uno stato…"
                emptyMessage="Nessuno stato."
                className="h-9 w-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contatto-cluster">Cluster statici</Label>
            <Combobox
              id="contatto-cluster"
              multiple
              options={clusterOptions}
              value={form.clusterIds}
              onChange={(next) => update({ clusterIds: next as string[] })}
              disabled={busy || clusterOptions.length === 0}
              placeholder={
                clusterOptions.length === 0 ? 'Nessun cluster statico' : 'Nessun cluster'
              }
              searchPlaceholder="Cerca un cluster…"
              emptyMessage="Nessun cluster statico."
              className="h-9 w-full"
            />
            <p className="text-xs text-muted-foreground">
              I cluster dinamici non compaiono qui: l’appartenenza è decisa dalle loro regole.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium leading-none text-foreground">Etichette</span>
            <ChipsInput
              values={form.tags}
              onChange={(tags) => update({ tags })}
              disabled={busy}
              placeholder="Scrivi un’etichetta e premi Invio"
              ariaLabel="Etichette del contatto"
            />
          </div>

          {isResubscribing ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Stai riattivando un contatto disiscritto</AlertTitle>
              <AlertDescription className="space-y-3">
                <span className="block">
                  Puoi rimettere in lista un indirizzo solo se hai una prova del nuovo consenso
                  (modulo firmato, iscrizione dal sito, richiesta scritta).
                </span>
                <label className="flex items-start gap-2">
                  <Checkbox
                    checked={form.allowResubscribe}
                    onCheckedChange={(checked) => update({ allowResubscribe: checked === true })}
                    aria-label="Confermo di avere il consenso documentato"
                    className="mt-0.5"
                  />
                  <span className="text-sm">Confermo di avere il consenso documentato</span>
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="contatto-consenso">Origine del consenso</Label>
                  <Input
                    id="contatto-consenso"
                    value={form.consentSource}
                    disabled={busy}
                    invalid={consentMissing}
                    placeholder="es. modulo cartaceo del 12/03/2026, fiera MECSPE"
                    onChange={(event) => update({ consentSource: event.target.value })}
                  />
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="contatto-note">Note interne</Label>
            <Textarea
              id="contatto-note"
              rows={3}
              maxLength={2000}
              value={form.notes}
              disabled={busy}
              placeholder="Informazioni utili al team commerciale. Non compaiono nelle email."
              onChange={(event) => update({ notes: event.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Annulla
          </Button>
          <Button
            loading={busy}
            disabled={busy || consentMissing || (isResubscribing && !form.allowResubscribe)}
            onClick={() => void handleSubmit()}
          >
            <Save aria-hidden="true" />
            {contact ? 'Salva le modifiche' : 'Crea il contatto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
