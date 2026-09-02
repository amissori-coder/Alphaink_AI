/** Nomi delle collezioni Firestore: unica fonte di verità per web app e Functions. */
export const COLLECTIONS = {
  users: 'users',
  contacts: 'contacts',
  clusters: 'clusters',
  newsletters: 'newsletters',
  /** Sotto-collezione di `newsletters`. */
  recipients: 'recipients',
  templates: 'templates',
  automations: 'automations',
  /** Sotto-collezione di `automations`. */
  automationRuns: 'runs',
  orders: 'orders',
  abandonedCarts: 'abandonedCarts',
  coupons: 'coupons',
  events: 'events',
  attributionTouches: 'attributionTouches',
  syncJobs: 'syncJobs',
  mediaAssets: 'mediaAssets',
  settings: 'settings',
  /** Coda di invio: un documento per batch di destinatari. */
  sendQueue: 'sendQueue',
  /** Log applicativo consultabile dalla UI. */
  activityLog: 'activityLog',
  /** Snapshot giornalieri per i grafici storici. */
  metricsDaily: 'metricsDaily',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Cartelle di Firebase Storage. */
export const STORAGE_PATHS = {
  media: 'media',
  thumbnails: 'thumbnails',
  imports: 'imports',
  exports: 'exports',
} as const;
