/**
 * Pagine pubbliche di disiscrizione e preferenze.
 *
 * =============================================================================
 * CONTRATTO DEI LINK
 * =============================================================================
 * Nell'email i merge tag `{{system.unsubscribeUrl}}` e
 * `{{system.preferencesUrl}}` vanno risolti con:
 *
 *   `${APP_URL}/u/${token}`   disiscrizione
 *   `${APP_URL}/p/${token}`   preferenze
 *
 * dove `token` è prodotto da `createUnsubscribeToken()` — un token firmato
 * HMAC (`LINK_SIGNING_KEY`) che contiene contatto, email e, quando noti,
 * newsletter/automazione di provenienza. Firmarlo impedisce a un terzo di
 * disiscrivere il cliente di qualcun altro cambiando un id nella URL.
 *
 * Il token è accettato anche come `?t=` o `?token=`, così le due pagine
 * funzionano sia dietro il proxy della web app (`/u/<token>`) sia chiamando
 * direttamente la Cloud Function.
 *
 * =============================================================================
 * COMPORTAMENTO
 * =============================================================================
 * GET  → mostra il modulo con l'indirizzo interessato.
 * POST → applica la scelta e mostra la conferma.
 *
 * È supportata anche la disiscrizione "un click" di RFC 8058: se il corpo
 * contiene `List-Unsubscribe=One-Click` la richiesta viene eseguita subito e la
 * risposta è una pagina minimale (nessuna interazione umana da attendere).
 *
 * La scrittura passa da un evento `unsubscribed` in `events`: così la
 * disiscrizione aggiorna il destinatario, le statistiche della newsletter e lo
 * stato del contatto con lo stesso codice usato dai webhook Brevo, senza
 * duplicare la logica. In più viene propagata a Brevo (blocklist).
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { NEWSLETTER_CATEGORY_LABELS, normalizeEmail } from '@alphaink/shared';
import type { BrandingSettings, Contact, IsoDate, NewsletterCategory } from '@alphaink/shared';

import { BREVO_API_KEY, LINK_SIGNING_KEY, WEBHOOK_RUNTIME } from '../lib/config';
import { col, logActivity, nowIso, withId } from '../lib/firestore';
import { clientIp, detectDevice, handlePreflight } from '../lib/http';
import { createLogger } from '../lib/logger';
import { createToken, readToken } from '../lib/signing';
import { escapeAttr, escapeHtml } from '../render/html-utils';
import { blocklistBrevoContact } from '../brevo/contacts';
import { readApiKeyFromSecret } from '../brevo/settings';
import { buildTrackingEvent, detectOs, saveTrackingEvent } from './events';
import { renderErrorPage, renderPublicPage, sendHtml } from './layout';
import { processEvent } from './processor';
import { publicAppUrl, readBrandingSettings, signingSecret } from './settings';

const log = createLogger('tracking.unsubscribe');

/** Percorsi pubblici che la web app deve inoltrare a queste funzioni. */
export const UNSUBSCRIBE_PATH = '/u';
export const PREFERENCES_PATH = '/p';

/** Validità di un token di disiscrizione: un anno, come le email archiviate. */
export const TOKEN_TTL_DAYS = 365;

// -----------------------------------------------------------------------------
// Token
// -----------------------------------------------------------------------------

export interface UnsubscribeTokenData {
  contactId: string | null;
  email: string;
  newsletterId: string | null;
  variantId: string | null;
  automationId: string | null;
  automationRunId: string | null;
}

/**
 * Crea il token da mettere nei link di disiscrizione e preferenze.
 * Le chiavi sono abbreviate per tenere corta la URL nell'email.
 */
export function createUnsubscribeToken(
  data: Partial<UnsubscribeTokenData> & { email: string },
  options: { secret?: string; ttlDays?: number } = {},
): string {
  const secret = options.secret ?? signingSecret();
  const ttlDays = options.ttlDays ?? TOKEN_TTL_DAYS;
  const payload: Record<string, string | number | boolean> = {
    e: normalizeEmail(data.email),
  };
  if (data.contactId) payload.c = data.contactId;
  if (data.newsletterId) payload.n = data.newsletterId;
  if (data.variantId) payload.v = data.variantId;
  if (data.automationId) payload.a = data.automationId;
  if (data.automationRunId) payload.r = data.automationRunId;

  return createToken(
    { data: payload, exp: Math.floor(Date.now() / 1000) + ttlDays * 86_400 },
    secret,
  );
}

/** Legge e valida un token. `null` se firma errata o scaduto. */
export function readUnsubscribeToken(token: string, secret?: string): UnsubscribeTokenData | null {
  const parsed = readToken(token, secret ?? signingSecret());
  if (!parsed) return null;
  const data = parsed.data ?? {};
  const value = (key: string, alias: string): string | null => {
    const raw = data[key] ?? data[alias];
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  };

  const email = normalizeEmail(String(data.e ?? data.email ?? ''));
  const contactId = value('c', 'contactId');
  if (!email && !contactId) return null;

  return {
    contactId,
    email,
    newsletterId: value('n', 'newsletterId'),
    variantId: value('v', 'variantId'),
    automationId: value('a', 'automationId'),
    automationRunId: value('r', 'automationRunId'),
  };
}

/** URL pubbliche da inserire nell'email. */
export function buildUnsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}${UNSUBSCRIBE_PATH}/${token}`;
}

export function buildPreferencesUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}${PREFERENCES_PATH}/${token}`;
}

// -----------------------------------------------------------------------------
// Preferenze del contatto
// -----------------------------------------------------------------------------

export type EmailFrequency = 'ogni_invio' | 'settimanale' | 'mensile';

export const FREQUENCY_LABELS: Record<EmailFrequency, string> = {
  ogni_invio: 'Tutte le comunicazioni',
  settimanale: 'Al massimo una email a settimana',
  mensile: 'Al massimo una email al mese',
};

export const FREQUENCY_HINTS: Record<EmailFrequency, string> = {
  ogni_invio: 'Ricevi offerte, novità e promemoria come li pubblichiamo.',
  settimanale: 'Raggruppiamo le comunicazioni e te ne inviamo al massimo una a settimana.',
  mensile: 'Solo il meglio del mese: una email, niente di più.',
};

/**
 * Preferenze salvate sul documento contatto (campo `emailPreferences`).
 * Non fa parte del tipo `Contact` condiviso perché è specifica di questa
 * pagina: i cluster la leggono come attributo libero.
 */
export interface ContactEmailPreferences {
  categories: NewsletterCategory[];
  frequency: EmailFrequency;
  updatedAt: IsoDate;
  source: string;
}

/** Categorie proposte nel modulo, escluse quelle non editoriali. */
const SELECTABLE_CATEGORIES: NewsletterCategory[] = [
  'promozione',
  'novita',
  'saldi',
  'informativa',
  'stagionale',
  'b2b',
];

const CATEGORY_HINTS: Partial<Record<NewsletterCategory, string>> = {
  promozione: 'Sconti e offerte a tempo su toner, cartucce e carta.',
  novita: 'Nuovi prodotti e nuove compatibilità con le stampanti.',
  saldi: 'Le occasioni dei periodi di saldo.',
  informativa: 'Guide, consigli d\'uso e comunicazioni di servizio.',
  stagionale: 'Iniziative legate al periodo dell\'anno.',
  b2b: 'Listini, condizioni e novità dedicate alle aziende.',
};

// -----------------------------------------------------------------------------
// Utility di richiesta
// -----------------------------------------------------------------------------

function bodyRecord(req: Request): Record<string, unknown> {
  const body = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  if (typeof body === 'string') {
    const record: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(body)) {
      const existing = record[key];
      if (existing === undefined) record[key] = value;
      else if (Array.isArray(existing)) (existing as string[]).push(value);
      else record[key] = [existing as string, value];
    }
    return record;
  }
  return {};
}

/** Il token può arrivare in query, nel corpo del modulo o in coda al percorso. */
function tokenFrom(req: Request): string | null {
  const fromQuery = req.query.t ?? req.query.token;
  const queryValue = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (typeof queryValue === 'string' && queryValue.trim()) return queryValue.trim();

  const body = bodyRecord(req);
  const fromBody = body.t ?? body.token;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  const segments = (req.path ?? '').split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  // Un token è sempre `payload.firma`: il punto lo distingue dal nome della route.
  if (last && last.includes('.')) return decodeURIComponent(last);
  return null;
}

function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function arrayField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/** Contatto puntato dal token: prima per id, poi per email. */
async function loadContact(data: UnsubscribeTokenData): Promise<Contact | null> {
  if (data.contactId) {
    const snapshot = await col.contacts().doc(data.contactId).get();
    if (snapshot.exists) return withId<Contact>(snapshot);
  }
  if (data.email) {
    const snapshot = await col.contacts().where('emailNormalized', '==', data.email).limit(1).get();
    if (!snapshot.empty) return withId<Contact>(snapshot.docs[0]!);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Azioni
// -----------------------------------------------------------------------------

/**
 * Registra la disiscrizione.
 *
 * L'aggiornamento passa da un evento `unsubscribed`, così destinatario,
 * statistiche e stato del contatto seguono lo stesso percorso dei webhook.
 */
async function applyUnsubscribe(
  data: UnsubscribeTokenData,
  contact: Contact | null,
  req: Request,
): Promise<void> {
  const email = contact?.email ? normalizeEmail(contact.email) : data.email;
  const userAgent = req.get('user-agent') ?? null;

  const event = buildTrackingEvent({
    type: 'unsubscribed',
    email,
    source: data.automationId ? 'automation' : 'newsletter',
    occurredAt: nowIso(),
    contactId: contact?.id ?? data.contactId,
    newsletterId: data.newsletterId,
    variantId: data.variantId,
    automationId: data.automationId,
    automationRunId: data.automationRunId,
    reason: 'Disiscrizione dalla pagina pubblica',
    ip: clientIp(req),
    userAgent,
    device: detectDevice(userAgent ?? undefined),
    os: detectOs(userAgent),
    raw: { via: 'unsubscribe_page', method: req.method },
  });

  const saved = await saveTrackingEvent(event);
  if (saved.stored) await processEvent(saved.event);

  // Il contatto potrebbe non esistere in rubrica (invio di prova, import
  // parziale): in quel caso l'evento resta come traccia e si esce.
  // Chi è già `blocked` o `bounced` non viene "promosso" a `unsubscribed`:
  // sarebbe uno stato meno restrittivo e perderebbe il motivo originale.
  if (contact && contact.status !== 'blocked' && contact.status !== 'bounced') {
    await col.contacts().doc(contact.id).set(
      {
        status: 'unsubscribed',
        statusReason: 'Disiscrizione dalla pagina pubblica',
        statusChangedAt: nowIso(),
        optOutAt: nowIso(),
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  }

  // Propagazione a Brevo: senza di essa il contatto continuerebbe a ricevere le
  // campagne inviate direttamente dalla piattaforma.
  const apiKey = readApiKeyFromSecret();
  if (apiKey && email) {
    try {
      await blocklistBrevoContact(apiKey, email, true);
    } catch (error) {
      log.error('Propagazione della disiscrizione a Brevo fallita', error, { email });
    }
  }

  await logActivity({
    action: 'contact.unsubscribed',
    entityType: 'contact',
    entityId: contact?.id ?? null,
    summary: `${email} si è disiscritto dalla pagina pubblica.`,
    metadata: { newsletterId: data.newsletterId, automationId: data.automationId },
  });
}

/** Riattiva l'iscrizione dopo un ripensamento. */
async function applyResubscribe(contact: Contact): Promise<boolean> {
  // Un contatto bloccato o rimbalzato non si riattiva da qui: rimetterlo in
  // lista danneggerebbe la reputazione del dominio.
  if (contact.status !== 'unsubscribed') return false;

  await col.contacts().doc(contact.id).set(
    {
      status: 'subscribed',
      statusReason: 'Riattivazione dalla pagina pubblica',
      statusChangedAt: nowIso(),
      optInAt: nowIso(),
      optOutAt: null,
      consentSource: 'pagina_disiscrizione',
      updatedAt: nowIso(),
    },
    { merge: true },
  );

  const apiKey = readApiKeyFromSecret();
  if (apiKey) {
    try {
      await blocklistBrevoContact(apiKey, normalizeEmail(contact.email), false);
    } catch (error) {
      log.error('Riattivazione su Brevo fallita', error, { contactId: contact.id });
    }
  }

  await logActivity({
    action: 'contact.resubscribed',
    entityType: 'contact',
    entityId: contact.id,
    summary: `${contact.email} ha riattivato l'iscrizione.`,
  });
  return true;
}

/** Salva le preferenze scelte nel modulo. */
async function applyPreferences(
  contact: Contact,
  categories: NewsletterCategory[],
  frequency: EmailFrequency,
): Promise<void> {
  const preferences: ContactEmailPreferences = {
    categories,
    frequency,
    updatedAt: nowIso(),
    source: 'pagina_preferenze',
  };

  await col.contacts().doc(contact.id).set(
    { emailPreferences: preferences, updatedAt: nowIso() },
    { merge: true },
  );

  await logActivity({
    action: 'contact.preferences_updated',
    entityType: 'contact',
    entityId: contact.id,
    summary: `${contact.email} ha aggiornato le preferenze email.`,
    metadata: { categories, frequency },
  });
}

// -----------------------------------------------------------------------------
// Frammenti HTML
// -----------------------------------------------------------------------------

function hiddenToken(token: string): string {
  return `<input type="hidden" name="t" value="${escapeAttr(token)}" />`;
}

function emailBadge(email: string): string {
  return `<p>Indirizzo interessato: <span class="email">${escapeHtml(email)}</span></p>`;
}

function confirmUnsubscribeBody(
  token: string,
  email: string,
  branding: BrandingSettings,
  preferencesLink: string,
): string {
  return (
    emailBadge(email) +
    `<p>${escapeHtml(branding.unsubscribeText || 'Non vuoi più ricevere le nostre email?')} ` +
    'Confermando non riceverai più newsletter, promozioni e promemoria di riacquisto.</p>' +
    '<form method="post">' +
    hiddenToken(token) +
    '<input type="hidden" name="action" value="unsubscribe" />' +
    '<div class="actions">' +
    '<button type="submit" class="btn-danger">Conferma disiscrizione</button>' +
    `<a class="btn btn-ghost" href="${escapeAttr(preferencesLink)}">Scegli cosa ricevere</a>` +
    '</div>' +
    '</form>' +
    '<p class="note">Preferisci ricevere meno email invece di disiscriverti? ' +
    'Con “Scegli cosa ricevere” puoi selezionare solo gli argomenti che ti interessano.</p>'
  );
}

function unsubscribedBody(token: string, email: string, canResubscribe: boolean): string {
  return (
    '<div class="notice notice-success">Disiscrizione registrata. Non riceverai più le nostre email.</div>' +
    emailBadge(email) +
    '<p>Ci dispiace vederti andare via. Se è stato un errore puoi riattivare l\'iscrizione qui sotto.</p>' +
    (canResubscribe
      ? '<form method="post">' +
        hiddenToken(token) +
        '<input type="hidden" name="action" value="resubscribe" />' +
        '<div class="actions"><button type="submit" class="btn-primary">Riattiva l\'iscrizione</button></div>' +
        '</form>'
      : '')
  );
}

function preferencesForm(
  token: string,
  contact: Contact,
  preferences: ContactEmailPreferences,
  unsubscribeLink: string,
): string {
  const options = SELECTABLE_CATEGORIES.map((category) => {
    const checked = preferences.categories.includes(category) ? ' checked' : '';
    const hint = CATEGORY_HINTS[category];
    return (
      '<li><label class="option">' +
      `<input type="checkbox" name="categories" value="${escapeAttr(category)}"${checked} />` +
      '<span class="option-text">' +
      `<span class="option-title">${escapeHtml(NEWSLETTER_CATEGORY_LABELS[category])}</span>` +
      (hint ? `<span class="option-hint">${escapeHtml(hint)}</span>` : '') +
      '</span></label></li>'
    );
  }).join('');

  const frequencies = (Object.keys(FREQUENCY_LABELS) as EmailFrequency[])
    .map((frequency) => {
      const checked = preferences.frequency === frequency ? ' checked' : '';
      return (
        '<li><label class="option">' +
        `<input type="radio" name="frequency" value="${escapeAttr(frequency)}"${checked} />` +
        '<span class="option-text">' +
        `<span class="option-title">${escapeHtml(FREQUENCY_LABELS[frequency])}</span>` +
        `<span class="option-hint">${escapeHtml(FREQUENCY_HINTS[frequency])}</span>` +
        '</span></label></li>'
      );
    })
    .join('');

  return (
    emailBadge(contact.email) +
    '<form method="post">' +
    hiddenToken(token) +
    '<input type="hidden" name="action" value="preferences" />' +
    '<h2>Cosa vuoi ricevere</h2>' +
    `<ul class="options">${options}</ul>` +
    '<h2>Ogni quanto</h2>' +
    `<ul class="options">${frequencies}</ul>` +
    '<div class="actions">' +
    '<button type="submit" class="btn-primary">Salva le preferenze</button>' +
    `<a class="btn btn-ghost" href="${escapeAttr(unsubscribeLink)}">Disiscriviti da tutto</a>` +
    '</div>' +
    '</form>'
  );
}

/** Preferenze correnti del contatto, con i valori predefiniti. */
function currentPreferences(contact: Contact | null): ContactEmailPreferences {
  const stored = (contact as unknown as { emailPreferences?: Partial<ContactEmailPreferences> } | null)
    ?.emailPreferences;
  const categories = Array.isArray(stored?.categories)
    ? (stored?.categories.filter((category) =>
        SELECTABLE_CATEGORIES.includes(category as NewsletterCategory),
      ) as NewsletterCategory[])
    : [...SELECTABLE_CATEGORIES];
  const frequency: EmailFrequency =
    stored?.frequency && stored.frequency in FREQUENCY_LABELS
      ? (stored.frequency as EmailFrequency)
      : 'ogni_invio';

  return { categories, frequency, updatedAt: stored?.updatedAt ?? nowIso(), source: stored?.source ?? '' };
}

/**
 * Link alla pagina "gemella" (preferenze ↔ disiscrizione).
 *
 * Si costruisce sempre da `APP_URL`, non dal percorso della richiesta: la
 * funzione può essere invocata sia dietro il proxy della web app (`/u/<token>`)
 * sia direttamente sul dominio `cloudfunctions.net`, dove il percorso non
 * permetterebbe di risalire all'altra pagina.
 */
function counterpartLink(path: string, token: string, req: Request): string {
  const configured = publicAppUrl();
  const base = configured || `${req.protocol}://${req.get('host') ?? ''}`;
  return `${base.replace(/\/+$/, '')}${path}/${encodeURIComponent(token)}`;
}

// -----------------------------------------------------------------------------
// unsubscribePage
// -----------------------------------------------------------------------------

export const unsubscribePage = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [LINK_SIGNING_KEY, BREVO_API_KEY] },
  async (req: Request, res: Response): Promise<void> => {
    if (handlePreflight(req, res)) return;
    const branding = await readBrandingSettings();

    const token = tokenFrom(req);
    const data = token ? readUnsubscribeToken(token) : null;
    if (!token || !data) {
      sendHtml(
        res,
        400,
        renderErrorPage(
          branding,
          'Link non valido',
          'Questo link di disiscrizione non è valido o è scaduto. Apri l\'ultima email ricevuta e riprova.',
        ),
      );
      return;
    }

    const contact = await loadContact(data);
    const email = contact?.email ?? data.email;
    const preferencesLink = counterpartLink(PREFERENCES_PATH, token, req);

    if (req.method === 'POST') {
      const body = bodyRecord(req);
      const oneClick = stringField(body, 'List-Unsubscribe') === 'One-Click';
      const action = oneClick ? 'unsubscribe' : (stringField(body, 'action') ?? 'unsubscribe');

      if (action === 'resubscribe' && contact) {
        const done = await applyResubscribe(contact);
        sendHtml(
          res,
          200,
          renderPublicPage({
            branding,
            title: `Iscrizione riattivata — ${branding.companyName}`,
            heading: done ? 'Bentornato!' : 'Non è stato possibile riattivare l\'iscrizione',
            accent: done ? 'success' : 'danger',
            bodyHtml: done
              ? '<div class="notice notice-success">Iscrizione riattivata: tornerai a ricevere le nostre email.</div>' +
                emailBadge(email)
              : '<p>Questo indirizzo non può essere riattivato automaticamente. ' +
                `Scrivici a <a href="mailto:${escapeAttr(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a> e ce ne occupiamo noi.</p>`,
          }),
        );
        return;
      }

      await applyUnsubscribe(data, contact, req);

      if (oneClick) {
        // RFC 8058: nessun umano sta guardando, basta un 200 asciutto.
        sendHtml(res, 200, '<!doctype html><html lang="it"><body>Disiscrizione registrata.</body></html>');
        return;
      }

      sendHtml(
        res,
        200,
        renderPublicPage({
          branding,
          title: `Disiscrizione completata — ${branding.companyName}`,
          heading: 'Disiscrizione completata',
          accent: 'success',
          bodyHtml: unsubscribedBody(token, email, true),
        }),
      );
      return;
    }

    if (contact && contact.status === 'unsubscribed') {
      sendHtml(
        res,
        200,
        renderPublicPage({
          branding,
          title: `Sei già disiscritto — ${branding.companyName}`,
          heading: 'Sei già disiscritto',
          bodyHtml: unsubscribedBody(token, email, true),
        }),
      );
      return;
    }

    sendHtml(
      res,
      200,
      renderPublicPage({
        branding,
        title: `Disiscrizione — ${branding.companyName}`,
        heading: 'Vuoi disiscriverti?',
        intro: 'Bastano pochi secondi. Puoi anche scegliere di ricevere solo ciò che ti interessa.',
        bodyHtml: confirmUnsubscribeBody(token, email, branding, preferencesLink),
      }),
    );
  },
);

// -----------------------------------------------------------------------------
// preferencesPage
// -----------------------------------------------------------------------------

export const preferencesPage = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [LINK_SIGNING_KEY, BREVO_API_KEY] },
  async (req: Request, res: Response): Promise<void> => {
    if (handlePreflight(req, res)) return;
    const branding = await readBrandingSettings();

    const token = tokenFrom(req);
    const data = token ? readUnsubscribeToken(token) : null;
    if (!token || !data) {
      sendHtml(
        res,
        400,
        renderErrorPage(
          branding,
          'Link non valido',
          'Questo link non è valido o è scaduto. Apri l\'ultima email ricevuta e riprova.',
        ),
      );
      return;
    }

    const contact = await loadContact(data);
    const unsubscribeLink = counterpartLink(UNSUBSCRIBE_PATH, token, req);

    if (!contact) {
      sendHtml(
        res,
        404,
        renderErrorPage(
          branding,
          'Indirizzo non trovato',
          `Non troviamo ${data.email} nella nostra rubrica: potrebbe essere già stato rimosso.`,
        ),
      );
      return;
    }

    if (req.method === 'POST') {
      const body = bodyRecord(req);
      const action = stringField(body, 'action') ?? 'preferences';

      if (action === 'unsubscribe') {
        await applyUnsubscribe(data, contact, req);
        sendHtml(
          res,
          200,
          renderPublicPage({
            branding,
            title: `Disiscrizione completata — ${branding.companyName}`,
            heading: 'Disiscrizione completata',
            accent: 'success',
            bodyHtml: unsubscribedBody(token, contact.email, true),
          }),
        );
        return;
      }

      const categories = arrayField(body, 'categories').filter((value): value is NewsletterCategory =>
        SELECTABLE_CATEGORIES.includes(value as NewsletterCategory),
      );
      const rawFrequency = stringField(body, 'frequency') ?? 'ogni_invio';
      const frequency: EmailFrequency =
        rawFrequency in FREQUENCY_LABELS ? (rawFrequency as EmailFrequency) : 'ogni_invio';

      // Nessuna categoria selezionata equivale a una disiscrizione: meglio
      // dirlo esplicitamente invece di lasciare un contatto "iscritto a nulla".
      if (categories.length === 0) {
        await applyUnsubscribe(data, contact, req);
        sendHtml(
          res,
          200,
          renderPublicPage({
            branding,
            title: `Disiscrizione completata — ${branding.companyName}`,
            heading: 'Disiscrizione completata',
            accent: 'success',
            intro: 'Non avendo selezionato alcun argomento, ti abbiamo rimosso da tutte le comunicazioni.',
            bodyHtml: unsubscribedBody(token, contact.email, true),
          }),
        );
        return;
      }

      await applyPreferences(contact, categories, frequency);
      const saved: ContactEmailPreferences = {
        categories,
        frequency,
        updatedAt: nowIso(),
        source: 'pagina_preferenze',
      };

      sendHtml(
        res,
        200,
        renderPublicPage({
          branding,
          title: `Preferenze salvate — ${branding.companyName}`,
          heading: 'Preferenze salvate',
          accent: 'success',
          bodyHtml:
            '<div class="notice notice-success">Da adesso riceverai solo ciò che hai scelto.</div>' +
            preferencesForm(token, contact, saved, unsubscribeLink),
        }),
      );
      return;
    }

    sendHtml(
      res,
      200,
      renderPublicPage({
        branding,
        title: `Preferenze email — ${branding.companyName}`,
        heading: 'Le tue preferenze',
        intro: 'Scegli gli argomenti che ti interessano e quante email vuoi ricevere.',
        bodyHtml: preferencesForm(token, contact, currentPreferences(contact), unsubscribeLink),
      }),
    );
  },
);
