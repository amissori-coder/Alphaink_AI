/**
 * Trigger Firestore sugli ordini: è il punto in cui un fatto commerciale
 * diventa un'azione di marketing.
 *
 * Alla scrittura di `orders/{orderId}`:
 *  1. se l'ordine è **appena passato a pagato** si chiudono le automazioni che
 *     non hanno più senso (pagamento abbandonato, riacquisto della famiglia
 *     acquistata) e si marca come recuperato l'eventuale carrello abbandonato;
 *  2. si registra il buono eventualmente speso nell'ordine (attribuzione);
 *  3. si aggiorna, per famiglia, la data dell'ultimo acquisto e quella prevista
 *     di riacquisto: è ciò che lo scanner giornaliero andrà a leggere;
 *  4. si arruola il contatto nelle automazioni `order_placed` che l'ordine
 *     soddisfa (fra cui "Coupon Stampante").
 *
 * L'ordine delle operazioni conta: prima si annulla, poi si arruola. Così un
 * ordine che chiude un pagamento abbandonato e contiene una stampante non
 * lascia in coda un promemoria ormai inutile.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  REVENUE_ORDER_STATUSES,
  patternToRegExp,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationKey,
  Contact,
  DocId,
  IsoDate,
  Order,
  ProductFamily,
  TriggerConfig,
} from '@alphaink/shared';

import { LIGHT_RUNTIME } from '../lib/config';
import { col, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { getContactByEmail, getContactById } from '../contacts/repository';
import { handleOrderAttribution, sameOrderForAttribution } from '../tracking/attribution';
import { abandonedCartDocId, readSiteSettings } from '../sync';
import { redeemCoupon } from './coupons';
import { enrollAllSteps, orderContextFrom } from './enrollment';
import {
  applyAutomationStats,
  cancelPendingRuns,
  getEnabledAutomationsByTrigger,
} from './repository';

const log = createLogger('automations.triggers');

const DAY_MS = 86_400_000;

/** Automazioni di riacquisto e famiglie che le rendono superflue. */
const REPURCHASE_AUTOMATIONS: Array<{ key: AutomationKey; families: ProductFamily[] }> = [
  { key: 'riacquisto_carta', families: ['carta'] },
  { key: 'riacquisto_toner_cartucce', families: ['toner', 'cartucce'] },
];

// -----------------------------------------------------------------------------
// Predicati sull'ordine
// -----------------------------------------------------------------------------

/** Vero se lo stato dell'ordine vale come incasso. */
export function isPaidOrder(order: Pick<Order, 'status'> | null | undefined): boolean {
  return Boolean(order && REVENUE_ORDER_STATUSES.includes(order.status));
}

/** Percorsi categoria dell'ordine, uno per riga prodotto. */
function categoryPathsOf(order: Order): string[] {
  const paths: string[] = [];
  for (const item of order.items ?? []) {
    if (item.categoryPath?.length) paths.push(item.categoryPath.join('/'));
  }
  return paths;
}

/**
 * Vero se l'ordine soddisfa il trigger `order_placed` configurato.
 * Le condizioni sono in AND: famiglie, SKU, categorie e totale minimo.
 */
export function matchesOrderTrigger(trigger: TriggerConfig, order: Order): boolean {
  const families = trigger.productFamilies ?? [];
  if (families.length) {
    const present = new Set(order.families ?? []);
    if (!families.some((family) => present.has(family))) return false;
  }

  const skuPatterns = trigger.skuPatterns ?? [];
  if (skuPatterns.length) {
    const skus = order.skus ?? [];
    const matches = skuPatterns.some((pattern) => {
      const regexp = patternToRegExp(pattern);
      return skus.some((sku) => regexp.test(sku));
    });
    if (!matches) return false;
  }

  const categoryPaths = trigger.categoryPaths ?? [];
  if (categoryPaths.length) {
    const paths = categoryPathsOf(order);
    const matches = categoryPaths.some((pattern) => {
      const regexp = patternToRegExp(pattern);
      return paths.some((path) => regexp.test(path));
    });
    if (!matches) return false;
  }

  if (typeof trigger.minOrderTotal === 'number' && (order.total ?? 0) < trigger.minOrderTotal) {
    return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// Effetti collaterali dell'incasso
// -----------------------------------------------------------------------------

/**
 * Marca come recuperati i carrelli/pagamenti abbandonati dello stesso cliente
 * antecedenti all'ordine. Il pagamento abbandonato dell'ordine stesso ha un id
 * deterministico, quindi si aggiorna direttamente.
 */
export async function markAbandonedRecovered(order: Order, orderId: DocId): Promise<number> {
  const now = nowIso();
  const paidAt = order.paidAt ?? order.completedAt ?? now;
  let recovered = 0;

  const paymentRef = col
    .abandonedCarts()
    .doc(abandonedCartDocId(order.source, 'payment', order.externalId));
  const paymentSnapshot = await paymentRef.get();
  if (paymentSnapshot.exists && !paymentSnapshot.get('recoveredAt')) {
    await paymentRef.set(
      { recoveredAt: paidAt, recoveredOrderId: orderId, recoveredRevenue: order.total ?? 0, updatedAt: now },
      { merge: true },
    );
    recovered += 1;
  }

  // Carrelli abbandonati dello stesso indirizzo, precedenti all'ordine.
  const snapshot = await col
    .abandonedCarts()
    .where('emailNormalized', '==', order.emailNormalized)
    .orderBy('abandonedAt', 'desc')
    .limit(20)
    .get();

  for (const doc of snapshot.docs) {
    if (doc.id === paymentRef.id) continue;
    const data = doc.data() as { recoveredAt?: string | null; closedAt?: string | null; abandonedAt?: string };
    if (data.recoveredAt || data.closedAt) continue;
    if (data.abandonedAt && Date.parse(data.abandonedAt) > Date.parse(paidAt)) continue;
    await doc.ref.set(
      { recoveredAt: paidAt, recoveredOrderId: orderId, recoveredRevenue: order.total ?? 0, updatedAt: now },
      { merge: true },
    );
    recovered += 1;
  }

  return recovered;
}

/** Annulla le run pendenti e aggiorna i contatori dell'automazione. */
async function cancelAndCount(
  contactId: DocId,
  automationKeys: AutomationKey[],
  reason: 'order_completed' | 'cart_recovered' | 'repurchased',
): Promise<number> {
  if (!automationKeys.length) return 0;
  const cancelled = await cancelPendingRuns({ contactId, automationKeys, reason });
  if (!cancelled.length) return 0;

  // Un aggiornamento per automazione, non uno per run.
  const byAutomation = new Map<DocId, Record<string, { cancelled: number }>>();
  for (const item of cancelled) {
    const steps = byAutomation.get(item.automationId) ?? {};
    steps[item.stepId] = { cancelled: (steps[item.stepId]?.cancelled ?? 0) + 1 };
    byAutomation.set(item.automationId, steps);
  }
  for (const [automationId, steps] of byAutomation) {
    const total = Object.values(steps).reduce((sum, step) => sum + step.cancelled, 0);
    await applyAutomationStats(automationId, { steps, automation: { cancelled: total } });
  }
  return cancelled.length;
}

/**
 * Aggiorna, per ogni famiglia presente nell'ordine, la data dell'ultimo
 * acquisto e quella prevista di riacquisto.
 *
 * È il "promemoria" che lo scanner giornaliero legge: viene scritto qui perché
 * il ricalcolo completo delle statistiche avviene solo alla sincronizzazione,
 * mentre un ordine può arrivare anche da webhook.
 */
export async function recordRepurchaseDue(order: Order, contact: Contact): Promise<ProductFamily[]> {
  const families = Array.from(new Set((order.families ?? []) as ProductFamily[])).filter(Boolean);
  if (!families.length) return [];

  const settings = await readSiteSettings();
  const cycles: Record<string, number> = {
    ...DEFAULT_REPURCHASE_CYCLE_DAYS,
    ...(settings.repurchaseCycleDays ?? {}),
  };

  const lastOrderByFamily: Record<string, IsoDate> = {};
  const nextPurchaseDueAt: Record<string, IsoDate> = {};
  const placedMs = Date.parse(order.placedAt);
  const touched: ProductFamily[] = [];

  for (const family of families) {
    const previous = contact.stats?.lastOrderByFamily?.[family];
    // Un ordine più vecchio di quello già registrato non sposta le date.
    if (previous && Date.parse(previous) >= placedMs) continue;
    const cycleDays = cycles[family] ?? DEFAULT_REPURCHASE_CYCLE_DAYS[family] ?? 120;
    lastOrderByFamily[family] = order.placedAt;
    nextPurchaseDueAt[family] = new Date(placedMs + cycleDays * DAY_MS).toISOString();
    touched.push(family);
  }

  if (!touched.length) return [];

  await col
    .contacts()
    .doc(contact.id)
    .set({ stats: { lastOrderByFamily, nextPurchaseDueAt } }, { merge: true });

  return touched;
}

// -----------------------------------------------------------------------------
// Arruolamento sugli ordini
// -----------------------------------------------------------------------------

/** Arruola il contatto in tutte le automazioni `order_placed` compatibili. */
export async function enrollOnOrder(
  order: Order,
  orderId: DocId,
  contact: Contact,
): Promise<number> {
  const automations: Automation[] = await getEnabledAutomationsByTrigger('order_placed');
  let enrolled = 0;

  for (const automation of automations) {
    if (!matchesOrderTrigger(automation.trigger, order)) continue;
    const result = await enrollAllSteps({
      automation,
      contact,
      source: 'order',
      sourceId: orderId,
      triggeredAt: order.paidAt ?? order.placedAt,
      context: { order: orderContextFrom(order), orderId, families: order.families ?? [] },
    });
    if (result.enrolled > 0) {
      await applyAutomationStats(automation.id, {
        automation: { enrolled: 1, scheduled: result.enrolled },
        lastRunAt: nowIso(),
      });
      enrolled += result.enrolled;
    }
    for (const item of result.results) {
      if (item.outcome === 'skipped') {
        log.debug('Arruolamento saltato', {
          automation: automation.key,
          contactId: contact.id,
          reason: item.reason,
        });
      }
    }
  }

  return enrolled;
}

// -----------------------------------------------------------------------------
// onOrderWritten
// -----------------------------------------------------------------------------

export const onOrderWritten = onDocumentWritten(
  { ...LIGHT_RUNTIME, document: 'orders/{orderId}' },
  async (event) => {
    const orderId = event.params.orderId as string;
    const afterSnapshot = event.data?.after;

    const before = event.data?.before?.exists
      ? { ...serializeDoc<Order>(event.data.before.data() ?? {}), id: orderId }
      : null;
    const after: Order | null = afterSnapshot?.exists
      ? { ...serializeDoc<Order>(afterSnapshot.data() ?? {}), id: orderId }
      : null;

    // Attribuzione degli acquisti: gira su OGNI scrittura dell'ordine
    // (cancellazioni comprese, per revocare il fatturato) e prima di qualunque
    // uscita anticipata. Vive qui invece che in un trigger dedicato perché due
    // trigger sullo stesso documento raddoppierebbero le invocazioni; la
    // prenotazione transazionale in `attributeOrder` rende comunque innocua una
    // doppia esecuzione.
    if (!before || !after || !sameOrderForAttribution(before, after)) {
      try {
        const outcome = await handleOrderAttribution(before, after);
        if (outcome?.attributed) {
          log.debug('Attribuzione applicata', { orderId, model: outcome.model });
        }
      } catch (error) {
        log.error('Attribuzione ordine fallita', error, { orderId });
      }
    }

    if (!after) return;
    const order: Order = after;

    const paidNow = isPaidOrder(order);
    const paidBefore = isPaidOrder(before);
    // Ci interessa solo la transizione verso "incassato": le riscritture di
    // sincronizzazione non devono rigenerare arruolamenti.
    if (!paidNow || paidBefore) return;

    const contact =
      (order.contactId ? await getContactById(order.contactId) : null) ??
      (await getContactByEmail(order.emailNormalized || order.email));
    if (!contact) {
      log.warn('Ordine incassato senza contatto associato: nessuna automazione avviata', {
        orderId,
        email: order.emailNormalized,
      });
      return;
    }

    try {
      const recovered = await markAbandonedRecovered(order, orderId);

      const cancelledPayment = await cancelAndCount(
        contact.id,
        ['pagamento_abbandonato'],
        'order_completed',
      );

      const orderFamilies = new Set(order.families ?? []);
      const repurchaseKeys = REPURCHASE_AUTOMATIONS.filter((entry) =>
        entry.families.some((family) => orderFamilies.has(family)),
      ).map((entry) => entry.key);
      const cancelledRepurchase = await cancelAndCount(contact.id, repurchaseKeys, 'repurchased');

      if (order.couponCode) {
        await redeemCoupon(order.couponCode, orderId, order.total ?? 0);
      }

      const families = await recordRepurchaseDue(order, contact);
      const enrolled = await enrollOnOrder(order, orderId, contact);

      log.info('Ordine incassato elaborato dalle automazioni', {
        orderId,
        contactId: contact.id,
        recovered,
        cancelledPayment,
        cancelledRepurchase,
        families,
        enrolled,
      });
    } catch (error) {
      // Il trigger non deve entrare in loop di retry: l'errore va registrato e
      // il prossimo scanner recupererà comunque le occasioni perse.
      log.error('Elaborazione automazioni sull\'ordine non riuscita', error, { orderId });
    }
  },
);
