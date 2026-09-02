'use client';

/**
 * Barra superiore dell'editor.
 *
 * Riunisce ciò che si usa di continuo: oggetto e testo di anteprima (con
 * contatore e avviso oltre i limiti), annulla/ripristina, commutatore
 * desktop/mobile e le azioni sulla campagna.
 *
 * ## Perché il contatore dell'oggetto
 * Un oggetto troppo lungo viene troncato dalle caselle di posta, spesso proprio
 * dove c'era la promessa: il contatore avvisa prima dell'invio, non dopo.
 */

import { LIMITS } from '@alphaink/shared';
import {
  Braces,
  Eye,
  FileDown,
  FileInput,
  Monitor,
  MoreHorizontal,
  Redo2,
  Save,
  Send,
  Smartphone,
  Undo2,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { countBlocks, useEditor } from './editor-store';
import { MergeTagMenu } from './merge-tag-menu';

// -----------------------------------------------------------------------------
// Campo con contatore
// -----------------------------------------------------------------------------

interface CounterFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  hint: string;
}

function CounterField({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
}: CounterFieldProps) {
  const length = value.length;
  const over = length > maxLength;
  const near = !over && length > maxLength * 0.9;
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  /** Inserisce il merge tag nel punto del cursore, non in coda. */
  const insertToken = (token: string) => {
    const input = inputRef.current;
    if (!input) {
      onChange(`${value}${token}`);
      return;
    }
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + token.length;
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
        <span
          className={cn(
            'text-[11px] tabular-nums',
            over ? 'font-semibold text-destructive' : near ? 'text-warning-foreground' : 'text-muted-foreground',
          )}
          aria-live="polite"
        >
          {length}/{maxLength}
        </span>
      </div>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          invalid={over}
          className="h-9 pr-9 text-sm"
          aria-describedby={`${id}-aiuto`}
        />
        <span className="absolute right-1 top-1/2 -translate-y-1/2">
          <MergeTagMenu
            align="end"
            groups={['contatto', 'azienda', 'coupon', 'ordine']}
            onInsert={insertToken}
            trigger={
              <button
                type="button"
                aria-label={`Inserisci un merge tag in ${label.toLowerCase()}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
              >
                <Braces />
              </button>
            }
          />
        </span>
      </div>
      <p id={`${id}-aiuto`} className="mt-1 truncate text-[11px] text-muted-foreground">
        {over ? `Oltre il limite: verrà troncato dai client di posta.` : hint}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Barra
// -----------------------------------------------------------------------------

export interface EditorToolbarProps {
  subject: string;
  preheader: string;
  onSubjectChange: (value: string) => void;
  onPreheaderChange: (value: string) => void;
  onPreview: () => void;
  onExportHtml: () => void;
  onImportTemplate: () => void;
  /** Assente quando la newsletter non è ancora salvata. */
  onSendTest?: () => void;
  onSave?: () => void;
  saving?: boolean;
  exporting?: boolean;
  className?: string;
}

export function EditorToolbar({
  subject,
  preheader,
  onSubjectChange,
  onPreheaderChange,
  onPreview,
  onExportHtml,
  onImportTemplate,
  onSendTest,
  onSave,
  saving,
  exporting,
  className,
}: EditorToolbarProps) {
  const { state, actions, canUndo, canRedo } = useEditor();
  const blocks = React.useMemo(() => countBlocks(state.document), [state.document]);

  return (
    <div
      className={cn(
        'flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border bg-card px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-[280px] flex-1 flex-wrap items-end gap-4">
        <CounterField
          id="editor-oggetto"
          label="Oggetto"
          value={subject}
          onChange={onSubjectChange}
          placeholder="Es. {{contact.firstName}}, toner in offerta fino a domenica"
          maxLength={LIMITS.maxSubjectLength}
          hint="I primi 40 caratteri sono quelli che si leggono sempre."
        />
        <CounterField
          id="editor-preheader"
          label="Testo di anteprima"
          value={preheader}
          onChange={onPreheaderChange}
          placeholder="La riga mostrata dopo l’oggetto nella casella di posta"
          maxLength={LIMITS.maxPreheaderLength}
          hint="Completa l’oggetto: non ripeterlo."
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <SimpleTooltip content="Annulla (Ctrl+Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={!canUndo}
              onClick={actions.undo}
            >
              <Undo2 aria-hidden="true" />
              <span className="sr-only">Annulla</span>
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="Ripristina (Ctrl+Maiusc+Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={!canRedo}
              onClick={actions.redo}
            >
              <Redo2 aria-hidden="true" />
              <span className="sr-only">Ripristina</span>
            </Button>
          </SimpleTooltip>
        </div>

        <ToggleGroup
          type="single"
          value={state.viewport}
          onValueChange={(value) => {
            if (value === 'desktop' || value === 'mobile') actions.setViewport(value);
          }}
          aria-label="Larghezza di anteprima"
        >
          <ToggleGroupItem value="desktop" aria-label="Anteprima desktop" className="size-8">
            <Monitor aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Anteprima mobile" className="size-8">
            <Smartphone aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>

        <Separator orientation="vertical" className="mx-0.5 h-8" />

        <Button type="button" variant="outline" size="sm" onClick={onPreview}>
          <Eye aria-hidden="true" />
          Anteprima
        </Button>

        <SimpleTooltip
          content={onSendTest ? 'Invia una copia di prova' : 'Salva la newsletter per inviare una prova'}
        >
          <span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!onSendTest}
              onClick={onSendTest}
            >
              <Send aria-hidden="true" />
              Invia test
            </Button>
          </span>
        </SimpleTooltip>

        {onSave ? (
          <Button type="button" size="sm" onClick={onSave} loading={saving}>
            <Save aria-hidden="true" />
            Salva
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8">
              <MoreHorizontal aria-hidden="true" />
              <span className="sr-only">Altre azioni</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onImportTemplate}>
              <FileInput aria-hidden="true" />
              Importa da template
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExportHtml} disabled={exporting}>
              <FileDown aria-hidden="true" />
              Esporta HTML
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal normal-case tracking-normal">
              {state.document.sections.length}{' '}
              {state.document.sections.length === 1 ? 'sezione' : 'sezioni'} · {blocks}{' '}
              {blocks === 1 ? 'blocco' : 'blocchi'}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
