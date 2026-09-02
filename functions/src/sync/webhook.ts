/**
 * Webhook in ingresso dai siti AlphaInk.
 *
 * Permette agli eventi del negozio di arrivare in tempo reale invece di
 * aspettare la sincronizzazione oraria: è ciò che rende immediate le
 * automazioni "carrello abbandonato" e "pagamento abbandonato".
 *
 * =============================================================================
 * CONTRATTO DEL PAYLOAD
 * =============================================================================
 * POST  https://<region>-<project>.cloudfunctions.net/siteWebhook
 * Header:
 *   Content-Type: application/json
 *   X-Alphaink-Signature: <HMAC-SHA256 del CORPO GREZZO, base64url>
 *                         (accettato anche il prefisso "sha256=")
 *
 * La firma si calcola sul corpo esattamente come inviato, con il segreto
 * condiviso `SITE_WEBHOOK_SECRET`. In PHP:
 *
 *   $body = json_encode($payload);
 *   $sig  = rtrim(strtr(base64_encode(hash_hmac('sha256', $body, $secret, true)), '+/', '-_'), '=');
 *
 * Corpo:
 * {
 *   "event":  "order.created" | "order.updated" | "order.paid"
 *           | "cart.updated"
 *           | "customer.created" | "customer.updated",
 *   "source": "prestashop_b2c" | "prestashop_b2b",
 *   "sentAt": "2026-09-02T10:15:00Z",          // facoltativo
 *   "data":   { ... }                          // vedi sotto
 * }
 *
 * data — eventi `order.*`
 * {
 *   "id": "12345",                     // id_order PrestaShop (obbligatorio)
 *   "reference": "ABCDEFGHI",
 *   "email": "cliente@esempio.it",     // obbligatorio
 *   "customerId": "998",
 *   "cartId": "555",
 *   "stateId": "2",                    // id stato PrestaShop, mappato da settings/site
 *   "stateName": "Pagamento accettato",
 *   "total": 122.00, "subtotal": 100.00, "shipping": 7.00, "tax": 15.00,
 *   "currency": "EUR",
 *   "couponCode": "ALPHA-A1B2-C3D4",   // unico punto in cui il codice buono ci arriva
 *   "placedAt": "2026-09-02 12:03:00", // ora locale del negozio, oppure ISO con fuso
 *   "updatedAt": "2026-09-02 12:20:00",
 *   "items": [
 *     { "productId": "77", "sku": "TN-2420", "name": "Toner HP 26A",
 *       "quantity": 2, "unitPrice": 45.9, "total": 91.8,
 *       "categoryPath": ["Toner", "HP"] }
 *   ],
 *   "utm": { "source": "newsletter", "medium": "email", "campaign": "settembre" }
 * }
 *
 * data — evento `cart.updated`
 * {
 *   "id": "555", "email": "cliente@esempio.it", "customerId": "998",
 *   "total": 91.8, "currency": "EUR",
 *   "recoveryUrl": "https://alphaink.net/index.php?controller=order&id_cart=555&...",
 *   "createdAt": "...", "updatedAt": "...",
 *   "items": [ ... come sopra ... ]
 * }
 * Un carrello inviato senza righe viene interpretato come "svuotato" e chiude
 * l'eventuale carrello abbandonato già aperto.
 *
 * data — eventi `customer.*`
 * {
 *   "id": "998", "email": "cliente@esempio.it",
 *   "firstName": "Mario", "lastName": "Rossi", "company": "Acme Srl",
 *   "vatNumber": "IT01234567890", "taxCode": "RSSMRA80A01H501U", "phone": "+39...",
 *   "newsletter": true, "optin": false, "active": true,
 *   "groupName": "Rivenditori", "languageId": "1",
 *   "country": "IT", "province": "MI", "city": "Milano", "postcode": "20100",
 *   "createdAt": "...", "updatedAt": "..."
 * }
 *
 * =============================================================================
 * GARANZIE
 * =============================================================================
 * - **Idempotenza**: gli id dei documenti sono deterministici, quindi una
 *   consegna ripetuta aggiorna lo stesso documento invece di duplicarlo.
 * - **Nessuna resurrezione**: un contatto disiscritto resta disiscritto anche
 *   se il sito lo rimanda con la casella newsletter spuntata.
 * - **Risposte**: `200` elaborato, `202` ignorato (evento non gestito),
 *   `400` payload non valido, `401` firma non valida, `503` segreto mancante.
 *   Il sito dovrebbe ritentare solo su `5xx`.
 */

import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { z } from 'zod';
import { REVENUE_ORDER_STATUSES } from '@alphaink/shared';
import type { PrestaShopStoreSettings, SiteSettings } from '@alphaink/shared';
import { SITE_WEBHOOK_SECRET, WEBHOOK_RUNTIME } from '../lib/config';
import { col, nowIso } from '../lib/firestore';
import { handlePreflight, sendError, sendJson } from '../lib/http';
import { createLogger } from '../lib/logger';
import { verifySignature } from '../lib/signing';
import {
  STORE_TIMEZONE,
  parsePsDate,
  toNormalizedCart,
  toNormalizedCustomer,
  toNormalizedOrder,
} from './normalize';
import type { NormalizationContext } from './normalize';
import {
  abandonedCartDocId,
  recomputeContactsStats,
  upsertAbandonedCartsBatch,
  upsertContactFromCustomer,
  upsertOrdersBatch,
} from './repository';
import { readSiteSettings } from './settings';
import { ORDER_STATE_TIMESTAMPS_KEY } from './types';
import type { PsCartRow, PsCustomerRow, PsLineRow, PsOrderRow } from './types';

const log = createLogger('sync.webhook');

/** Finestra di accettazione di `sentAt`: limita il riuso di una firma catturata. */
const MAX_PAYLOAD_AGE_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Schemi
// -----------------------------------------------------------------------------

/** Gli id PrestaShop arrivano indifferentemente come numero o stringa. */
const idSchema = z.union([z.string(), z.number()]).transform((value) => String(value).trim());
const dateSchema = z.union([z.string(), z.null()]).optional();

/**
 * PrestaShop serializza i numeri come stringhe (`"122.00"`) e i booleani come
 * `"0"`/`"1"`. `z.coerce` non basta: `Boolean("0")` è `true`, e trasformerebbe
 * un cliente senza consenso in un iscritto. Da qui le due conversioni esplicite.
 */
function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Numero obbligatorio con valore di ripiego. */
function numberField(fallback: number) {
  return z.preprocess((value) => coerceNumber(value, fallback), z.number());
}

/** Numero facoltativo: assente o `null` restano `undefined`. */
const optionalNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === '' ? undefined : coerceNumber(value, 0)),
  z.number().optional(),
);

/** Booleano tollerante: `"0"`, `""`, `0` e `false` sono falsi. */
function boolField(fallback: boolean) {
  return z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }
    if (value === null || value === undefined) return fallback;
    return Boolean(value);
  }, z.boolean());
}

export const siteWebhookLineSchema = z.object({
  productId: idSchema.optional().nullable(),
  sku: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  quantity: numberField(1),
  unitPrice: numberField(0),
  total: optionalNumber,
  categoryPath: z.array(z.string()).optional(),
});

export const siteWebhookOrderSchema = z.object({
  id: idSchema,
  reference: z.string().optional().nullable(),
  email: z.string().email('Email non valida'),
  customerId: idSchema.optional().nullable(),
  cartId: idSchema.optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  stateId: idSchema.optional().nullable(),
  stateName: z.string().optional().nullable(),
  total: numberField(0),
  subtotal: optionalNumber,
  shipping: optionalNumber,
  tax: optionalNumber,
  discounts: optionalNumber,
  currency: z.string().optional().nullable(),
  payment: z.string().optional().nullable(),
  couponCode: z.string().optional().nullable(),
  placedAt: dateSchema,
  updatedAt: dateSchema,
  items: z.array(siteWebhookLineSchema).default([]),
  utm: z
    .object({
      source: z.string().optional().nullable(),
      medium: z.string().optional().nullable(),
      campaign: z.string().optional().nullable(),
      term: z.string().optional().nullable(),
      content: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const siteWebhookCartSchema = z.object({
  id: idSchema,
  email: z.string().email('Email non valida'),
  customerId: idSchema.optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  secureKey: z.string().optional().nullable(),
  total: optionalNumber,
  currency: z.string().optional().nullable(),
  recoveryUrl: z.string().optional().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  items: z.array(siteWebhookLineSchema).default([]),
});

export const siteWebhookCustomerSchema = z.object({
  id: idSchema,
  email: z.string().email('Email non valida'),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable(),
  taxCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  newsletter: boolField(false),
  optin: boolField(false),
  active: boolField(true),
  groupName: z.string().optional().nullable(),
  groupNames: z.array(z.string()).optional(),
  languageId: idSchema.optional().nullable(),
  country: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

export const siteWebhookEnvelopeSchema = z.object({
  event: z.enum([
    'order.created',
    'order.updated',
    'order.paid',
    'cart.updated',
    'customer.created',
    'customer.updated',
  ]),
  source: z.enum(['prestashop_b2c', 'prestashop_b2b']),
  sentAt: z.string().optional().nullable(),
  data: z.record(z.unknown()),
});

type WebhookEvent = z.infer<typeof siteWebhookEnvelopeSchema>['event'];

// -----------------------------------------------------------------------------
// Endpoint
// -----------------------------------------------------------------------------

export const siteWebhook = onRequest(
  { ...WEBHOOK_RUNTIME, secrets: [SITE_WEBHOOK_SECRET] },
  async (req: Request, res: Response): Promise<void> => {
    if (handlePreflight(req, res)) return;
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed', 'Usa POST.');
      return;
    }

    const secret = readSecret();
    if (!secret) {
      sendError(
        res,
        503,
        'webhook_not_configured',
        'Segreto del webhook non configurato: imposta SITE_WEBHOOK_SECRET.',
      );
      return;
    }

    const raw = rawBodyOf(req);
    const signature = signatureOf(req);
    if (!signature || !verifySignature(raw, signature, secret)) {
      log.warn('Webhook rifiutato: firma non valida', { hasSignature: Boolean(signature) });
      sendError(res, 401, 'invalid_signature', 'Firma non valida.');
      return;
    }

    let payload: unknown;
    try {
      payload = raw ? JSON.parse(raw) : req.body;
    } catch {
      sendError(res, 400, 'invalid_json', 'Corpo della richiesta non è JSON valido.');
      return;
    }

    const envelope = siteWebhookEnvelopeSchema.safeParse(payload);
    if (!envelope.success) {
      sendError(
        res,
        400,
        'invalid_payload',
        `Payload non valido: ${envelope.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      );
      return;
    }

    const { event, source, sentAt, data } = envelope.data;
    if (sentAt) {
      const age = Date.now() - Date.parse(sentAt);
      if (Number.isFinite(age) && age > MAX_PAYLOAD_AGE_MS) {
        sendError(res, 400, 'payload_too_old', 'Evento troppo vecchio: rifiutato.');
        return;
      }
    }

    try {
      const settings = await readSiteSettings();
      const store = settings.stores?.[source];
      if (!store) {
        sendError(res, 400, 'unknown_store', `Negozio "${source}" non configurato.`);
        return;
      }

      const result = await dispatch(event, data, store, settings);
      log.info('Evento sito elaborato', { event, source, ...result });
      sendJson(res, 200, { ok: true, event, source, ...result });
    } catch (error) {
      log.error('Elaborazione evento sito fallita', error, { event, source });
      sendError(res, 500, 'internal', 'Elaborazione non riuscita.');
    }
  },
);

async function dispatch(
  event: WebhookEvent,
  data: Record<string, unknown>,
  store: PrestaShopStoreSettings,
  settings: SiteSettings,
): Promise<Record<string, unknown>> {
  switch (event) {
    case 'order.created':
    case 'order.updated':
    case 'order.paid':
      return handleOrder(event, data, store, settings);
    case 'cart.updated':
      return handleCart(data, store, settings);
    case 'customer.created':
    case 'customer.updated':
      return handleCustomer(data, store);
    default:
      return { ignored: true };
  }
}

// -----------------------------------------------------------------------------
// Gestori
// -----------------------------------------------------------------------------

function contextFor(
  store: PrestaShopStoreSettings,
  settings: SiteSettings,
  stateNames?: Record<string, string>,
): NormalizationContext {
  return {
    store,
    familyRules: settings.familyRules ?? [],
    stateNames,
    timeZone: STORE_TIMEZONE,
  };
}

function toLines(items: z.infer<typeof siteWebhookLineSchema>[]): PsLineRow[] {
  return items.map((item) => ({
    productId: item.productId ?? null,
    reference: item.sku ?? item.reference ?? null,
    name: item.name ?? '',
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.total ?? item.unitPrice * item.quantity,
    categoryPath: item.categoryPath ?? [],
  }));
}

async function handleOrder(
  event: WebhookEvent,
  raw: Record<string, unknown>,
  store: PrestaShopStoreSettings,
  settings: SiteSettings,
): Promise<Record<string, unknown>> {
  const data = siteWebhookOrderSchema.parse(raw);
  const updatedAt = data.updatedAt ?? data.placedAt ?? nowIso();

  const row: PsOrderRow = {
    id: data.id,
    reference: data.reference ?? null,
    customerId: data.customerId ?? null,
    cartId: data.cartId ?? null,
    email: data.email,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    currentState: data.stateId ?? null,
    total: data.total,
    subtotal: data.subtotal ?? null,
    shipping: data.shipping ?? null,
    tax: data.tax ?? null,
    discounts: data.discounts ?? null,
    currency: data.currency || 'EUR',
    payment: data.payment ?? null,
    valid: true,
    couponCode: data.couponCode ?? null,
    dateAdd: data.placedAt ?? null,
    dateUpd: data.updatedAt ?? null,
    items: toLines(data.items),
    // Con un solo stato noto lo storico è quello: basta a datare l'incasso.
    stateHistory: data.stateId ? [{ stateId: data.stateId, date: updatedAt }] : [],
    raw: { firstName: data.firstName ?? null, lastName: data.lastName ?? null, webhookEvent: event },
  };

  const stateNames = data.stateId && data.stateName ? { [data.stateId]: data.stateName } : undefined;
  let order = toNormalizedOrder(row, contextFor(store, settings, stateNames));
  if (data.utm) order = { ...order, utm: data.utm };

  // `order.paid` è esplicito: se la mappa degli stati non è ancora allineata
  // (stato personalizzato non mappato) l'evento vale più della mappa.
  if (event === 'order.paid' && !REVENUE_ORDER_STATUSES.includes(order.normalizedStatus)) {
    const paidAt = parsePsDate(updatedAt) ?? nowIso();
    order = {
      ...order,
      normalizedStatus: 'paid',
      raw: {
        ...(order.raw ?? {}),
        [ORDER_STATE_TIMESTAMPS_KEY]: {
          paidAt,
          completedAt: null,
          cancelledAt: null,
          refundedAt: null,
        },
      },
    };
  }

  const result = await upsertOrdersBatch([order], store, {
    abandonedPaymentAfterMinutes: settings.abandonedPaymentAfterMinutes,
  });
  await recomputeContactsStats(result.contactIds, {
    repurchaseCycleDays: settings.repurchaseCycleDays,
  });

  return {
    orderId: `${order.source}_${order.externalId}`,
    status: order.normalizedStatus,
    created: result.created,
    updated: result.updated,
    contacts: result.contactIds.length,
  };
}

async function handleCart(
  raw: Record<string, unknown>,
  store: PrestaShopStoreSettings,
  settings: SiteSettings,
): Promise<Record<string, unknown>> {
  const data = siteWebhookCartSchema.parse(raw);

  // Carrello svuotato: chiudiamo quello abbandonato invece di aprirne uno vuoto.
  if (data.items.length === 0) {
    const id = abandonedCartDocId(store.source, 'cart', data.id);
    const ref = col.abandonedCarts().doc(id);
    const snapshot = await ref.get();
    if (snapshot.exists && !snapshot.get('closedAt')) {
      await ref.set(
        { closedAt: nowIso(), closedReason: 'Carrello svuotato dal cliente', updatedAt: nowIso() },
        { merge: true },
      );
      return { cartId: id, closed: true };
    }
    return { cartId: id, ignored: true };
  }

  const createdAt = data.createdAt ?? data.updatedAt ?? nowIso();
  const row: PsCartRow = {
    id: data.id,
    customerId: data.customerId ?? null,
    email: data.email,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    currency: data.currency || 'EUR',
    secureKey: data.secureKey ?? null,
    total: data.total ?? 0,
    items: toLines(data.items),
    dateAdd: createdAt,
    dateUpd: data.updatedAt ?? createdAt,
    raw: { webhookEvent: 'cart.updated' },
  };

  const cart = toNormalizedCart(row, contextFor(store, settings));
  if (data.recoveryUrl) cart.recoveryUrl = data.recoveryUrl;

  // Soglia zero: il sito ci dice che il carrello esiste ADESSO. Decidere quando
  // è "abbandonato" spetta all'automazione, che guarda `lastSeenAt`.
  const result = await upsertAbandonedCartsBatch([cart], { abandonedAfterMinutes: 0 });
  return {
    cartId: abandonedCartDocId(store.source, 'cart', data.id),
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
  };
}

async function handleCustomer(
  raw: Record<string, unknown>,
  store: PrestaShopStoreSettings,
): Promise<Record<string, unknown>> {
  const data = siteWebhookCustomerSchema.parse(raw);

  const row: PsCustomerRow = {
    id: data.id,
    email: data.email,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    company: data.company ?? null,
    vatNumber: data.vatNumber ?? null,
    taxCode: data.taxCode ?? null,
    phone: data.phone ?? null,
    newsletter: data.newsletter,
    optin: data.optin,
    active: data.active,
    isGuest: false,
    deleted: false,
    groupId: null,
    groupName: data.groupName ?? null,
    groupNames: data.groupNames ?? (data.groupName ? [data.groupName] : []),
    languageId: data.languageId ?? String(store.languageId),
    country: data.country ?? null,
    province: data.province ?? null,
    city: data.city ?? null,
    postcode: data.postcode ?? null,
    dateAdd: data.createdAt ?? null,
    dateUpd: data.updatedAt ?? null,
    raw: { webhookEvent: 'customer' },
  };

  const customer = toNormalizedCustomer(row, store);
  const result = await upsertContactFromCustomer(customer, store, {
    consentSource: `webhook:${store.source}`,
  });
  return { contactId: result.id, created: result.created };
}

// -----------------------------------------------------------------------------
// Utility HTTP
// -----------------------------------------------------------------------------

function readSecret(): string {
  try {
    return (SITE_WEBHOOK_SECRET.value() ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Corpo grezzo: la firma va verificata sui byte ricevuti, non sul JSON
 * ri-serializzato (l'ordine delle chiavi e gli spazi cambierebbero l'HMAC).
 */
function rawBodyOf(req: Request): string {
  if (req.rawBody) return req.rawBody.toString('utf8');
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
}

function signatureOf(req: Request): string | null {
  const header = req.headers['x-alphaink-signature'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  return value.startsWith('sha256=') ? value.slice(7) : value;
}
