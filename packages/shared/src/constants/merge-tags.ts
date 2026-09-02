import type { MergeTag } from '../types/email';

/**
 * Merge tag disponibili nell'editor. La risoluzione avviene lato Functions
 * (`resolveMergeTags`) prima dell'invio; l'anteprima usa i `fallback`.
 */
export const MERGE_TAGS: MergeTag[] = [
  // Contatto
  { token: '{{contact.firstName}}', label: 'Nome', group: 'contatto', fallback: 'Cliente' },
  { token: '{{contact.lastName}}', label: 'Cognome', group: 'contatto', fallback: '' },
  { token: '{{contact.fullName}}', label: 'Nome e cognome', group: 'contatto', fallback: 'Cliente AlphaInk' },
  { token: '{{contact.email}}', label: 'Email', group: 'contatto', fallback: 'cliente@esempio.it' },
  { token: '{{contact.company}}', label: 'Azienda', group: 'contatto', fallback: '' },
  { token: '{{contact.city}}', label: 'Città', group: 'contatto', fallback: '' },
  { token: '{{contact.ordersCount}}', label: 'Numero ordini', group: 'contatto', fallback: '0' },
  { token: '{{contact.totalSpent}}', label: 'Totale speso', group: 'contatto', fallback: '0,00 €' },
  { token: '{{contact.lastOrderDate}}', label: 'Data ultimo ordine', group: 'contatto', fallback: '' },
  { token: '{{contact.printerBrand}}', label: 'Marca stampante', group: 'contatto', fallback: 'la tua stampante' },
  { token: '{{contact.printerModel}}', label: 'Modello stampante', group: 'contatto', fallback: '' },

  // Ordine (automazioni)
  { token: '{{order.number}}', label: 'Numero ordine', group: 'ordine', fallback: '#00000' },
  { token: '{{order.total}}', label: 'Totale ordine', group: 'ordine', fallback: '0,00 €' },
  { token: '{{order.date}}', label: 'Data ordine', group: 'ordine', fallback: '' },
  { token: '{{order.itemsList}}', label: 'Elenco prodotti', group: 'ordine', fallback: '' },
  { token: '{{order.recoveryUrl}}', label: 'Link ripristino carrello', group: 'ordine', fallback: '#' },
  { token: '{{order.firstProductName}}', label: 'Primo prodotto', group: 'ordine', fallback: '' },

  // Coupon
  { token: '{{coupon.code}}', label: 'Codice coupon', group: 'coupon', fallback: 'ALPHA10' },
  { token: '{{coupon.discount}}', label: 'Sconto', group: 'coupon', fallback: '10%' },
  { token: '{{coupon.expiresAt}}', label: 'Scadenza coupon', group: 'coupon', fallback: '' },
  { token: '{{coupon.url}}', label: 'Link con coupon applicato', group: 'coupon', fallback: '#' },

  // Azienda
  { token: '{{company.name}}', label: 'Nome azienda', group: 'azienda', fallback: 'AlphaInk' },
  { token: '{{company.address}}', label: 'Indirizzo', group: 'azienda', fallback: '' },
  { token: '{{company.website}}', label: 'Sito web', group: 'azienda', fallback: 'https://alphaink.net' },
  { token: '{{company.supportEmail}}', label: 'Email assistenza', group: 'azienda', fallback: 'info@alphaink.net' },

  // Sistema
  { token: '{{system.unsubscribeUrl}}', label: 'Link disiscrizione', group: 'sistema', fallback: '#' },
  { token: '{{system.preferencesUrl}}', label: 'Link preferenze', group: 'sistema', fallback: '#' },
  { token: '{{system.webviewUrl}}', label: 'Vedi nel browser', group: 'sistema', fallback: '#' },
  { token: '{{system.currentYear}}', label: 'Anno corrente', group: 'sistema', fallback: '2026' },
];

export const MERGE_TAG_TOKENS: string[] = MERGE_TAGS.map((t) => t.token);

/** Espressione che riconosce un merge tag nell'HTML. */
export const MERGE_TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
