'use client';

/**
 * Blocco di testo con editing inline.
 *
 * Il testo si modifica direttamente sul canvas (Tiptap): grassetto, corsivo,
 * sottolineato, barrato, elenchi, link, colore e merge tag. La barra degli
 * strumenti compare sopra al blocco solo quando è selezionato, così il canvas
 * resta pulito mentre si osserva il risultato.
 *
 * ## Perché l'allineamento è del blocco e non del paragrafo
 * Il sanificatore del renderer ammette negli attributi `style` solo colore,
 * dimensione, peso, decorazione e sfondo: un `text-align` sul singolo paragrafo
 * verrebbe scartato nell'email. L'allineamento agisce quindi sulla tipografia
 * del blocco, che il renderer applica al contenitore.
 */

import type { TextBlockContent, TextAlign } from '@alphaink/shared';
import Color from '@tiptap/extension-color';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor as useTiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Strikethrough,
  Underline as UnderlineIcon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/ui/color-picker';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { useEditor } from '../editor-store';
import { MergeTagMenu } from '../merge-tag-menu';
import { htmlToPlainText, normalizeUrl, typographyToStyle } from '../utils';
import type { BlockViewProps } from './types';

const ALIGNMENTS: Array<{ value: TextAlign; label: string; icon: React.ReactNode }> = [
  { value: 'left', label: 'Allinea a sinistra', icon: <AlignLeft /> },
  { value: 'center', label: 'Allinea al centro', icon: <AlignCenter /> },
  { value: 'right', label: 'Allinea a destra', icon: <AlignRight /> },
  { value: 'justify', label: 'Giustifica', icon: <AlignJustify /> },
];

/** Pulsante compatto della barra di formattazione. */
function ToolButton({
  active,
  label,
  onClick,
  children,
  disabled,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // `mousedown` predefinito toglierebbe il fuoco all'editor perdendo la selezione.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors [&_svg]:size-3.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function TextBlock({ block, selected }: BlockViewProps) {
  const { actions, state } = useEditor();
  const content = block.content as TextBlockContent & { type: 'text' };
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkDraft, setLinkDraft] = React.useState('');

  // Riferimenti stabili per non ricreare l'istanza Tiptap a ogni render.
  const blockIdRef = React.useRef(block.id);
  blockIdRef.current = block.id;
  const actionsRef = React.useRef(actions);
  actionsRef.current = actions;

  const editor = useTiptapEditor({
    // Next.js renderizza anche i componenti client sul server: senza questa
    // opzione l'HTML iniziale non combacia con quello idratato.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: content.html || '<p></p>',
    editable: false,
    editorProps: {
      attributes: {
        class: 'ai-prose focus:outline-none',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: instance }) => {
      actionsRef.current.updateBlock(
        blockIdRef.current,
        { html: instance.getHTML() },
        `testo:${blockIdRef.current}`,
      );
    },
  });

  // L'editing è consentito solo sul blocco selezionato: evita fuochi accidentali.
  // Al primo clic il blocco viene selezionato e subito dopo riceve il fuoco, così
  // si comincia a scrivere senza dover fare un secondo clic.
  const focusOnSelect = React.useRef(false);

  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(selected);
    if (selected && focusOnSelect.current) {
      focusOnSelect.current = false;
      editor.commands.focus();
    }
    if (!selected) focusOnSelect.current = false;
  }, [editor, selected]);

  // Allineamento dal documento verso l'istanza Tiptap (undo, import, template).
  React.useEffect(() => {
    if (!editor) return;
    const incoming = content.html || '<p></p>';
    if (editor.isFocused) return;
    if (editor.getHTML() === incoming) return;
    editor.commands.setContent(incoming, false);
  }, [editor, content.html]);

  const applyLink = () => {
    if (!editor) return;
    const href = normalizeUrl(linkDraft);
    if (!href) return;
    editor.chain().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };

  const removeLink = () => {
    editor?.chain().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  const typographyStyle = typographyToStyle(content.typography);
  const isEmpty = !htmlToPlainText(content.html);

  return (
    <div className="relative">
      {selected && editor ? (
        <div
          className={cn(
            'absolute left-0 z-30 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-popover',
            'animate-fade-in',
          )}
          style={{ top: '-2.7rem' }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <ToolButton
            label="Grassetto"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold />
          </ToolButton>
          <ToolButton
            label="Corsivo"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </ToolButton>
          <ToolButton
            label="Sottolineato"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon />
          </ToolButton>
          <ToolButton
            label="Barrato"
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough />
          </ToolButton>

          <Separator orientation="vertical" className="mx-0.5 h-5" />

          <ToolButton
            label="Elenco puntato"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List />
          </ToolButton>
          <ToolButton
            label="Elenco numerato"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </ToolButton>

          <Separator orientation="vertical" className="mx-0.5 h-5" />

          <Popover
            open={linkOpen}
            onOpenChange={(next) => {
              setLinkOpen(next);
              if (next) setLinkDraft((editor.getAttributes('link').href as string) ?? '');
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Inserisci link"
                title="Inserisci link"
                onMouseDown={(event) => event.preventDefault()}
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-md transition-colors [&_svg]:size-3.5',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  editor.isActive('link')
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Link2 />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2">
              <p className="text-xs font-medium text-foreground">Indirizzo del link</p>
              <Input
                autoFocus
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyLink();
                  }
                }}
                placeholder="https://alphaink.net/offerte"
                className="h-8 text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <Button type="button" size="sm" onClick={applyLink} disabled={!linkDraft.trim()}>
                  Applica
                </Button>
                {editor.isActive('link') ? (
                  <Button type="button" size="sm" variant="ghost" onClick={removeLink}>
                    <Link2Off aria-hidden="true" />
                    Rimuovi
                  </Button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>

          <div onMouseDown={(event) => event.preventDefault()}>
            <ColorPicker
              hideInput
              align="start"
              label="Colore del testo"
              value={(editor.getAttributes('textStyle').color as string) ?? content.typography.color}
              // Nessun `focus()`: aprirebbe e chiuderebbe il popover del colore.
              onChange={(color) => editor.chain().setColor(color).run()}
              className="[&>button]:size-7"
            />
          </div>

          <Separator orientation="vertical" className="mx-0.5 h-5" />

          {ALIGNMENTS.map((alignment) => (
            <ToolButton
              key={alignment.value}
              label={alignment.label}
              active={content.typography.align === alignment.value}
              onClick={() =>
                actions.updateBlock(block.id, {
                  typography: { ...content.typography, align: alignment.value },
                })
              }
            >
              {alignment.icon}
            </ToolButton>
          ))}

          <Separator orientation="vertical" className="mx-0.5 h-5" />

          <MergeTagMenu
            align="start"
            onInsert={(token) => editor.chain().focus().insertContent(token).run()}
            trigger={
              <button
                type="button"
                aria-label="Inserisci merge tag"
                title="Inserisci merge tag"
                onMouseDown={(event) => event.preventDefault()}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
              >
                <Braces />
              </button>
            }
          />
        </div>
      ) : null}

      <div
        style={typographyStyle}
        className="relative"
        onMouseDown={() => {
          if (!selected) focusOnSelect.current = true;
        }}
      >
        <EditorContent editor={editor} />
        {isEmpty && !selected ? (
          <span className="pointer-events-none absolute inset-0 italic opacity-40">
            Blocco di testo vuoto — fai clic per scrivere.
          </span>
        ) : null}
      </div>

      {/* Promemoria discreto: il canvas non risolve i merge tag dentro al testo. */}
      {selected && state.viewport === 'desktop' && content.html.includes('{{') ? (
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-primary/70">
          I merge tag verranno sostituiti all’invio
        </p>
      ) : null}
    </div>
  );
}
