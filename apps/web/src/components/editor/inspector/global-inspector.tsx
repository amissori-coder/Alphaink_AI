'use client';

/**
 * Impostazioni globali del documento.
 *
 * Valgono per tutta l'email: larghezza, colori di base, tipografia, raggio e
 * supporto al tema scuro. Ogni modifica si riflette subito sul canvas, così si
 * valuta l'effetto complessivo prima di scendere nel dettaglio dei blocchi.
 */

import { ALPHAINK_PALETTE, FONT_STACK_BODY } from '@alphaink/shared';
import { Moon, Palette, Ruler, Type as TypeIcon } from 'lucide-react';
import * as React from 'react';

import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { useEditor } from '../editor-store';
import {
  ColorField,
  Field,
  InspectorGroups,
  InspectorSection,
  NumberField,
  SelectField,
} from './controls';

/**
 * Famiglie proposte. Ogni voce include sempre un fallback web-safe: se il web
 * font non viene caricato dal client di posta, il testo resta leggibile.
 */
const FONT_STACKS: Array<{ value: string; label: string; webFont?: string }> = [
  { value: FONT_STACK_BODY, label: 'Inter (consigliato)', webFont: 'Inter:wght@400;500;600;700;800' },
  {
    value: "'Poppins', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    label: 'Poppins',
    webFont: 'Poppins:wght@400;500;600;700',
  },
  {
    value: "'Montserrat', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    label: 'Montserrat',
    webFont: 'Montserrat:wght@400;500;600;700',
  },
  {
    value: "'Lato', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    label: 'Lato',
    webFont: 'Lato:wght@400;700',
  },
  { value: "Arial, Helvetica, sans-serif", label: 'Arial (universale)' },
  { value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", label: 'Segoe UI' },
  { value: "Verdana, Geneva, sans-serif", label: 'Verdana' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia (con grazie)' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
];

/** Larghezze tipiche: 600 px è lo standard storico dei client di posta. */
const WIDTH_PRESETS = [560, 600, 640, 680];

export function GlobalInspector() {
  const { state, actions } = useEditor();
  const gs = state.document.globalStyles;

  const currentFont =
    FONT_STACKS.find((stack) => stack.value === gs.fontFamily)?.value ?? gs.fontFamily;

  const applyFont = (value: string) => {
    const stack = FONT_STACKS.find((item) => item.value === value);
    actions.updateGlobalStyles({
      fontFamily: value,
      // Il web font va importato nell'head: senza, il client usa il fallback.
      webFonts: stack?.webFont ? [stack.webFont] : [],
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground">Stile del documento</p>
        <p className="text-[11px] text-muted-foreground">
          Impostazioni valide per tutta la newsletter.
        </p>
      </div>

      <InspectorGroups defaultValue={['struttura', 'colori']}>
        <InspectorSection value="struttura" title="Struttura" icon={<Ruler />}>
          <Field
            label="Larghezza del contenuto"
            hint="600 px è la larghezza sicura su tutti i client, compreso Outlook."
          >
            <div className="mb-2 flex items-center gap-1.5">
              {WIDTH_PRESETS.map((width) => (
                <button
                  key={width}
                  type="button"
                  aria-pressed={gs.contentWidth === width}
                  onClick={() => actions.updateGlobalStyles({ contentWidth: width })}
                  className={cn(
                    'flex-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    gs.contentWidth === width
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  {width}
                </button>
              ))}
            </div>
          </Field>
          <NumberField
            label="Larghezza personalizzata"
            value={gs.contentWidth}
            min={320}
            max={900}
            step={10}
            slider
            onChange={(contentWidth) =>
              actions.updateGlobalStyles({ contentWidth }, 'globale:larghezza')
            }
          />
          <NumberField
            label="Raggio degli angoli"
            value={gs.borderRadius}
            min={0}
            max={48}
            slider
            onChange={(borderRadius) => actions.updateGlobalStyles({ borderRadius }, 'globale:raggio')}
            hint="Usato dai contenitori che seguono lo stile del documento."
          />
        </InspectorSection>

        <InspectorSection value="colori" title="Colori" icon={<Palette />}>
          <ColorField
            label="Sfondo dell’email"
            value={gs.backgroundColor}
            onChange={(backgroundColor) =>
              actions.updateGlobalStyles({ backgroundColor: backgroundColor ?? ALPHAINK_PALETTE.background })
            }
            hint="La fascia visibile attorno al contenuto."
          />
          <ColorField
            label="Sfondo del contenuto"
            value={gs.contentBackgroundColor}
            onChange={(contentBackgroundColor) =>
              actions.updateGlobalStyles({
                contentBackgroundColor: contentBackgroundColor ?? '#FFFFFF',
              })
            }
          />
          <ColorField
            label="Testo"
            value={gs.textColor}
            onChange={(textColor) =>
              actions.updateGlobalStyles({ textColor: textColor ?? ALPHAINK_PALETTE.key })
            }
          />
          <ColorField
            label="Titoli"
            value={gs.headingColor}
            onChange={(headingColor) =>
              actions.updateGlobalStyles({ headingColor: headingColor ?? ALPHAINK_PALETTE.key })
            }
          />
          <ColorField
            label="Link"
            value={gs.linkColor}
            onChange={(linkColor) =>
              actions.updateGlobalStyles({ linkColor: linkColor ?? ALPHAINK_PALETTE.cyanDark })
            }
          />
        </InspectorSection>

        <InspectorSection value="tipografia" title="Tipografia" icon={<TypeIcon />}>
          <SelectField
            label="Famiglia"
            value={currentFont}
            onChange={applyFont}
            options={FONT_STACKS.map((stack) => ({ value: stack.value, label: stack.label }))}
          />
          <div
            className="rounded-md border border-border bg-card px-3 py-2.5 text-sm"
            style={{ fontFamily: gs.fontFamily }}
          >
            <span className="block font-semibold" style={{ color: gs.headingColor }}>
              Toner e cartucce per la tua stampante
            </span>
            <span className="block text-xs" style={{ color: gs.textColor }}>
              Anteprima del carattere con un testo di esempio.
            </span>
          </div>
          <NumberField
            label="Dimensione di base"
            value={gs.baseFontSize}
            min={10}
            max={24}
            onChange={(baseFontSize) => actions.updateGlobalStyles({ baseFontSize })}
          />
          <NumberField
            label="Interlinea di base"
            value={gs.baseLineHeight}
            min={1}
            max={2.5}
            step={0.05}
            suffix="×"
            onChange={(baseLineHeight) => actions.updateGlobalStyles({ baseLineHeight })}
          />
          {gs.webFonts.length ? (
            <p className="rounded-md bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
              Web font importati: {gs.webFonts.map((font) => font.split(':')[0]).join(', ')}. Outlook
              per Windows userà comunque il carattere di riserva.
            </p>
          ) : null}
        </InspectorSection>

        <InspectorSection value="dark" title="Tema scuro" icon={<Moon />}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Adatta al tema scuro</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Applica i colori scuri solo alle sezioni che usano quelli predefiniti: le sezioni con
                sfondo personalizzato restano invariate.
              </p>
            </div>
            <Switch
              checked={gs.darkModeSupport}
              onCheckedChange={(darkModeSupport) => actions.updateGlobalStyles({ darkModeSupport })}
              aria-label="Adatta al tema scuro"
            />
          </div>

          {gs.darkModeSupport ? (
            <>
              <Separator />
              <ColorField
                label="Sfondo (scuro)"
                value={gs.darkBackgroundColor ?? '#0B1220'}
                onChange={(darkBackgroundColor) =>
                  actions.updateGlobalStyles({ darkBackgroundColor: darkBackgroundColor ?? '#0B1220' })
                }
              />
              <ColorField
                label="Contenuto (scuro)"
                value={gs.darkContentBackgroundColor ?? '#111C2E'}
                onChange={(darkContentBackgroundColor) =>
                  actions.updateGlobalStyles({
                    darkContentBackgroundColor: darkContentBackgroundColor ?? '#111C2E',
                  })
                }
              />
              <ColorField
                label="Testo (scuro)"
                value={gs.darkTextColor ?? '#E2E8F0'}
                onChange={(darkTextColor) =>
                  actions.updateGlobalStyles({ darkTextColor: darkTextColor ?? '#E2E8F0' })
                }
              />
            </>
          ) : null}
        </InspectorSection>
      </InspectorGroups>
    </div>
  );
}
