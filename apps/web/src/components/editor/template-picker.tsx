'use client';

/**
 * Importazione di un template.
 *
 * Sostituisce l'intero documento con quello del template scelto: l'operazione
 * è annullabile con Ctrl+Z, ma il riepilogo prima della conferma evita la
 * sorpresa di veder sparire il lavoro fatto.
 */

import { COLLECTIONS, NEWSLETTER_CATEGORY_LABELS } from '@alphaink/shared';
import type { EmailDocument, NewsletterCategory } from '@alphaink/shared';
import { limit as limitTo, orderBy } from 'firebase/firestore';
import { FileInput, LayoutTemplate, Search, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useCollectionQuery } from '@/lib/hooks/use-collection';

import { countBlocks } from './editor-store';

interface TemplateDoc {
  id: string;
  name: string;
  description?: string | null;
  category: NewsletterCategory | 'sistema';
  document: EmailDocument;
  thumbnailUrl?: string | null;
  isSystem: boolean;
  usageCount: number;
  tags: string[];
}

export interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Riceve il documento del template scelto. */
  onImport: (document: EmailDocument, template: { id: string; name: string }) => void;
}

export function TemplatePickerDialog({ open, onOpenChange, onImport }: TemplatePickerDialogProps) {
  const constraints = React.useMemo(() => [orderBy('name', 'asc'), limitTo(100)], []);
  const { data: templates, loading, error } = useCollectionQuery<TemplateDoc>(
    COLLECTIONS.templates,
    constraints,
    { enabled: open },
  );

  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedId(null);
  }, [open]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(needle) ||
        (template.description ?? '').toLowerCase().includes(needle) ||
        template.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [templates, query]);

  const selected = filtered.find((template) => template.id === selectedId) ?? null;

  const confirm = () => {
    if (!selected?.document) return;
    onImport(selected.document, { id: selected.id, name: selected.name });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[90vh] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle>Importa da template</DialogTitle>
          <DialogDescription>
            Il contenuto attuale viene sostituito da quello del template. Puoi annullare con Ctrl+Z.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border px-5 py-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca per nome, descrizione o etichetta…"
            aria-label="Cerca un template"
            startIcon={<Search />}
            className="h-9"
          />
        </div>

        <ScrollArea className="h-[48vh] min-h-[280px]">
          <div className="p-5">
            {loading ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-40 w-full rounded-lg" />
                ))}
              </div>
            ) : error ? (
              <EmptyState title="Template non disponibili" description={error.message} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<LayoutTemplate />}
                title={query ? 'Nessun template trovato' : 'Nessun template salvato'}
                description={
                  query
                    ? 'Prova con un altro termine di ricerca.'
                    : 'I template di sistema vengono creati dalla configurazione iniziale.'
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {filtered.map((template) => {
                  const active = template.id === selectedId;
                  const blocks = template.document ? countBlocks(template.document) : 0;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      onDoubleClick={() => {
                        setSelectedId(template.id);
                        onImport(template.document, { id: template.id, name: template.name });
                        onOpenChange(false);
                      }}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col overflow-hidden rounded-lg border bg-card text-left transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        active
                          ? 'border-primary ring-2 ring-primary/25'
                          : 'border-border hover:-translate-y-px hover:border-primary/50 hover:shadow-card',
                      )}
                    >
                      <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
                        {template.thumbnailUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={template.thumbnailUrl}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <LayoutTemplate className="size-6 text-muted-foreground" aria-hidden="true" />
                        )}
                      </span>
                      <span className="flex flex-1 flex-col gap-1 p-3">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">
                            {template.name}
                          </span>
                          {template.isSystem ? (
                            <ShieldCheck
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-label="Template di sistema"
                            />
                          ) : null}
                        </span>
                        {template.description ? (
                          <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {template.description}
                          </span>
                        ) : null}
                        <span className="mt-auto flex items-center gap-1.5 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {template.category === 'sistema'
                              ? 'Sistema'
                              : NEWSLETTER_CATEGORY_LABELS[template.category] ?? template.category}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {blocks} {blocks === 1 ? 'blocco' : 'blocchi'}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="items-center gap-3 border-t border-border p-5 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {selected
              ? `«${selected.name}» sostituirà il contenuto attuale.`
              : 'Seleziona un template per continuare.'}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button type="button" onClick={confirm} disabled={!selected}>
              <FileInput aria-hidden="true" />
              Importa
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
