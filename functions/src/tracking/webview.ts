/**
 * "Vedi nel browser": mostra la newsletter come pagina web.
 *
 *   GET /w?n=<newsletterId>&c=<contactId>&s=<firma>[&v=<variantId>]
 *
 * La firma HMAC (`LINK_SIGNING_KEY`) sul payload `n|c` impedisce di sfogliare
 * le campagne altrui cambiando l'id nella URL: senza firma valida la pagina non
 * viene servita.
 *
 * L'HTML mostrato è quello **già compilato** al momento dell'invio
 * (`newsletter.html`). Se manca — per esempio su una bozza mai spedita — viene
 * ricostruito al volo dal documento dell'editor. In entrambi i casi i merge tag
 * vengono risolti con i dati del contatto che sta guardando, così la pagina
 * corrisponde all'email ricevuta.
 *
 * Il pixel di apertura viene rimosso: l'apertura è già stata conteggiata quando
 * l'email è stata letta, contarla di nuovo falserebbe l'open rate. I link
 * tracciati restano invece attivi, perché un click dalla webview è un click a
 * tutti gli effetti.
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import type { Contact, Newsletter } from '@alphaink/shared';

import { LINK_SIGNING_KEY, WEBHOOK_RUNTIME } from '../lib/config';
import { col, withId } from '../lib/firestore';
import { handlePreflight } from '../lib/http';
import { createLogger } from '../lib/logger';
import { sign, verifySignature } from '../lib/signing';
import { buildEmail } from '../render/pipeline';
import { buildMergeContext, resolveMergeTags } from '../render/merge-tags';
import type { MergeContactInput } from '../render/merge-tags';
import { renderErrorPage, sendHtml } from './layout';
import { readBrandingSettings, signingSecret } from './settings';

const log = createLogger('tracking.webview');

/** Percorso pubblico che la web app deve inoltrare a questa funzione. */
export const WEBVIEW_PATH = '/w';

/** Payload firmato della webview. */
export function webviewSignaturePayload(newsletterId: string, contactId: string): string {
  return `${newsletterId}|${contactId}`;
}

/** URL da usare per il merge tag `{{system.webviewUrl}}`. */
export function buildWebviewUrl(
  appUrl: string,
  newsletterId: string,
  contactId: string,
  options: { secret?: string; variantId?: string | null } = {},
): string {
  const secret = options.secret ?? signingSecret();
  const query = [
    `n=${encodeURIComponent(newsletterId)}`,
    `c=${encodeURIComponent(contactId)}`,
    `s=${sign(webviewSignaturePayload(newsletterId, contactId), secret)}`,
  ];
  if (options.variantId) query.push(`v=${encodeURIComponent(options.variantId)}`);
  return `${appUrl.replace(/\/+$/, '')}${WEBVIEW_PATH}?${query.join('&')}`;
}

function queryValue(req: Request, name: string): string | null {
  const value = req.query[name];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
  return null;
}

/** Rimuove il pixel di apertura dall'HTML servito nel browser. */
export function stripOpenPixel(html: string): string {
  return html.replace(/<img[^>]+src="[^"]*\/t\/o\?[^"]*"[^>]*>/gi, '');
}

/** Sottoinsieme del contatto usato dai merge tag. */
function mergeContactOf(contact: Contact | null): MergeContactInput | null {
  if (!contact) return null;
  return {
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    displayName: contact.displayName,
    company: contact.company,
    city: contact.city,
    stats: contact.stats,
    printers: contact.printers,
    customAttributes: contact.customAttributes,
  };
}

export const webviewPage = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [LINK_SIGNING_KEY] },
  async (req: Request, res: Response): Promise<void> => {
    if (handlePreflight(req, res)) return;

    const branding = await readBrandingSettings();
    const newsletterId = queryValue(req, 'n');
    const contactId = queryValue(req, 'c');
    const signature = queryValue(req, 's');
    const variantId = queryValue(req, 'v');
    const secret = signingSecret();

    const valid =
      Boolean(secret) &&
      Boolean(newsletterId) &&
      Boolean(contactId) &&
      Boolean(signature) &&
      verifySignature(webviewSignaturePayload(newsletterId!, contactId!), signature!, secret);

    if (!valid) {
      log.warn('Webview con firma non valida', { newsletterId, contactId });
      sendHtml(
        res,
        403,
        renderErrorPage(
          branding,
          'Pagina non disponibile',
          'Questo link non è valido o è scaduto. Apri il messaggio dalla tua casella di posta.',
        ),
      );
      return;
    }

    const snapshot = await col.newsletters().doc(newsletterId!).get();
    if (!snapshot.exists) {
      sendHtml(
        res,
        404,
        renderErrorPage(branding, 'Messaggio non trovato', 'Questa comunicazione non è più disponibile.'),
      );
      return;
    }

    const newsletter = withId<Newsletter>(snapshot);
    const contactSnap = await col.contacts().doc(contactId!).get();
    const contact = contactSnap.exists ? withId<Contact>(contactSnap) : null;
    const variant = variantId ? newsletter.variants?.find((item) => item.id === variantId) ?? null : null;

    let html = variant?.document ? null : (newsletter.html ?? null);

    if (!html) {
      // Nessun HTML compilato (bozza o variante senza render): si ricostruisce.
      const document = variant?.document ?? newsletter.document;
      if (!document) {
        sendHtml(
          res,
          404,
          renderErrorPage(branding, 'Messaggio non disponibile', 'Il contenuto di questa email non è più consultabile.'),
        );
        return;
      }
      const built = buildEmail({
        document,
        branding,
        context: {
          subject: variant?.subject ?? newsletter.subject,
          preheader: variant?.preheader ?? newsletter.preheader ?? '',
          contact: mergeContactOf(contact),
          branding,
        },
        // Nessun tracciamento: la pagina è già stata aperta.
        tracking: null,
      });
      html = built.html;
    } else {
      // L'HTML archiviato può contenere ancora i merge tag: si risolvono qui.
      html = resolveMergeTags(
        html,
        buildMergeContext({ contact: mergeContactOf(contact), branding }),
      );
    }

    sendHtml(res, 200, stripOpenPixel(html));
  },
);
