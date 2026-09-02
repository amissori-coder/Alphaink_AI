/**
 * Inlining del CSS.
 *
 * I blocchi sono già generati con stili inline, quindi juice serve soprattutto
 * per l'HTML personalizzato incollato dall'utente (che può portarsi dietro un
 * proprio `<style>`) e come rete di sicurezza sui client che ignorano l'head.
 *
 * Il foglio di stile principale del documento è marcato `data-embed`: juice lo
 * lascia intatto, così media query, regole `prefers-color-scheme` e selettori
 * `[data-ogsc]` — che non sono inlinabili per definizione — restano nell'head.
 */
import juice from 'juice';

export interface InlineOptions {
  /** CSS aggiuntivo da applicare prima dell'inlining. */
  extraCss?: string;
}

export function inlineCss(html: string, options: InlineOptions = {}): string {
  if (!html) return '';
  return juice(html, {
    applyStyleTags: true,
    // Gli stili inlinabili escono dall'head; quelli che non lo sono
    // (media query, font-face, keyframe, pseudo-classi) restano.
    removeStyleTags: true,
    preserveMediaQueries: true,
    preserveFontFaces: true,
    preserveKeyFrames: true,
    preservePseudos: true,
    preserveImportant: true,
    inlinePseudoElements: false,
    // Larghezze e altezze duplicate anche come attributi HTML: Outlook per
    // Windows ignora `width` in CSS sulle tabelle.
    applyWidthAttributes: true,
    applyHeightAttributes: true,
    applyAttributesTableElements: true,
    // Nessuna risorsa remota va scaricata in fase di render.
    webResources: { images: false, links: false, scripts: false, svgs: false },
    extraCss: options.extraCss,
  });
}
