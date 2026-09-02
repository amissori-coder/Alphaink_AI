/**
 * Scanner periodici delle automazioni.
 *
 *  - `scheduledAbandonedScanner` (ogni 30 minuti): trasforma gli ordini rimasti
 *    senza pagamento in `abandonedCarts` e arruola i clienti nell'automazione
 *    "Pagamento Abbandonato".
 *  - `scheduledRepurchaseScanner` (ogni giorno alle 09:00): trova i contatti la
 *    cui data prevista di riacquisto è arrivata e li arruola nelle automazioni
 *    "Riacquisto Carta" e "Riacquisto Toner e Cartucce".
 *
 * Entrambi lavorano **a budget di tempo** e con una finestra di recupero
 * limitata: se il lavoro non entra in una corsa, la corsa successiva riprende
 * dagli stessi documenti (le query sono ordinate in modo stabile) senza generare
 * doppioni, perché l'arruolamento è idempotente sulla `dedupeKey`.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  ABANDONED_PAYMENT_STATUSES,
  DEFAULT_REPURCHASE_CYCLE_DAYS,
  dayKey,
} from '@alphaink/shared';
import type {
  AbandonedCart,
  AutomationKey,
  Contact,
  DocId,
  IsoDate,
  Order,
  ProductFamily,
} from '@alphaink/shared';

import { HEAVY_RUNTIME, TIMEZONE } from '../lib/config';
import { col, logActivity, nowIso, paginateQuery, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { getContactByEmail, getContactById } from '../contacts/repository';
import { readSiteSettings, upsertAbandonedCart } from '../sync';
import { cartContextFrom, enrollAllSteps, isContactSendable } from './enrollment';
import {
  applyAutomationStats,
  findRunsForContact,
  getAutomationByKey,
} from './repository';

const log = createLogger('automations.scanners');

const DAY_MS = 86_400_000;

/**
 * Sentinella per uscire da `paginateQuery`: il gestore di pagina non può
 * fermare il ciclo con un `return`, quindi si interrompe con un'eccezione
 * dedicata, intercettata subito fuori.
 */
class ScanStop extends Error {
  constructor(readonly motivo: 'budget' | 'limite') {
    super(`Scansione interrotta: ${motivo}`);
    this.name = 'ScanStop';
  }
}

/** Budget di lavoro: lascia margine sul timeout di 540 s. */
export const SCANNER_TIME_BUDGET_MS = 5 * 60 * 1000;

/** Quanto indietro si guarda: oltre questa soglia il recupero non ha più senso. */
export const ABANDONED_LOOKBACK_DAYS = 7;

/** Riacquisti scaduti recuperati al massimo entro questa finestra. */
export const REPURCHASE_LOOKBACK_DAYS = 30;

// -----------------------------------------------------------------------------
// Utilità comuni
// -----------------------------------------------------------------------------

/** Vero se esiste già una run generata da questo trigger (qualunque stato). */
async function alreadyEnrolled(
  contactId: DocId,
  automationKey: AutomationKey,
  sourceId: string,
): Promise<boolean> {
  const runs = await findRunsForContact({ contactId, automationKey, limit: 30 });
  return runs.some((run) => run.sourceId === sourceId);
}

/** Contatto della riga: prima per id, poi per email. */
async function resolveContact(
  contactId: DocId | null | undefined,
  email: string | null | undefined,
): Promise<Contact | null> {
  if (contactId) {
    const byId = await getContactById(contactId);
    if (byId) return byId;
  }
  return email ? getContactByEmail(email) : null;
}

// -----------------------------------------------------------------------------
// Pagamenti e carrelli abbandonati
// -----------------------------------------------------------------------------

export interface AbandonedScanSummary {
  ordersScanned: number;
  cartsCreated: number;
  cartsScanned: number;
  enrolled: number;
  skipped: number;
  exhaustedBudget: boolean;
  durationMs: number;
}

/**
 * URL con cui il cliente riprende il pagamento.
 * PrestaShop espone il dettaglio ordine sul front office: richiede il login,
 * che è esattamente ciò che serve per pagare un ordine già creato.
 */
function paymentRecoveryUrl(baseUrl: string, externalId: string): string | null {
  const clean = String(baseUrl ?? '').replace(/\/+$/, '');
  if (!clean) return null;
  return `${clean}/index.php?controller=order-detail&id_order=${encodeURIComponent(externalId)}`;
}

/**
 * Ordini non pagati oltre la soglia → documenti `abandonedCarts` di tipo
 * `payment`. La scrittura è idempotente (id deterministico), quindi ripassare
 * sugli stessi ordini non crea duplicati.
 */
async function syncAbandonedPayments(options: {
  thresholdIso: IsoDate;
  lookbackIso: IsoDate;
  limit: number;
  baseUrlBySource: Record<string, string>;
}): Promise<{ scanned: number; created: number }> {
  const snapshot = await col
    .orders()
    .where('status', 'in', ABANDONED_PAYMENT_STATUSES)
    .where('placedAt', '>=', options.lookbackIso)
    .where('placedAt', '<=', options.thresholdIso)
    .orderBy('placedAt', 'desc')
    .limit(options.limit)
    .get();

  let created = 0;
  for (const doc of snapshot.docs) {
    const order = withId<Order>(doc);
    if (!order.email) continue;
    const result = await upsertAbandonedCart({
      source: order.source,
      kind: 'payment',
      externalId: order.externalId,
      email: order.email,
      contactId: order.contactId ?? null,
      total: order.total ?? 0,
      currency: order.currency,
      items: order.items ?? [],
      recoveryUrl: paymentRecoveryUrl(options.baseUrlBySource[order.source] ?? '', order.externalId),
      abandonedAt: order.placedAt,
      lastSeenAt: nowIso(),
      orderId: order.id,
    });
    if (result.created) created += 1;
  }

  return { scanned: snapshot.size, created };
}

/** Corpo del job, isolato per poter essere richiamato dai test e dalla shell. */
export async function runAbandonedScan(
  options: { budgetMs?: number; maxCarts?: number; maxOrders?: number } = {},
): Promise<AbandonedScanSummary> {
  const startedAt = Date.now();
  const budget = options.budgetMs ?? SCANNER_TIME_BUDGET_MS;
  const now = nowIso();
  const settings = await readSiteSettings();

  const paymentThreshold = new Date(
    Date.now() - Math.max(1, settings.abandonedPaymentAfterMinutes ?? 60) * 60_000,
  ).toISOString();
  const cartThreshold = new Date(
    Date.now() - Math.max(1, settings.abandonedCartAfterMinutes ?? 240) * 60_000,
  ).toISOString();
  const lookback = new Date(Date.now() - ABANDONED_LOOKBACK_DAYS * DAY_MS).toISOString();

  const baseUrlBySource: Record<string, string> = {};
  for (const store of Object.values(settings.stores ?? {})) {
    if (store?.source) baseUrlBySource[store.source] = store.baseUrl ?? '';
  }

  const payments = await syncAbandonedPayments({
    thresholdIso: paymentThreshold,
    lookbackIso: lookback,
    limit: options.maxOrders ?? 300,
    baseUrlBySource,
  });

  const summary: AbandonedScanSummary = {
    ordersScanned: payments.scanned,
    cartsCreated: payments.created,
    cartsScanned: 0,
    enrolled: 0,
    skipped: 0,
    exhaustedBudget: false,
    durationMs: 0,
  };

  const automation = await getAutomationByKey('pagamento_abbandonato');
  if (!automation || !automation.enabled) {
    summary.durationMs = Date.now() - startedAt;
    log.info('Automazione "Pagamento Abbandonato" non attiva: solo aggiornamento carrelli', {
      created: payments.created,
    });
    return summary;
  }

  // La soglia più permissiva fra pagamenti e carrelli: il tipo di documento
  // determina poi quale delle due si applica davvero.
  const threshold = paymentThreshold > cartThreshold ? paymentThreshold : cartThreshold;
  const snapshot = await col
    .abandonedCarts()
    .where('recoveredAt', '==', null)
    .where('closedAt', '==', null)
    .where('abandonedAt', '>=', lookback)
    .where('abandonedAt', '<=', threshold)
    .orderBy('abandonedAt', 'asc')
    .limit(options.maxCarts ?? 400)
    .get();

  let enrolledRuns = 0;

  for (const doc of snapshot.docs) {
    if (Date.now() - startedAt > budget) {
      summary.exhaustedBudget = true;
      break;
    }
    summary.cartsScanned += 1;

    const cart = withId<AbandonedCart>(doc);
    const specificThreshold = cart.kind === 'payment' ? paymentThreshold : cartThreshold;
    if (cart.abandonedAt > specificThreshold) {
      summary.skipped += 1;
      continue;
    }
    if (await alreadyEnrolled(cart.contactId ?? '', 'pagamento_abbandonato', cart.id)) {
      summary.skipped += 1;
      continue;
    }

    const contact = await resolveContact(cart.contactId, cart.emailNormalized || cart.email);
    if (!contact || !isContactSendable(contact)) {
      summary.skipped += 1;
      continue;
    }

    const result = await enrollAllSteps({
      automation,
      contact,
      source: cart.kind === 'payment' ? 'order' : 'cart',
      sourceId: cart.id,
      triggeredAt: cart.abandonedAt,
      context: {
        order: cartContextFrom(cart),
        cartId: cart.id,
        kind: cart.kind,
        orderId: cart.orderId ?? null,
      },
    });

    summary.enrolled += result.enrolled;
    enrolledRuns += result.enrolled;
    if (result.enrolled === 0) summary.skipped += 1;
  }

  if (enrolledRuns > 0) {
    await applyAutomationStats(automation.id, {
      automation: { enrolled: summary.enrolled, scheduled: enrolledRuns },
      lastRunAt: nowIso(),
    });
  }

  summary.durationMs = Date.now() - startedAt;
  log.info('Scansione pagamenti e carrelli abbandonati completata', { ...summary, now });
  return summary;
}

export const scheduledAbandonedScanner = onSchedule(
  {
    ...HEAVY_RUNTIME,
    schedule: 'every 30 minutes',
    timeZone: TIMEZONE,
    retryCount: 1,
  },
  async () => {
    const summary = await runAbandonedScan();
    if (summary.enrolled > 0 || summary.cartsCreated > 0) {
      await logActivity({
        action: 'automation.abandoned_scan',
        entityType: 'automation',
        entityId: 'pagamento_abbandonato',
        userId: null,
        summary:
          `Pagamenti abbandonati: ${summary.cartsCreated} nuovi carrelli, ` +
          `${summary.enrolled} promemoria programmati`,
        metadata: { ...summary },
      });
    }
  },
);

// -----------------------------------------------------------------------------
// Riacquisto
// -----------------------------------------------------------------------------

export interface RepurchaseScanSummary {
  automations: number;
  contactsScanned: number;
  enrolled: number;
  skipped: number;
  exhaustedBudget: boolean;
  durationMs: number;
}

/**
 * Identificativo del ciclo di riacquisto: famiglia + giorno dell'ultimo
 * acquisto. Finché il cliente non ricompra la chiave non cambia, quindi il
 * contatto non può essere arruolato due volte per lo stesso ciclo.
 */
export function repurchaseSourceId(family: ProductFamily, referenceDate: IsoDate): string {
  return `${family}:${dayKey(referenceDate)}`;
}

/** Corpo del job di riacquisto. */
export async function runRepurchaseScan(
  options: { budgetMs?: number; pageSize?: number; maxContactsPerFamily?: number } = {},
): Promise<RepurchaseScanSummary> {
  const startedAt = Date.now();
  const budget = options.budgetMs ?? SCANNER_TIME_BUDGET_MS;
  const now = nowIso();
  const lookback = new Date(Date.now() - REPURCHASE_LOOKBACK_DAYS * DAY_MS).toISOString();

  const settings = await readSiteSettings();
  const cycles: Record<string, number> = {
    ...DEFAULT_REPURCHASE_CYCLE_DAYS,
    ...(settings.repurchaseCycleDays ?? {}),
  };

  const summary: RepurchaseScanSummary = {
    automations: 0,
    contactsScanned: 0,
    enrolled: 0,
    skipped: 0,
    exhaustedBudget: false,
    durationMs: 0,
  };

  const keys: AutomationKey[] = ['riacquisto_carta', 'riacquisto_toner_cartucce'];

  for (const key of keys) {
    const automation = await getAutomationByKey(key);
    if (!automation || !automation.enabled) continue;
    if (automation.trigger?.type !== 'repurchase_due') continue;
    summary.automations += 1;

    const families = (automation.trigger.productFamilies ?? []) as ProductFamily[];
    let enrolledForAutomation = 0;

    for (const family of families) {
      if (Date.now() - startedAt > budget) {
        summary.exhaustedBudget = true;
        break;
      }

      const field = `stats.nextPurchaseDueAt.${family}`;
      // Query su un solo campo (con `orderBy` sullo stesso campo): usa
      // l'indice automatico di Firestore, senza indice composito dedicato.
      const query = col
        .contacts()
        .where(field, '>=', lookback)
        .where(field, '<=', now)
        .orderBy(field, 'asc');

      const maxContacts = options.maxContactsPerFamily ?? 5_000;
      let processed = 0;

      try {
        await paginateQuery(query, options.pageSize ?? 200, async (docs) => {
          for (const doc of docs) {
            if (Date.now() - startedAt > budget) {
              summary.exhaustedBudget = true;
              throw new ScanStop('budget');
            }
            if (processed >= maxContacts) throw new ScanStop('limite');
            processed += 1;
            summary.contactsScanned += 1;

            const contact = withId<Contact>(doc);
            if (!isContactSendable(contact)) {
              summary.skipped += 1;
              continue;
            }

            const dueAt = contact.stats?.nextPurchaseDueAt?.[family];
            const lastOrderAt = contact.stats?.lastOrderByFamily?.[family] ?? null;
            if (!dueAt) {
              summary.skipped += 1;
              continue;
            }

            const sourceId = repurchaseSourceId(family, lastOrderAt ?? dueAt);
            if (await alreadyEnrolled(contact.id, key, sourceId)) {
              summary.skipped += 1;
              continue;
            }

            const result = await enrollAllSteps({
              automation,
              contact,
              source: 'schedule',
              sourceId,
              // Il ritardo dello step si misura dall'ultimo acquisto della
              // famiglia: "1440 ore" significa 1440 ore dopo quell'ordine.
              triggeredAt: lastOrderAt ?? dueAt,
              context: { family, dueAt, lastOrderAt },
            });

            summary.enrolled += result.enrolled;
            enrolledForAutomation += result.enrolled;
            if (result.enrolled === 0) {
              summary.skipped += 1;
              continue;
            }

            // La data prevista avanza di un ciclo: il contatto esce subito dalla
            // finestra di scansione e tornerà al prossimo giro di consumo.
            const cycleDays = cycles[family] ?? DEFAULT_REPURCHASE_CYCLE_DAYS[family] ?? 120;
            await col
              .contacts()
              .doc(contact.id)
              .set(
                {
                  stats: {
                    nextPurchaseDueAt: {
                      [family]: new Date(Date.parse(dueAt) + cycleDays * DAY_MS).toISOString(),
                    },
                  },
                },
                { merge: true },
              );
            }
          });
      } catch (error) {
        if (!(error instanceof ScanStop)) throw error;
        if (error.motivo === 'budget') break;
      }
    }

    if (enrolledForAutomation > 0) {
      await applyAutomationStats(automation.id, {
        automation: { enrolled: enrolledForAutomation, scheduled: enrolledForAutomation },
        lastRunAt: nowIso(),
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  log.info('Scansione riacquisti completata', { ...summary });
  return summary;
}

export const scheduledRepurchaseScanner = onSchedule(
  {
    ...HEAVY_RUNTIME,
    schedule: 'every day 09:00',
    timeZone: TIMEZONE,
    retryCount: 1,
  },
  async () => {
    const summary = await runRepurchaseScan();
    if (summary.enrolled > 0) {
      await logActivity({
        action: 'automation.repurchase_scan',
        entityType: 'automation',
        userId: null,
        summary: `Riacquisti: ${summary.enrolled} promemoria programmati su ${summary.contactsScanned} contatti esaminati`,
        metadata: { ...summary },
      });
    }
  },
);
