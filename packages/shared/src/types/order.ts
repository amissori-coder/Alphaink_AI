import type { AuditFields, DocId, IsoDate } from './common';
import type { NormalizedOrderItem, OrderStatus, SiteSource, UtmParams } from './site';
import type { OrderAttribution } from './tracking';

/** Ordine persistito su Firestore, arricchito con l'attribuzione. */
export interface Order extends AuditFields {
  id: DocId;
  externalId: string;
  source: SiteSource;
  orderNumber?: string | null;
  email: string;
  emailNormalized: string;
  contactId?: DocId | null;

  status: OrderStatus;
  rawStatus: string;
  total: number;
  subtotal?: number | null;
  shipping?: number | null;
  tax?: number | null;
  currency: string;
  couponCode?: string | null;

  items: NormalizedOrderItem[];
  /** Famiglie prodotto presenti nell'ordine: indicizzate per query rapide. */
  families: string[];
  skus: string[];

  placedAt: IsoDate;
  paidAt?: IsoDate | null;
  completedAt?: IsoDate | null;
  cancelledAt?: IsoDate | null;
  refundedAt?: IsoDate | null;
  refundedAmount?: number | null;

  utm?: UtmParams | null;
  attribution?: OrderAttribution | null;
  /** Attribuzioni multiple in modello lineare. */
  attributions?: OrderAttribution[];

  lastSyncAt: IsoDate;
}

/** Carrello/pagamento abbandonato. */
export interface AbandonedCart extends AuditFields {
  id: DocId;
  externalId: string;
  source: SiteSource;
  email: string;
  emailNormalized: string;
  contactId?: DocId | null;
  /** `cart` = carrello mai convertito; `payment` = ordine creato ma non pagato. */
  kind: 'cart' | 'payment';
  /** Se `kind === 'payment'`, l'ordine non pagato. */
  orderId?: DocId | null;
  total: number;
  currency: string;
  items: NormalizedOrderItem[];
  recoveryUrl?: string | null;
  abandonedAt: IsoDate;
  lastSeenAt: IsoDate;
  remindersSent: number;
  lastReminderAt?: IsoDate | null;
  recoveredAt?: IsoDate | null;
  recoveredOrderId?: DocId | null;
  recoveredRevenue?: number | null;
  /** Chiuso senza recupero (scaduto o cliente disiscritto). */
  closedAt?: IsoDate | null;
  closedReason?: string | null;
}

/** Coupon emesso dalla piattaforma newsletter. */
export interface IssuedCoupon extends AuditFields {
  id: DocId;
  code: string;
  automationId?: DocId | null;
  automationRunId?: DocId | null;
  newsletterId?: DocId | null;
  contactId: DocId;
  email: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderTotal?: number | null;
  restrictToSkus?: string[];
  restrictToFamilies?: string[];
  issuedAt: IsoDate;
  expiresAt: IsoDate;
  /** Sincronizzato sul sito come `cart_rule` PrestaShop. */
  siteCouponId?: string | null;
  siteSyncError?: string | null;
  redeemedAt?: IsoDate | null;
  redeemedOrderId?: DocId | null;
  redeemedAmount?: number | null;
}
