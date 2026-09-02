'use client';

import { ALPHAINK_PALETTE, NEWSLETTER_CATEGORY_LABELS } from '@alphaink/shared';
import type { NewsletterTemplate } from '@alphaink/shared';
import { Check, FilePlus2, LayoutTemplate } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatNumber } from '@/lib/utils';

/** Valore speciale della griglia: nessun template, documento vuoto. */
export const BLANK_TEMPLATE = 'vuoto';

export interface TemplateGalleryProps {
  templates: NewsletterTemplate[];
  loading?: boolean;
  /** Id del template scelto oppure `BLANK_TEMPLATE`. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Mostra anche i template creati dagli utenti, non solo quelli di sistema. */
  includeCustom?: boolean;
}

/** Colore di sfondo della miniatura di ripiego, per categoria. */
const CATEGORY_TINTS: Record<string, string> = {
  promozione: ALPHAINK_PALETTE.cyan,
  novita: ALPHAINK_PALETTE.magenta,
  saldi: ALPHAINK_PALETTE.yellow,
  informativa: ALPHAINK_PALETTE.key,
  stagionale: ALPHAINK_PALETTE.cyan,
  b2b: ALPHAINK_PALETTE.key,
  automazione: ALPHAINK_PALETTE.magenta,
  altro: ALPHAINK_PALETTE.key,
  sistema: ALPHAINK_PALETTE.cyan,
};

function categoryLabel(category: NewsletterTemplate['category']): string {
  if (category === 'sistema') return 'Sistema';
  return NEWSLETTER_CATEGORY_LABELS[category] ?? 'Altro';
}

/** Miniatura: l'immagine salvata oppure un segnaposto tinto con il colore della categoria. */
function Thumbnail({ template }: { template: NewsletterTemplate }) {
  const tint = CATEGORY_TINTS[template.category] ?? ALPHAINK_PALETTE.cyan;

  if (template.thumbnailUrl) {
    return (
      <img
        src={template.thumbnailUrl}
        alt=""
        className="h-28 w-full rounded-md border border-border object-cover object-top"
        loading="lazy"
      />
    );
  }

  return (
    <div
      className="flex h-28 w-full items-center justify-center rounded-md border border-border"
      style={{ backgroundColor: `${tint}1A` }}
      aria-hidden="true"
    >
      <div className="w-3/5 space-y-1.5">
        <div className="h-2.5 rounded-sm" style={{ backgroundColor: tint }} />
        <div className="h-1.5 w-4/5 rounded-sm bg-foreground/15" />
        <div className="h-1.5 w-3/5 rounded-sm bg-foreground/15" />
        <div className="mt-2 h-4 w-2/5 rounded-sm" style={{ backgroundColor: `${tint}99` }} />
      </div>
    </div>
  );
}

/**
 * Griglia di scelta del punto di partenza: documento vuoto oppure uno dei
 * template disponibili, con miniatura, categoria e utilizzi.
 */
export function TemplateGallery({
  templates,
  loading = false,
  value,
  onChange,
  className,
  includeCustom = true,
}: TemplateGalleryProps) {
  const visible = React.useMemo(
    () =>
      templates
        .filter((template) => includeCustom || template.isSystem)
        .sort((left, right) => {
          if (left.isSystem !== right.isSystem) return left.isSystem ? -1 : 1;
          return left.name.localeCompare(right.name, 'it');
        }),
    [templates, includeCustom],
  );

  if (loading) {
    return (
      <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}
      role="radiogroup"
      aria-label="Punto di partenza della newsletter"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === BLANK_TEMPLATE}
        onClick={() => onChange(BLANK_TEMPLATE)}
        className={cn(
          'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          value === BLANK_TEMPLATE
            ? 'border-primary bg-primary/5'
            : 'border-border hover:bg-muted/50',
        )}
      >
        <div className="flex h-28 w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/40">
          <FilePlus2 className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Parti da zero</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Un documento vuoto: costruisci l’email blocco per blocco.
            </span>
          </span>
          {value === BLANK_TEMPLATE ? (
            <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
          ) : null}
        </div>
      </button>

      {visible.length === 0 ? (
        <EmptyState
          compact
          className="sm:col-span-1 lg:col-span-2"
          icon={<LayoutTemplate />}
          title="Nessun template disponibile"
          description="Esegui la configurazione iniziale dalle impostazioni per creare i template di sistema."
        />
      ) : (
        visible.map((template) => {
          const selected = value === template.id;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(template.id)}
              className={cn(
                'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
              )}
            >
              <Thumbnail template={template} />
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {template.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                    {template.description || 'Nessuna descrizione.'}
                  </span>
                </span>
                {selected ? (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{categoryLabel(template.category)}</Badge>
                {template.isSystem ? <Badge variant="secondary">Sistema</Badge> : null}
                {template.usageCount > 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    usato {formatNumber(template.usageCount)}{' '}
                    {template.usageCount === 1 ? 'volta' : 'volte'}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
