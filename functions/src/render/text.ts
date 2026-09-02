/**
 * Versione testuale dell'email.
 *
 * Ogni invio parte con entrambe le versioni: la parte `text/plain` migliora il
 * punteggio antispam ed è l'unica leggibile su alcuni client aziendali.
 */
import { convert } from 'html-to-text';

export interface PlainTextOptions {
  /** Colonne prima di andare a capo; `false` disattiva l'a capo automatico. */
  wordwrap?: number | false;
  /** Mantiene l'URL accanto al testo del link (default: true). */
  showLinkUrls?: boolean;
}

/**
 * Converte l'HTML dell'email in testo:
 *  - le immagini sono ignorate (in testo un `alt` isolato è solo rumore);
 *  - i link diventano `testo (url)`;
 *  - preheader, pixel di tracciamento e contenuti nascosti sono esclusi.
 */
export function htmlToPlainText(html: string, options: PlainTextOptions = {}): string {
  if (!html) return '';
  const showLinkUrls = options.showLinkUrls !== false;
  const text = convert(html, {
    wordwrap: options.wordwrap ?? 78,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: '.ai-preheader', format: 'skip' },
      { selector: '.mobile-hide', format: 'skip' },
      {
        selector: 'a',
        options: {
          hideLinkHrefIfSameAsText: true,
          ignoreHref: !showLinkUrls,
          linkBrackets: showLinkUrls ? [' (', ')'] : false,
        },
      },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'h4', options: { uppercase: false } },
      { selector: 'ul', options: { itemPrefix: ' - ' } },
      { selector: 'table', format: 'dataTable' },
    ],
  });
  // Comprime le righe vuote lasciate dalle tabelle di impaginazione.
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
