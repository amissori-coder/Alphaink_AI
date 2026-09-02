'use client';

import { COLLECTIONS, blockId, emptyDocument } from '@alphaink/shared';
import type {
  BrandingSettings,
  BrevoSettings,
  Newsletter,
  NewsletterCategory,
} from '@alphaink/shared';
import { CalendarPlus, Info } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentQuery } from '@/lib/hooks/use-document';
import { formatDateTimeIt } from '@/lib/utils';

import { BUSINESS_TIMEZONE, CATEGORY_OPTIONS } from './constants';
import type { NewsletterDraftInput } from './types';
import { formatTime } from './utils';

export interface NewNewsletterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Giorno preselezionato: arriva dal clic su una cella del calendario. */
  day: Date | null;
  /** Crea la bozza; restituisce la newsletter creata oppure `null` in caso di errore. */
  onCreate: (input: NewsletterDraftInput) => Promise<Newsletter | null>;
  /** Invocata dopo la creazione, tipicamente per aprire l'editor. */
  onCreated: (newsletter: Newsletter) => void;
  pending?: boolean;
}

const FALLBACK_SENDER_NAME = 'AlphaInk';
const FALLBACK_SENDER_EMAIL = 'info@alphaink.net';

/** Orario predefinito di invio quando si crea dalla griglia. */
const DEFAULT_SEND_TIME = '09:00';

/**
 * Creazione rapida di una bozza con la data di invio già compilata.
 * Il contenuto si costruisce poi nell'editor: qui si raccoglie il minimo
 * indispensabile perché la newsletter esista e compaia nel calendario.
 */
export function NewNewsletterDialog({
  open,
  onOpenChange,
  day,
  onCreate,
  onCreated,
  pending = false,
}: NewNewsletterDialogProps) {
  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [category, setCategory] = React.useState<NewsletterCategory | ''>('');
  const [date, setDate] = React.useState<string | null>(null);
  const [time, setTime] = React.useState(DEFAULT_SEND_TIME);
  const [submitting, setSubmitting] = React.useState(false);

  const brevo = useDocumentQuery<BrevoSettings>(COLLECTIONS.settings, 'brevo', { enabled: open });
  const branding = useDocumentQuery<BrandingSettings>(COLLECTIONS.settings, 'branding', {
    enabled: open,
  });

  const dayTime = day ? day.getTime() : null;

  // All'apertura si azzerano i campi e si precompila la data scelta sulla griglia.
  React.useEffect(() => {
    if (!open) return;
    setName('');
    setSubject('');
    setCategory('');
    setDate(day ? day.toISOString() : null);
    setTime(day && (day.getHours() || day.getMinutes()) ? formatTime(day) : DEFAULT_SEND_TIME);
  }, [open, dayTime, day]);

  const sender = React.useMemo(() => {
    const settings = brevo.data;
    const active = settings?.senders?.find(
      (candidate) => candidate.email === settings.defaultSenderEmail,
    );
    const first = settings?.senders?.find((candidate) => candidate.active) ?? settings?.senders?.[0];
    const chosen = active ?? first ?? null;
    return {
      name: chosen?.name || branding.data?.companyName || FALLBACK_SENDER_NAME,
      email:
        chosen?.email ||
        brevo.data?.defaultSenderEmail ||
        branding.data?.supportEmail ||
        FALLBACK_SENDER_EMAIL,
      configured: Boolean(chosen?.email || brevo.data?.defaultSenderEmail),
    };
  }, [brevo.data, branding.data]);

  const sendAt = React.useMemo(() => {
    if (!date) return null;
    const base = new Date(date);
    if (Number.isNaN(base.getTime())) return null;
    const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
    base.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    return base;
  }, [date, time]);

  const trimmedName = name.trim();
  const trimmedSubject = subject.trim();
  const valid = trimmedName.length >= 2 && trimmedSubject.length >= 1;
  const busy = submitting || pending;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy) return;

    const input: NewsletterDraftInput = {
      name: trimmedName,
      subject: trimmedSubject,
      preheader: null,
      fromName: sender.name,
      fromEmail: sender.email,
      replyTo: null,
      document: emptyDocument(blockId('section'), blockId('column')),
      audience: {
        clusterIds: [],
        excludeClusterIds: [],
        includeContactIds: [],
        excludeContactIds: [],
      },
      schedule: sendAt
        ? { sendAt: sendAt.toISOString(), timezone: BUSINESS_TIMEZONE, throttle: null, quietHours: null }
        : null,
      tags: [],
      color: null,
      category: category || null,
    };

    setSubmitting(true);
    try {
      const created = await onCreate(input);
      if (created) {
        onOpenChange(false);
        onCreated(created);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="size-4 text-primary" aria-hidden="true" />
              Nuova newsletter
            </DialogTitle>
            <DialogDescription>
              Viene creata una bozza con la data di invio già impostata. Il contenuto si costruisce
              nell’editor, poi la newsletter si pianifica per l’invio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="nuova-nome">Nome interno</Label>
            <Input
              id="nuova-nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Es. Promo toner settembre"
              maxLength={160}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nuova-oggetto">Oggetto dell’email</Label>
            <Input
              id="nuova-oggetto"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Es. -20% su tutti i toner compatibili"
              maxLength={200}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="nuova-categoria">Categoria</Label>
              <Select
                value={category || undefined}
                onValueChange={(value) => setCategory(value as NewsletterCategory)}
              >
                <SelectTrigger id="nuova-categoria">
                  <SelectValue placeholder="Nessuna" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="nuova-data">Data di invio</Label>
              <DatePicker id="nuova-data" value={date} onChange={setDate} minDate={new Date()} />
            </div>

            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="nuova-ora">Orario</Label>
              <Input
                id="nuova-ora"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                step={300}
              />
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Mittente: <strong className="text-foreground">{sender.name}</strong> &lt;{sender.email}&gt;
              {sender.configured ? null : ' — configura un mittente verificato nelle impostazioni Brevo.'}
              {sendAt ? ` · Invio previsto per ${formatDateTimeIt(sendAt)}.` : ' · Nessuna data impostata.'}
            </span>
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Annulla
            </Button>
            <Button type="submit" disabled={!valid || busy} loading={busy}>
              Crea e apri l’editor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
