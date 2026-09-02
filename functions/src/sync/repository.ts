/**
 * Scrittura idempotente su Firestore dei dati provenienti dai negozi.
 *
 * -----------------------------------------------------------------------------
 * IDENTITÀ DEI DOCUMENTI
 * -----------------------------------------------------------------------------
 * Gli id sono **deterministici**: la stessa entità sincronizzata dieci volte
 * produce sempre lo stesso documento, quindi una sincronizzazione ripetuta (o
 * un webhook consegnato due volte) non duplica nulla.
 *
 * - contatti  → slug + impronta dell'email normalizzata
 * - ordini    → `{source}_{externalId}`
 * - carrelli  → `{source}_{kind}_{externalId}`
 *
 * Il contatto è identificato **solo** dall'email: un cliente che compra sia sul
 * B2C sia sul B2B è una persona sola. `sources` e `externalIds` si accumulano,
 * le statistiche si calcolano sull'unione degli ordini dei due negozi.
 *
 * -----------------------------------------------------------------------------
 * COSA NON VIENE MAI SOVRASCRITTO
 * -----------------------------------------------------------------------------
 * Tutte le scritture usano `merge: true` e omettono i campi di competenza di
 * altri moduli: `engagement` (webhook Brevo), `attribution` (tracking),
 * `clusterIds`, `tags`, `notes`, `remindersSent`. La sincronizzazione porta i
 * dati del negozio, non cancella il lavoro dell'app.
 */

import { createHash } from 'node:crypto';
import {
  DEFAULT_CURRENCY,
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  EMPTY_ENGAGEMENT,
  PRODUCT_FAMILIES,
  REVENUE_ORDER_STATUSES,
  normalizeEmail,
  slugify,
} from '@alphaink/shared';
import type {
  AbandonedCart,
  Contact,
  ContactStats,
  DocId,
  IsoDate,
  NormalizedCart,
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedOrderItem,
  Order,
  OwnedPrinter,
  PrestaShopStoreSettings,
  ProductFamily,
  SiteSource,
  StoreSource,
} from '@alphaink/shared';
import { chunk, mapWithConcurrency } from '../lib/async';
import { commitInBatches, col, db, nowIso } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { EMPTY_CONTACT_STATS, buildContactPatch, readStateTimestamps, round2, segmentForGroups } from './normalize';

const log = createLogger('sync.repository');

/** Documenti letti in un colpo solo con `getAll`. */
const READ_CHUNK = 250;

/** Ordini caricati per ricalcolare le statistiche di un contatto. */
const MAX_ORDERS_PER_CONTACT = 1000;

/** Stampanti conservate per contatto: oltre, il documento cresce inutilmente. */
const MAX_PRINTERS = 20;

export interface UpsertCounts {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export function emptyCounts(): UpsertCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 };
}

// -----------------------------------------------------------------------------
// Id deterministici
// -----------------------------------------------------------------------------

/**
 * Id del contatto: slug leggibile dell'email + impronta.
 *
 * Lo slug da solo non basta (`mario.rossi@a.it` e `mario-rossi@a.it`
 * collasserebbero sullo stesso id), l'impronta da sola renderebbe illeggibile
 * la console Firestore: si usano entrambi.
 */
export function contactDocId(email: string): DocId {
  const normalized = normalizeEmail(email);
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  const slug = slugify(normalized).slice(0, 48);
  return slug ? `${slug}-${digest}` : digest;
}

export function orderDocId(source: SiteSource, externalId: string): DocId {
  return `${source}_${externalId}`;
}

export function abandonedCartDocId(source: SiteSource, kind: 'cart' | 'payment', externalId: string): DocId {
  return `${source}_${kind}_${externalId}`;
}

// -----------------------------------------------------------------------------
// Contatti
// -----------------------------------------------------------------------------

export interface ContactSyncOptions {
  /** Origine del consenso da registrare alla prima iscrizione. */
  consentSource?: string | null;
  now?: IsoDate;
}

/** Segmento del contatto a partire dai gruppi cliente del negozio. */
function segmentFor(customer: NormalizedCustomer, store: PrestaShopStoreSettings): 'b2c' | 'b2b' {
  const raw = (customer.raw ?? {}) as { segment?: unknown; groupNames?: unknown };
  if (raw.segment === 'b2b' || raw.segment === 'b2c') return raw.segment;
  const groupNames = Array.isArray(raw.groupNames) ? (raw.groupNames as string[]) : [];
  return segmentForGroups(store, [customer.customerGroup, ...groupNames]);
}

/** Crea o aggiorna il contatto corrispondente a un cliente del negozio. */
export async function upsertContactFromCustomer(
  customer: NormalizedCustomer,
  store: PrestaShopStoreSettings,
  options: ContactSyncOptions = {},
): Promise<{ id: DocId; created: boolean }> {
  const id = contactDocId(customer.email);
  const ref = col.contacts().doc(id);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? ({ ...snapshot.data(), id } as Contact) : null;

  const patch = buildContactPatch(customer, existing, {
    segment: segmentFor(customer, store),
    now: options.now ?? nowIso(),
    consentSource: options.consentSource ?? null,
  });

  await ref.set(patch, { merge: true });
  return { id, created: !existing };
}

/**
 * Versione a lotti: legge i documenti esistenti con `getAll` e scrive in batch.
 * È la via usata dall'orchestratore, che deve reggere centinaia di migliaia di
 * clienti senza una lettura per record.
 */
export async function upsertContactsBatch(
  customers: NormalizedCustomer[],
  store: PrestaShopStoreSettings,
  options: ContactSyncOptions = {},
): Promise<UpsertCounts & { contactIds: DocId[] }> {
  const counts = emptyCounts();
  const contactIds: DocId[] = [];
  if (customers.length === 0) return { ...counts, contactIds };

  // Lo stesso indirizzo può comparire due volte nella stessa pagina (clienti
  // duplicati sul negozio): vince l'ultimo, gli altri sono "saltati".
  const byId = new Map<DocId, NormalizedCustomer>();
  for (const customer of customers) {
    if (!customer.email || !customer.email.includes('@')) {
      counts.skipped += 1;
      continue;
    }
    const id = contactDocId(customer.email);
    if (byId.has(id)) counts.skipped += 1;
    byId.set(id, customer);
  }

  const entries = [...byId.entries()];
  const now = options.now ?? nowIso();
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  for (const block of chunk(entries, READ_CHUNK)) {
    const refs = block.map(([id]) => col.contacts().doc(id));
    const snapshots = await db.getAll(...refs);

    block.forEach(([id, customer], index) => {
      const snapshot = snapshots[index];
      const existing = snapshot?.exists ? ({ ...snapshot.data(), id } as Contact) : null;
      const patch = buildContactPatch(customer, existing, {
        segment: segmentFor(customer, store),
        now,
        consentSource: options.consentSource ?? null,
      });
      operations.push((batch) => batch.set(col.contacts().doc(id), patch, { merge: true }));
      contactIds.push(id);
      if (existing) counts.updated += 1;
      else counts.created += 1;
    });
  }

  await commitInBatches(operations);
  return { ...counts, contactIds };
}

/**
 * Garantisce l'esistenza di un contatto per l'email indicata.
 * Serve quando arriva prima l'ordine del cliente (import parziali, webhook).
 */
export async function ensureContactForEmail(
  email: string,
  source: SiteSource,
  hints: {
    firstName?: string | null;
    lastName?: string | null;
    externalId?: string | null;
    segment?: 'b2c' | 'b2b';
  } = {},
): Promise<{ id: DocId; created: boolean }> {
  const id = contactDocId(email);
  const ref = col.contacts().doc(id);
  const snapshot = await ref.get();
  if (snapshot.exists) return { id, created: false };

  await ref.set(minimalContact(email, source, hints), { merge: true });
  return { id, created: true };
}

/**
 * Documento minimo di un contatto creato da un ordine.
 * Lo stato è `never_subscribed`: un acquisto non è un consenso all'invio.
 */
function minimalContact(
  email: string,
  source: SiteSource,
  hints: { firstName?: string | null; lastName?: string | null; externalId?: string | null; segment?: 'b2c' | 'b2b' },
): Partial<Contact> {
  const now = nowIso();
  const emailNormalized = normalizeEmail(email);
  const displayName =
    [hints.firstName, hints.lastName].filter(Boolean).join(' ').trim() || emailNormalized.split('@')[0] || emailNormalized;

  return {
    email: emailNormalized,
    emailNormalized,
    firstName: hints.firstName ?? null,
    lastName: hints.lastName ?? null,
    displayName,
    source,
    sources: [source],
    externalIds: hints.externalId ? ({ [source]: hints.externalId } as Partial<Record<SiteSource, string>>) : {},
    status: 'never_subscribed',
    language: 'it',
    segment: hints.segment ?? 'b2c',
    tags: [],
    clusterIds: [],
    dynamicClusterIds: [],
    stats: { ...EMPTY_CONTACT_STATS },
    engagement: { ...EMPTY_ENGAGEMENT },
    printers: [],
    brevoContactId: null,
    lastSyncAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
  };
}

// -----------------------------------------------------------------------------
// Ordini
// -----------------------------------------------------------------------------

/** Documento `orders` a partire dall'ordine normalizzato. */
function orderDocument(
  order: NormalizedOrder,
  contactId: DocId,
  existing: Order | null,
): Partial<Order> {
  const now = nowIso();
  const timestamps = readStateTimestamps(order);
  const families = Array.from(
    new Set(order.items.map((item) => item.family ?? 'altro').filter(Boolean)),
  ) as string[];
  const skus = Array.from(new Set(order.items.map((item) => item.sku).filter(Boolean)));

  const document: Partial<Order> = {
    externalId: order.externalId,
    source: order.source,
    orderNumber: order.orderNumber ?? null,
    email: order.email,
    emailNormalized: normalizeEmail(order.email),
    contactId,
    status: order.normalizedStatus,
    rawStatus: order.status,
    total: round2(order.total),
    subtotal: order.subtotal ?? null,
    shipping: order.shipping ?? null,
    tax: order.tax ?? null,
    currency: order.currency || DEFAULT_CURRENCY,
    items: order.items,
    families,
    skus,
    placedAt: order.placedAt,
    paidAt: timestamps.paidAt,
    completedAt: timestamps.completedAt,
    cancelledAt: timestamps.cancelledAt,
    refundedAt: timestamps.refundedAt,
    lastSyncAt: now,
    updatedAt: now,
  };

  // Campi che possono arrivare da altre sorgenti (webhook del sito, tracking):
  // si scrivono solo se abbiamo un valore, per non cancellare quello esistente.
  if (order.couponCode) document.couponCode = order.couponCode;
  else if (!existing?.couponCode) document.couponCode = null;
  if (order.utm) document.utm = order.utm;

  if (!existing) {
    document.createdAt = order.placedAt ?? now;
    document.createdBy = null;
    document.attribution = null;
    document.attributions = [];
    document.refundedAmount = null;
  }
  return document;
}

export interface OrderUpsertResult extends UpsertCounts {
  /** Contatti toccati: vanno ricalcolate le statistiche. */
  contactIds: DocId[];
}

/** Crea o aggiorna un singolo ordine. */
export async function upsertOrder(
  order: NormalizedOrder,
  store: PrestaShopStoreSettings,
): Promise<{ id: DocId; contactId: DocId; created: boolean }> {
  const result = await upsertOrdersBatch([order], store);
  return {
    id: orderDocId(order.source, order.externalId),
    contactId: contactDocId(order.email),
    created: result.created > 0,
  };
}

/**
 * Scrittura a lotti degli ordini.
 *
 * Oltre al documento ordine, l'operazione:
 *  - crea il contatto minimo se l'ordine arriva prima del cliente;
 *  - apre un "pagamento abbandonato" per gli ordini fermi in attesa di incasso;
 *  - chiude come recuperato il carrello abbandonato da cui l'ordine proviene.
 */
export async function upsertOrdersBatch(
  orders: NormalizedOrder[],
  store: PrestaShopStoreSettings,
  options: { abandonedPaymentAfterMinutes?: number } = {},
): Promise<OrderUpsertResult> {
  const counts: OrderUpsertResult = { ...emptyCounts(), contactIds: [] };
  if (orders.length === 0) return counts;

  const now = nowIso();
  const nowMs = Date.parse(now);
  const abandonAfterMs = Math.max(1, options.abandonedPaymentAfterMinutes ?? 60) * 60_000;
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const touched = new Set<DocId>();
  /** Contatti già creati in questo lotto: evita due scritture sullo stesso documento. */
  const createdContacts = new Set<DocId>();

  // Un ordine può comparire due volte nella stessa pagina solo per errore della
  // sorgente: vince l'ultima versione letta.
  const byId = new Map<DocId, NormalizedOrder>();
  for (const order of orders) {
    if (!order.email || !order.email.includes('@')) {
      counts.skipped += 1;
      continue;
    }
    byId.set(orderDocId(order.source, order.externalId), order);
  }

  for (const block of chunk([...byId.entries()], READ_CHUNK)) {
    const orderRefs = block.map(([id]) => col.orders().doc(id));
    const contactRefs = block.map(([, order]) => col.contacts().doc(contactDocId(order.email)));
    const cartRefs = block.map(([, order]) =>
      col.abandonedCarts().doc(abandonedCartDocId(order.source, 'cart', cartIdOf(order) ?? '-')),
    );
    const paymentRefs = block.map(([, order]) =>
      col.abandonedCarts().doc(abandonedCartDocId(order.source, 'payment', order.externalId)),
    );

    const [orderSnapshots, contactSnapshots, cartSnapshots, paymentSnapshots] = await Promise.all([
      db.getAll(...orderRefs),
      db.getAll(...contactRefs),
      db.getAll(...cartRefs),
      db.getAll(...paymentRefs),
    ]);

    block.forEach(([id, order], index) => {
      const orderSnapshot = orderSnapshots[index];
      const existing = orderSnapshot?.exists ? ({ ...orderSnapshot.data(), id } as Order) : null;
      const contactId = contactDocId(order.email);
      const document = orderDocument(order, contactId, existing);

      operations.push((batch) => batch.set(col.orders().doc(id), document, { merge: true }));
      if (existing) counts.updated += 1;
      else counts.created += 1;
      touched.add(contactId);

      // Contatto minimo se l'ordine precede il cliente.
      if (!contactSnapshots[index]?.exists && !createdContacts.has(contactId)) {
        createdContacts.add(contactId);
        const raw = (order.raw ?? {}) as { firstName?: string | null; lastName?: string | null };
        const minimal = minimalContact(order.email, order.source, {
          firstName: raw.firstName ?? null,
          lastName: raw.lastName ?? null,
          externalId: order.customerExternalId ?? null,
          segment: store.defaultSegment,
        });
        operations.push((batch) => batch.set(col.contacts().doc(contactId), minimal, { merge: true }));
      }

      // Pagamento abbandonato: ordine creato ma mai incassato entro la soglia.
      const placedMs = Date.parse(order.placedAt);
      const stale = Number.isFinite(placedMs) && nowMs - placedMs >= abandonAfterMs;
      if (isAwaitingPayment(order) && stale) {
        const paymentId = abandonedCartDocId(order.source, 'payment', order.externalId);
        const payment = abandonedCartDocument({
          source: order.source,
          kind: 'payment',
          externalId: order.externalId,
          email: order.email,
          contactId,
          total: order.total,
          currency: order.currency,
          items: order.items,
          recoveryUrl: null,
          abandonedAt: order.placedAt,
          lastSeenAt: order.updatedAt ?? now,
          orderId: id,
        }, false);
        operations.push((batch) => batch.set(col.abandonedCarts().doc(paymentId), payment, { merge: true }));
      }

      // Ordine incassato: il carrello da cui nasce non è più abbandonato.
      const cartSnapshot = cartSnapshots[index];
      if (cartSnapshot?.exists && isRevenue(order)) {
        const data = cartSnapshot.data() as AbandonedCart | undefined;
        if (!data?.recoveredAt) {
          operations.push((batch) =>
            batch.set(
              cartSnapshot.ref,
              {
                recoveredAt: readStateTimestamps(order).paidAt ?? order.placedAt,
                recoveredOrderId: id,
                recoveredRevenue: round2(order.total),
                closedAt: now,
                closedReason: 'Ordine completato',
                updatedAt: now,
              },
              { merge: true },
            ),
          );
        }
      }

      // L'ordine è stato incassato: anche il pagamento abbandonato si chiude.
      // Si scrive SOLO se il documento esiste già: un `set` con merge su un
      // riferimento inesistente creerebbe un carrello abbandonato fantasma.
      const paymentSnapshot = paymentSnapshots[index];
      if (paymentSnapshot?.exists && isRevenue(order)) {
        const payment = paymentSnapshot.data() as AbandonedCart | undefined;
        if (!payment?.recoveredAt) {
          operations.push((batch) =>
            batch.set(
              paymentSnapshot.ref,
              {
                recoveredAt: readStateTimestamps(order).paidAt ?? now,
                recoveredOrderId: id,
                recoveredRevenue: round2(order.total),
                closedAt: now,
                closedReason: 'Pagamento completato',
                updatedAt: now,
              },
              { merge: true },
            ),
          );
        }
      }
    });
  }

  await commitInBatches(operations);
  counts.contactIds = [...touched];
  return counts;
}

function cartIdOf(order: NormalizedOrder): string | null {
  const raw = (order.raw ?? {}) as { cartId?: unknown };
  const value = raw.cartId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRevenue(order: NormalizedOrder): boolean {
  return REVENUE_ORDER_STATUSES.includes(order.normalizedStatus);
}

/** Ordine creato ma non ancora incassato: candidato a "pagamento abbandonato". */
function isAwaitingPayment(order: NormalizedOrder): boolean {
  return order.normalizedStatus === 'awaiting_payment' || order.normalizedStatus === 'pending';
}

// -----------------------------------------------------------------------------
// Carrelli abbandonati
// -----------------------------------------------------------------------------

export interface AbandonedCartInput {
  source: SiteSource;
  kind: 'cart' | 'payment';
  externalId: string;
  email: string;
  contactId?: DocId | null;
  total: number;
  currency: string;
  items: NormalizedOrderItem[];
  recoveryUrl?: string | null;
  abandonedAt: IsoDate;
  lastSeenAt: IsoDate;
  orderId?: DocId | null;
}

/**
 * Documento `abandonedCarts`.
 * I contatori dei promemoria appartengono al motore automazioni: alla creazione
 * si azzerano, negli aggiornamenti non si toccano.
 */
function abandonedCartDocument(input: AbandonedCartInput, exists: boolean): Partial<AbandonedCart> {
  const now = nowIso();
  const document: Partial<AbandonedCart> = {
    externalId: input.externalId,
    source: input.source,
    email: input.email,
    emailNormalized: normalizeEmail(input.email),
    contactId: input.contactId ?? contactDocId(input.email),
    kind: input.kind,
    orderId: input.orderId ?? null,
    total: round2(input.total),
    currency: input.currency || DEFAULT_CURRENCY,
    items: input.items,
    recoveryUrl: input.recoveryUrl ?? null,
    lastSeenAt: input.lastSeenAt,
    updatedAt: now,
  };

  if (!exists) {
    document.abandonedAt = input.abandonedAt;
    document.remindersSent = 0;
    document.lastReminderAt = null;
    document.recoveredAt = null;
    document.recoveredOrderId = null;
    document.recoveredRevenue = null;
    document.closedAt = null;
    document.closedReason = null;
    document.createdAt = input.abandonedAt ?? now;
    document.createdBy = null;
  }
  return document;
}

/** Crea o aggiorna un carrello/pagamento abbandonato. */
export async function upsertAbandonedCart(
  input: AbandonedCartInput,
): Promise<{ id: DocId; created: boolean }> {
  const id = abandonedCartDocId(input.source, input.kind, input.externalId);
  const ref = col.abandonedCarts().doc(id);
  const snapshot = await ref.get();
  await ref.set(abandonedCartDocument(input, snapshot.exists), { merge: true });
  return { id, created: !snapshot.exists };
}

/**
 * Scrittura a lotti dei carrelli abbandonati letti dal negozio.
 * Un carrello più recente della soglia non è ancora "abbandonato": viene
 * saltato, così l'automazione non parte mentre il cliente sta ancora comprando.
 */
export async function upsertAbandonedCartsBatch(
  carts: NormalizedCart[],
  options: { abandonedAfterMinutes?: number; now?: IsoDate } = {},
): Promise<UpsertCounts> {
  const counts = emptyCounts();
  if (carts.length === 0) return counts;

  const now = options.now ?? nowIso();
  const nowMs = Date.parse(now);
  const thresholdMs = Math.max(0, options.abandonedAfterMinutes ?? 240) * 60_000;
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  const eligible = carts.filter((cart) => {
    if (!cart.email || cart.items.length === 0) return false;
    // Soglia zero (webhook del sito): il carrello si registra subito, decidere
    // quando è "abbandonato" spetta all'automazione.
    if (thresholdMs <= 0) return true;
    const updatedMs = Date.parse(cart.updatedAt || cart.createdAt);
    if (!Number.isFinite(updatedMs)) return false;
    return nowMs - updatedMs >= thresholdMs;
  });
  counts.skipped += carts.length - eligible.length;

  for (const block of chunk(eligible, READ_CHUNK)) {
    const refs = block.map((cart) =>
      col.abandonedCarts().doc(abandonedCartDocId(cart.source, 'cart', cart.externalId)),
    );
    const snapshots = await db.getAll(...refs);

    block.forEach((cart, index) => {
      const snapshot = snapshots[index];
      const existing = snapshot?.exists ? (snapshot.data() as AbandonedCart) : null;
      // Un carrello già recuperato o chiuso non torna indietro.
      if (existing?.recoveredAt || existing?.closedAt) {
        counts.skipped += 1;
        return;
      }
      const document = abandonedCartDocument(
        {
          source: cart.source,
          kind: 'cart',
          externalId: cart.externalId,
          email: cart.email,
          total: cart.total,
          currency: cart.currency,
          items: cart.items,
          recoveryUrl: cart.recoveryUrl ?? null,
          abandonedAt: cart.updatedAt || cart.createdAt,
          lastSeenAt: cart.updatedAt || cart.createdAt,
        },
        Boolean(existing),
      );
      operations.push((batch) => batch.set(refs[index] as FirebaseFirestore.DocumentReference, document, { merge: true }));
      if (existing) counts.updated += 1;
      else counts.created += 1;
    });
  }

  await commitInBatches(operations);
  return counts;
}

// -----------------------------------------------------------------------------
// Statistiche del contatto
// -----------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export interface RecomputeOptions {
  /** Cicli di riacquisto per famiglia, da `settings/site`. */
  repurchaseCycleDays?: Record<string, number>;
  /** Numero massimo di ordini considerati. */
  ordersLimit?: number;
}

/**
 * Ricalcola le metriche commerciali del contatto sull'unione degli ordini dei
 * due negozi.
 *
 * Contano solo gli ordini in stato "incassato" (`REVENUE_ORDER_STATUSES`):
 * un ordine annullato o mai pagato non deve gonfiare il valore del cliente né
 * spostare in avanti la data di riacquisto.
 */
export async function recomputeContactStats(
  contactId: DocId,
  options: RecomputeOptions = {},
): Promise<ContactStats | null> {
  const ref = col.contacts().doc(contactId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    log.warn('Ricalcolo statistiche su contatto inesistente', { contactId });
    return null;
  }
  const contact = snapshot.data() as Contact;
  const emailNormalized = contact.emailNormalized ?? normalizeEmail(contact.email ?? '');
  if (!emailNormalized) return null;

  // Query servita dall'indice (emailNormalized ASC, placedAt DESC).
  const ordersSnapshot = await col
    .orders()
    .where('emailNormalized', '==', emailNormalized)
    .orderBy('placedAt', 'desc')
    .limit(options.ordersLimit ?? MAX_ORDERS_PER_CONTACT)
    .get();

  const orders = ordersSnapshot.docs
    .map((doc) => doc.data() as Order)
    .filter((order) => REVENUE_ORDER_STATUSES.includes(order.status))
    .sort((a, b) => Date.parse(a.placedAt) - Date.parse(b.placedAt));

  const stats = computeStats(orders, options.repurchaseCycleDays);
  const printers = mergePrinters(contact.printers ?? [], derivePrinters(orders));

  await ref.set({ stats, printers, updatedAt: nowIso() }, { merge: true });
  return stats;
}

/** Ricalcolo di più contatti con concorrenza limitata. */
export async function recomputeContactsStats(
  contactIds: DocId[],
  options: RecomputeOptions & { concurrency?: number } = {},
): Promise<number> {
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) return 0;
  let done = 0;
  await mapWithConcurrency(unique, options.concurrency ?? 8, async (id) => {
    try {
      await recomputeContactStats(id, options);
      done += 1;
    } catch (error) {
      log.error('Ricalcolo statistiche non riuscito', error, { contactId: id });
    }
    return null;
  });
  return done;
}

/** Calcolo puro delle statistiche a partire dagli ordini validi, ordinati per data. */
export function computeStats(
  orders: Order[],
  repurchaseCycleDays: Record<string, number> = DEFAULT_REPURCHASE_CYCLE_DAYS,
): ContactStats {
  if (orders.length === 0) return { ...EMPTY_CONTACT_STATS };

  const totalSpent = round2(orders.reduce((sum, order) => sum + (order.total ?? 0), 0));
  const first = orders[0] as Order;
  const last = orders[orders.length - 1] as Order;

  // Intervallo medio fra ordini consecutivi: base delle automazioni di riacquisto.
  let averageDaysBetweenOrders: number | null = null;
  if (orders.length >= 2) {
    let total = 0;
    for (let i = 1; i < orders.length; i += 1) {
      total += Date.parse((orders[i] as Order).placedAt) - Date.parse((orders[i - 1] as Order).placedAt);
    }
    averageDaysBetweenOrders = Math.round(total / (orders.length - 1) / DAY_MS);
  }

  const spentByFamily: Partial<Record<ProductFamily, number>> = {};
  const ordersByFamily: Partial<Record<ProductFamily, number>> = {};
  const lastOrderByFamily: Partial<Record<ProductFamily, IsoDate>> = {};
  const datesByFamily = new Map<ProductFamily, number[]>();

  for (const order of orders) {
    const familiesInOrder = new Set<ProductFamily>();
    for (const item of order.items ?? []) {
      const family = (item.family ?? 'altro') as ProductFamily;
      familiesInOrder.add(family);
      spentByFamily[family] = round2((spentByFamily[family] ?? 0) + (item.total ?? 0));
    }
    const placedMs = Date.parse(order.placedAt);
    for (const family of familiesInOrder) {
      ordersByFamily[family] = (ordersByFamily[family] ?? 0) + 1;
      lastOrderByFamily[family] = order.placedAt;
      const dates = datesByFamily.get(family);
      if (dates) dates.push(placedMs);
      else datesByFamily.set(family, [placedMs]);
    }
  }

  // Prossimo riacquisto: se il cliente ha già ricomprato quella famiglia si usa
  // il SUO ritmo, altrimenti il ciclo medio configurato per la famiglia.
  const nextPurchaseDueAt: Partial<Record<ProductFamily, IsoDate>> = {};
  for (const family of PRODUCT_FAMILIES) {
    const lastAt = lastOrderByFamily[family];
    if (!lastAt) continue;
    const dates = (datesByFamily.get(family) ?? []).sort((a, b) => a - b);
    let cycleDays = repurchaseCycleDays[family] ?? DEFAULT_REPURCHASE_CYCLE_DAYS[family] ?? 120;
    if (dates.length >= 2) {
      let total = 0;
      for (let i = 1; i < dates.length; i += 1) total += (dates[i] as number) - (dates[i - 1] as number);
      const personal = Math.round(total / (dates.length - 1) / DAY_MS);
      if (personal > 0) cycleDays = personal;
    }
    nextPurchaseDueAt[family] = new Date(Date.parse(lastAt) + cycleDays * DAY_MS).toISOString();
  }

  return {
    ordersCount: orders.length,
    totalSpent,
    averageOrderValue: round2(totalSpent / orders.length),
    firstOrderAt: first.placedAt,
    lastOrderAt: last.placedAt,
    averageDaysBetweenOrders,
    nextPurchaseDueAt,
    spentByFamily,
    ordersByFamily,
    lastOrderByFamily,
  };
}

/**
 * Stampanti possedute dedotte dagli acquisti.
 * L'acquisto di una stampante è una prova diretta; il consumabile compatibile
 * è un indizio (`compatibility`), utile per i cluster ma meno affidabile.
 */
export function derivePrinters(orders: Order[]): OwnedPrinter[] {
  const found = new Map<string, OwnedPrinter>();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const brand = item.brand ?? null;
      const models = item.printerModels ?? [];
      if (!brand && models.length === 0) continue;
      const detectedFrom: OwnedPrinter['detectedFrom'] = item.family === 'stampanti' ? 'order' : 'compatibility';
      // Un consumabile di cui non riconosciamo il modello non dice nulla sulla
      // stampante posseduta: solo l'acquisto di una stampante vale da solo.
      if (models.length === 0 && item.family !== 'stampanti') continue;
      for (const model of models.length > 0 ? models : ['']) {
        if (!brand && !model) continue;
        const key = `${(brand ?? '').toLowerCase()}|${model.toLowerCase()}`;
        const existing = found.get(key);
        // Un acquisto diretto sostituisce sempre un indizio da compatibilità.
        if (existing && !(existing.detectedFrom === 'compatibility' && detectedFrom === 'order')) continue;
        found.set(key, {
          brand: brand ?? 'Sconosciuta',
          model: model || 'Modello non identificato',
          detectedFrom,
          detectedAt: order.placedAt,
          compatibleSkus: [item.sku],
        });
      }
    }
  }
  return [...found.values()];
}

/** Fonde le stampanti dedotte con quelle inserite a mano, che hanno la precedenza. */
export function mergePrinters(existing: OwnedPrinter[], derived: OwnedPrinter[]): OwnedPrinter[] {
  const result = new Map<string, OwnedPrinter>();
  for (const printer of derived) {
    result.set(`${printer.brand.toLowerCase()}|${printer.model.toLowerCase()}`, printer);
  }
  for (const printer of existing) {
    const key = `${printer.brand.toLowerCase()}|${printer.model.toLowerCase()}`;
    if (printer.detectedFrom === 'manual' || !result.has(key)) result.set(key, printer);
  }
  return [...result.values()]
    .sort((a, b) => Date.parse(b.detectedAt ?? '') - Date.parse(a.detectedAt ?? ''))
    .slice(0, MAX_PRINTERS);
}

/** Numero di negozi in cui il contatto è presente: usato dai log di sincronizzazione. */
export function storeSourcesOf(contact: Pick<Contact, 'sources'>): StoreSource[] {
  return (contact.sources ?? []).filter(
    (source): source is StoreSource => source === 'prestashop_b2c' || source === 'prestashop_b2b',
  );
}
