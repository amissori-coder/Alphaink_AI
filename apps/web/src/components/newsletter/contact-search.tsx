'use client';

import { COLLECTIONS, displayNameFor, normalizeEmail } from '@alphaink/shared';
import type { Contact, DocId } from '@alphaink/shared';
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
import { Spinner } from '@/components/ui/spinner';
import { getDb, isFirebaseConfigured } from '@/lib/firebase/client';
import { cn } from '@/lib/utils';

import { CONTACT_QUERY_ROOT } from './constants';
import type { ContactOption } from './types';

const SEARCH_LIMIT = 15;
const LOOKUP_CHUNK = 10;
const MAX_LOOKUP_IDS = 60;

function toOption(id: string, data: Partial<Contact>): ContactOption {
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

/** Ricerca per prefisso sull'email normalizzata: usa l'indice naturale di Firestore. */
async function searchContacts(term: string): Promise<ContactOption[]> {
  const prefix = normalizeEmail(term);
  if (prefix.length < 2) return [];
  const reference = query(
    collection(getDb(), COLLECTIONS.contacts),
    orderBy('emailNormalized'),
    startAt(prefix),
    endAt(`${prefix}\uf8ff`),
    limitTo(SEARCH_LIMIT),
  );
  const snapshot = await getDocs(reference);
  return snapshot.docs.map((document) => toOption(document.id, document.data() as Partial<Contact>));
}

/** Risolve i contatti già selezionati, a blocchi di dieci id. */
async function lookupContacts(ids: string[]): Promise<ContactOption[]> {
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, MAX_LOOKUP_IDS);
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += LOOKUP_CHUNK) {
    chunks.push(unique.slice(index, index + LOOKUP_CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const reference = query(
        collection(getDb(), COLLECTIONS.contacts),
        where(documentId(), 'in', chunk),
      );
      const snapshot = await getDocs(reference);
      return snapshot.docs.map((document) =>
        toOption(document.id, document.data() as Partial<Contact>),
      );
    }),
  );

  return results.flat();
}

/** Contatti che corrispondono al testo cercato (minimo due caratteri). */
export function useContactSearch(term: string) {
  const normalized = normalizeEmail(term);
  return useQuery<ContactOption[], Error>({
    queryKey: [...CONTACT_QUERY_ROOT, 'ricerca', normalized],
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
    queryKey: [...CONTACT_QUERY_ROOT, 'anagrafica', signature],
    queryFn: () => lookupContacts(signature ? signature.split(',') : []),
    enabled: signature.length > 0 && isFirebaseConfigured(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Elenco dei risultati, condiviso dai due selettori
// -----------------------------------------------------------------------------

interface ResultListProps {
  term: string;
  onTermChange: (value: string) => void;
  selectedIds: string[];
  onToggle: (option: ContactOption) => void;
  inputId: string;
}

function ResultList({ term, onTermChange, selectedIds, onToggle, inputId }: ResultListProps) {
  const search = useContactSearch(term);
  const results = search.data ?? [];
  const tooShort = normalizeEmail(term).length < 2;

  return (
    <div className="space-y-2">
      <Input
        id={inputId}
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder="Cerca per email…"
        startIcon={<Search />}
        autoFocus
        aria-label="Cerca un contatto per email"
      />

      <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Risultati della ricerca">
        {tooShort ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Scrivi almeno due caratteri dell’indirizzo email.
          </p>
        ) : search.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-4" />
            Ricerca in corso…
          </div>
        ) : search.error ? (
          <p className="px-2 py-6 text-center text-xs text-destructive">{search.error.message}</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nessun contatto trovato per “{term.trim()}”.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {results.map((option) => {
              const selected = selectedIds.includes(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onToggle(option)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected && 'bg-muted',
                    )}
                  >
                    <Check
                      className={cn('size-4 shrink-0 text-primary', !selected && 'opacity-0')}
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
                    <Badge variant="outline" className="shrink-0 uppercase">
                      {option.segment}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Selettore multiplo
// -----------------------------------------------------------------------------

export interface ContactMultiSelectProps {
  value: DocId[];
  onChange: (ids: DocId[]) => void;
  /** Etichetta del pulsante quando non c'è nessuna selezione. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Numero massimo di contatti selezionabili. */
  max?: number;
}

/** Selezione di più contatti con ricerca lato server e chip removibili. */
export function ContactMultiSelect({
  value,
  onChange,
  placeholder = 'Aggiungi contatti…',
  disabled,
  id,
  className,
  max,
}: ContactMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const lookup = useContactLookup(value);

  const labelById = React.useMemo(() => {
    const map = new Map<string, ContactOption>();
    for (const option of lookup.data ?? []) map.set(option.id, option);
    return map;
  }, [lookup.data]);

  const toggle = (option: ContactOption) => {
    if (value.includes(option.id)) {
      onChange(value.filter((item) => item !== option.id));
      return;
    }
    if (max && value.length >= max) return;
    onChange([...value, option.id]);
  };

  const remove = (contactId: string) => onChange(value.filter((item) => item !== contactId));

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
            disabled={disabled}
            aria-expanded={open}
          >
            <UserRoundPlus aria-hidden="true" />
            {value.length > 0 ? `${value.length} contatti selezionati` : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,90vw)] p-2">
          <ResultList
            term={term}
            onTermChange={setTerm}
            selectedIds={value}
            onToggle={toggle}
            inputId={`${id ?? 'contatti'}-ricerca`}
          />
          {max && value.length >= max ? (
            <p className="px-2 pt-2 text-xs text-warning-foreground">
              Hai raggiunto il massimo di {max} contatti.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((contactId) => {
            const option = labelById.get(contactId);
            return (
              <li key={contactId}>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
                  <span className="max-w-[14rem] truncate">
                    {option ? option.email : `Contatto ${contactId.slice(0, 6)}…`}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(contactId)}
                    disabled={disabled}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Rimuovi ${option ? option.email : 'il contatto'}`}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Selettore singolo
// -----------------------------------------------------------------------------

export interface ContactSingleSelectProps {
  value: DocId | null;
  onChange: (id: DocId | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** Selezione di un solo contatto (es. campione per i merge tag). */
export function ContactSingleSelect({
  value,
  onChange,
  placeholder = 'Contatto di esempio…',
  disabled,
  id,
  className,
}: ContactSingleSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const ids = React.useMemo(() => (value ? [value] : []), [value]);
  const lookup = useContactLookup(ids);
  const selected = lookup.data?.[0] ?? null;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start font-normal"
            disabled={disabled}
            aria-expanded={open}
          >
            <Search aria-hidden="true" />
            <span className="truncate">
              {value ? (selected ? `${selected.displayName} · ${selected.email}` : 'Contatto selezionato') : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(24rem,90vw)] p-2">
          <ResultList
            term={term}
            onTermChange={setTerm}
            selectedIds={ids}
            onToggle={(option) => {
              onChange(option.id === value ? null : option.id);
              setOpen(false);
            }}
            inputId={`${id ?? 'contatto'}-ricerca`}
          />
        </PopoverContent>
      </Popover>

      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Rimuovi il contatto di esempio"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
