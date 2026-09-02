'use client';

/**
 * Pannello proprietà della sezione selezionata.
 *
 * Una sezione è la riga a tutta larghezza dell'email: qui si scelgono le
 * colonne, i due livelli di sfondo (fascia esterna e superficie del
 * contenitore), la spaziatura, il bordo e il comportamento su mobile.
 */

import { COLUMN_PRESETS } from '@alphaink/shared';
import type { EmailSection } from '@alphaink/shared';
import { Columns3, Copy, Image as ImageIcon, Palette, Smartphone, Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useEditor } from '../editor-store';
import { MediaPickerDialog } from '../media-picker';
import { fileNameFromUrl, spansLabel } from '../utils';
import {
  BorderField,
  ColorField,
  Field,
  InspectorGroups,
  InspectorSection,
  SelectField,
  SpacingField,
  SwitchField,
  TextField,
} from './controls';

export function SectionInspector({ section, index }: { section: EmailSection; index: number }) {
  const { state, actions } = useEditor();
  const [mediaOpen, setMediaOpen] = React.useState(false);
  const spans = section.columns.map((column) => column.span);
  const currentPreset = spansLabel(spans);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {section.name?.trim() || `Sezione ${index + 1}`}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {section.columns.length} {section.columns.length === 1 ? 'colonna' : 'colonne'} ·{' '}
            {currentPreset}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <SimpleTooltip content="Duplica sezione">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => actions.duplicateSection(section.id)}
            >
              <Copy aria-hidden="true" />
              <span className="sr-only">Duplica sezione</span>
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="Elimina sezione">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 hover:text-destructive"
              disabled={state.document.sections.length <= 1}
              onClick={() => actions.removeSection(section.id)}
            >
              <Trash2 aria-hidden="true" />
              <span className="sr-only">Elimina sezione</span>
            </Button>
          </SimpleTooltip>
        </div>
      </div>

      <InspectorGroups defaultValue={['colonne', 'sfondo']}>
        <InspectorSection value="colonne" title="Colonne" icon={<Columns3 />}>
          <Field
            label="Struttura"
            hint="Cambiando struttura i blocchi delle colonne in eccesso confluiscono nell’ultima."
          >
            <div className="grid grid-cols-3 gap-1.5">
              {COLUMN_PRESETS.map((preset) => {
                const active = spansLabel(preset.spans) === currentPreset;
                return (
                  <SimpleTooltip key={preset.label} content={preset.label}>
                    <button
                      type="button"
                      aria-label={preset.label}
                      aria-pressed={active}
                      onClick={() => actions.setColumns(section.id, preset.spans)}
                      className={cn(
                        'flex h-9 items-center gap-0.5 rounded-md border p-1 transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-card hover:border-primary/50',
                      )}
                    >
                      {preset.spans.map((span, spanIndex) => (
                        <span
                          key={spanIndex}
                          className={cn('h-full rounded-sm', active ? 'bg-primary/40' : 'bg-muted')}
                          style={{ flexGrow: span, flexBasis: 0 }}
                        />
                      ))}
                    </button>
                  </SimpleTooltip>
                );
              })}
            </div>
          </Field>

          {section.columns.length > 1 ? (
            <div className="space-y-2">
              {section.columns.map((column, columnIndex) => (
                <div
                  key={column.id}
                  className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-2.5"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Colonna {columnIndex + 1} · {column.span}/12
                  </p>
                  <SelectField
                    label="Allineamento verticale"
                    inline
                    value={column.verticalAlign}
                    onChange={(verticalAlign) =>
                      actions.updateColumn(section.id, column.id, { verticalAlign })
                    }
                    options={[
                      { value: 'top', label: 'In alto' },
                      { value: 'middle', label: 'Al centro' },
                      { value: 'bottom', label: 'In basso' },
                    ]}
                  />
                  <ColorField
                    allowEmpty
                    label="Sfondo colonna"
                    value={column.backgroundColor}
                    onChange={(backgroundColor) =>
                      actions.updateColumn(section.id, column.id, { backgroundColor })
                    }
                  />
                  <SpacingField
                    label="Spaziatura interna"
                    value={column.padding}
                    onChange={(padding) => actions.updateColumn(section.id, column.id, { padding })}
                  />
                </div>
              ))}
            </div>
          ) : (
            <SelectField
              label="Allineamento verticale"
              inline
              value={section.columns[0]?.verticalAlign ?? 'top'}
              onChange={(verticalAlign) =>
                section.columns[0] &&
                actions.updateColumn(section.id, section.columns[0].id, { verticalAlign })
              }
              options={[
                { value: 'top', label: 'In alto' },
                { value: 'middle', label: 'Al centro' },
                { value: 'bottom', label: 'In basso' },
              ]}
            />
          )}
        </InspectorSection>

        <InspectorSection value="sfondo" title="Sfondo e spazi" icon={<Palette />}>
          <ColorField
            allowEmpty
            label="Fascia a tutta larghezza"
            fallback={state.document.globalStyles.backgroundColor}
            value={section.fullWidthBackgroundColor}
            onChange={(fullWidthBackgroundColor) =>
              actions.updateSection(section.id, { fullWidthBackgroundColor })
            }
            hint="Il colore visibile ai lati del contenuto."
          />
          <ColorField
            allowEmpty
            label="Superficie del contenuto"
            fallback={state.document.globalStyles.contentBackgroundColor}
            value={section.backgroundColor}
            onChange={(backgroundColor) => actions.updateSection(section.id, { backgroundColor })}
          />

          <Field
            label="Immagine di sfondo"
            hint="Outlook per Windows la ignora: assicurati che il testo resti leggibile anche sul solo colore."
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMediaOpen(true)}
                className={cn(
                  'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition-colors',
                  'hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                aria-label="Scegli l’immagine di sfondo"
              >
                {section.backgroundImage?.src ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={section.backgroundImage.src}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-xs text-muted-foreground">
                  {section.backgroundImage?.src
                    ? fileNameFromUrl(section.backgroundImage.src)
                    : 'Nessuna immagine'}
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setMediaOpen(true)}
                  >
                    {section.backgroundImage ? 'Cambia' : 'Scegli'}
                  </Button>
                  {section.backgroundImage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => actions.updateSection(section.id, { backgroundImage: null })}
                    >
                      Rimuovi
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Field>

          {section.backgroundImage ? (
            <div className="space-y-3 rounded-md border border-border/70 bg-muted/30 p-2.5">
              <SelectField
                label="Adattamento"
                inline
                value={section.backgroundImage.size}
                onChange={(size) =>
                  section.backgroundImage &&
                  actions.updateSection(section.id, {
                    backgroundImage: { ...section.backgroundImage, size },
                  })
                }
                options={[
                  { value: 'cover', label: 'Riempi' },
                  { value: 'contain', label: 'Contieni' },
                  { value: 'auto', label: 'Dimensione reale' },
                ]}
              />
              <SwitchField
                label="Ripeti"
                checked={section.backgroundImage.repeat}
                onChange={(repeat) =>
                  section.backgroundImage &&
                  actions.updateSection(section.id, {
                    backgroundImage: { ...section.backgroundImage, repeat },
                  })
                }
              />
            </div>
          ) : null}

          <Separator />

          <SpacingField
            label="Spaziatura della sezione"
            value={section.padding}
            max={160}
            onChange={(padding) => actions.updateSection(section.id, { padding })}
          />
          <BorderField
            value={section.border}
            onChange={(border) => actions.updateSection(section.id, { border })}
          />
        </InspectorSection>

        <InspectorSection value="mobile" title="Comportamento mobile" icon={<Smartphone />}>
          <SwitchField
            label="Impila le colonne"
            checked={section.stackOnMobile !== false}
            hint="Su schermi stretti le colonne vanno una sotto l’altra."
            onChange={(stackOnMobile) => actions.updateSection(section.id, { stackOnMobile })}
          />
          <SwitchField
            label="Inverti l’ordine"
            checked={Boolean(section.reverseOnMobile)}
            hint="Solo per le sezioni a due colonne: utile per mettere l’immagine sopra al testo."
            onChange={(reverseOnMobile) => actions.updateSection(section.id, { reverseOnMobile })}
          />
          <Separator />
          <TextField
            label="Nome della sezione"
            value={section.name ?? ''}
            onChange={(name) => actions.updateSection(section.id, { name })}
            placeholder="Copertina, Prodotti, Footer…"
            hint="Solo per orientarsi nell’editor: non compare nell’email."
          />
        </InspectorSection>
      </InspectorGroups>

      <MediaPickerDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        currentSrc={section.backgroundImage?.src ?? null}
        onSelect={(selection) =>
          actions.updateSection(section.id, {
            backgroundImage: {
              src: selection.src,
              size: section.backgroundImage?.size ?? 'cover',
              repeat: section.backgroundImage?.repeat ?? false,
            },
          })
        }
      />
    </div>
  );
}
