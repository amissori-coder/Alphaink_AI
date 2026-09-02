/**
 * Emissione e riscatto dei buoni sconto generati dalle automazioni.
 *
 * Il codice viene generato qui, salvato in `coupons` e — quando la politica lo
 * prevede — creato anche sul negozio come `cart_rule` PrestaShop tramite
 * l'adapter di sincronizzazione. Un errore lato negozio **non** blocca l'invio:
 * viene registrato in `siteSyncError` e l'email parte comunque, perché un
 * promemoria senza coupon vale più di un promemoria mai spedito.
 *
 * Modalità:
 *  - `unique_per_contact`: un codice nominale per destinatario, monouso;
 *  - `shared`: un unico codice già esistente sul negozio, usato da tutti. In
 *    questo caso non si crea nulla sul sito, si registra solo l'assegnazione
 *    per poter attribuire gli ordini.
 */

import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  couponCode as buildCouponCode,
  formatCurrency,
  normalizeEmail,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationRun,
  Contact,
  CouponPolicy,
  DocId,
  IsoDate,
  IssuedCoupon,
  ProductFamily,
  SiteSettings,
  StoreSource,
} from '@alphaink/shared';

import { AppError } from '../lib/errors';
import { auditCreate, col, nowIso, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { getAdapter, readSiteSettings } from '../sync';
import type { SiteAdapter } from '../sync';
import { runsRef } from './repository';

const log = createLogger('automations.coupons');

const DAY_MS = 86_400_000;
const STORE_SOURCE_SET = new Set<string>(['prestashop_b2c', 'prestashop_b2b']);

// -----------------------------------------------------------------------------
// Helper
// -----------------------------------------------------------------------------

/** Etichetta leggibile dello sconto: "-15%" oppure "-10,00 €". */
export function discountLabelOf(policy: Pick<CouponPolicy, 'discountType' | 'discountValue'>): string {
  if (policy.discountType === 'fixed') {
    return `-${formatCurrency(policy.discountValue, DEFAULT_CURRENCY, DEFAULT_LOCALE)}`;
  }
  return `-${Math.round(policy.discountValue)}%`;
}

/**
 * Negozio su cui creare il buono.
 * Si preferisce la sorgente principale del contatto; se non è un negozio
 * (import CSV, inserimento manuale) si usa quella predefinita.
 */
export function storeSourceForContact(contact: Contact, settings: SiteSettings): StoreSource {
  if (STORE_SOURCE_SET.has(contact.source)) return contact.source as StoreSource;
  const fromSources = (contact.sources ?? []).find((source) => STORE_SOURCE_SET.has(source));
  if (fromSources) return fromSources as StoreSource;
  return settings.defaultSource ?? 'prestashop_b2c';
}

/** SKU compatibili con le stampanti possedute dal contatto. */
export function compatibleSkusOf(contact: Contact): string[] {
  const skus = new Set<string>();
  for (const printer of contact.printers ?? []) {
    for (const sku of printer.compatibleSkus ?? []) {
      if (sku) skus.add(sku);
    }
  }
  return Array.from(skus);
}

// -----------------------------------------------------------------------------
// Emissione
// -----------------------------------------------------------------------------

export interface IssueCouponInput {
  policy: CouponPolicy;
  contact: Contact;
  automation: Automation;
  run?: AutomationRun | null;
  newsletterId?: DocId | null;
  /** Istante di riferimento per la scadenza (default: adesso). */
  now?: IsoDate;
}

export interface IssuedCouponResult {
  id: DocId;
  code: string;
  expiresAt: IsoDate;
  discountLabel: string;
  /** Id della `cart_rule` creata sul negozio, se la creazione è riuscita. */
  siteCouponId: string | null;
  /** Motivo del mancato allineamento al negozio, già in italiano. */
  siteSyncError: string | null;
}

/**
 * Genera (o assegna) il buono sconto di uno step e lo registra su Firestore.
 *
 * Il documento `coupons` usa il codice come id: la lettura in fase di riscatto
 * diventa una `get` diretta e due codici identici non possono coesistere.
 */
export async function issueCoupon(input: IssueCouponInput): Promise<IssuedCouponResult> {
  const { policy, contact, automation } = input;
  if (!policy?.enabled) {
    throw new AppError('failed_precondition', 'La politica coupon di questo step non è attiva.');
  }

  const now = input.now ?? nowIso();
  const expiresAt = new Date(Date.parse(now) + Math.max(1, policy.validForDays) * DAY_MS).toISOString();
  const shared = policy.mode === 'shared';
  const code = shared
    ? (policy.sharedCode?.trim() || buildCouponCode(policy.prefix)).toUpperCase()
    : buildCouponCode(policy.prefix);

  const restrictToSkus =
    policy.restrictToCompatibleSkus === true ? compatibleSkusOf(contact) : [];

  const document: Omit<IssuedCoupon, 'id'> = {
    code,
    automationId: automation.id,
    automationRunId: input.run?.id ?? null,
    newsletterId: input.newsletterId ?? null,
    contactId: contact.id,
    email: contact.emailNormalized || normalizeEmail(contact.email ?? ''),
    discountType: policy.discountType,
    discountValue: policy.discountValue,
    minOrderTotal: policy.minOrderTotal ?? null,
    restrictToSkus,
    restrictToFamilies: (policy.restrictToFamilies ?? []) as string[],
    issuedAt: now,
    expiresAt,
    siteCouponId: null,
    siteSyncError: null,
    redeemedAt: null,
    redeemedOrderId: null,
    redeemedAmount: null,
    ...auditCreate(null),
  };

  const ref = col.coupons().doc(code);
  // `set` senza merge: con `shared` lo stesso codice viene riusato e il
  // documento tiene traccia dell'ultima assegnazione.
  await ref.set(document, { merge: shared });

  let siteCouponId: string | null = null;
  let siteSyncError: string | null = null;

  if (policy.createOnSite && !shared) {
    const created = await createCouponOnSite({ code, expiresAt, policy, contact, automation });
    siteCouponId = created.id;
    siteSyncError = created.error;
    await ref.set({ siteCouponId, siteSyncError }, { merge: true });
  }

  log.info('Coupon emesso', {
    code,
    contactId: contact.id,
    automationId: automation.id,
    siteCouponId,
    siteSyncError,
  });

  return {
    id: ref.id,
    code,
    expiresAt,
    discountLabel: discountLabelOf(policy),
    siteCouponId,
    siteSyncError,
  };
}

/** Crea la `cart_rule` sul negozio. Non solleva: restituisce l'errore. */
async function createCouponOnSite(input: {
  code: string;
  expiresAt: IsoDate;
  policy: CouponPolicy;
  contact: Contact;
  automation: Automation;
}): Promise<{ id: string | null; error: string | null }> {
  const { code, expiresAt, policy, contact, automation } = input;
  let adapter: SiteAdapter | null = null;

  try {
    const settings = await readSiteSettings();
    const source = storeSourceForContact(contact, settings);
    adapter = getAdapter(source, settings);

    const created = await adapter.createCoupon({
      code,
      name: `${automation.name} — ${discountLabelOf(policy)}`,
      description: `Buono generato dall'automazione "${automation.name}" per ${contact.email}.`,
      discountType: policy.discountType,
      discountValue: policy.discountValue,
      minOrderTotal: policy.minOrderTotal ?? null,
      startsAt: nowIso(),
      expiresAt,
      // Il buono resta nominale: legarlo al cliente PrestaShop impedisce che il
      // codice, se condiviso, venga speso da altri.
      customerExternalId: contact.externalIds?.[source] ?? null,
      quantity: 1,
      quantityPerUser: 1,
      freeShipping: false,
      highlight: true,
      partialUse: policy.discountType === 'fixed',
    });
    return { id: created.id, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore sconosciuto';
    log.error('Creazione del buono sul negozio non riuscita', error, { code });
    return { id: null, error: message };
  } finally {
    if (adapter) {
      try {
        await adapter.close();
      } catch {
        // La chiusura del pool non deve mai propagare errori.
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Lettura e riscatto
// -----------------------------------------------------------------------------

/** Buono per codice: prima l'id diretto, poi la query (codici storici). */
export async function findCouponByCode(code: string): Promise<IssuedCoupon | null> {
  const normalized = String(code ?? '').trim().toUpperCase();
  if (!normalized) return null;

  const direct = await col.coupons().doc(normalized).get();
  if (direct.exists) return withId<IssuedCoupon>(direct);

  const snapshot = await col.coupons().where('code', '==', normalized).limit(1).get();
  const doc = snapshot.docs[0];
  return doc ? withId<IssuedCoupon>(doc) : null;
}

export interface RedeemCouponResult {
  redeemed: boolean;
  coupon: IssuedCoupon | null;
  /** Motivo del mancato riscatto, già in italiano. */
  reason?: string;
}

/**
 * Marca un buono come utilizzato quando arriva l'ordine che lo contiene.
 *
 * Aggiorna anche la `run` che lo ha generato (`convertedOrderId`, `revenue`):
 * è l'attribuzione più solida che abbiamo, perché il codice è nominale e non
 * dipende da click o aperture.
 */
export async function redeemCoupon(
  code: string,
  orderId: DocId,
  amount: number,
): Promise<RedeemCouponResult> {
  const coupon = await findCouponByCode(code);
  if (!coupon) return { redeemed: false, coupon: null, reason: 'Codice non emesso da questa piattaforma.' };
  if (coupon.redeemedAt && coupon.redeemedOrderId === orderId) {
    return { redeemed: false, coupon, reason: 'Buono già registrato su questo ordine.' };
  }

  const now = nowIso();
  await col.coupons().doc(coupon.id).set(
    {
      redeemedAt: coupon.redeemedAt ?? now,
      redeemedOrderId: orderId,
      redeemedAmount: amount,
      updatedAt: now,
    },
    { merge: true },
  );

  if (coupon.automationId && coupon.automationRunId) {
    await runsRef(coupon.automationId)
      .doc(coupon.automationRunId)
      .set({ convertedOrderId: orderId, revenue: amount }, { merge: true });
  }

  log.info('Buono riscattato', { code: coupon.code, orderId, amount });
  return { redeemed: true, coupon };
}

/** Famiglie ammesse dal buono, tipizzate. */
export function couponFamilies(coupon: IssuedCoupon): ProductFamily[] {
  return (coupon.restrictToFamilies ?? []) as ProductFamily[];
}
