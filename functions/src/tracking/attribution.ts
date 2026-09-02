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
 * - **Un ordine è un ordine**: i pesi del modello multi-touch ripartiscono
 *   ordine e fatturato fra gli invii coinvolti (le attribuzioni si raggruppano
 *   per destinazione prima di toccare i contatori) e la somma delle quote di
 *   fatturato è esattamente il valore attribuibile dell'ordine.
 * - **Più acquisti per destinatario**: le conversioni vivono in un elenco sul
 *   destinatario (`conversions`), da cui `recomputeNewsletterStats` ricostruisce
 *   ordini e fatturato: la riconciliazione oraria e l'attribuzione dicono la
 *   stessa cosa anche quando lo stesso contatto compra due volte.
 * - **Reso e annullamento**: `revokeAttribution` sottrae il fatturato quando
 *   `subtractRefunds` è attivo e cancella dal destinatario **solo** la
 *   conversione dell'ordine revocato, senza mai portare i contatori sotto zero.
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
import {
  conversionsPatch,
  findRecipientInNewsletter,
  readRecipientConversions,
  statsPatch,
} from './processor';
import type { RecipientConversion } from './processor';
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

/**
 * Divide un importo secondo i pesi indicati, al centesimo.
 *
 * L'ultima quota assorbe il resto: arrotondando ogni quota per conto suo la
 * somma si scosta dal totale (con sette tocchi 0,1429 × 7 = 1,0003) e la
 * newsletter incasserebbe più del valore dell'ordine. Così la somma delle quote
 * è esattamente l'importo attribuibile, qualunque sia il numero di tocchi.
 */
export function distributeAmount(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const cents = Math.round(total * 100);
  const shares: number[] = [];
  let assigned = 0;

  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      shares.push(Math.max(0, cents - assigned) / 100);
      return;
    }
    const share = Math.max(0, Math.round(cents * (Number.isFinite(weight) ? weight : 0)));
    assigned += share;
    shares.push(share / 100);
  });

  return shares;
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
      const weights = pool.map(() => weight);
      // L'ultimo peso assorbe il resto dell'arrotondamento: la somma deve
      // restare esattamente 1, altrimenti un ordine varrebbe più di se stesso.
      weights[weights.length - 1] = Math.round((1 - weight * (pool.length - 1)) * 10_000) / 10_000;
      return { touches: pool, weights };
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
  attributedRevenue: number,
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
    attributedRevenue: Math.round(attributedRevenue * 100) / 100,
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
 * Destinazione su cui ricadono ordini e fatturato di una o più attribuzioni.
 *
 * `weight` è la quota di ordine spettante all'invio: nel modello lineare i pesi
 * dei tocchi si sommano qui, così la stessa newsletter non riceve un ordine per
 * ogni click ricevuto.
 */
export interface ConversionTarget {
  newsletterId: string | null;
  automationId: string | null;
  automationRunId: string | null;
  weight: number;
  revenue: number;
}

/** Chiave di raggruppamento di una destinazione. */
function targetKey(target: ConversionTarget): string {
  return target.newsletterId
    ? `n:${target.newsletterId}`
    : `a:${target.automationId ?? '-'}:${target.automationRunId ?? '-'}`;
}

/**
 * Raggruppa le attribuzioni di un ordine per invio di destinazione.
 *
 * Un ordine è **un** ordine: i pesi del modello multi-touch lo ripartiscono fra
 * gli invii, non lo moltiplicano. Senza il raggruppamento tre click sulla stessa
 * newsletter le farebbero contare tre ordini (e la riconciliazione, che conta i
 * destinatari, direbbe il contrario).
 */
export function groupByTarget(attributions: OrderAttribution[]): ConversionTarget[] {
  const groups = new Map<string, ConversionTarget>();

  for (const attribution of attributions) {
    const newsletterId = attribution.newsletterId ?? null;
    const automationId = newsletterId ? null : (attribution.automationId ?? null);
    if (!newsletterId && !automationId) continue;

    const parsedWeight = Number(attribution.weight);
    const weight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 1;
    const revenue = Number(attribution.attributedRevenue ?? 0);
    const target: ConversionTarget = {
      newsletterId,
      automationId,
      automationRunId: newsletterId ? null : (attribution.automationRunId ?? null),
      weight,
      revenue,
    };

    const existing = groups.get(targetKey(target));
    if (!existing) {
      groups.set(targetKey(target), target);
      continue;
    }
    existing.weight = Math.round((existing.weight + weight) * 10_000) / 10_000;
    existing.revenue = Math.round((existing.revenue + revenue) * 100) / 100;
  }

  return [...groups.values()];
}

/**
 * Delta da applicare ai contatori aggregati.
 *
 * In revoca la sottrazione è limitata a quanto risulta effettivamente
 * conteggiato: la revoca può arrivare dopo un ricalcolo che non aveva visto la
 * conversione (destinatario non trovato, email diversa da quella dell'invio) e
 * un `increment` negativo lascerebbe ordini e fatturato sotto zero.
 */
function conversionDelta(
  current: { orders: number; revenue: number },
  target: ConversionTarget,
  sign: 1 | -1,
): { orders: number; revenue: number } {
  if (sign > 0) {
    return {
      orders: Math.round(target.weight * 10_000) / 10_000,
      revenue: Math.round(target.revenue * 100) / 100,
    };
  }
  const orders = Math.min(Math.max(0, Number(current.orders ?? 0)), target.weight);
  const revenue = Math.min(Math.max(0, Number(current.revenue ?? 0)), target.revenue);
  return {
    orders: -(Math.round(orders * 10_000) / 10_000),
    revenue: -(Math.round(revenue * 100) / 100),
  };
}

/** Elenco delle conversioni dopo l'aggiunta o la rimozione di questo ordine. */
function nextConversions(
  current: RecipientConversion[],
  order: Order,
  target: ConversionTarget,
  sign: 1 | -1,
): RecipientConversion[] {
  // Si toglie sempre la conversione di **questo** ordine (e solo quella): in
  // aggiunta perché una ri-attribuzione forzata non la duplichi, in revoca
  // perché gli altri acquisti dello stesso destinatario restino intatti.
  const others = current.filter((conversion) => conversion.orderId !== order.id);
  if (sign < 0) return others;
  return [
    ...others,
    { orderId: order.id, at: order.placedAt, revenue: target.revenue, weight: target.weight },
  ];
}

/**
 * Somma (o sottrae) ordini e fatturato su newsletter/automazione e sul
 * destinatario corrispondente.
 *
 * `sign` vale +1 in attribuzione e -1 in revoca.
 */
async function applyConversion(
  target: ConversionTarget,
  order: Order,
  sign: 1 | -1,
): Promise<void> {
  if (target.newsletterId) {
    const newsletterRef = col.newsletters().doc(target.newsletterId);
    const recipientRef = await findRecipientInNewsletter(
      target.newsletterId,
      order.contactId ?? null,
      normalizeEmail(order.emailNormalized || order.email),
    );

    await db.runTransaction(async (tx) => {
      const newsletterSnap = await tx.get(newsletterRef);
      const recipientSnap = recipientRef ? await tx.get(recipientRef) : null;
      if (!newsletterSnap.exists) return;

      const newsletter = withId<Newsletter>(newsletterSnap);
      const stats = { ...EMPTY_STATS, ...(newsletter.stats ?? {}) };
      const patch = statsPatch(stats, conversionDelta(stats, target, sign));
      // `update`: la patch usa i percorsi puntati, che `set` scriverebbe come
      // nomi di campo letterali.
      if (Object.keys(patch).length > 0) tx.update(newsletterRef, patch);

      if (recipientSnap?.exists) {
        const data = serializeDoc<Record<string, unknown>>(recipientSnap.data() ?? {});
        const conversions = nextConversions(readRecipientConversions(data), order, target, sign);
        tx.set(
          recipientSnap.ref,
          {
            ...conversionsPatch(conversions),
            // Il destinatario resta "convertito" finché almeno un ordine è
            // ancora attribuito a questo invio.
            status: conversions.length > 0 ? 'converted' : statusWithoutConversion(data),
            updatedAt: nowIso(),
          },
          { merge: true },
        );
      }
    });
    return;
  }

  if (target.automationId) {
    const automationId = target.automationId;
    const automationRef = col.automations().doc(automationId);
    const runRef = target.automationRunId
      ? col.automationRuns(automationId).doc(target.automationRunId)
      : null;

    await db.runTransaction(async (tx) => {
      const automationSnap = await tx.get(automationRef);
      const runSnap = runRef ? await tx.get(runRef) : null;
      if (!automationSnap.exists) return;

      const current = (automationSnap.get('stats') as { orders?: number; revenue?: number } | undefined) ?? {};
      const delta = conversionDelta(
        { orders: Number(current.orders ?? 0), revenue: Number(current.revenue ?? 0) },
        target,
        sign,
      );

      const patch: Record<string, unknown> = {
        'stats.updatedAt': nowIso(),
        updatedAt: nowIso(),
      };
      if (delta.orders !== 0) patch['stats.orders'] = FieldValue.increment(delta.orders);
      if (delta.revenue !== 0) patch['stats.revenue'] = FieldValue.increment(delta.revenue);

      // Statistiche dello step: l'array va riscritto per intero.
      const steps = (automationSnap.get('steps') as Array<Record<string, unknown>> | undefined) ?? [];
      const stepId = (runSnap?.get('stepId') as string | undefined) ?? null;
      if (stepId && steps.length > 0 && (delta.orders !== 0 || delta.revenue !== 0)) {
        patch.steps = steps.map((step) => {
          if (step.id !== stepId) return step;
          const stats = (step.stats as Record<string, number> | undefined) ?? {};
          return {
            ...step,
            stats: {
              ...stats,
              // Stesso principio dei contatori aggregati: mai sotto zero.
              orders: Math.max(0, Math.round((Number(stats.orders ?? 0) + delta.orders) * 10_000) / 10_000),
              revenue: Math.max(0, Math.round((Number(stats.revenue ?? 0) + delta.revenue) * 100) / 100),
            },
          };
        });
      }
      tx.update(automationRef, patch);

      if (runSnap?.exists) {
        const data = serializeDoc<Record<string, unknown>>(runSnap.data() ?? {});
        const conversions = nextConversions(readRecipientConversions(data), order, target, sign);
        tx.set(runSnap.ref, conversionsPatch(conversions), { merge: true });
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
    const shares = distributeAmount(revenue, selection.weights);
    attributions = selection.touches.map((touch, index) =>
      attributionFromTouch(
        touch,
        order,
        settings.model,
        selection.weights[index] ?? 1,
        shares[index] ?? 0,
      ),
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
  // Le attribuzioni si raggruppano per invio: più tocchi sulla stessa
  // newsletter valgono un ordine solo, ripartito.
  for (const target of groupByTarget(attributions)) {
    await applyConversion(target, order, 1);
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

  for (const target of groupByTarget(existing)) {
    await applyConversion(target, order, -1);
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
  // Stessa ripartizione dell'attribuzione iniziale: le quote sommate restano
  // esattamente il fatturato attribuibile dopo il reso.
  const shares = distributeAmount(
    revenue,
    existing.map((attribution) => Number(attribution.weight ?? 0)),
  );
  const updated = existing.map((attribution, index) => ({
    ...attribution,
    attributedRevenue: shares[index] ?? 0,
  }));

  const changed = updated.some(
    (attribution, index) => attribution.attributedRevenue !== (existing[index]?.attributedRevenue ?? 0),
  );
  if (!changed) return outcome(order.id, 'nessuna_variazione');

  const primary = [...updated].sort(
    (a, b) => Date.parse(b.touchAt ?? '') - Date.parse(a.touchAt ?? ''),
  )[0]!;

  await col
    .orders()
    .doc(order.id)
    .set({ attribution: primary, attributions: updated, updatedAt: nowIso() }, { merge: true });

  // Il delta si calcola per invio di destinazione, non per tocco: altrimenti
  // una newsletter con tre tocchi riceverebbe tre volte la stessa correzione.
  const before = new Map(groupByTarget(existing).map((target) => [targetKey(target), target]));
  for (const target of groupByTarget(updated)) {
    const delta = Math.round((target.revenue - (before.get(targetKey(target))?.revenue ?? 0)) * 100) / 100;
    if (delta === 0) continue;
    await applyRevenueDelta(target, order, delta);
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

/** Aggiorna la quota di conversione di **questo** ordine, se presente. */
function repricedConversions(
  current: RecipientConversion[],
  order: Order,
  target: ConversionTarget,
): RecipientConversion[] | null {
  if (!current.some((conversion) => conversion.orderId === order.id)) return null;
  return current.map((conversion) =>
    conversion.orderId === order.id ? { ...conversion, revenue: target.revenue } : conversion,
  );
}

/** Somma solo il fatturato (senza toccare il conteggio ordini). */
async function applyRevenueDelta(
  target: ConversionTarget,
  order: Order,
  delta: number,
): Promise<void> {
  if (target.newsletterId) {
    const ref = col.newsletters().doc(target.newsletterId);
    const recipientRef = await findRecipientInNewsletter(
      target.newsletterId,
      order.contactId ?? null,
      normalizeEmail(order.emailNormalized || order.email),
    );

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const recipientSnap = recipientRef ? await tx.get(recipientRef) : null;
      if (!snapshot.exists) return;

      const newsletter = withId<Newsletter>(snapshot);
      const stats = { ...EMPTY_STATS, ...(newsletter.stats ?? {}) };
      // Un reso non può portare il fatturato della newsletter sotto zero.
      const applied = Math.max(delta, -Number(stats.revenue ?? 0));
      const patch = statsPatch(stats, { revenue: applied });
      if (Object.keys(patch).length > 0) tx.update(ref, patch);

      if (recipientSnap?.exists) {
        const data = serializeDoc<Record<string, unknown>>(recipientSnap.data() ?? {});
        const conversions = repricedConversions(readRecipientConversions(data), order, target);
        if (conversions) {
          tx.set(
            recipientSnap.ref,
            { ...conversionsPatch(conversions), updatedAt: nowIso() },
            { merge: true },
          );
        }
      }
    });
    return;
  }

  if (target.automationId) {
    const automationId = target.automationId;
    const automationRef = col.automations().doc(automationId);
    const runRef = target.automationRunId
      ? col.automationRuns(automationId).doc(target.automationRunId)
      : null;

    try {
      await db.runTransaction(async (tx) => {
        const automationSnap = await tx.get(automationRef);
        const runSnap = runRef ? await tx.get(runRef) : null;
        if (!automationSnap.exists) return;

        const stats = (automationSnap.get('stats') as { revenue?: number } | undefined) ?? {};
        const applied = Math.max(delta, -Number(stats.revenue ?? 0));
        if (applied !== 0) {
          // `update` e non `set`: i percorsi puntati devono restare annidati.
          tx.update(automationRef, {
            'stats.revenue': FieldValue.increment(applied),
            'stats.updatedAt': nowIso(),
            updatedAt: nowIso(),
          });
        }

        if (runSnap?.exists) {
          const data = serializeDoc<Record<string, unknown>>(runSnap.data() ?? {});
          const conversions = repricedConversions(readRecipientConversions(data), order, target);
          if (conversions) tx.set(runSnap.ref, conversionsPatch(conversions), { merge: true });
        }
      });
    } catch (error) {
      log.error('Aggiornamento fatturato automazione fallito', error, {
        automationId,
      });
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
