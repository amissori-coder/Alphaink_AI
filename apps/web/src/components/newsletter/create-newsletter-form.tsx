'use client';

import type { Newsletter, NewsletterCategory } from '@alphaink/shared';
import { Info, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { CATEGORY_OPTIONS, ROUTES } from './constants';
import { BLANK_TEMPLATE, TemplateGallery } from './template-gallery';
import { useCreateNewsletter } from './use-create-newsletter';
import { useTemplates } from './use-newsletter-data';

export interface CreateNewsletterFormProps {
  /** Riduce le spaziature per l'uso dentro un dialogo. */
  compact?: boolean;
  /** Template preselezionato (id oppure `vuoto`). */
  initialTemplateId?: string | null;
  /** Mostrato accanto al pulsante principale. */
  onCancel?: () => void;
  /** Invocata dopo la creazione, prima di aprire l'editor. */
  onCreated?: (newsletter: Newsletter) => void;
  className?: string;
}

/**
 * Form di creazione di una newsletter: nome interno, oggetto, categoria e
 * punto di partenza. Alla conferma crea la bozza e apre subito l'editor.
 */
export function CreateNewsletterForm({
  compact = false,
  initialTemplateId = null,
  onCancel,
  onCreated,
  className,
}: CreateNewsletterFormProps) {
  const router = useRouter();
  const templates = useTemplates();
  const { create, sender, pending } = useCreateNewsletter();

  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [category, setCategory] = React.useState<NewsletterCategory | ''>('');
  const [templateId, setTemplateId] = React.useState<string>(initialTemplateId ?? BLANK_TEMPLATE);
  const [submitting, setSubmitting] = React.useState(false);

  const selectedTemplate = React.useMemo(
    () => (templates.data ?? []).find((template) => template.id === templateId) ?? null,
    [templates.data, templateId],
  );

  const trimmedName = name.trim();
  const trimmedSubject = subject.trim();
  const valid = trimmedName.length >= 2 && trimmedSubject.length >= 1;
  const busy = submitting || pending;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy) return;

    setSubmitting(true);
    try {
      const created = await create({
        name: trimmedName,
        subject: trimmedSubject,
        category: category || null,
        template: selectedTemplate,
      });
      if (!created) return;
      onCreated?.(created);
      router.push(ROUTES.editor(created.id));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn(compact ? 'space-y-4' : 'space-y-6', className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="crea-nome">Nome interno</Label>
          <Input
            id="crea-nome"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Es. Promo toner settembre"
            maxLength={160}
            required
            autoFocus
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Visibile solo nell’applicazione: serve a ritrovare la campagna negli elenchi.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="crea-categoria">Categoria</Label>
          <Select
            value={category || undefined}
            onValueChange={(value) => setCategory(value as NewsletterCategory)}
            disabled={busy}
          >
            <SelectTrigger id="crea-categoria">
              <SelectValue placeholder="Nessuna categoria" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Serve a filtrare elenco e calendario editoriale.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="crea-oggetto">Oggetto dell’email</Label>
        <Input
          id="crea-oggetto"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Es. -20% su tutti i toner compatibili"
          maxLength={200}
          required
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">
          Potrai modificarlo in qualsiasi momento dall’editor. {subject.length}/200 caratteri.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="flex items-center gap-1.5">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Punto di partenza
          </Label>
          {selectedTemplate ? (
            <span className="text-xs text-muted-foreground">
              Template scelto: {selectedTemplate.name}
            </span>
          ) : null}
        </div>
        <TemplateGallery
          templates={templates.data ?? []}
          loading={templates.loading}
          value={templateId}
          onChange={setTemplateId}
        />
      </div>

      <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Mittente: <strong className="text-foreground">{sender.name}</strong> &lt;{sender.email}&gt;.
          {sender.configured ? null : (
            <>
              {' '}
              Nessun mittente verificato:{' '}
              <Link href={ROUTES.settings} className="underline underline-offset-2">
                configuralo nelle impostazioni Brevo
              </Link>{' '}
              prima di inviare.
            </>
          )}
        </span>
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Annulla
          </Button>
        ) : (
          <Button type="button" variant="outline" asChild>
            <Link href={ROUTES.list}>Torna all’elenco</Link>
          </Button>
        )}
        <Button type="submit" disabled={!valid || busy} loading={busy}>
          Crea e apri l’editor
        </Button>
      </div>
    </form>
  );
}
