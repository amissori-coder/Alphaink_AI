/**
 * Motore di attribuzione degli acquisti.
 *
 * Collega un ordine arrivato dal sito all'email che lo ha generato, così la
 * dashboard può dire quanto fattura ogni newsletter e ogni automazione.
 *
 * =============================================================================
 * COME FUNZIONA
 * =============================================================================
 * Ogni apertura e ogni click producono un `AttributionTouch` (vedi
 * `processor.ts`). Quando arriva un ordine si cercano i tocchi del contatto
 * nelle finestre configurate in `settings/tracking`:
 *
 *   - `clickWindowDays` (default 7)  → quanto indietro vale un click
 *   - `openWindowDays`  (default 2)  → quanto indietro vale un'apertura
 *
 * e si sceglie il tocco secondo il modello:
 *
 *   last_click   l'ultimo click prima dell'ordine
 *   first_click  il primo click della finestra (premia chi ha innescato)
 *   last_open    l'ultimo segnale in assoluto, click o apertura
 *   linear       tutti i tocchi, con peso 1/n (i click hanno la precedenza
 *                sulle aperture: se c'è almeno un click le aperture si ignorano)
 *   coupon       solo il codice sconto emesso da noi
 *
 * Il **coupon batte tutto** quando `couponOverridesModel` è attivo e l'ordine
 * porta un codice che abbiamo emesso: è l'unico segnale deterministico, non
 * probabilistico.
 *
 * =============================================================================
 * GARANZIE
 * =============================================================================
 * - **Idempotenza**: l'ordine viene "prenotato" in transazione. Se un altro
 *   processo lo ha già attribuito, la seconda esecuzione esce senza toccare i
 *   contatori. Ciò rende innocua la doppia chiamata da `onOrderWritten`
 *   (modulo automazioni) e da `onOrderAttributionWritten` (qui).
 * - **Tocchi consumati**: un tocco attribuito a un ordine non viene riusato per
 *   un altro, così due acquisti ravvicinati non raddoppiano il merito della
 *   stessa email.
 * - **Reso e annullamento**: `revokeAttribution` sottrae il fatturato quando
 *   `subtractRefunds` è attivo e riporta il destinatario allo stato precedente.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { EMPTY_STATS, normalizeEmail } from '@alphaink/shared';
import type {
  AttributionModel,
  AttributionSettings,
  AttributionTouch,
  IssuedCoupon,
  Newsletter,
  Order,
  OrderAttribution,
  RecipientStatus,
} from '@alphaink/shared';

import { LIGHT_RUNTIME, REGION } from '../lib/config';
import { FieldValue, col, db, logActivity, nowIso, serializeDoc, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { findRecipientInNewsletter, statsPatch } from './processor';
import { readAttributionSettings } from './settings';

const log = createLogger('tracking.attribution');

/** Tocchi caricati al massimo per finestra: oltre è rumore. */
const MAX_TOUCHES = 50;

export interface AttributionOutcome {
  orderId: string;
  attributed: boolean;
  model: AttributionModel | null;
  /** Numero di tocchi che hanno ricevuto merito. */
  touches: number;
  /** Fatturato complessivamente attribuito. */
  revenue: number;
  /** Motivo per cui non è stato attribuito nulla. */
  reason: string | null;
}

function outcome(orderId: string, reason: string): AttributionOutcome {
  return { orderId, attributed: false, model: null, touches: 0, revenue: 0, reason };
}

// -----------------------------------------------------------------------------
// Fatturato attribuibile
// -----------------------------------------------------------------------------

/** Valore dell'ordine al netto dei resi, se le impostazioni lo richiedono. */
export function attributableRevenue(order: Order, settings: AttributionSettings): number {
  const total = Number(order.total ?? 0);
  const refunded = settings.subtractRefunds ? Number(order.refundedAmount ?? 0) : 0;
  return Math.max(0, Math.round((total - refunded) * 100) / 100);
}

// -----------------------------------------------------------------------------
// Tocchi
// -----------------------------------------------------------------------------

interface TouchQuery {
  contactId: string | null;
  email: string;
  touchType: 'open' | 'click';
  from: string;
  to: string;
}

/** Carica i tocchi utili di un contatto nella finestra indicata. */
export async function loadTouches(query: TouchQuery): Promise<AttributionTouch[]> {
  if (Date.parse(query.from) >= Date.parse(query.to)) return [];

  let snapshot: FirebaseFirestore.QuerySnapshot;
  if (query.contactId) {
    snapshot = await col
      .attributionTouches()
      .where('contactId', '==', query.contactId)
      .where('touchType', '==', query.touchType)
      .where('occurredAt', '>=', query.from)
      .where('occurredAt', '<=', query.to)
      .orderBy('occurredAt', 'desc')
      .limit(MAX_TOUCHES)
      .get();
  } else if (query.email) {
    // Contatto non ancora in rubrica: si ripiega sull'indice per email.
    snapshot = await col
      .attributionTouches()
      .where('email', '==', query.email)
      .where('occurredAt', '>=', query.from)
      .where('occurredAt', '<=', query.to)
      .orderBy('occurredAt', 'desc')
      .limit(MAX_TOUCHES * 2)
      .get();
  } else {
    return [];
  }

  return snapshot.docs
    .map((doc) => withId<AttributionTouch>(doc))
    .filter((touch) => touch.touchType === query.touchType);
}

/** Un tocco già assegnato a un altro ordine non può essere riusato. */
function isAvailable(touch: AttributionTouch, orderId: string): boolean {
  return !touch.attributedOrderId || touch.attributedOrderId === orderId;
}

/** Il tocco punta davvero a un invio nostro? */
function hasTarget(touch: AttributionTouch): boolean {
  return Boolean(touch.newsletterId || touch.automationId);
}

export interface TouchSelection {
  touches: AttributionTouch[];
  weights: number[];
}

/** Applica il modello di attribuzione ai tocchi disponibili. */
export function selectTouches(
  model: AttributionModel,
  clicks: AttributionTouch[],
  opens: AttributionTouch[],
): TouchSelection {
  // Gli elenchi arrivano ordinati dal più recente al più vecchio.
  const byRecent = (list: AttributionTouch[]): AttributionTouch[] =>
    [...list].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const sortedClicks = byRecent(clicks);
  const sortedOpens = byRecent(opens);

  switch (model) {
    case 'last_click': {
      const touch = sortedClicks[0];
      return touch ? { touches: [touch], weights: [1] } : { touches: [], weights: [] };
    }
    case 'first_click': {
      const touch = sortedClicks[sortedClicks.length - 1];
      return touch ? { touches: [touch], weights: [1] } : { touches: [], weights: [] };
    }
    case 'last_open': {
      const touch = byRecent([...sortedClicks, ...sortedOpens])[0];
      return touch ? { touches: [touch], weights: [1] } : { touches: [], weights: [] };
    }
    case 'linear': {
      const pool = sortedClicks.length > 0 ? sortedClicks : sortedOpens;
      if (pool.length === 0) return { touches: [], weights: [] };
      const weight = Math.round((1 / pool.length) * 10_000) / 10_000;
      return { touches: pool, weights: pool.map(() => weight) };
    }
    case 'coupon':
    default:
      return { touches: [], weights: [] };
  }
}

// -----------------------------------------------------------------------------
// Coupon
// -----------------------------------------------------------------------------

/** Coupon emesso dalla piattaforma corrispondente al codice dell'ordine. */
export async function findIssuedCoupon(code: string | null | undefined): Promise<IssuedCoupon | null> {
  const value = (code ?? '').trim();
  if (!value) return null;

  const variants = Array.from(new Set([value, value.toUpperCase(), value.toLowerCase()]));
  for (const candidate of variants) {
    const snapshot = await col.coupons().where('code', '==', candidate).limit(1).get();
    if (!snapshot.empty) return withId<IssuedCoupon>(snapshot.docs[0]!);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Costruzione delle attribuzioni
// -----------------------------------------------------------------------------

function hoursBetween(from: string, to: string): number | null {
  const delta = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(delta)) return null;
  return Math.round((delta / 3_600_000) * 10) / 10;
}

function attributionFromTouch(
  touch: AttributionTouch,
  order: Order,
  model: AttributionModel,
  weight: number,
  revenue: number,
): OrderAttribution {
  return {
    model,
    weight,
    newsletterId: touch.newsletterId ?? null,
    automationId: touch.automationId ?? null,
    automationRunId: touch.automationRunId ?? null,
    variantId: touch.variantId ?? null,
    touchId: touch.id,
    touchAt: touch.occurredAt,
    hoursToConversion: hoursBetween(touch.occurredAt, order.placedAt),
    couponCode: order.couponCode ?? null,
    utm: order.utm ?? null,
    attributedRevenue: Math.round(revenue * weight * 100) / 100,
    attributedAt: nowIso(),
  };
}

function attributionFromCoupon(
  coupon: IssuedCoupon,
  order: Order,
  revenue: number,
): OrderAttribution {
  return {
    model: 'coupon',
    weight: 1,
    newsletterId: coupon.newsletterId ?? null,
    automationId: coupon.automationId ?? null,
    automationRunId: coupon.automationRunId ?? null,
    variantId: null,
    touchId: null,
    touchAt: coupon.issuedAt,
    hoursToConversion: hoursBetween(coupon.issuedAt, order.placedAt),
    couponCode: coupon.code,
    utm: order.utm ?? null,
    attributedRevenue: revenue,
    attributedAt: nowIso(),
  };
}

// -----------------------------------------------------------------------------
// Applicazione degli effetti
// -----------------------------------------------------------------------------

/** Stato a cui torna un destinatario quando la conversione viene revocata. */
function statusWithoutConversion(data: Record<string, unknown>): RecipientStatus {
  if (data.unsubscribedAt) return 'unsubscribed';
  if (data.firstClickedAt) return 'clicked';
  if (data.firstOpenedAt) return 'opened';
  if (data.deliveredAt) return 'delivered';
  if (data.sentAt) return 'sent';
  return 'pending';
}

/**
 * Somma (o sottrae) ordini e fatturato su newsletter/automazione e sul
 * destinatario corrispondente.
 *
 * `sign` vale +1 in attribuzione e -1 in revoca.
 */
async function applyConversion(
  attribution: OrderAttribution,
  order: Order,
  sign: 1 | -1,
): Promise<void> {
  const revenue = Math.round(attribution.attributedRevenue * sign * 100) / 100;
  const orders = sign;

  if (attribution.newsletterId) {
    const newsletterRef = col.newsletters().doc(attribution.newsletterId);
    const recipientRef = await findRecipientInNewsletter(
      attribution.newsletterId,
      order.contactId ?? null,
      normalizeEmail(order.emailNormalized || order.email),
    );

    await db.runTransaction(async (tx) => {
      const newsletterSnap = await tx.get(newsletterRef);
      const recipientSnap = recipientRef ? await tx.get(recipientRef) : null;
      if (!newsletterSnap.exists) return;

      const newsletter = withId<Newsletter>(newsletterSnap);
      const patch = statsPatch({ ...EMPTY_STATS, ...(newsletter.stats ?? {}) }, { orders, revenue });
      // `update`: la patch usa i percorsi puntati, che `set` scriverebbe come
      // nomi di campo letterali.
      if (Object.keys(patch).length > 0) tx.update(newsletterRef, patch);

      if (recipientSnap?.exists) {
        const data = serializeDoc<Record<string, unknown>>(recipientSnap.data() ?? {});
        tx.set(
          recipientSnap.ref,
          sign > 0
            ? {
                status: 'converted',
                convertedOrderId: order.id,
                convertedAt: order.placedAt,
                revenue: attribution.attributedRevenue,
                updatedAt: nowIso(),
              }
            : {
                status: statusWithoutConversion(data),
                convertedOrderId: null,
                convertedAt: null,
                revenue: null,
                updatedAt: nowIso(),
              },
          { merge: true },
        );
      }
    });
    return;
  }

  if (attribution.automationId) {
    const automationRef = col.automations().doc(attribution.automationId);
    const runRef = attribution.automationRunId
      ? col.automationRuns(attribution.automationId).doc(attribution.automationRunId)
      : null;

    await db.runTransaction(async (tx) => {
      const automationSnap = await tx.get(automationRef);
      const runSnap = runRef ? await tx.get(runRef) : null;
      if (!automationSnap.exists) return;

      const patch: Record<string, unknown> = {
        'stats.orders': FieldValue.increment(orders),
        'stats.revenue': FieldValue.increment(revenue),
        'stats.updatedAt': nowIso(),
        updatedAt: nowIso(),
      };

      // Statistiche dello step: l'array va riscritto per intero.
      const steps = (automationSnap.get('steps') as Array<Record<string, unknown>> | undefined) ?? [];
      const stepId = (runSnap?.get('stepId') as string | undefined) ?? null;
      if (stepId && steps.length > 0) {
        patch.steps = steps.map((step) => {
          if (step.id !== stepId) return step;
          const stats = (step.stats as Record<string, number> | undefined) ?? {};
          return {
            ...step,
            stats: {
              ...stats,
              orders: Number(stats.orders ?? 0) + orders,
              revenue: Math.round((Number(stats.revenue ?? 0) + revenue) * 100) / 100,
            },
          };
        });
      }
      tx.update(automationRef, patch);

      if (runSnap?.exists) {
        tx.set(
          runSnap.ref,
          sign > 0
            ? {
                convertedOrderId: order.id,
                convertedAt: order.placedAt,
                revenue: attribution.attributedRevenue,
              }
            : { convertedOrderId: null, convertedAt: null, revenue: null },
          { merge: true },
        );
      }
    });
  }
}

/** Marca (o libera) i tocchi usati per l'attribuzione. */
async function markTouches(
  touchIds: string[],
  orderId: string | null,
): Promise<void> {
  if (touchIds.length === 0) return;
  const batch = db.batch();
  for (const id of touchIds) {
    batch.set(
      col.attributionTouches().doc(id),
      { attributedOrderId: orderId, attributedAt: orderId ? nowIso() : null },
      { merge: true },
    );
  }
  await batch.commit();
}

/** Segna il coupon come utilizzato (o annulla il riscatto in revoca). */
async function markCoupon(
  coupon: IssuedCoupon,
  order: Order | null,
  amount: number,
): Promise<void> {
  await col
    .coupons()
    .doc(coupon.id)
    .set(
      order
        ? { redeemedAt: order.placedAt, redeemedOrderId: order.id, redeemedAmount: amount, updatedAt: nowIso() }
        : { redeemedAt: null, redeemedOrderId: null, redeemedAmount: null, updatedAt: nowIso() },
      { merge: true },
    );
}

// -----------------------------------------------------------------------------
// attributeOrder
// -----------------------------------------------------------------------------

export interface AttributeOrderOptions {
  /** Ri-attribuisce anche un ordine già attribuito (prima lo revoca). */
  force?: boolean;
}

/**
 * Attribuisce un ordine alla newsletter o all'automazione che lo ha generato.
 * Non lancia in caso di ordine non attribuibile: restituisce il motivo.
 */
export async function attributeOrder(
  order: Order,
  options: AttributeOrderOptions = {},
): Promise<AttributionOutcome> {
  const settings = await readAttributionSettings();

  if (!settings.countStatuses.includes(order.status)) {
    return outcome(order.id, 'stato_non_conteggiato');
  }
  if (order.attribution && !options.force) {
    return outcome(order.id, 'gia_attribuito');
  }
  if (order.attribution && options.force) {
    await revokeAttribution(order);
  }

  const revenue = attributableRevenue(order, settings);
  const email = normalizeEmail(order.emailNormalized || order.email || '');

  let contactId = order.contactId ?? null;
  if (!contactId && email) {
    const snapshot = await col.contacts().where('emailNormalized', '==', email).limit(1).get();
    contactId = snapshot.empty ? null : snapshot.docs[0]!.id;
  }

  // 1. Coupon: segnale deterministico, ha la precedenza se configurato.
  let coupon: IssuedCoupon | null = null;
  if (order.couponCode && (settings.couponOverridesModel || settings.model === 'coupon')) {
    coupon = await findIssuedCoupon(order.couponCode);
  }

  let attributions: OrderAttribution[] = [];
  let touchIds: string[] = [];

  if (coupon && (coupon.newsletterId || coupon.automationId)) {
    attributions = [attributionFromCoupon(coupon, order, revenue)];
  } else if (settings.model !== 'coupon') {
    // 2. Tocchi nelle rispettive finestre.
    const placedAtMs = Date.parse(order.placedAt);
    const to = Number.isFinite(placedAtMs) ? new Date(placedAtMs).toISOString() : nowIso();
    const toMs = Date.parse(to);

    const [clicks, opens] = await Promise.all([
      loadTouches({
        contactId,
        email,
        touchType: 'click',
        from: new Date(toMs - settings.clickWindowDays * 86_400_000).toISOString(),
        to,
      }),
      settings.openWindowDays > 0
        ? loadTouches({
            contactId,
            email,
            touchType: 'open',
            from: new Date(toMs - settings.openWindowDays * 86_400_000).toISOString(),
            to,
          })
        : Promise.resolve<AttributionTouch[]>([]),
    ]);

    const usableClicks = clicks.filter((touch) => hasTarget(touch) && isAvailable(touch, order.id));
    const usableOpens = opens.filter((touch) => hasTarget(touch) && isAvailable(touch, order.id));

    const selection = selectTouches(settings.model, usableClicks, usableOpens);
    attributions = selection.touches.map((touch, index) =>
      attributionFromTouch(touch, order, settings.model, selection.weights[index] ?? 1, revenue),
    );
    touchIds = selection.touches.map((touch) => touch.id);
  }

  if (attributions.length === 0) {
    return outcome(order.id, coupon ? 'coupon_senza_origine' : 'nessun_tocco_in_finestra');
  }

  // Il tocco più recente rappresenta l'ordine nelle query indicizzate
  // (`attribution.newsletterId`), anche nel modello lineare.
  const primary = [...attributions].sort(
    (a, b) => Date.parse(b.touchAt ?? '') - Date.parse(a.touchAt ?? ''),
  )[0]!;

  // 3. Prenotazione dell'ordine: chi arriva secondo non conteggia nulla.
  const claimed = await db.runTransaction(async (tx) => {
    const ref = col.orders().doc(order.id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return false;
    if (snapshot.get('attribution') && !options.force) return false;

    tx.set(
      ref,
      {
        attribution: primary,
        attributions,
        attributionRevokedAt: null,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
    return true;
  });

  if (!claimed) return outcome(order.id, 'gia_attribuito');

  // 4. Effetti collaterali: contatori, destinatari, tocchi, coupon.
  for (const attribution of attributions) {
    await applyConversion(attribution, order, 1);
  }
  await markTouches(touchIds, order.id);
  if (coupon) await markCoupon(coupon, order, revenue);

  const total = attributions.reduce((sum, item) => sum + item.attributedRevenue, 0);
  log.info('Ordine attribuito', {
    orderId: order.id,
    model: primary.model,
    newsletterId: primary.newsletterId,
    automationId: primary.automationId,
    revenue: total,
  });

  return {
    orderId: order.id,
    attributed: true,
    model: primary.model,
    touches: attributions.length,
    revenue: Math.round(total * 100) / 100,
    reason: null,
  };
}

// -----------------------------------------------------------------------------
// revokeAttribution
// -----------------------------------------------------------------------------

/**
 * Annulla l'attribuzione di un ordine (annullamento, reso, cambio di stato).
 *
 * Ordini e fatturato vengono sempre sottratti: l'ordine non è più valido e
 * lasciarne traccia nei contatori li renderebbe incoerenti con il ricalcolo da
 * `recipients`, che è la fonte di verità. L'impostazione `subtractRefunds`
 * governa invece i **resi parziali**, gestiti da `adjustAttributedRevenue`.
 */
export async function revokeAttribution(order: Order): Promise<AttributionOutcome> {
  const existing = order.attributions?.length
    ? order.attributions
    : order.attribution
      ? [order.attribution]
      : [];

  if (existing.length === 0) return outcome(order.id, 'nessuna_attribuzione');

  // Rilascio della prenotazione: se qualcun altro l'ha già revocata, si esce.
  const released = await db.runTransaction(async (tx) => {
    const ref = col.orders().doc(order.id);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || !snapshot.get('attribution')) return false;
    tx.set(
      ref,
      { attribution: null, attributions: [], attributionRevokedAt: nowIso(), updatedAt: nowIso() },
      { merge: true },
    );
    return true;
  });

  if (!released) return outcome(order.id, 'gia_revocata');

  for (const attribution of existing) {
    await applyConversion(attribution, order, -1);
  }

  await markTouches(
    existing.map((attribution) => attribution.touchId).filter((id): id is string => Boolean(id)),
    null,
  );

  const coupon = order.couponCode ? await findIssuedCoupon(order.couponCode) : null;
  if (coupon && coupon.redeemedOrderId === order.id) await markCoupon(coupon, null, 0);

  const total = existing.reduce((sum, item) => sum + item.attributedRevenue, 0);
  log.info('Attribuzione revocata', { orderId: order.id, revenue: total, status: order.status });
  await logActivity({
    action: 'attribution.revoked',
    entityType: 'order',
    entityId: order.id,
    summary: `Attribuzione revocata per l'ordine ${order.orderNumber ?? order.externalId}`,
    metadata: { status: order.status, revenue: total },
  });

  return {
    orderId: order.id,
    attributed: false,
    model: existing[0]?.model ?? null,
    touches: existing.length,
    revenue: -Math.round(total * 100) / 100,
    reason: 'revocata',
  };
}

// -----------------------------------------------------------------------------
// Adeguamento del fatturato (resi parziali)
// -----------------------------------------------------------------------------

/**
 * Aggiorna il fatturato attribuito quando cambia l'importo rimborsato senza
 * che l'ordine cambi stato (reso parziale).
 */
export async function adjustAttributedRevenue(order: Order): Promise<AttributionOutcome> {
  const settings = await readAttributionSettings();
  if (!settings.subtractRefunds) return outcome(order.id, 'resi_non_sottratti');

  const existing = order.attributions?.length
    ? order.attributions
    : order.attribution
      ? [order.attribution]
      : [];
  if (existing.length === 0) return outcome(order.id, 'nessuna_attribuzione');

  const revenue = attributableRevenue(order, settings);
  const updated = existing.map((attribution) => ({
    ...attribution,
    attributedRevenue: Math.round(revenue * attribution.weight * 100) / 100,
  }));

  const deltas = updated.map(
    (attribution, index) =>
      Math.round((attribution.attributedRevenue - (existing[index]?.attributedRevenue ?? 0)) * 100) / 100,
  );
  if (deltas.every((delta) => delta === 0)) return outcome(order.id, 'nessuna_variazione');

  const primary = [...updated].sort(
    (a, b) => Date.parse(b.touchAt ?? '') - Date.parse(a.touchAt ?? ''),
  )[0]!;

  await col
    .orders()
    .doc(order.id)
    .set({ attribution: primary, attributions: updated, updatedAt: nowIso() }, { merge: true });

  for (let index = 0; index < updated.length; index += 1) {
    const delta = deltas[index] ?? 0;
    if (delta === 0) continue;
    // Si riusa `applyConversion` con un'attribuzione "solo delta": gli ordini
    // non cambiano (0), cambia solo il fatturato.
    const attribution = updated[index]!;
    await applyRevenueDelta(attribution, order, delta);
  }

  const total = updated.reduce((sum, item) => sum + item.attributedRevenue, 0);
  return {
    orderId: order.id,
    attributed: true,
    model: primary.model,
    touches: updated.length,
    revenue: Math.round(total * 100) / 100,
    reason: 'aggiornata',
  };
}

/** Somma solo il fatturato (senza toccare il conteggio ordini). */
async function applyRevenueDelta(
  attribution: OrderAttribution,
  order: Order,
  delta: number,
): Promise<void> {
  if (attribution.newsletterId) {
    const ref = col.newsletters().doc(attribution.newsletterId);
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return;
      const newsletter = withId<Newsletter>(snapshot);
      const patch = statsPatch({ ...EMPTY_STATS, ...(newsletter.stats ?? {}) }, { revenue: delta });
      if (Object.keys(patch).length > 0) tx.update(ref, patch);
    });

    const recipientRef = await findRecipientInNewsletter(
      attribution.newsletterId,
      order.contactId ?? null,
      normalizeEmail(order.emailNormalized || order.email),
    );
    if (recipientRef) {
      await recipientRef.set(
        { revenue: attribution.attributedRevenue, updatedAt: nowIso() },
        { merge: true },
      );
    }
    return;
  }

  if (attribution.automationId) {
    try {
      // `update` e non `set`: i percorsi puntati devono restare annidati.
      await col
        .automations()
        .doc(attribution.automationId)
        .update({ 'stats.revenue': FieldValue.increment(delta), 'stats.updatedAt': nowIso(), updatedAt: nowIso() });
    } catch (error) {
      log.error('Aggiornamento fatturato automazione fallito', error, {
        automationId: attribution.automationId,
      });
    }
    if (attribution.automationRunId) {
      await col
        .automationRuns(attribution.automationId)
        .doc(attribution.automationRunId)
        .set({ revenue: attribution.attributedRevenue }, { merge: true });
    }
  }
}

// -----------------------------------------------------------------------------
// Reazione alle scritture sugli ordini
// -----------------------------------------------------------------------------

/**
 * Decide cosa fare quando un ordine viene creato, aggiornato o eliminato.
 *
 * Esposta separatamente dal trigger perché anche il modulo automazioni, che
 * possiede `onOrderWritten`, possa richiamarla senza duplicare la logica.
 * Chiamarla due volte sullo stesso ordine è innocuo.
 */
export async function handleOrderAttribution(
  before: Order | null,
  after: Order | null,
): Promise<AttributionOutcome | null> {
  if (!after) {
    if (before?.attribution) return revokeAttribution(before);
    return null;
  }

  const settings = await readAttributionSettings();
  const countable = settings.countStatuses.includes(after.status);
  const attributed = Boolean(after.attribution);

  if (countable && !attributed) return attributeOrder(after);
  if (!countable && attributed) return revokeAttribution(after);

  if (countable && attributed) {
    const refundChanged = Number(before?.refundedAmount ?? 0) !== Number(after.refundedAmount ?? 0);
    const totalChanged = Number(before?.total ?? 0) !== Number(after.total ?? 0);
    if (refundChanged || totalChanged) return adjustAttributedRevenue(after);
  }

  return null;
}

/** Converte lo snapshot Firestore in un `Order` serializzato. */
function toOrder(snapshot: DocumentSnapshot | undefined): Order | null {
  if (!snapshot?.exists) return null;
  return withId<Order>(snapshot);
}

/**
 * Trigger autonomo sugli ordini.
 *
 * ATTENZIONE: **non è esportato da `index.ts` e quindi non viene distribuito**.
 * Due trigger sullo stesso documento `orders/{orderId}` raddoppierebbero le
 * invocazioni, perciò l'attribuzione gira dentro `onOrderWritten` (modulo
 * automazioni), che chiama `handleOrderAttribution`. Questa definizione resta
 * come alternativa pronta all'uso: basta esportarla da `index.ts` (e togliere
 * la chiamata da `onOrderWritten`) per riportare l'attribuzione su un trigger
 * indipendente dalle automazioni.
 */
export const onOrderAttributionWritten = onDocumentWritten(
  { document: 'orders/{orderId}', region: REGION, memory: LIGHT_RUNTIME.memory, retry: false },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { orderId: string }>) => {
    const before = toOrder(event.data?.before);
    const after = toOrder(event.data?.after);

    // Scrittura generata da noi stessi (solo l'attribuzione è cambiata):
    // niente da fare, si evita il ciclo infinito.
    if (before && after && sameOrderForAttribution(before, after)) return;

    try {
      const result = await handleOrderAttribution(before, after);
      if (result?.attributed) {
        log.debug('Attribuzione applicata dal trigger', { orderId: result.orderId, model: result.model });
      }
    } catch (error) {
      log.error('Attribuzione ordine fallita', error, { orderId: event.params.orderId });
    }
  },
);

/** Vero se, ai fini dell'attribuzione, l'ordine non è cambiato. */
export function sameOrderForAttribution(before: Order, after: Order): boolean {
  return (
    before.status === after.status &&
    Number(before.total ?? 0) === Number(after.total ?? 0) &&
    Number(before.refundedAmount ?? 0) === Number(after.refundedAmount ?? 0) &&
    (before.couponCode ?? null) === (after.couponCode ?? null) &&
    (before.contactId ?? null) === (after.contactId ?? null)
  );
}
