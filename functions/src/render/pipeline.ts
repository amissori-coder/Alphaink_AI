/**
 * Pipeline completa di costruzione dell'email.
 *
 *   validazione → render HTML → merge tag → riscrittura link → pixel di
 *   apertura → inlining CSS → versione testuale
 *
 * L'ordine non è arbitrario: i merge tag vanno risolti **prima** della
 * riscrittura dei link (altrimenti si tenterebbe di firmare un URL che è
 * ancora un token), e il pixel va inserito **prima** dell'inlining, così anche
 * lui riceve i propri stili.
 */
import { LIMITS } from '@alphaink/shared';
import type { BlockContent, EmailBlock, EmailDocument, EmailGlobalStyles, UtmParams } from '@alphaink/shared';

import { renderEmailDocument } from './document';
import { safeUrl, stripTags } from './html-utils';
import { inlineCss } from './inline';
import { injectOpenPixel, rewriteLinks } from './links';
import type { TrackingLinkOptions } from './links';
import {
  buildMergeContext,
  deferredTokens,
  listMergeTags,
  listUnknownTags,
  mergeContextToFields,
  resolveMergeTags,
} from './merge-tags';
import type { MergeContext, MergeContextInput } from './merge-tags';
import { htmlToPlainText } from './text';
import { hasBlockingIssues, makeWarning } from './types';
import type { FieldValues, RenderBranding, RenderWarning } from './types';

/** Oltre questa soglia Gmail tronca il messaggio e mostra "Visualizza messaggio completo". */
export const GMAIL_CLIP_BYTES = 102 * 1024;

// ---------------------------------------------------------------------------
// Attraversamento del documento
// ---------------------------------------------------------------------------

export function forEachBlock(
  document: EmailDocument | null | undefined,
  visit: (block: EmailBlock, sectionId: string) => void,
): void {
  for (const section of document?.sections ?? []) {
    for (const column of section?.columns ?? []) {
      for (const block of column?.blocks ?? []) {
        if (block) visit(block, section.id);
      }
    }
  }
}

export function countBlocks(document: EmailDocument | null | undefined): number {
  let total = 0;
  forEachBlock(document, () => {
    total += 1;
  });
  return total;
}

/** Testo di tutti i contenuti testuali, usato per cercare i merge tag. */
function collectTextualContent(document: EmailDocument | null | undefined): string {
  const chunks: string[] = [];
  forEachBlock(document, (block) => {
    const content = block.content as BlockContent | undefined;
    if (!content) return;
    if (content.type === 'text' || content.type === 'html') chunks.push(content.html ?? '');
    if (content.type === 'heading') chunks.push(content.text ?? '');
    if (content.type === 'footer') chunks.push(`${content.address ?? ''} ${content.extraHtml ?? ''}`);
    if (content.type === 'unsubscribe') chunks.push(`${content.text ?? ''} ${content.linkLabel ?? ''}`);
    if (content.type === 'button') chunks.push(content.href ?? '');
    if (content.type === 'menu') chunks.push((content.items ?? []).map((i) => i.href ?? '').join(' '));
  });
  return chunks.join('\n');
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

export interface ValidateDocumentOptions {
  subject?: string;
  preheader?: string;
  /** HTML già costruito: abilita il controllo sul peso del messaggio. */
  html?: string;
}

/**
 * Controlli sul documento prima dell'invio.
 *
 * Gravità assegnate:
 *  - `errore` (bloccante): documento vuoto, oggetto mancante, disiscrizione
 *    assente, link di un pulsante non valido, troppi blocchi;
 *  - `avviso`: immagini senza `alt`, HTML oltre la soglia di clipping di Gmail,
 *    link secondari non validi, preheader troppo lungo.
 */
export function validateDocument(
  document: EmailDocument,
  options: ValidateDocumentOptions = {},
): RenderWarning[] {
  const warnings: RenderWarning[] = [];
  const blocks: Array<{ block: EmailBlock; sectionId: string }> = [];
  forEachBlock(document, (block, sectionId) => blocks.push({ block, sectionId }));

  if (!blocks.length) {
    warnings.push(makeWarning('documento_vuoto', 'Il documento non contiene blocchi: non c’è nulla da inviare.', 'errore'));
  }
  if (blocks.length > LIMITS.maxBlocksPerDocument) {
    warnings.push(
      makeWarning(
        'troppi_blocchi',
        `Il documento contiene ${blocks.length} blocchi: il massimo consentito è ${LIMITS.maxBlocksPerDocument}.`,
        'errore',
      ),
    );
  }

  if (options.subject !== undefined) {
    const subject = options.subject.trim();
    if (!subject) {
      warnings.push(makeWarning('oggetto_vuoto', "L'oggetto dell'email è vuoto.", 'errore'));
    } else if (subject.length > LIMITS.maxSubjectLength) {
      warnings.push(
        makeWarning(
          'oggetto_troppo_lungo',
          `L'oggetto supera i ${LIMITS.maxSubjectLength} caratteri e verrà troncato dai client.`,
          'avviso',
        ),
      );
    }
  }

  if (options.preheader && options.preheader.length > LIMITS.maxPreheaderLength) {
    warnings.push(
      makeWarning(
        'preheader_troppo_lungo',
        `Il preheader supera i ${LIMITS.maxPreheaderLength} caratteri: la parte finale non sarà visibile in anteprima.`,
        'avviso',
      ),
    );
  }

  // --- Disiscrizione --------------------------------------------------------
  const hasUnsubscribeBlock = blocks.some(({ block }) => (block.content?.type ?? block.type) === 'unsubscribe');
  const hasUnsubscribeTag = /\{\{\s*system\.unsubscribeUrl\s*\}\}/.test(collectTextualContent(document));
  if (!hasUnsubscribeBlock && !hasUnsubscribeTag) {
    warnings.push(
      makeWarning(
        'manca_disiscrizione',
        "Manca il blocco di disiscrizione: è obbligatorio per legge e senza di esso l'invio è bloccato.",
        'errore',
      ),
    );
  }

  // --- Immagini e link ------------------------------------------------------
  for (const { block, sectionId } of blocks) {
    const content = block.content as BlockContent | undefined;
    if (!content) continue;

    if (content.type === 'image') {
      if (!String(content.alt ?? '').trim()) {
        warnings.push(
          makeWarning(
            'immagine_senza_alt',
            "Un'immagine non ha testo alternativo: chi blocca le immagini non vedrà nulla.",
            'avviso',
            { blockId: block.id, sectionId },
          ),
        );
      }
      if (!content.src || !safeUrl(content.src)) {
        warnings.push(
          makeWarning('immagine_non_valida', "L'indirizzo di un'immagine non è valido.", 'avviso', {
            blockId: block.id,
            sectionId,
          }),
        );
      }
      if (content.href && !safeUrl(content.href)) {
        warnings.push(
          makeWarning('link_non_valido', "Il link di un'immagine non è valido.", 'avviso', {
            blockId: block.id,
            sectionId,
          }),
        );
      }
    }

    if (content.type === 'button') {
      const label = String(content.label ?? '').trim();
      if (!label) {
        warnings.push(
          makeWarning('pulsante_senza_testo', 'Un pulsante non ha etichetta.', 'avviso', { blockId: block.id, sectionId }),
        );
      }
      if (!safeUrl(content.href)) {
        warnings.push(
          makeWarning('link_non_valido', `Il pulsante "${label || 'senza etichetta'}" non ha un indirizzo valido.`, 'errore', {
            blockId: block.id,
            sectionId,
          }),
        );
      }
    }

    if (content.type === 'menu') {
      for (const item of content.items ?? []) {
        if (!safeUrl(item.href)) {
          warnings.push(
            makeWarning('link_non_valido', `La voce di menu "${item.label}" non ha un indirizzo valido.`, 'avviso', {
              blockId: block.id,
              sectionId,
            }),
          );
        }
      }
    }

    if (content.type === 'product' && content.url && !safeUrl(content.url)) {
      warnings.push(
        makeWarning('link_non_valido', `Il prodotto "${content.name}" ha un indirizzo non valido.`, 'avviso', {
          blockId: block.id,
          sectionId,
        }),
      );
    }

    if (content.type === 'coupon' && content.ctaHref && !safeUrl(content.ctaHref)) {
      warnings.push(
        makeWarning('link_non_valido', 'Il pulsante del coupon ha un indirizzo non valido.', 'errore', {
          blockId: block.id,
          sectionId,
        }),
      );
    }

    if (content.type === 'video' && (!safeUrl(content.url) || !content.thumbnailUrl)) {
      warnings.push(
        makeWarning('video_incompleto', 'Un blocco video non ha URL o miniatura validi.', 'avviso', {
          blockId: block.id,
          sectionId,
        }),
      );
    }
  }

  if (options.html) {
    warnings.push(...checkHtmlSize(options.html));
  }

  return warnings;
}

/** Controllo sul peso del messaggio (clipping di Gmail). */
export function checkHtmlSize(html: string): RenderWarning[] {
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes <= GMAIL_CLIP_BYTES) return [];
  return [
    makeWarning(
      'html_troppo_pesante',
      `L'email pesa ${Math.round(bytes / 1024)} KB: oltre i ${Math.round(GMAIL_CLIP_BYTES / 1024)} KB Gmail la tronca e nasconde il link di disiscrizione.`,
      'avviso',
    ),
  ];
}

// ---------------------------------------------------------------------------
// buildEmail
// ---------------------------------------------------------------------------

export interface BuildEmailContext extends MergeContextInput {
  subject?: string;
  preheader?: string;
  /** Contesto già costruito; se assente viene ricavato da contact/order/coupon. */
  merge?: MergeContext;
  /** Valori per le regole di visibilità; se assenti derivano dal contesto merge. */
  fields?: FieldValues;
  /** Sovrascritture degli stili globali del documento. */
  globalStyles?: Partial<EmailGlobalStyles> | null;
  isPreview?: boolean;
  /**
   * Percorsi di merge tag da lasciare intatti nell'HTML (es. `['coupon.code']`
   * quando il codice viene generato per destinatario dopo il render).
   */
  deferTags?: string[];
}

export interface BuildEmailTracking extends Partial<TrackingLinkOptions> {
  /** Riscrive i link nel redirector (richiede ref, contactId, secret, appUrl). */
  clickTracking?: boolean;
  /** Inserisce il pixel di apertura. */
  openTracking?: boolean;
  utm?: UtmParams | null;
  /** URL da lasciare intatti. */
  skip?: RegExp[];
  trackAppUrls?: boolean;
}

export interface BuildEmailInput {
  document: EmailDocument;
  context?: BuildEmailContext;
  tracking?: BuildEmailTracking | null;
  branding?: Partial<RenderBranding> | null;
}

export interface BuildEmailResult {
  html: string;
  text: string;
  warnings: RenderWarning[];
  /** URL di destinazione presenti nell'email, deduplicati. */
  links: string[];
  /** true se almeno un avviso è bloccante. */
  blocking: boolean;
}

function trackingOptions(tracking?: BuildEmailTracking | null): TrackingLinkOptions | null {
  if (!tracking) return null;
  const { ref, contactId, secret, appUrl } = tracking;
  if (!ref || !contactId || !secret || !appUrl) return null;
  return { ref, contactId, secret, appUrl };
}

/**
 * Costruisce l'email pronta per l'invio.
 *
 * Gli avvisi raccolti dalla validazione e dai renderer sono restituiti insieme
 * all'HTML: sta al chiamante decidere se fermarsi (`blocking === true`) o
 * inviare comunque.
 */
export function buildEmail(input: BuildEmailInput): BuildEmailResult {
  const { document } = input;
  const context = input.context ?? {};
  const branding = input.branding ?? context.branding ?? null;
  const subject = context.subject ?? '';
  const preheader = context.preheader ?? '';

  const merge =
    context.merge ??
    buildMergeContext({
      contact: context.contact,
      order: context.order,
      coupon: context.coupon,
      branding,
      urls: context.urls,
      now: context.now,
      locale: context.locale,
      timezone: context.timezone,
      currency: context.currency,
    });

  const warnings: RenderWarning[] = validateDocument(document, { subject, preheader });

  const unknownTags = listUnknownTags(collectTextualContent(document));
  if (unknownTags.length) {
    warnings.push(
      makeWarning(
        'merge_tag_sconosciuto',
        `Questi segnaposto non sono riconosciuti e resteranno vuoti: ${unknownTags.join(', ')}.`,
        'avviso',
      ),
    );
  }

  // 1. Render dell'albero. `warnings` è condiviso: i renderer vi accodano i
  //    problemi che emergono solo durante la generazione del markup.
  const rendered = renderEmailDocument(document, {
    globalStyles: context.globalStyles ?? undefined,
    branding,
    urls: context.urls,
    now: context.now,
    locale: context.locale,
    timezone: context.timezone,
    currency: context.currency,
    subject,
    preheader,
    isPreview: context.isPreview ?? false,
    fields: context.fields ?? mergeContextToFields(merge),
    warnings,
  });

  // 2. Merge tag. Quelli rinviati restano nell'HTML: li risolverà chi invia,
  //    destinatario per destinatario.
  const deferred = deferredTokens(merge, context.deferTags ?? []);
  let html = resolveMergeTags(rendered.html, merge, { defer: context.deferTags });

  // 3. UTM + redirector.
  const tracking = input.tracking ?? null;
  const trackingLink = tracking?.clickTracking === false ? null : trackingOptions(tracking);
  const rewritten = rewriteLinks(html, {
    utm: tracking?.utm ?? null,
    tracking: trackingLink,
    skip: tracking?.skip,
    trackAppUrls: tracking?.trackAppUrls,
  });
  html = rewritten.html;

  // 4. Pixel di apertura.
  const openOptions = trackingOptions(tracking);
  if (tracking?.openTracking && openOptions) {
    html = injectOpenPixel(html, openOptions);
  } else if (tracking?.openTracking && !openOptions) {
    warnings.push(
      makeWarning(
        'pixel_non_inserito',
        'Il tracciamento delle aperture è attivo ma mancano i dati di firma: il pixel non è stato inserito.',
        'avviso',
      ),
    );
  }

  // 5. Inlining del CSS e versione testuale.
  html = inlineCss(html);
  const text = htmlToPlainText(html);

  // 6. Controlli finali sull'HTML prodotto.
  warnings.push(...checkHtmlSize(html));
  const residual = listMergeTags(html).filter((token) => !deferred.has(token));
  if (residual.length) {
    warnings.push(
      makeWarning(
        'merge_tag_residuo',
        `L'HTML contiene ancora segnaposto non risolti: ${residual.join(', ')}.`,
        'avviso',
      ),
    );
  }
  if (!stripTags(text)) {
    warnings.push(makeWarning('contenuto_vuoto', 'Il messaggio non contiene testo leggibile.', 'errore'));
  }

  return {
    html,
    text,
    warnings,
    links: rewritten.links,
    blocking: hasBlockingIssues(warnings),
  };
}
