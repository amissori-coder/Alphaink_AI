/**
 * Trigger sulla collezione `newsletters`.
 *
 * Ogni volta che l'editor salva un documento, questa funzione ricostruisce i
 * campi derivati:
 *  - `html` e `plainText` (render "master", con i token `{{system.*}}` intatti);
 *  - `warnings`, gli avvisi di validazione che la UI mostra accanto al pulsante
 *    di invio;
 *  - `audience.estimatedRecipients`, ricalcolato solo quando cambiano davvero i
 *    criteri di pubblico (la stima è una scansione, non un contatore).
 *
 * ## Come si evita il ciclo infinito
 * Il trigger scrive sullo stesso documento che lo ha attivato. Per non
 * rilanciarsi all'infinito confronta due impronte salvate sul documento:
 *  - `contentHash`  → oggetto, preheader, documento e varianti;
 *  - `audienceHash` → criteri di pubblico.
 * Se entrambe coincidono con quelle già registrate non viene scritto nulla e
 * la catena si ferma alla seconda invocazione.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Newsletter, NewsletterStatus } from '@alphaink/shared';

import { LIGHT_RUNTIME, LINK_SIGNING_KEY, REGION } from '../lib/config';
import { nowIso, serializeDoc, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { estimateAudienceSize } from '../clusters';
import { loadNewsletterEnvironment, renderNewsletterMaster } from './compose';
import { audienceSignature, contentSignature } from './repository';

const log = createLogger('newsletters.triggers');

/**
 * Stati in cui il contenuto è congelato: durante la spedizione l'HTML non va
 * più toccato, altrimenti i destinatari del secondo batch riceverebbero
 * un'email diversa da quelli del primo.
 */
const FROZEN_STATUSES: NewsletterStatus[] = ['queued', 'sending', 'sent'];

export const onNewsletterWritten = onDocumentWritten(
  {
    ...LIGHT_RUNTIME,
    region: REGION,
    // Il render inlinea il CSS e produce l'HTML completo: 256 MB stanno stretti.
    memory: '512MiB',
    timeoutSeconds: 120,
    document: 'newsletters/{newsletterId}',
    // L'HTML prodotto qui è quello servito da `webviewPage`: senza la chiave di
    // firma i link tracciati verrebbero salvati senza firma e `trackClick` li
    // rifiuterebbe.
    secrets: [LINK_SIGNING_KEY],
  },
  async (event) => {
    const newsletterId = event.params.newsletterId;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) {
      // La cancellazione a cascata è gestita dalla callable `deleteNewsletter`.
      return;
    }

    const raw = serializeDoc<Record<string, unknown>>(afterSnapshot.data() ?? {});
    const newsletter = withId<Newsletter>(afterSnapshot);

    if (FROZEN_STATUSES.includes(newsletter.status)) {
      log.debug('Contenuto congelato: nessuna rigenerazione', {
        newsletterId,
        status: newsletter.status,
      });
      return;
    }

    const storedContentHash = typeof raw.contentHash === 'string' ? raw.contentHash : null;
    const storedAudienceHash = typeof raw.audienceHash === 'string' ? raw.audienceHash : null;

    const contentHash = contentSignature(newsletter);
    const audienceHash = audienceSignature(newsletter.audience);

    const needsRender = contentHash !== storedContentHash || !newsletter.html;
    const needsEstimate = audienceHash !== storedAudienceHash;

    if (!needsRender && !needsEstimate) return;

    const patch: Record<string, unknown> = {};

    // --- Render ---------------------------------------------------------------
    if (needsRender) {
      try {
        const env = await loadNewsletterEnvironment();
        const rendered = renderNewsletterMaster(newsletter, env);
        patch.html = rendered.html;
        patch.plainText = rendered.text;
        patch.warnings = rendered.warnings;
        patch.blocking = rendered.blocking;
        patch.contentHash = contentHash;
        patch.renderedAt = nowIso();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Errore di rendering';
        log.error('Rigenerazione dell\'HTML non riuscita', error, { newsletterId });
        // L'impronta viene comunque salvata: senza, ogni scrittura successiva
        // ritenterebbe lo stesso render fallito all'infinito.
        patch.contentHash = contentHash;
        patch.renderedAt = nowIso();
        patch.warnings = [
          {
            code: 'render_fallito',
            message: `Non è stato possibile generare l'anteprima: ${message}`,
            severity: 'errore',
          },
        ];
        patch.blocking = true;
      }
    }

    // --- Stima del pubblico ---------------------------------------------------
    if (needsEstimate) {
      patch.audienceHash = audienceHash;
      try {
        const estimate = await estimateAudienceSize(newsletter.audience);
        patch['audience.estimatedRecipients'] = estimate.recipients;
        patch['audience.estimatedAt'] = nowIso();
      } catch (error) {
        // Una stima mancata non deve impedire il salvataggio: resta il valore
        // precedente e l'operatore può ricalcolarla dalla UI.
        log.error('Stima del pubblico non riuscita', error, { newsletterId });
      }
    }

    if (!Object.keys(patch).length) return;

    // `update`: `audience.estimatedRecipients` è un percorso di campo e solo
    // `update` lo interpreta come tale.
    await afterSnapshot.ref.update(patch);
    log.info('Campi derivati della newsletter aggiornati', {
      newsletterId,
      rendered: needsRender,
      estimated: needsEstimate,
    });
  },
);
