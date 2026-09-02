/**
 * `GET /api/preview/[id]` — HTML di una newsletter per l'iframe di anteprima.
 *
 * Autenticazione: token di sessione Firebase nell'intestazione
 * `Authorization: Bearer <idToken>`; il ruolo minimo è `viewer`, come per la
 * lettura delle newsletter.
 *
 * Il documento viene letto con l'Admin SDK (`adminDb`). Se l'HTML compilato è
 * già presente lo si restituisce così com'è; altrimenti — o con `?refresh=1` —
 * si chiede la compilazione alla callable `renderNewsletterPreview`, che è
 * l'unico punto in cui vive il motore di rendering.
 *
 * Parametri accettati:
 *  - `variante`  id della variante A/B da mostrare;
 *  - `contatto`  id di un contatto di esempio per i tag di personalizzazione;
 *  - `refresh=1` forza la ricompilazione ignorando l'HTML salvato.
 *
 * Nota: i webhook di Brevo e del sito non passano da queste route ma dalle
 * Cloud Functions `brevoWebhook` e `siteWebhook`.
 */

import { COLLECTIONS } from '@alphaink/shared';

import { adminDb } from '@/lib/firebase/admin';

import {
  CallableProxyError,
  authenticate,
  callCallable,
  jsonError,
  resolveRole,
} from '../../_lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Intestazioni dell'anteprima: nessuna cache, nessuno script eseguibile. */
const HTML_HEADERS: HeadersInit = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  // L'HTML di un'email non contiene script: bloccarli protegge da contenuti
  // incollati nel blocco HTML personalizzato.
  'Content-Security-Policy':
    "default-src 'none'; img-src https: data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; frame-ancestors 'self'",
};

interface NewsletterPreviewResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

interface StoredNewsletter {
  html?: string | null;
  subject?: string | null;
  name?: string | null;
}

/** Pagina di cortesia mostrata quando non c'è ancora nulla da visualizzare. */
function placeholderHtml(message: string): string {
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Anteprima non disponibile</title>
  </head>
  <body style="margin:0;padding:40px;background:#F1F5F9;font-family:Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:28px;text-align:center;">
      <p style="margin:0 0 8px;font-size:16px;font-weight:600;">Anteprima non disponibile</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">${message}</p>
    </div>
  </body>
</html>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!id) return jsonError(400, 'invalid-argument', 'Identificativo della newsletter mancante.');

  const caller = await authenticate(request);
  if (!caller) {
    return jsonError(401, 'unauthenticated', 'Sessione non valida: effettua di nuovo l’accesso.');
  }
  if (!(await resolveRole(caller, 'viewer'))) {
    return jsonError(403, 'permission-denied', 'Non hai i permessi per vedere questa newsletter.');
  }

  const url = new URL(request.url);
  const variantId = url.searchParams.get('variante');
  const sampleContactId = url.searchParams.get('contatto');
  const refresh = url.searchParams.get('refresh') === '1';

  let stored: StoredNewsletter | null = null;
  try {
    const snapshot = await adminDb.collection(COLLECTIONS.newsletters).doc(id).get();
    if (!snapshot.exists) {
      return jsonError(404, 'not-found', 'Newsletter non trovata.');
    }
    stored = (snapshot.data() ?? {}) as StoredNewsletter;
  } catch (error) {
    return jsonError(
      500,
      'internal',
      `Lettura della newsletter non riuscita: ${(error as Error)?.message ?? 'errore imprevisto'}.`,
    );
  }

  // L'HTML salvato è aggiornato a ogni salvataggio: va bene per l'anteprima,
  // a meno che serva una variante, un contatto di esempio o un refresh esplicito.
  if (!refresh && !variantId && !sampleContactId && stored.html) {
    return new Response(stored.html, { status: 200, headers: HTML_HEADERS });
  }

  try {
    const preview = await callCallable<
      { newsletterId: string; variantId?: string; sampleContactId?: string },
      NewsletterPreviewResult
    >(
      'renderNewsletterPreview',
      {
        newsletterId: id,
        ...(variantId ? { variantId } : {}),
        ...(sampleContactId ? { sampleContactId } : {}),
      },
      caller.token,
      120_000,
    );

    if (!preview?.html) {
      return new Response(
        placeholderHtml('La newsletter non contiene ancora contenuti da mostrare.'),
        { status: 200, headers: HTML_HEADERS },
      );
    }

    return new Response(preview.html, { status: 200, headers: HTML_HEADERS });
  } catch (error) {
    if (stored.html) {
      // Meglio l'ultima versione compilata di una pagina d'errore.
      return new Response(stored.html, { status: 200, headers: HTML_HEADERS });
    }
    const proxyError =
      error instanceof CallableProxyError
        ? error
        : new CallableProxyError(500, 'internal', 'Compilazione dell’anteprima non riuscita.');

    if (proxyError.status === 401 || proxyError.status === 403) {
      return jsonError(proxyError.status, proxyError.code, proxyError.message);
    }
    return new Response(placeholderHtml(proxyError.message), {
      status: 200,
      headers: HTML_HEADERS,
    });
  }
}
