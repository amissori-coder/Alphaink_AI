'use client';

import {
  COLLECTIONS,
  SUBSCRIPTION_STATUS_LABELS,
  displayNameFor,
  normalizeEmail,
} from '@alphaink/shared';
import type { Contact, DocId, SubscriptionStatus } from '@alphaink/shared';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  documentId,
  endAt,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  startAt,
  where,
} from 'firebase/firestore';
import { Check, Search, UserRoundPlus, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';
import { cn, formatNumber } from '@/lib/utils';

/** Proiezione minima di un contatto usata dai selettori. */
export interface ContactOption {
  id: DocId;
  email: string;
  displayName: string;
  status: SubscriptionStatus;
  segment: 'b2c' | 'b2b';
}

const SEARCH_LIMIT = 20;
const LOOKUP_CHUNK = 10;
const MAX_LOOKUP_IDS = 100;

export const CONTACT_PICKER_QUERY_ROOT = ['contatti', 'selettore'] as const;

export function toContactOption(id: string, data: Partial<Contact>): ContactOption {
  const email = data.email ?? '';
  return {
    id,
    email,
    displayName: displayNameFor({
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      company: data.company ?? null,
      email,
    }),
    status: data.status ?? 'never_subscribed',
    segment: data.segment === 'b2b' ? 'b2b' : 'b2c',
  };
}

/**
 * Ricerca per prefisso sull'email normalizzata.
 * Usa l'indice a campo singolo creato in automatico da Firestore: nessuna
 * configurazione aggiuntiva e nessun costo di lettura sull'intera rubrica.
 */
async function searchContacts(prefix: string): Promise<ContactOption[]> {
  if (prefix.length < 2) return [];
  const reference = query(
    collection(getDb(), COLLECTIONS.contacts),
    orderBy('emailNormalized'),
    startAt(prefix),
    endAt(`${prefix}`),
    limitTo(SEARCH_LIMIT),
  );
  const snapshot = await getDocs(reference);
  return snapshot.docs.map((document) =>
    toContactOption(document.id, document.data() as Partial<Contact>),
  );
}

/** Risolve i contatti già scelti, a blocchi di dieci id (limite di `in`). */
async function lookupContacts(ids: string[]): Promise<ContactOption[]> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_LOOKUP_IDS);
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += LOOKUP_CHUNK) {
    chunks.push(unique.slice(index, index + LOOKUP_CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const snapshot = await getDocs(
        query(collection(getDb(), COLLECTIONS.contacts), where(documentId(), 'in', chunk)),
      );
      return snapshot.docs.map((document) =>
        toContactOption(document.id, document.data() as Partial<Contact>),
      );
    }),
  );

  return results.flat();
}

/** Contatti il cui indirizzo inizia con il testo cercato (minimo due caratteri). */
export function useContactSearch(term: string) {
  const normalized = normalizeEmail(term);
  return useQuery<ContactOption[], Error>({
    queryKey: [...CONTACT_PICKER_QUERY_ROOT, 'ricerca', normalized],
    queryFn: () => searchContacts(normalized),
    enabled: normalized.length >= 2 && isFirebaseConfigured(),
    staleTime: 60_000,
    retry: false,
  });
}

/** Anagrafica dei contatti selezionati, per mostrarne il nome nelle etichette. */
export function useContactLookup(ids: string[]) {
  const signature = React.useMemo(() => Array.from(new Set(ids)).sort().join(','), [ids]);
  return useQuery<ContactOption[], Error>({
    queryKey: [...CONTACT_PICKER_QUERY_ROOT, 'anagrafica', signature],
    queryFn: () => lookupContacts(signature ? signature.split(',') : []),
    enabled: signature.length > 0 && isFirebaseConfigured(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Selettore multiplo
// -----------------------------------------------------------------------------

export interface ContactPickerProps {
  value: DocId[];
  onChange: (ids: DocId[]) => void;
  disabled?: boolean;
  /** Numero massimo di contatti selezionabili. */
  max?: number;
  className?: string;
  label?: string;
}

/**
 * Selettore di contatti per email, con elenco dei già scelti.
 * La ricerca parte dal secondo carattere e interroga il server: funziona anche
 * su rubriche che non stanno in memoria.
 */
export function ContactPicker({
  value,
  onChange,
  disabled = false,
  max = 5000,
  className,
  label = 'Cerca un contatto per email',
}: ContactPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');

  const search = useContactSearch(term);
  const selected = useContactLookup(value);

  const selectedById = React.useMemo(() => {
    const map = new Map<string, ContactOption>();
    for (const option of selected.data ?? []) map.set(option.id, option);
    return map;
  }, [selected.data]);

  const toggle = (option: ContactOption) => {
    if (value.includes(option.id)) {
      onChange(value.filter((id) => id !== option.id));
      return;
    }
    if (value.length >= max) return;
    onChange([...value, option.id]);
  };

  const results = search.data ?? [];
  const normalized = normalizeEmail(term);
  const full = value.length >= max;

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
            disabled={disabled}
            aria-expanded={open}
          >
            <UserRoundPlus aria-hidden="true" />
            {value.length > 0
              ? `${formatNumber(value.length)} contatti selezionati`
              : 'Aggiungi contatti'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,90vw)] p-0">
          <div className="border-b border-border p-2">
            <Input
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={label}
              startIcon={<Search aria-hidden="true" />}
              aria-label={label}
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {normalized.length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Scrivi almeno due caratteri dell’indirizzo email.
              </p>
            ) : search.isPending ? (
              <div className="flex items-center justify-center py-6">
                <Spinner size="sm" label="Ricerca in corso" />
              </div>
            ) : search.error ? (
              <p className="px-3 py-6 text-center text-sm text-destructive">
                {search.error.message}
              </p>
            ) : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nessun contatto trovato per “{term.trim()}”.
              </p>
            ) : (
              <ul role="listbox" aria-label="Risultati della ricerca">
                {results.map((option) => {
                  const checked = value.includes(option.id);
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={checked}
                        disabled={!checked && full}
                        onClick={() => toggle(option)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          'disabled:cursor-not-allowed disabled:opacity-50',
                          checked && 'bg-primary/5',
                        )}
                      >
                        <Check
                          className={cn('size-4 shrink-0', checked ? 'text-primary' : 'opacity-0')}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {option.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.email}
                          </span>
                        </span>
                        <Badge variant={option.status === 'subscribed' ? 'success' : 'outline'}>
                          {SUBSCRIPTION_STATUS_LABELS[option.status]}
                        </Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {full ? (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Hai raggiunto il massimo di {formatNumber(max)} contatti.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <ScrollArea className="max-h-48 rounded-md border border-border">
          <ul className="divide-y divide-border">
            {value.map((id) => {
              const option = selectedById.get(id);
              return (
                <li key={id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {option?.displayName ?? 'Contatto'}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {option?.email ?? id}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={disabled}
                    onClick={() => onChange(value.filter((entry) => entry !== id))}
                    aria-label={`Rimuovi ${option?.email ?? 'il contatto'}`}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      ) : null}
    </div>
  );
}
