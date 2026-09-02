'use client';

import {
  COLLECTIONS,
  type Cluster,
  type Contact,
  NEWSLETTER_STATUS_LABELS,
  type Newsletter,
  displayNameFor,
} from '@alphaink/shared';
import { endAt, limit, orderBy, startAt, where } from 'firebase/firestore';
import { CornerDownLeft, Layers, Mail, Search, Users, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { NAV_ITEMS } from '@/components/layout/nav-items';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';
import { cn, formatDateIt } from '@/lib/utils';

export interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  key: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
}

const MAX_PER_GROUP = 5;

/** Normalizza per il confronto: minuscolo e senza accenti. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matches(haystacks: Array<string | null | undefined>, needle: string): boolean {
  if (!needle) return true;
  return haystacks.some((value) => (value ? normalize(value).includes(needle) : false));
}

/**
 * Ricerca globale (⌘K / Ctrl+K): filtra newsletter, cluster, contatti e le
 * sezioni dell'applicazione. I contatti sono cercati per prefisso dell'email
 * direttamente su Firestore; newsletter e cluster sono filtrati in memoria
 * sulle ultime voci aggiornate.
 */
export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const router = useRouter();
  const { can } = useAuth();
  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(normalize(term)), 220);
    return () => window.clearTimeout(id);
  }, [term]);

  // Ogni apertura riparte da una ricerca pulita.
  React.useEffect(() => {
    if (!open) {
      setTerm('');
      setDebounced('');
      setActiveIndex(0);
    }
  }, [open]);

  const canReadNewsletters = can('newsletter:read');
  const canReadClusters = can('clusters:read');
  const canReadContacts = can('contacts:read');

  const newsletters = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [where('archived', '==', false), orderBy('updatedAt', 'desc'), limit(50)],
    { enabled: open && canReadNewsletters, key: 'ricerca-newsletter' },
  );

  const clusters = useCollectionQuery<Cluster>(
    COLLECTIONS.clusters,
    [orderBy('name', 'asc'), limit(100)],
    { enabled: open && canReadClusters, key: 'ricerca-cluster' },
  );

  const contactTerm = debounced.length >= 2 ? debounced : '';
  const contacts = useCollectionQuery<Contact>(
    COLLECTIONS.contacts,
    [
      orderBy('emailNormalized', 'asc'),
      startAt(contactTerm),
      endAt(`${contactTerm}\uf8ff`),
      limit(MAX_PER_GROUP),
    ],
    { enabled: open && canReadContacts && contactTerm.length >= 2, key: `ricerca-contatti:${contactTerm}` },
  );

  const results = React.useMemo<SearchResult[]>(() => {
    const rows: SearchResult[] = [];

    for (const item of NAV_ITEMS) {
      if (!can(item.permission)) continue;
      if (!matches([item.label, item.description, ...(item.keywords ?? [])], debounced)) continue;
      rows.push({
        key: `nav:${item.href}`,
        group: 'Sezioni',
        label: item.label,
        hint: item.description,
        href: item.href,
        icon: item.icon,
      });
    }

    if (canReadNewsletters) {
      const found = newsletters.data
        .filter((newsletter) => matches([newsletter.name, newsletter.subject, ...(newsletter.tags ?? [])], debounced))
        .slice(0, MAX_PER_GROUP);
      for (const newsletter of found) {
        const sent = newsletter.sentAt ? formatDateIt(newsletter.sentAt) : null;
        rows.push({
          key: `newsletter:${newsletter.id}`,
          group: 'Newsletter',
          label: newsletter.name || newsletter.subject || 'Senza titolo',
          hint: [NEWSLETTER_STATUS_LABELS[newsletter.status] ?? newsletter.status, sent]
            .filter(Boolean)
            .join(' · '),
          href: `/newsletter/${newsletter.id}`,
          icon: Mail,
        });
      }
    }

    if (canReadClusters) {
      const found = clusters.data
        .filter((cluster) => !cluster.archived && matches([cluster.name, cluster.description], debounced))
        .slice(0, MAX_PER_GROUP);
      for (const cluster of found) {
        rows.push({
          key: `cluster:${cluster.id}`,
          group: 'Cluster',
          label: cluster.name,
          hint: `${cluster.contactCount} contatti`,
          href: `/cluster/${cluster.id}`,
          icon: Layers,
        });
      }
    }

    if (canReadContacts && contactTerm.length >= 2) {
      for (const contact of contacts.data.slice(0, MAX_PER_GROUP)) {
        rows.push({
          key: `contatto:${contact.id}`,
          group: 'Contatti',
          label: displayNameFor(contact),
          hint: contact.email,
          href: `/contatti/${contact.id}`,
          icon: Users,
        });
      }
    }

    return rows;
  }, [
    can,
    canReadClusters,
    canReadContacts,
    canReadNewsletters,
    clusters.data,
    contactTerm,
    contacts.data,
    debounced,
    newsletters.data,
  ]);

  React.useEffect(() => {
    setActiveIndex((current) => (current < results.length ? current : 0));
  }, [results.length]);

  React.useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(results.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) go(selected.href);
    }
  };

  const loading =
    (open && canReadNewsletters && newsletters.loading) ||
    (contactTerm.length >= 2 && contacts.loading);

  let renderedIndex = -1;
  let lastGroup = '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        size="lg"
        className="top-[12%] max-h-[70vh] translate-y-0 gap-0 overflow-hidden p-0"
        aria-describedby="ricerca-globale-descrizione"
      >
        <DialogTitle className="sr-only">Ricerca globale</DialogTitle>
        <DialogDescription id="ricerca-globale-descrizione" className="sr-only">
          Cerca fra newsletter, cluster, contatti e sezioni dell&apos;applicazione.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Cerca newsletter, contatti, cluster…"
            aria-label="Cerca in tutta l'applicazione"
            aria-controls="ricerca-globale-risultati"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading ? <Spinner size="sm" /> : null}
        </div>

        <div
          id="ricerca-globale-risultati"
          role="listbox"
          aria-label="Risultati della ricerca"
          className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {term.trim()
                ? `Nessun risultato per “${term.trim()}”.`
                : 'Digita per cercare fra newsletter, contatti e cluster.'}
            </p>
          ) : (
            results.map((result) => {
              renderedIndex += 1;
              const index = renderedIndex;
              const showGroup = result.group !== lastGroup;
              lastGroup = result.group;
              const Icon = result.icon;
              const active = index === activeIndex;

              return (
                <React.Fragment key={result.key}>
                  {showGroup ? (
                    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
                      {result.group}
                    </p>
                  ) : null}
                  <button
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(result.href)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors',
                      active ? 'bg-muted text-foreground' : 'text-foreground/90 hover:bg-muted/60',
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.label}</span>
                      {result.hint ? (
                        <span className="block truncate text-xs text-muted-foreground">{result.hint}</span>
                      ) : null}
                    </span>
                    {active ? (
                      <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">↑</kbd>{' '}
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">↓</kbd> per muoverti ·{' '}
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">Invio</kbd> per aprire
          </span>
          <span>
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono">Esc</kbd> per chiudere
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
