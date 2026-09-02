/**
 * Motore di rendering delle email AlphaInk.
 *
 * Punto di ingresso: `buildEmail`, che trasforma un `EmailDocument`
 * dell'editor in HTML table-based compatibile con Outlook, Gmail, Apple Mail e
 * i client mobile, più la versione testuale.
 *
 * ```ts
 * const { html, text, warnings, blocking } = buildEmail({
 *   document: newsletter.document,
 *   context: { subject, preheader, contact, urls },
 *   tracking: { clickTracking: true, openTracking: true, ref, contactId, secret, appUrl, utm },
 *   branding,
 * });
 * ```
 */
export * from './html-utils';
export * from './types';
export * from './blocks';
export * from './document';
export * from './merge-tags';
export * from './links';
export * from './text';
export * from './inline';
export * from './pipeline';
