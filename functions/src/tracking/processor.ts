/**
 * Elaborazione di un evento di tracciamento.
 *
 * Percorso completo di un evento:
 *
 *   1. **Correlazione** — si risale al destinatario dell'invio. In ordine:
 *      a) gli id già presenti nell'evento (li scriviamo noi in `X-Mailin-custom`
 *         al momento dell'invio ed è la via più affidabile);
 *      b) il `messageId` cercato nel collection group `recipients`;
 *      c) il `messageId` cercato nel collection group `runs` (automazioni);
 *      d) email + finestra temporale, come ultima spiaggia.
 *   2. **Destinatario** — stato, timestamp, contatori e URL cliccati.
 *   3. **Statistiche aggregate** — newsletter (ed eventuale variante A/B) oppure
 *      automazione e singolo step, con `FieldValue.increment` dentro una
 *      transazione: due eventi concorrenti non si sovrascrivono.
 *   4. **Contatto** — engagement, punteggio, fascia e, per gli eventi negativi,
 *      stato di iscrizione.
 *   5. **Attribuzione** — un `AttributionTouch` per ogni click e per la prima
 *      apertura, che il motore di attribuzione consumerà quando arriverà
 *      l'ordine.
 *
 * I punti 2-4 vivono in un'unica transazione: o l'evento aggiorna tutto o non
 * aggiorna nulla, e in caso di errore resta `processed: false` per essere
 * ripreso dalla riconciliazione oraria.
 */

import {
  EMPTY_ENGAGEMENT,
  EMPTY_STATS,
  computeEngagementScore,
  engagementTierFromScore,
  normalizeEmail,
  safeRate,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationRun,
  AutomationStepStats,
  BrevoEventType,
  Contact,
  ContactEngagement,
  Newsletter,
  NewsletterRecipient,
  NewsletterStats,
  RecipientStatus,
  SubscriptionStatus,
  TrackingEvent,
} from '@alphaink/shared';

import { FieldValue, col, db, nowIso, paginateQuery, serializeDoc, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { readTrackingSettings } from './settings';

const log = createLogger('tracking.processor');

/** Quanto indietro cercare un invio quando l'evento non porta il `messageId`. */
export const EMAIL_MATCH_WINDOW_DAYS = 30;

/** Documenti letti al massimo nelle ricerche di ripiego per email. */
const FALLBACK_SCAN_LIMIT = 25;

// -----------------------------------------------------------------------------
// Tipi interni
// -----------------------------------------------------------------------------

type StatsDelta = Partial<Record<keyof NewsletterStats, number>>;
type StepDelta = Partial<Record<keyof AutomationStepStats, number>>;
type EngagementDelta = Partial<Record<'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complaints', number>>;

export interface ResolvedTarget {
  kind: 'newsletter' | 'automation';
  /** Documento della newsletter o dell'automazione. */
  parentRef: FirebaseFirestore.DocumentReference;
  /** Documento del destinatario (`recipients`) o dell'esecuzione (`runs`). */
  entryRef: FirebaseFirestore.DocumentReference | null;
  newsletterId: string | null;
  automationId: string | null;
  variantId: string | null;
  contactId: string | null;
}

export interface ProcessEventResult {
  eventId: string;
  type: BrevoEventType;
  matched: 'newsletter' | 'automation' | 'none';
  newsletterId: string | null;
  automationId: string | null;
  contactId: string | null;
  /** Motivo per cui l'evento non ha prodotto aggiornamenti, se applicabile. */
  skipped: string | null;
}

/** Ordine di avanzamento degli stati "positivi" di un destinatario. */
const RECIPIENT_RANK: Record<RecipientStatus, number> = {
  pending: 0,
  failed: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  converted: 6,
  soft_bounced: 1,
  hard_bounced: 1,
  blocked: 1,
  unsubscribed: 1,
  spam: 1,
};

/** Stati terminali: si applicano anche "all'indietro", tranne su `converted`. */
const TERMINAL_STATUSES: RecipientStatus[] = [
  'soft_bounced',
  'hard_bounced',
  'blocked',
  'unsubscribed',
  'spam',
  'failed',
];

/** Gravità dello stato di iscrizione: non si torna mai indietro da solo. */
const SUBSCRIPTION_SEVERITY: Record<SubscriptionStatus, number> = {
  never_subscribed: 0,
  pending: 0,
  subscribed: 0,
  bounced: 1,
  unsubscribed: 2,
  blocked: 3,
};

// -----------------------------------------------------------------------------
// Statistiche derivate
// -----------------------------------------------------------------------------

/** Somma un delta a una fotografia di statistiche. */
export function mergeStats(current: NewsletterStats, delta: StatsDelta): NewsletterStats {
  const merged: NewsletterStats = { ...EMPTY_STATS, ...current };
  for (const [key, value] of Object.entries(delta) as Array<[keyof NewsletterStats, number]>) {
    if (typeof value !== 'number' || value === 0) continue;
    const previous = Number(merged[key] ?? 0);
    (merged as unknown as Record<string, unknown>)[key] = previous + value;
  }
  return merged;
}

/** Ricalcola i tassi a partire dai contatori assoluti. */
export function computeRates(stats: NewsletterStats): Pick<
  NewsletterStats,
  | 'deliveryRate'
  | 'openRate'
  | 'clickRate'
  | 'clickToOpenRate'
  | 'bounceRate'
  | 'unsubscribeRate'
  | 'conversionRate'
  | 'revenuePerRecipient'
> {
  const base = stats.requested || stats.recipients || 0;
  const delivered = stats.delivered || 0;
  return {
    deliveryRate: safeRate(delivered, base),
    openRate: safeRate(stats.uniqueOpened, delivered),
    clickRate: safeRate(stats.uniqueClicked, delivered),
    clickToOpenRate: safeRate(stats.uniqueClicked, stats.uniqueOpened),
    bounceRate: safeRate(stats.softBounces + stats.hardBounces + stats.blocked, base),
    unsubscribeRate: safeRate(stats.unsubscribed, delivered),
    conversionRate: safeRate(stats.orders, delivered),
    revenuePerRecipient: safeRate(stats.revenue, stats.recipients || delivered),
  };
}

/**
 * Patch di aggiornamento delle statistiche: contatori con `increment`
 * (atomici) e tassi ricalcolati sul valore risultante.
 *
 * ATTENZIONE: le chiavi usano la notazione puntata (`stats.opened`), che
 * Firestore interpreta come percorso annidato **solo in `update()`**. Con
 * `set()` verrebbe creato un campo chiamato letteralmente "stats.opened".
 * Chi usa questa patch deve quindi chiamare `update()` su un documento di cui
 * ha già verificato l'esistenza.
 */
export function statsPatch(current: NewsletterStats, delta: StatsDelta, prefix = 'stats'): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta) as Array<[string, number]>) {
    if (typeof value !== 'number' || value === 0) continue;
    patch[`${prefix}.${key}`] = FieldValue.increment(value);
  }
  if (Object.keys(patch).length === 0) return patch;

  const merged = mergeStats(current, delta);
  for (const [key, value] of Object.entries(computeRates(merged))) {
    patch[`${prefix}.${key}`] = value;
  }
  patch[`${prefix}.updatedAt`] = nowIso();
  return patch;
}

// -----------------------------------------------------------------------------
// Correlazione evento → invio
// -----------------------------------------------------------------------------

/** Recupera il destinatario di una newsletter per contatto o per email. */
export async function findRecipientInNewsletter(
  newsletterId: string,
  contactId: string | null,
  email: string,
): Promise<FirebaseFirestore.DocumentReference | null> {
  const recipients = col.recipients(newsletterId);

  if (contactId) {
    const direct = await recipients.doc(contactId).get();
    if (direct.exists) return direct.ref;
    const byField = await recipients.where('contactId', '==', contactId).limit(1).get();
    if (!byField.empty) return byField.docs[0]!.ref;
  }
  if (email) {
    const byEmail = await recipients.where('email', '==', email).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0]!.ref;
  }
  return null;
}

/**
 * Esegue una query tollerando l'assenza dell'indice.
 *
 * Le query sui collection group possono richiedere un indice a scope
 * `COLLECTION_GROUP` che potrebbe non essere ancora stato distribuito. In quel
 * caso Firestore risponde `FAILED_PRECONDITION`: meglio perdere una via di
 * correlazione secondaria (e dirlo nei log) che far fallire l'intero evento.
 */
async function safeQuery(
  query: FirebaseFirestore.Query,
  context: Record<string, unknown>,
): Promise<FirebaseFirestore.QuerySnapshot | null> {
  try {
    return await query.get();
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 9 || code === 'failed-precondition') {
      log.warn('Query di correlazione senza indice: correlazione saltata', {
        ...context,
        suggerimento: 'Distribuisci gli indici con "firebase deploy --only firestore:indexes".',
      });
      return null;
    }
    throw error;
  }
}

/** Destinatario individuato dal `messageId` restituito da Brevo all'invio. */
async function findRecipientByMessageId(
  messageId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snapshot = await safeQuery(
    col.allRecipients().where('messageId', '==', messageId).limit(1),
    { query: 'recipients.messageId' },
  );
  return !snapshot || snapshot.empty ? null : snapshot.docs[0]!;
}

/** Esecuzione di automazione individuata dal `messageId`. */
async function findRunByMessageId(
  messageId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snapshot = await safeQuery(
    col.allAutomationRuns().where('messageId', '==', messageId).limit(1),
    { query: 'runs.messageId' },
  );
  return !snapshot || snapshot.empty ? null : snapshot.docs[0]!;
}

/** Timestamp di invio di un documento (destinatario o run). */
function sentAtOf(snapshot: FirebaseFirestore.DocumentSnapshot): number {
  const value = (snapshot.get('sentAt') as string | undefined) ?? (snapshot.get('createdAt') as string | undefined);
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Ripiego finale: l'invio più recente all'indirizzo, entro la finestra.
 * Serve per gli eventi marketing di Brevo, che non sempre portano il
 * `message-id` dell'invio originale.
 */
async function findLatestByEmail(
  email: string,
  occurredAtMs: number,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const cutoff = new Date(occurredAtMs - EMAIL_MATCH_WINDOW_DAYS * 86_400_000).toISOString();

  const [recipients, runs] = await Promise.all([
    safeQuery(
      col
        .allRecipients()
        .where('email', '==', email)
        .where('sentAt', '>=', cutoff)
        .orderBy('sentAt', 'desc')
        .limit(1),
      { query: 'recipients.email+sentAt' },
    ),
    // Sulle `runs` non esiste un indice (email, sentAt): si legge un blocco
    // limitato e si sceglie in memoria.
    safeQuery(col.allAutomationRuns().where('email', '==', email).limit(FALLBACK_SCAN_LIMIT), {
      query: 'runs.email',
    }),
  ]);

  const bestRecipient = !recipients || recipients.empty ? null : recipients.docs[0]!;
  const cutoffMs = Date.parse(cutoff);
  let bestRun: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (const doc of runs?.docs ?? []) {
    const sentAt = sentAtOf(doc);
    if (sentAt < cutoffMs || sentAt > occurredAtMs + 3_600_000) continue;
    if (!bestRun || sentAt > sentAtOf(bestRun)) bestRun = doc;
  }

  if (bestRecipient && bestRun) {
    return sentAtOf(bestRecipient) >= sentAtOf(bestRun) ? bestRecipient : bestRun;
  }
  return bestRecipient ?? bestRun;
}

/** Costruisce il bersaglio a partire da un documento `recipients`. */
function targetFromRecipient(snapshot: FirebaseFirestore.DocumentSnapshot): ResolvedTarget | null {
  const newsletterId = snapshot.ref.parent.parent?.id ?? null;
  if (!newsletterId) return null;
  return {
    kind: 'newsletter',
    parentRef: col.newsletters().doc(newsletterId),
    entryRef: snapshot.ref,
    newsletterId,
    automationId: null,
    variantId: (snapshot.get('variantId') as string | undefined) ?? null,
    contactId: (snapshot.get('contactId') as string | undefined) ?? null,
  };
}

/** Costruisce il bersaglio a partire da un documento `runs`. */
function targetFromRun(snapshot: FirebaseFirestore.DocumentSnapshot): ResolvedTarget | null {
  const automationId =
    (snapshot.get('automationId') as string | undefined) ?? snapshot.ref.parent.parent?.id ?? null;
  if (!automationId) return null;
  return {
    kind: 'automation',
    parentRef: col.automations().doc(automationId),
    entryRef: snapshot.ref,
    newsletterId: null,
    automationId,
    variantId: null,
    contactId: (snapshot.get('contactId') as string | undefined) ?? null,
  };
}

/** Risale dall'evento all'invio che lo ha generato. */
export async function resolveEventTarget(event: TrackingEvent): Promise<ResolvedTarget | null> {
  const email = normalizeEmail(event.email ?? '');

  // a) Id già noti (scritti da noi negli header dell'invio).
  if (event.automationId && event.automationRunId) {
    const runRef = col.automationRuns(event.automationId).doc(event.automationRunId);
    return {
      kind: 'automation',
      parentRef: col.automations().doc(event.automationId),
      entryRef: runRef,
      newsletterId: null,
      automationId: event.automationId,
      variantId: null,
      contactId: event.contactId ?? null,
    };
  }
  if (event.newsletterId) {
    const entryRef = await findRecipientInNewsletter(event.newsletterId, event.contactId ?? null, email);
    return {
      kind: 'newsletter',
      parentRef: col.newsletters().doc(event.newsletterId),
      entryRef,
      newsletterId: event.newsletterId,
      automationId: null,
      variantId: event.variantId ?? null,
      // Il contatto, se non arriva con l'evento, viene risolto per email in `processEvent`.
      contactId: event.contactId ?? null,
    };
  }

  // a-bis) Campagna Brevo: gli eventi marketing portano `camp_id` invece del
  // `message-id`. La campagna è collegata alla newsletter che l'ha creata.
  if (event.brevoCampaignId) {
    const campaign = await col
      .newsletters()
      .where('brevoCampaignId', '==', event.brevoCampaignId)
      .limit(1)
      .get();
    if (!campaign.empty) {
      const newsletterId = campaign.docs[0]!.id;
      const entryRef = await findRecipientInNewsletter(newsletterId, event.contactId ?? null, email);
      return {
        kind: 'newsletter',
        parentRef: col.newsletters().doc(newsletterId),
        entryRef,
        newsletterId,
        automationId: null,
        variantId: event.variantId ?? null,
        contactId: event.contactId ?? null,
      };
    }
  }

  // b/c) `message-id`: chiave di correlazione principale.
  if (event.messageId) {
    const recipient = await findRecipientByMessageId(event.messageId);
    if (recipient) return targetFromRecipient(recipient);
    const run = await findRunByMessageId(event.messageId);
    if (run) return targetFromRun(run);
  }

  // d) Email + finestra temporale.
  if (email) {
    const fallback = await findLatestByEmail(email, Date.parse(event.occurredAt) || Date.now());
    if (fallback) {
      const target =
        fallback.ref.parent.id === 'recipients' ? targetFromRecipient(fallback) : targetFromRun(fallback);
      if (target) return target;
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Effetti di un evento
// -----------------------------------------------------------------------------

interface EntrySnapshotView {
  status: RecipientStatus | null;
  deliveredAt: string | null;
  firstOpenedAt: string | null;
  firstClickedAt: string | null;
  unsubscribedAt: string | null;
  bouncedAt: string | null;
  clickedUrls: Array<{ url: string; count: number; lastAt: string }>;
}

function readEntry(data: Record<string, unknown> | undefined): EntrySnapshotView {
  const value = data ?? {};
  return {
    status: (value.status as RecipientStatus | undefined) ?? null,
    deliveredAt: (value.deliveredAt as string | undefined) ?? null,
    firstOpenedAt: (value.firstOpenedAt as string | undefined) ?? null,
    firstClickedAt: (value.firstClickedAt as string | undefined) ?? null,
    unsubscribedAt: (value.unsubscribedAt as string | undefined) ?? null,
    bouncedAt: (value.bouncedAt as string | undefined) ?? null,
    clickedUrls:
      (value.clickedUrls as Array<{ url: string; count: number; lastAt: string }> | undefined) ?? [],
  };
}

/** Nuovo stato del destinatario, rispettando la progressione e i terminali. */
function nextRecipientStatus(
  current: RecipientStatus | null,
  candidate: RecipientStatus | null,
): RecipientStatus | null {
  if (!candidate) return null;
  if (!current) return candidate;
  if (current === candidate) return null;
  // `converted` è il traguardo commerciale: non lo si perde per un'apertura
  // successiva né per una disiscrizione arrivata dopo l'acquisto.
  if (current === 'converted') return null;
  if (TERMINAL_STATUSES.includes(candidate)) return candidate;
  return RECIPIENT_RANK[candidate] > RECIPIENT_RANK[current] ? candidate : null;
}

interface EventEffect {
  /** Patch da applicare al destinatario o alla run. */
  entryPatch: Record<string, unknown>;
  statsDelta: StatsDelta;
  stepDelta: StepDelta;
  engagementDelta: EngagementDelta;
  engagementTimestamps: Partial<Pick<ContactEngagement, 'lastSentAt' | 'lastOpenedAt' | 'lastClickedAt'>>;
  contactStatus: SubscriptionStatus | null;
  touchType: 'open' | 'click' | null;
  /** Nessun aggiornamento aggregato: evento informativo o già conteggiato. */
  noop: boolean;
}

function emptyEffect(): EventEffect {
  return {
    entryPatch: {},
    statsDelta: {},
    stepDelta: {},
    engagementDelta: {},
    engagementTimestamps: {},
    contactStatus: null,
    touchType: null,
    noop: true,
  };
}

/** Aggiorna l'elenco degli URL cliccati mantenendo conteggio e ultimo click. */
function withClickedUrl(
  current: Array<{ url: string; count: number; lastAt: string }>,
  url: string,
  at: string,
): Array<{ url: string; count: number; lastAt: string }> {
  const list = current.map((entry) => ({ ...entry }));
  const existing = list.find((entry) => entry.url === url);
  if (existing) {
    existing.count += 1;
    existing.lastAt = at;
  } else {
    list.push({ url, count: 1, lastAt: at });
  }
  // Tetto prudenziale: un destinatario che clicca 200 link diversi è un bot.
  return list.slice(0, 200);
}

/**
 * Traduce l'evento in aggiornamenti concreti.
 *
 * Le grandezze "uniche" (consegna, prima apertura, primo click, disiscrizione,
 * bounce) sono protette dallo stato già presente sul destinatario: un secondo
 * evento `delivered` per lo stesso invio non incrementa più nulla.
 */
export function computeEventEffect(
  event: TrackingEvent,
  entry: EntrySnapshotView,
  options: { isAutomation: boolean; countProxyOpens: boolean },
): EventEffect {
  const effect = emptyEffect();
  const at = event.occurredAt;
  const isAutomation = options.isAutomation;

  const apply = (): void => {
    effect.noop = false;
  };

  switch (event.type) {
    case 'request': {
      if (entry.status && RECIPIENT_RANK[entry.status] >= RECIPIENT_RANK.sent) break;
      apply();
      effect.entryPatch.sentAt = at;
      effect.statsDelta.requested = 1;
      effect.stepDelta.sent = 1;
      effect.engagementDelta.sent = 1;
      effect.engagementTimestamps.lastSentAt = at;
      break;
    }

    case 'delivered': {
      if (entry.deliveredAt) break;
      apply();
      effect.entryPatch.deliveredAt = at;
      effect.statsDelta.delivered = 1;
      effect.stepDelta.delivered = 1;
      effect.engagementDelta.delivered = 1;
      break;
    }

    case 'proxy_open':
    case 'opened':
    case 'unique_opened': {
      const isProxy = event.type === 'proxy_open';
      // Brevo, quando l'evento è registrato, invia `opened` **e**
      // `unique_opened` per la stessa apertura: se contassimo entrambi le
      // aperture totali risulterebbero doppie. `unique_opened` aggiorna quindi
      // solo i contatori "unici" e i timestamp.
      const countsAsTotal = event.type !== 'unique_opened';
      if (isProxy && !options.countProxyOpens) {
        // L'apertura c'è stata ma non è umana: la si annota sul destinatario
        // senza toccare statistiche, engagement e attribuzione.
        apply();
        effect.entryPatch.proxyOpenCount = FieldValue.increment(1);
        effect.entryPatch.lastProxyOpenAt = at;
        break;
      }
      apply();
      const first = !entry.firstOpenedAt;
      if (countsAsTotal) effect.entryPatch.openCount = FieldValue.increment(1);
      effect.entryPatch.lastOpenedAt = at;
      if (first) effect.entryPatch.firstOpenedAt = at;
      if (countsAsTotal) effect.statsDelta.opened = 1;
      if (first) effect.statsDelta.uniqueOpened = 1;
      // Le automazioni non hanno il contatore "unico": si conta la prima
      // apertura di ogni esecuzione, così `opened/delivered` resta un tasso.
      if (first) effect.stepDelta.opened = 1;
      if (first) {
        effect.engagementDelta.opened = 1;
        effect.touchType = 'open';
      }
      effect.engagementTimestamps.lastOpenedAt = at;
      break;
    }

    case 'click': {
      apply();
      const first = !entry.firstClickedAt;
      effect.entryPatch.clickCount = FieldValue.increment(1);
      effect.entryPatch.lastClickedAt = at;
      if (first) effect.entryPatch.firstClickedAt = at;
      if (event.url) {
        effect.entryPatch.clickedUrls = withClickedUrl(entry.clickedUrls, event.url, at);
      }
      effect.statsDelta.clicked = 1;
      if (first) effect.statsDelta.uniqueClicked = 1;
      if (first) effect.stepDelta.clicked = 1;
      // Un click implica un'apertura anche quando il pixel è stato bloccato.
      if (!entry.firstOpenedAt) {
        effect.entryPatch.firstOpenedAt = at;
        effect.entryPatch.lastOpenedAt = at;
        effect.statsDelta.uniqueOpened = 1;
        effect.statsDelta.opened = 1;
        effect.stepDelta.opened = 1;
        effect.engagementDelta.opened = 1;
        effect.engagementTimestamps.lastOpenedAt = at;
      }
      if (first) effect.engagementDelta.clicked = 1;
      effect.engagementTimestamps.lastClickedAt = at;
      effect.touchType = 'click';
      break;
    }

    case 'soft_bounce': {
      if (entry.bouncedAt) break;
      apply();
      effect.entryPatch.bouncedAt = at;
      effect.entryPatch.bounceReason = event.reason ?? null;
      effect.statsDelta.softBounces = 1;
      effect.stepDelta.bounced = 1;
      break;
    }

    case 'hard_bounce':
    case 'invalid_email': {
      if (entry.bouncedAt) break;
      apply();
      effect.entryPatch.bouncedAt = at;
      effect.entryPatch.bounceReason = event.reason ?? null;
      effect.statsDelta.hardBounces = 1;
      effect.stepDelta.bounced = 1;
      effect.engagementDelta.bounced = 1;
      effect.contactStatus = 'bounced';
      break;
    }

    case 'blocked': {
      if (entry.bouncedAt) break;
      apply();
      effect.entryPatch.bouncedAt = at;
      effect.entryPatch.bounceReason = event.reason ?? 'Contatto in blocklist';
      effect.statsDelta.blocked = 1;
      effect.stepDelta.bounced = 1;
      effect.engagementDelta.bounced = 1;
      effect.contactStatus = 'blocked';
      break;
    }

    case 'spam': {
      apply();
      effect.statsDelta.complaints = 1;
      effect.engagementDelta.complaints = 1;
      effect.contactStatus = 'blocked';
      break;
    }

    case 'unsubscribed': {
      if (entry.unsubscribedAt) break;
      apply();
      effect.entryPatch.unsubscribedAt = at;
      effect.statsDelta.unsubscribed = 1;
      effect.stepDelta.unsubscribed = 1;
      effect.contactStatus = 'unsubscribed';
      break;
    }

    case 'deferred':
    case 'error': {
      apply();
      effect.entryPatch.error = event.reason ?? 'Errore di consegna';
      break;
    }

    default:
      // list_addition, contact_updated, contact_deleted: nessun effetto sugli invii.
      break;
  }

  // Stato del destinatario derivato dall'evento.
  const candidate = recipientStatusFor(event.type, options.countProxyOpens);
  const next = nextRecipientStatus(entry.status, candidate);
  if (next) {
    effect.entryPatch.status = next;
    effect.noop = false;
  }

  if (isAutomation) {
    // Le `runs` non hanno i campi `status` dei destinatari: lo stato resta
    // quello dell'esecuzione (`sent`), i dettagli vivono nei timestamp.
    delete effect.entryPatch.status;
  }

  return effect;
}

/** Stato del destinatario corrispondente al tipo di evento. */
function recipientStatusFor(type: BrevoEventType, countProxyOpens: boolean): RecipientStatus | null {
  switch (type) {
    case 'request':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'opened':
    case 'unique_opened':
      return 'opened';
    case 'proxy_open':
      return countProxyOpens ? 'opened' : null;
    case 'click':
      return 'clicked';
    case 'soft_bounce':
      return 'soft_bounced';
    case 'hard_bounce':
    case 'invalid_email':
      return 'hard_bounced';
    case 'blocked':
      return 'blocked';
    case 'spam':
      return 'spam';
    case 'unsubscribed':
      return 'unsubscribed';
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Scritture
// -----------------------------------------------------------------------------

/** Applica il delta agli step dell'automazione (array: va riscritto intero). */
function applyStepDelta(
  automation: Automation,
  stepId: string | null,
  delta: StepDelta,
): Automation['steps'] | null {
  if (!stepId || Object.keys(delta).length === 0) return null;
  const steps = automation.steps ?? [];
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return null;

  const updated = steps.map((step, position) => {
    if (position !== index) return step;
    const stats: AutomationStepStats = { ...step.stats };
    for (const [key, value] of Object.entries(delta) as Array<[keyof AutomationStepStats, number]>) {
      if (typeof value !== 'number' || value === 0) continue;
      stats[key] = Number(stats[key] ?? 0) + value;
    }
    return { ...step, stats };
  });
  return updated;
}

/** Delta delle statistiche di automazione ricavato da quello degli step. */
function automationStatsPatch(delta: StepDelta, revenueDelta = 0, ordersDelta = 0): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const map: Array<[keyof AutomationStepStats, string]> = [
    ['sent', 'stats.sent'],
    ['delivered', 'stats.delivered'],
    ['opened', 'stats.opened'],
    ['clicked', 'stats.clicked'],
    ['cancelled', 'stats.cancelled'],
    ['scheduled', 'stats.scheduled'],
  ];
  for (const [key, field] of map) {
    const value = delta[key];
    if (typeof value === 'number' && value !== 0) patch[field] = FieldValue.increment(value);
  }
  if (ordersDelta) patch['stats.orders'] = FieldValue.increment(ordersDelta);
  if (revenueDelta) patch['stats.revenue'] = FieldValue.increment(revenueDelta);
  if (Object.keys(patch).length > 0) patch['stats.updatedAt'] = nowIso();
  return patch;
}

/** Aggiorna le statistiche della variante A/B coinvolta. */
function applyVariantDelta(
  newsletter: Newsletter,
  variantId: string | null,
  delta: StatsDelta,
): Newsletter['variants'] | null {
  if (!variantId || !newsletter.variants?.length || Object.keys(delta).length === 0) return null;
  const index = newsletter.variants.findIndex((variant) => variant.id === variantId);
  if (index < 0) return null;

  return newsletter.variants.map((variant, position) => {
    if (position !== index) return variant;
    const merged = mergeStats({ ...EMPTY_STATS, ...variant.stats }, delta);
    return { ...variant, stats: { ...merged, ...computeRates(merged), updatedAt: nowIso() } };
  });
}

/**
 * Patch dell'engagement del contatto, punteggio e fascia inclusi.
 * Percorsi puntati: va applicata con `update()`, non con `set()`.
 */
export function engagementPatch(
  current: ContactEngagement | undefined,
  delta: EngagementDelta,
  timestamps: Partial<Pick<ContactEngagement, 'lastSentAt' | 'lastOpenedAt' | 'lastClickedAt'>>,
  nowMs = Date.now(),
): Record<string, unknown> {
  const base: ContactEngagement = { ...EMPTY_ENGAGEMENT, ...(current ?? {}) };
  const patch: Record<string, unknown> = {};

  const projected: ContactEngagement = { ...base };
  for (const [key, value] of Object.entries(delta) as Array<[keyof EngagementDelta, number]>) {
    if (typeof value !== 'number' || value === 0) continue;
    patch[`engagement.${key}`] = FieldValue.increment(value);
    (projected as unknown as Record<string, unknown>)[key] = Number(base[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(timestamps)) {
    if (!value) continue;
    patch[`engagement.${key}`] = value;
    (projected as unknown as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(patch).length === 0) return patch;

  const score = computeEngagementScore(projected, nowMs);
  patch['engagement.engagementScore'] = score;
  patch['engagement.engagementTier'] = engagementTierFromScore(score, projected.delivered);
  patch.updatedAt = nowIso();
  return patch;
}

/**
 * Applica il delta alle statistiche della newsletter.
 *
 * Durante un invio il documento della newsletter è il punto più caldo del
 * database: decine di eventi al secondo puntano tutti lì. Per questo NON si usa
 * una transazione ma un `update` con `FieldValue.increment`, che il server
 * applica atomicamente senza far abortire i concorrenti. I tassi vengono
 * ricalcolati sulla fotografia appena letta: due eventi simultanei possono
 * scriverli sfasati di un'unità, differenza irrilevante su una percentuale e
 * comunque corretta dalla riconciliazione oraria.
 *
 * Le varianti A/B fanno eccezione: l'array va letto e riscritto, quindi lì
 * serve la transazione (i volumi per variante sono una frazione del totale).
 */
export async function applyNewsletterStatsDelta(
  newsletterRef: FirebaseFirestore.DocumentReference,
  delta: StatsDelta,
  variantId: string | null,
): Promise<void> {
  if (Object.keys(delta).length === 0) return;

  const snapshot = await newsletterRef.get();
  if (!snapshot.exists) return;
  const newsletter = withId<Newsletter>(snapshot);
  const hasVariant = Boolean(variantId && newsletter.variants?.some((variant) => variant.id === variantId));

  if (!hasVariant) {
    const patch = statsPatch({ ...EMPTY_STATS, ...(newsletter.stats ?? {}) }, delta);
    if (Object.keys(patch).length > 0) await newsletterRef.update(patch);
    return;
  }

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(newsletterRef);
    if (!fresh.exists) return;
    const current = withId<Newsletter>(fresh);
    const patch = statsPatch({ ...EMPTY_STATS, ...(current.stats ?? {}) }, delta);
    const variants = applyVariantDelta(current, variantId, delta);
    if (variants) patch.variants = variants;
    if (Object.keys(patch).length > 0) tx.update(newsletterRef, patch);
  });
}

/**
 * Applica il delta alle statistiche dell'automazione e del suo step.
 * Qui la transazione resta: l'array `steps` va letto e riscritto, e il ritmo
 * degli eventi di un'automazione è ordini di grandezza sotto quello di un
 * invio massivo.
 */
export async function applyAutomationStatsDelta(
  automationRef: FirebaseFirestore.DocumentReference,
  delta: StepDelta,
  stepId: string | null,
): Promise<void> {
  if (Object.keys(delta).length === 0) return;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(automationRef);
    if (!snapshot.exists) return;
    const automation = withId<Automation>(snapshot);
    const patch = automationStatsPatch(delta);
    const steps = applyStepDelta(automation, stepId, delta);
    if (steps) patch.steps = steps;
    if (Object.keys(patch).length > 0) tx.update(automationRef, { ...patch, updatedAt: nowIso() });
  });
}

// -----------------------------------------------------------------------------
// processEvent
// -----------------------------------------------------------------------------

/**
 * Elabora un evento già registrato in `events`.
 * È idempotente rispetto agli effetti "unici" ma non rispetto ai contatori
 * cumulativi (aperture e click totali): per questo l'evento va salvato una
 * sola volta, cosa garantita dall'id = `dedupeHash`.
 */
export async function processEvent(event: TrackingEvent): Promise<ProcessEventResult> {
  const settings = await readTrackingSettings();
  const countProxyOpens = !settings.excludeProxyOpens;
  const email = normalizeEmail(event.email ?? '');

  const result: ProcessEventResult = {
    eventId: event.id,
    type: event.type,
    matched: 'none',
    newsletterId: event.newsletterId ?? null,
    automationId: event.automationId ?? null,
    contactId: event.contactId ?? null,
    skipped: null,
  };

  let target: ResolvedTarget | null = null;
  try {
    target = await resolveEventTarget(event);
  } catch (error) {
    log.error('Correlazione evento fallita', error, { eventId: event.id, type: event.type });
  }

  if (target) {
    result.matched = target.kind;
    result.newsletterId = target.newsletterId;
    result.automationId = target.automationId;
    if (target.contactId) result.contactId = target.contactId;
  }

  // Contatto: dagli id noti, altrimenti per email.
  let contactRef: FirebaseFirestore.DocumentReference | null = null;
  const contactId = result.contactId;
  if (contactId) {
    contactRef = col.contacts().doc(contactId);
  } else if (email) {
    const snapshot = await col.contacts().where('emailNormalized', '==', email).limit(1).get();
    if (!snapshot.empty) {
      contactRef = snapshot.docs[0]!.ref;
      result.contactId = contactRef.id;
    }
  }

  // Transazione limitata ai documenti "freddi": destinatario e contatto.
  // Le statistiche aggregate restano fuori di proposito — vedi
  // `applyNewsletterStatsDelta`.
  const applied = await db.runTransaction(async (tx) => {
    // --- letture (tutte prima delle scritture, come richiede Firestore) ---
    const entrySnap = target?.entryRef ? await tx.get(target.entryRef) : null;
    const contactSnap = contactRef ? await tx.get(contactRef) : null;

    const entry = readEntry(
      entrySnap?.exists ? (serializeDoc(entrySnap.data()) as Record<string, unknown>) : undefined,
    );
    const effect = computeEventEffect(event, entry, {
      isAutomation: target?.kind === 'automation',
      countProxyOpens,
    });

    // --- scritture ---
    if (entrySnap?.exists && Object.keys(effect.entryPatch).length > 0) {
      tx.set(entrySnap.ref, { ...effect.entryPatch, updatedAt: nowIso() }, { merge: true });
    }

    if (contactSnap?.exists) {
      const contact = withId<Contact>(contactSnap);
      const patch = engagementPatch(contact.engagement, effect.engagementDelta, effect.engagementTimestamps);

      if (effect.contactStatus) {
        const currentSeverity = SUBSCRIPTION_SEVERITY[contact.status] ?? 0;
        const nextSeverity = SUBSCRIPTION_SEVERITY[effect.contactStatus] ?? 0;
        if (nextSeverity > currentSeverity) {
          patch.status = effect.contactStatus;
          patch.statusReason = event.reason ?? `Evento Brevo: ${event.type}`;
          patch.statusChangedAt = event.occurredAt;
          patch.optOutAt = event.occurredAt;
          patch.updatedAt = nowIso();
        }
      }
      if (Object.keys(patch).length > 0) tx.update(contactSnap.ref, patch);
    }

    return {
      effect,
      entryExists: Boolean(entrySnap?.exists),
      stepId: (entrySnap?.get('stepId') as string | undefined) ?? null,
    };
  });

  // Statistiche aggregate: solo se l'evento è agganciato a un invio noto,
  // altrimenti non c'è modo di sapere se è già stato conteggiato.
  if (target && applied.entryExists) {
    try {
      if (target.kind === 'newsletter' && target.newsletterId) {
        await applyNewsletterStatsDelta(
          target.parentRef,
          applied.effect.statsDelta,
          target.variantId ?? event.variantId ?? null,
        );
      } else if (target.kind === 'automation') {
        await applyAutomationStatsDelta(target.parentRef, applied.effect.stepDelta, applied.stepId);
      }
    } catch (error) {
      // Le statistiche aggregate sono una cache: un errore qui non deve far
      // rielaborare l'evento (perderebbe l'idempotenza dei contatori unici).
      // Ci pensa `recomputeNewsletterStats` alla riconciliazione oraria.
      log.error('Aggiornamento statistiche aggregate fallito', error, {
        eventId: event.id,
        newsletterId: target.newsletterId,
        automationId: target.automationId,
      });
    }
  }

  const touch = applied.effect.touchType;

  // Tocco di attribuzione: fuori transazione, l'id deterministico lo rende
  // sicuro da ripetere.
  if (touch && result.contactId) {
    await recordAttributionTouch(event, touch, target, result.contactId);
  }

  // Gli id risolti vengono riscritti sull'evento: servono ai report per
  // filtrare senza dover ri-correlare. Si scrive una volta sola, insieme al
  // flag `processed`.
  const enrichment: Record<string, unknown> = {};
  if (result.newsletterId && !event.newsletterId) enrichment.newsletterId = result.newsletterId;
  if (result.automationId && !event.automationId) enrichment.automationId = result.automationId;
  if (result.contactId && !event.contactId) enrichment.contactId = result.contactId;
  if (target?.kind === 'automation' && target.entryRef && !event.automationRunId) {
    enrichment.automationRunId = target.entryRef.id;
  }
  // Un evento transazionale che si è rivelato appartenere a una campagna o a
  // un'automazione viene riclassificato: i report filtrano per `source`.
  if (target && event.source === 'transactional') enrichment.source = target.kind;

  await col
    .events()
    .doc(event.id)
    .set({ ...enrichment, processed: true, processingError: null, processedAt: nowIso() }, { merge: true });

  if (!target) result.skipped = 'invio_non_correlato';
  return result;
}

/** Scrive (o riscrive) il tocco di attribuzione legato all'evento. */
async function recordAttributionTouch(
  event: TrackingEvent,
  touchType: 'open' | 'click',
  target: ResolvedTarget | null,
  contactId: string,
): Promise<void> {
  await col
    .attributionTouches()
    .doc(event.id)
    .set(
      {
        contactId,
        email: normalizeEmail(event.email ?? ''),
        source: target?.kind ?? event.source ?? 'newsletter',
        newsletterId: target?.newsletterId ?? event.newsletterId ?? null,
        automationId: target?.automationId ?? event.automationId ?? null,
        automationRunId:
          target?.kind === 'automation' ? (target.entryRef?.id ?? null) : (event.automationRunId ?? null),
        variantId: target?.variantId ?? event.variantId ?? null,
        touchType,
        url: event.url ?? null,
        occurredAt: event.occurredAt,
        attributedOrderId: null,
        createdAt: nowIso(),
      },
      { merge: true },
    );
}

// -----------------------------------------------------------------------------
// Ricalcolo completo
// -----------------------------------------------------------------------------

/**
 * Ricalcola da zero le statistiche di una newsletter leggendo i destinatari.
 *
 * È la rete di sicurezza contro gli incrementi persi (istanza terminata a metà,
 * evento elaborato due volte da processi concorrenti): la sotto-collezione
 * `recipients` è la fonte di verità, i contatori aggregati solo una cache.
 */
export async function recomputeNewsletterStats(newsletterId: string): Promise<NewsletterStats> {
  const ref = col.newsletters().doc(newsletterId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new Error(`Newsletter "${newsletterId}" non trovata.`);
  }
  const newsletter = withId<Newsletter>(snapshot);

  const stats: NewsletterStats = {
    ...EMPTY_STATS,
    currency: newsletter.stats?.currency ?? EMPTY_STATS.currency,
  };
  const variantTotals = new Map<string, NewsletterStats>();

  const bump = (variantId: string | null | undefined, apply: (target: NewsletterStats) => void): void => {
    apply(stats);
    if (!variantId) return;
    const existing = variantTotals.get(variantId) ?? { ...EMPTY_STATS };
    apply(existing);
    variantTotals.set(variantId, existing);
  };

  await paginateQuery(
    col
      .recipients(newsletterId)
      .select(
        'status',
        'variantId',
        'sentAt',
        'deliveredAt',
        'firstOpenedAt',
        'openCount',
        'firstClickedAt',
        'clickCount',
        'unsubscribedAt',
        'bouncedAt',
        'convertedOrderId',
        'revenue',
      )
      .orderBy('__name__'),
    500,
    async (docs) => {
      for (const doc of docs) {
        const data = doc.data() as Partial<NewsletterRecipient> & { proxyOpenCount?: number };
        const variantId = data.variantId ?? null;

        bump(variantId, (target) => {
          target.recipients += 1;
          if (data.sentAt) target.requested += 1;
          if (data.deliveredAt) target.delivered += 1;
          if (data.firstOpenedAt) target.uniqueOpened += 1;
          target.opened += Number(data.openCount ?? 0);
          if (data.firstClickedAt) target.uniqueClicked += 1;
          target.clicked += Number(data.clickCount ?? 0);
          if (data.unsubscribedAt) target.unsubscribed += 1;
          if (data.status === 'soft_bounced') target.softBounces += 1;
          if (data.status === 'hard_bounced') target.hardBounces += 1;
          if (data.status === 'blocked') target.blocked += 1;
          if (data.status === 'spam') target.complaints += 1;
          if (data.convertedOrderId) {
            target.orders += 1;
            target.revenue += Number(data.revenue ?? 0);
          }
        });
      }
    },
  );

  const finalStats: NewsletterStats = { ...stats, ...computeRates(stats), updatedAt: nowIso() };

  const patch: Record<string, unknown> = { stats: finalStats };
  if (newsletter.variants?.length) {
    patch.variants = newsletter.variants.map((variant) => {
      const totals = variantTotals.get(variant.id);
      if (!totals) return variant;
      return { ...variant, stats: { ...totals, ...computeRates(totals), updatedAt: nowIso() } };
    });
  }

  await ref.set(patch, { merge: true });
  log.info('Statistiche newsletter ricalcolate', {
    newsletterId,
    recipients: finalStats.recipients,
    delivered: finalStats.delivered,
    uniqueOpened: finalStats.uniqueOpened,
  });

  return finalStats;
}
