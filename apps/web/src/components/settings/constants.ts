/**
 * Etichette, opzioni e testi di aiuto dell'area Impostazioni.
 * Tutto ciò che l'operatore legge a schermo vive qui: le viste restano pulite
 * e le stringhe sono modificabili in un solo punto.
 */

import {
  ATTRIBUTION_MODEL_LABELS,
  PRODUCT_FAMILY_LABELS,
  ROLE_PERMISSIONS,
  type AttributionModel,
  type OrderStatus,
  type Permission,
  type ProductFamily,
  type SocialNetwork,
  type SyncEntity,
  type UserRole,
} from '@alphaink/shared';
import {
  Building2,
  Crosshair,
  Palette,
  Send,
  ServerCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { SettingsTab } from './types';

// -----------------------------------------------------------------------------
// Navigazione della pagina
// -----------------------------------------------------------------------------

export interface SettingsTabDefinition {
  id: SettingsTab;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Permesso minimo per aprire la sezione. */
  permission: Permission;
}

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  {
    id: 'brevo',
    label: 'Brevo',
    description: 'Chiave API, mittenti verificati, webhook e limiti di invio.',
    icon: Send,
    permission: 'settings:read',
  },
  {
    id: 'sito',
    label: 'Sito AlphaInk',
    description: 'I due negozi PrestaShop, la sincronizzazione e le famiglie prodotto.',
    icon: Building2,
    permission: 'settings:read',
  },
  {
    id: 'tracciamento',
    label: 'Tracciamento',
    description: 'Modello di attribuzione, finestre, UTM e click tracciati.',
    icon: Crosshair,
    permission: 'settings:read',
  },
  {
    id: 'brand',
    label: 'Brand',
    description: 'Dati aziendali, logo, palette, font e footer legale.',
    icon: Palette,
    permission: 'settings:read',
  },
  {
    id: 'utenti',
    label: 'Utenti e permessi',
    description: 'Ruoli, accessi e matrice dei permessi.',
    icon: Users,
    permission: 'settings:read',
  },
  {
    id: 'sistema',
    label: 'Sistema',
    description: 'Dati predefiniti, ambiente e documentazione.',
    icon: ServerCog,
    permission: 'settings:read',
  },
];

export const SETTINGS_TAB_IDS: SettingsTab[] = SETTINGS_TABS.map((tab) => tab.id);

/** True se la stringa corrisponde a una sezione esistente. */
export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return Boolean(value) && SETTINGS_TAB_IDS.includes(value as SettingsTab);
}

// -----------------------------------------------------------------------------
// Brevo
// -----------------------------------------------------------------------------

/** Istruzioni per recuperare la chiave API dal pannello Brevo. */
export const BREVO_API_KEY_STEPS: string[] = [
  'Accedi a app.brevo.com con l’account AlphaInk.',
  'Apri il menu con il nome dell’account in alto a destra e scegli «SMTP e API».',
  'Vai alla scheda «Chiavi API» e premi «Genera una nuova chiave API».',
  'Assegna un nome riconoscibile, ad esempio «AlphaInk Newsletter Suite».',
  'Copia la chiave (inizia con xkeysib-) e incollala qui sotto: Brevo non la mostrerà più.',
];

/** Eventi che il webhook deve coprire, mostrati come promemoria. */
export const BREVO_WEBHOOK_EVENTS: string[] = [
  'delivered',
  'opened',
  'click',
  'soft_bounce',
  'hard_bounce',
  'blocked',
  'spam',
  'invalid_email',
  'deferred',
  'unsubscribed',
];

export const BREVO_WEBHOOK_TYPE_LABELS: Record<'transactional' | 'marketing', string> = {
  transactional: 'Transazionale (invii singoli e automazioni)',
  marketing: 'Marketing (campagne Brevo)',
};

// -----------------------------------------------------------------------------
// Sito e sincronizzazione
// -----------------------------------------------------------------------------

export const SYNC_ENTITY_LABELS: Record<SyncEntity, string> = {
  customers: 'Clienti',
  orders: 'Ordini',
  carts: 'Carrelli',
  products: 'Prodotti',
  categories: 'Categorie',
  coupons: 'Buoni sconto',
  customer_groups: 'Gruppi cliente',
};

export const SYNC_ENTITY_HINTS: Record<SyncEntity, string> = {
  customers: 'Anagrafiche, consensi newsletter e gruppo commerciale.',
  orders: 'Ordini con righe, totali e stato: base del fatturato attribuito.',
  carts: 'Carrelli non convertiti, usati dall’automazione «Carrello abbandonato».',
  products: 'Catalogo usato per i blocchi prodotto e la classificazione in famiglie.',
  categories: 'Albero categorie: serve alle regole di famiglia basate sul percorso.',
  coupons: 'Stato dei buoni emessi dalle automazioni (usati / scaduti).',
  customer_groups: 'Gruppi PrestaShop da mappare sui segmenti B2C e B2B.',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'In attesa',
  processing: 'In lavorazione',
  awaiting_payment: 'In attesa di pagamento',
  paid: 'Pagato',
  shipped: 'Spedito',
  completed: 'Completato',
  cancelled: 'Annullato',
  refunded: 'Rimborsato',
  failed: 'Fallito',
};

export const ORDER_STATUS_VALUES: OrderStatus[] = [
  'pending',
  'processing',
  'awaiting_payment',
  'paid',
  'shipped',
  'completed',
  'cancelled',
  'refunded',
  'failed',
];

/** Stati PrestaShop di fabbrica, per aiutare a riconoscere gli id nella mappa. */
export const PRESTASHOP_STATE_HINTS: Record<string, string> = {
  '1': 'In attesa del pagamento con assegno',
  '2': 'Pagamento accettato',
  '3': 'Preparazione in corso',
  '4': 'Spedito',
  '5': 'Consegnato',
  '6': 'Annullato',
  '7': 'Rimborsato',
  '8': 'Errore di pagamento',
  '9': 'In attesa di rifornimento (pagato)',
  '10': 'In attesa di bonifico bancario',
  '11': 'Pagamento remoto accettato',
  '12': 'In attesa di rifornimento (non pagato)',
  '13': 'In attesa di validazione contrassegno',
};

/** Pianificazioni proposte, con la relativa espressione cron. */
export const CRON_PRESETS: Array<{ value: string; label: string; description: string }> = [
  { value: '0 * * * *', label: 'Ogni ora', description: 'Massima freschezza dei dati, carico costante sul sito.' },
  {
    value: '0 */6 * * *',
    label: 'Ogni 6 ore',
    description: 'Quattro passaggi al giorno: buon compromesso per AlphaInk.',
  },
  { value: '0 3 * * *', label: 'Ogni giorno alle 03:00', description: 'Una sola finestra notturna, carico minimo.' },
  {
    value: '0 3 * * 1',
    label: 'Ogni lunedì alle 03:00',
    description: 'Solo per cataloghi che cambiano di rado.',
  },
];

export const PRODUCT_FAMILY_OPTIONS: Array<{ value: ProductFamily; label: string }> = (
  Object.keys(PRODUCT_FAMILY_LABELS) as ProductFamily[]
).map((family) => ({ value: family, label: PRODUCT_FAMILY_LABELS[family] }));

// -----------------------------------------------------------------------------
// Tracciamento
// -----------------------------------------------------------------------------

export const ATTRIBUTION_MODEL_HELP: Record<AttributionModel, string> = {
  last_click:
    'L’ordine è attribuito all’ultima email su cui il cliente ha cliccato entro la finestra. È il modello consigliato: premia l’invio che ha davvero portato alla visita.',
  last_open:
    'Vale l’ultima email aperta, anche senza click. Utile quando molti clienti arrivano al sito digitando l’indirizzo, ma sovrastima le newsletter molto aperte.',
  first_click:
    'Vale il primo click della finestra: mette in evidenza le email che avviano il percorso d’acquisto invece di quelle che lo chiudono.',
  linear:
    'Il fatturato viene diviso in parti uguali fra tutte le email toccate nella finestra. Dà una lettura più equilibrata delle sequenze lunghe.',
  coupon:
    'Conta solo il codice sconto usato nell’ordine. È il più prudente: attribuisce esclusivamente ciò che è tracciabile con certezza.',
};

export const ATTRIBUTION_MODEL_OPTIONS: Array<{ value: AttributionModel; label: string }> = (
  Object.keys(ATTRIBUTION_MODEL_LABELS) as AttributionModel[]
).map((model) => ({ value: model, label: ATTRIBUTION_MODEL_LABELS[model] }));

// -----------------------------------------------------------------------------
// Brand
// -----------------------------------------------------------------------------

export const BRAND_PALETTE_FIELDS: Array<{
  key: 'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'muted' | 'success' | 'danger';
  label: string;
  hint: string;
}> = [
  { key: 'primary', label: 'Primario', hint: 'Pulsanti e link principali delle email.' },
  { key: 'secondary', label: 'Secondario', hint: 'Accento promozionale, badge sconto.' },
  { key: 'accent', label: 'Evidenza', hint: 'Etichette «novità» e riquadri in risalto.' },
  { key: 'background', label: 'Sfondo', hint: 'Area esterna al contenuto dell’email.' },
  { key: 'surface', label: 'Superficie', hint: 'Sfondo del corpo del messaggio.' },
  { key: 'text', label: 'Testo', hint: 'Colore dei paragrafi e dei titoli.' },
  { key: 'muted', label: 'Testo secondario', hint: 'Note, footer e didascalie.' },
  { key: 'success', label: 'Positivo', hint: 'Conferme, disponibilità, spedizioni.' },
  { key: 'danger', label: 'Attenzione', hint: 'Scadenze, esaurimenti, errori.' },
];

export const SOCIAL_NETWORK_OPTIONS: Array<{ value: SocialNetwork; label: string }> = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Sito web' },
];

/** Font sicuri nei client di posta: niente webfont esotici. */
export const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Inter', label: 'Inter (consigliato)' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Times New Roman', label: 'Times New Roman' },
];

// -----------------------------------------------------------------------------
// Utenti e permessi
// -----------------------------------------------------------------------------

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Proprietario',
  admin: 'Amministratore',
  editor: 'Redattore',
  analyst: 'Analista',
  viewer: 'Osservatore',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: 'Controllo completo, compresa la gestione degli utenti.',
  admin: 'Configura tutto e invia le newsletter, ma non cambia i ruoli.',
  editor: 'Crea contenuti, cluster e pianifica gli invii.',
  analyst: 'Consulta report ed esporta i contatti.',
  viewer: 'Sola lettura su contenuti e configurazione.',
};

export const ROLE_ORDER: UserRole[] = ['owner', 'admin', 'editor', 'analyst', 'viewer'];

export const ROLE_OPTIONS: Array<{ value: UserRole; label: string; description: string }> = ROLE_ORDER.map(
  (role) => ({ value: role, label: ROLE_LABELS[role], description: ROLE_DESCRIPTIONS[role] }),
);

export const PERMISSION_LABELS: Record<Permission, string> = {
  'newsletter:read': 'Vedere le newsletter',
  'newsletter:write': 'Creare e modificare newsletter',
  'newsletter:send': 'Inviare subito',
  'newsletter:schedule': 'Pianificare gli invii',
  'contacts:read': 'Vedere i contatti',
  'contacts:write': 'Modificare i contatti',
  'contacts:export': 'Esportare i contatti',
  'clusters:read': 'Vedere i cluster',
  'clusters:write': 'Creare e modificare cluster',
  'automations:read': 'Vedere le automazioni',
  'automations:write': 'Modificare le automazioni',
  'automations:toggle': 'Attivare o sospendere automazioni',
  'analytics:read': 'Consultare i report',
  'media:write': 'Caricare file nella libreria',
  'settings:read': 'Vedere le impostazioni',
  'settings:write': 'Modificare le impostazioni',
  'users:manage': 'Gestire utenti e ruoli',
  'sync:run': 'Avviare la sincronizzazione del sito',
};

/** Permessi raggruppati per area, nell'ordine della matrice. */
export const PERMISSION_GROUPS: Array<{ label: string; permissions: Permission[] }> = [
  {
    label: 'Newsletter',
    permissions: ['newsletter:read', 'newsletter:write', 'newsletter:schedule', 'newsletter:send'],
  },
  { label: 'Contatti e cluster', permissions: ['contacts:read', 'contacts:write', 'contacts:export', 'clusters:read', 'clusters:write'] },
  { label: 'Automazioni', permissions: ['automations:read', 'automations:write', 'automations:toggle'] },
  { label: 'Analisi e media', permissions: ['analytics:read', 'media:write'] },
  { label: 'Sistema', permissions: ['settings:read', 'settings:write', 'sync:run', 'users:manage'] },
];

/** True se il ruolo possiede il permesso (matrice statica, senza chiamate). */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// -----------------------------------------------------------------------------
// Sistema
// -----------------------------------------------------------------------------

export const DOC_LINKS: Array<{ label: string; href: string; description: string }> = [
  {
    label: 'Documentazione Brevo — API v3',
    href: 'https://developers.brevo.com/reference/getting-started-1',
    description: 'Riferimento delle API usate per invii, contatti e campagne.',
  },
  {
    label: 'Webhook transazionali Brevo',
    href: 'https://developers.brevo.com/docs/transactional-webhooks',
    description: 'Elenco degli eventi che alimentano consegne, aperture e click.',
  },
  {
    label: 'Webservice PrestaShop',
    href: 'https://devdocs.prestashop-project.org/8/webservice/',
    description: 'Come abilitare la chiave API sul negozio e quali risorse esporre.',
  },
  {
    label: 'Firebase Cloud Functions (2ª generazione)',
    href: 'https://firebase.google.com/docs/functions',
    description: 'Runtime, segreti e pianificazioni usati dalla suite.',
  },
];
