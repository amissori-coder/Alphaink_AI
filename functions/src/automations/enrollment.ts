/**
 * Arruolamento di un contatto in uno step di automazione.
 *
 * `enroll` è l'unico punto da cui nascono le `runs`: trigger, scanner, test e
 * callable passano tutti da qui, così le regole anti-spam valgono sempre.
 *
 * Controlli applicati, nell'ordine (il primo che fallisce interrompe):
 *  1. automazione e step attivi;
 *  2. contatto contattabile (email valida e stato che consente l'invio);
 *  3. cluster esclusi;
 *  4. filtro di pubblico (`audienceFilter`), valutato con il motore dei cluster;
 *  5. cooldown fra due esecuzioni della stessa automazione;
 *  6. tetto annuale di email per contatto;
 *  7. calcolo dell'orario di invio: fascia di silenzio e giorni consentiti.
 *
 * L'idempotenza non si basa su una lettura preventiva ma sull'id del documento:
 * la `dedupeKey` **è** l'id della run, quindi due arruolamenti generati dallo
 * stesso trigger collidono dentro Firestore anche se partono in parallelo da due
 * istanze diverse.
 */

import {
  SENDABLE_STATUSES,
  dedupeKey as buildDedupeKey,
  delayToMinutes,
  isValidEmail,
  localWeekday,
  normalizeEmail,
  shiftOutOfQuietHours,
} from '@alphaink/shared';
import type {
  AbandonedCart,
  Automation,
  AutomationRun,
  AutomationStep,
  Contact,
  DocId,
  IsoDate,
  NormalizedOrderItem,
  Order,
} from '@alphaink/shared';

import { col, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import {
  buildEvaluationContext,
  createEvaluationContext,
  groupNeedsPurchaseFacts,
  matchesRules,
} from '../clusters/evaluator';
import type { EvaluationOrder, RuleGroup } from '../clusters/evaluator';
import {
  applyAutomationStats,
  createRun,
  findRunsForContact,
  getEnabledAutomationsByTrigger,
} from './repository';

const log = createLogger('automations.enrollment');

const DAY_MS = 86_400_000;

/** Esito dell'arruolamento. */
export type EnrollOutcome = 'enrolled' | 'duplicate' | 'skipped';

/** Motivo dello scarto: stringhe stabili, usate anche nei log e nei report. */
export type EnrollSkipReason =
  | 'automazione_disattivata'
  | 'step_disattivato'
  | 'email_non_valida'
  | 'contatto_non_contattabile'
  | 'cluster_escluso'
  | 'filtro_pubblico'
  | 'cooldown'
  | 'limite_annuale';

export interface EnrollInput {
  automation: Automation;
  step: AutomationStep;
  contact: Contact;
  /** Entità che ha generato il trigger. */
  source: AutomationRun['sourceType'];
  sourceId: string;
  /**
   * Istante di invio desiderato. Se assente viene calcolato come
   * `triggeredAt + step.delay`, mai nel passato.
   */
  scheduledFor?: IsoDate | null;
  /** Istante del trigger: base del ritardo dello step. Default: adesso. */
  triggeredAt?: IsoDate | null;
  /** Dati usati dal merge in fase di invio (ordine, carrello, famiglia...). */
  context?: Record<string, unknown>;
  /** Salta cooldown e tetto annuale: usato dagli invii di prova. */
  force?: boolean;
}

export interface EnrollResult {
  outcome: EnrollOutcome;
  runId?: DocId;
  dedupeKey: string;
  scheduledFor?: IsoDate;
  reason?: EnrollSkipReason;
  /** Messaggio già in italiano, mostrabile in UI. */
  message?: string;
}

// -----------------------------------------------------------------------------
// Contattabilità
// -----------------------------------------------------------------------------

/** Vero se al contatto si può scrivere adesso. */
export function isContactSendable(contact: Contact | null | undefined): boolean {
  if (!contact) return false;
  const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
  if (!email || !isValidEmail(email)) return false;
  return SENDABLE_STATUSES.includes(contact.status);
}

/** Vero se il contatto appartiene a uno dei cluster esclusi dall'automazione. */
export function isExcludedByCluster(contact: Contact, excludeClusterIds: DocId[]): boolean {
  if (!excludeClusterIds?.length) return false;
  const memberships = new Set([...(contact.clusterIds ?? []), ...(contact.dynamicClusterIds ?? [])]);
  return excludeClusterIds.some((clusterId) => memberships.has(clusterId));
}

/**
 * Valuta il filtro di pubblico sul singolo contatto.
 * Gli ordini si caricano solo se le regole li richiedono davvero
 * (`purchasedSku` / `purchasedBrand`): sono la parte costosa della valutazione.
 */
export async function matchesAudienceFilter(
  automation: Automation,
  contact: Contact,
  now: number = Date.now(),
): Promise<boolean> {
  const rules = (automation.audienceFilter ?? null) as RuleGroup | null;
  if (!rules) return true;

  if (!groupNeedsPurchaseFacts(rules)) {
    return matchesRules(rules, contact, createEvaluationContext(now));
  }

  // Si interroga per email normalizzata: è l'indice ordini già previsto
  // (`emailNormalized` + `placedAt`) e copre anche gli ordini non ancora
  // collegati al documento contatto.
  const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
  const snapshot = await col
    .orders()
    .where('emailNormalized', '==', email)
    .orderBy('placedAt', 'desc')
    .limit(100)
    .get();
  const orders = snapshot.docs.map((doc) => serializeDoc<EvaluationOrder>(doc.data()));
  return matchesRules(rules, contact, buildEvaluationContext(orders, now));
}

// -----------------------------------------------------------------------------
// Calcolo dell'orario di invio
// -----------------------------------------------------------------------------

/**
 * Sposta l'invio al primo giorno consentito.
 * Avanza di 24 ore alla volta (massimo una settimana) e ri-applica la fascia di
 * silenzio: cambiando giorno l'orario potrebbe rientrarci.
 */
export function shiftToAllowedWeekday(
  iso: IsoDate,
  allowedWeekdays: number[] | undefined,
  timezone: string,
  quietHours?: { start: string; end: string } | null,
): IsoDate {
  if (!allowedWeekdays?.length || allowedWeekdays.length >= 7) return iso;
  let candidate = iso;
  for (let i = 0; i < 7; i += 1) {
    if (allowedWeekdays.includes(localWeekday(candidate, timezone))) return candidate;
    // Il giorno successivo alla stessa ora, poi fuori dalla fascia di silenzio.
    candidate = new Date(Date.parse(candidate) + DAY_MS).toISOString();
    if (quietHours) candidate = shiftOutOfQuietHours(candidate, quietHours, timezone);
  }
  return candidate;
}

/**
 * Istante di invio definitivo dello step.
 * Mai nel passato: una run "in ritardo" partirebbe comunque al primo giro del
 * dispatcher, ma con una data coerente i report restano leggibili.
 */
export function computeScheduledFor(input: {
  automation: Automation;
  step: AutomationStep;
  scheduledFor?: IsoDate | null;
  triggeredAt?: IsoDate | null;
  now?: IsoDate;
}): IsoDate {
  const now = input.now ?? nowIso();
  const nowMs = Date.parse(now);

  let target: number;
  if (input.scheduledFor) {
    target = Date.parse(input.scheduledFor);
  } else {
    const base = Date.parse(input.triggeredAt ?? now);
    target = base + delayToMinutes(input.step.delay) * 60_000;
  }
  if (!Number.isFinite(target) || target < nowMs) target = nowMs;

  const timezone = input.automation.timezone || 'Europe/Rome';
  let iso = new Date(target).toISOString();
  if (input.automation.quietHours) {
    iso = shiftOutOfQuietHours(iso, input.automation.quietHours, timezone);
  }
  return shiftToAllowedWeekday(iso, input.automation.allowedWeekdays, timezone, input.automation.quietHours);
}

// -----------------------------------------------------------------------------
// Regole di frequenza
// -----------------------------------------------------------------------------

/** Run che "contano" per cooldown e tetto annuale. */
function isCountedRun(run: AutomationRun): boolean {
  return run.status === 'sent' || run.status === 'scheduled';
}

export interface FrequencyCheck {
  ok: boolean;
  reason?: EnrollSkipReason;
  message?: string;
}

/**
 * Verifica cooldown e tetto annuale.
 *
 * Le run generate dallo **stesso trigger** (stesso `sourceId`) sono escluse dal
 * cooldown: altrimenti il secondo step di un'automazione multi-step verrebbe
 * scartato dal primo appena creato.
 */
export async function checkFrequency(
  automation: Automation,
  contact: Contact,
  sourceId: string,
  now: IsoDate = nowIso(),
): Promise<FrequencyCheck> {
  const cooldownDays = Math.max(0, automation.cooldownDays ?? 0);
  const yearlyCap = automation.maxPerContactPerYear ?? null;
  if (cooldownDays === 0 && !yearlyCap) return { ok: true };

  const nowMs = Date.parse(now);
  const windowDays = Math.max(cooldownDays, yearlyCap ? 365 : 0);
  const since = new Date(nowMs - windowDays * DAY_MS).toISOString();

  const runs = (
    await findRunsForContact({
      contactId: contact.id,
      automationKey: automation.key,
      since,
      limit: 400,
    })
  ).filter(isCountedRun);

  if (cooldownDays > 0) {
    const cooldownSince = nowMs - cooldownDays * DAY_MS;
    const recent = runs.find(
      (run) => run.sourceId !== sourceId && Date.parse(run.createdAt) >= cooldownSince,
    );
    if (recent) {
      return {
        ok: false,
        reason: 'cooldown',
        message: `Il contatto ha già ricevuto questa automazione negli ultimi ${cooldownDays} giorni.`,
      };
    }
  }

  if (yearlyCap && runs.length >= yearlyCap) {
    return {
      ok: false,
      reason: 'limite_annuale',
      message: `Raggiunto il tetto di ${yearlyCap} invii all'anno per questo contatto.`,
    };
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// enroll
// -----------------------------------------------------------------------------

function skip(dedupe: string, reason: EnrollSkipReason, message: string): EnrollResult {
  return { outcome: 'skipped', dedupeKey: dedupe, reason, message };
}

/**
 * Arruola un contatto in uno step, creando la `run` corrispondente.
 *
 * Non aggiorna le statistiche dell'automazione: lo fa il chiamante, che spesso
 * arruola più contatti e conviene aggiorni i contatori una volta sola.
 */
export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  const { automation, step, contact } = input;
  const now = nowIso();
  const dedupe = buildDedupeKey([automation.key, step.id, contact.id, input.sourceId]);

  if (!automation.enabled && !input.force) {
    return skip(dedupe, 'automazione_disattivata', `L'automazione "${automation.name}" è disattivata.`);
  }
  if (!step.enabled && !input.force) {
    return skip(dedupe, 'step_disattivato', `Lo step "${step.name}" è disattivato.`);
  }

  const email = contact.emailNormalized || normalizeEmail(contact.email ?? '');
  if (!email || !isValidEmail(email)) {
    return skip(dedupe, 'email_non_valida', 'Il contatto non ha un indirizzo email valido.');
  }
  if (!isContactSendable(contact)) {
    return skip(
      dedupe,
      'contatto_non_contattabile',
      `Il contatto non è iscritto (stato: ${contact.status}).`,
    );
  }
  if (isExcludedByCluster(contact, automation.excludeClusterIds ?? [])) {
    return skip(dedupe, 'cluster_escluso', 'Il contatto appartiene a un cluster escluso dall\'automazione.');
  }
  if (!(await matchesAudienceFilter(automation, contact, Date.parse(now)))) {
    return skip(dedupe, 'filtro_pubblico', 'Il contatto non soddisfa il filtro di pubblico dell\'automazione.');
  }

  if (!input.force) {
    const frequency = await checkFrequency(automation, contact, input.sourceId, now);
    if (!frequency.ok) {
      return skip(dedupe, frequency.reason ?? 'cooldown', frequency.message ?? 'Invio troppo ravvicinato.');
    }
  }

  const scheduledFor = computeScheduledFor({
    automation,
    step,
    scheduledFor: input.scheduledFor,
    triggeredAt: input.triggeredAt,
    now,
  });

  const run: Omit<AutomationRun, 'id'> = {
    automationId: automation.id,
    automationKey: automation.key,
    stepId: step.id,
    contactId: contact.id,
    email,
    dedupeKey: dedupe,
    sourceType: input.source,
    sourceId: input.sourceId,
    status: 'scheduled',
    scheduledFor,
    processedAt: null,
    sentAt: null,
    messageId: null,
    cancelledReason: null,
    skipReason: null,
    error: null,
    couponCode: null,
    couponExpiresAt: null,
    convertedOrderId: null,
    revenue: null,
    context: input.context ?? {},
    createdAt: now,
  };

  const { created, id } = await createRun(automation.id, run);
  if (!created) {
    log.debug('Arruolamento duplicato ignorato', { dedupeKey: dedupe });
    return { outcome: 'duplicate', dedupeKey: dedupe, runId: id, scheduledFor };
  }

  return { outcome: 'enrolled', dedupeKey: dedupe, runId: id, scheduledFor };
}

/**
 * Arruola il contatto in **tutti** gli step attivi di un'automazione.
 * È la forma usata dai trigger: ogni step ha il proprio ritardo calcolato
 * dall'istante del trigger, quindi le run nascono tutte insieme.
 */
export async function enrollAllSteps(
  input: Omit<EnrollInput, 'step'>,
): Promise<{ enrolled: number; duplicate: number; skipped: number; results: EnrollResult[] }> {
  const results: EnrollResult[] = [];
  for (const step of input.automation.steps ?? []) {
    if (!step.enabled && !input.force) continue;
    results.push(await enroll({ ...input, step }));
  }
  return {
    enrolled: results.filter((r) => r.outcome === 'enrolled').length,
    duplicate: results.filter((r) => r.outcome === 'duplicate').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    results,
  };
}

/**
 * Arruola un contatto in tutte le automazioni attive di un tipo di trigger.
 *
 * È il gancio generico usato dai moduli che possiedono altri trigger: il
 * modulo contatti, per esempio, chiama `enrollByTrigger('contact_subscribed',
 * contact, ...)` alla prima iscrizione per far partire il Benvenuto.
 */
export async function enrollByTrigger(
  triggerType: Automation['trigger']['type'],
  contact: Contact,
  options: {
    source: AutomationRun['sourceType'];
    sourceId: string;
    triggeredAt?: IsoDate | null;
    context?: Record<string, unknown>;
  },
): Promise<{ automations: number; enrolled: number }> {
  const automations = await getEnabledAutomationsByTrigger(triggerType);
  let enrolled = 0;

  for (const automation of automations) {
    const result = await enrollAllSteps({
      automation,
      contact,
      source: options.source,
      sourceId: options.sourceId,
      triggeredAt: options.triggeredAt ?? null,
      context: options.context,
    });
    if (result.enrolled > 0) {
      await applyAutomationStats(automation.id, {
        automation: { enrolled: 1, scheduled: result.enrolled },
        lastRunAt: nowIso(),
      });
      enrolled += result.enrolled;
    }
  }

  return { automations: automations.length, enrolled };
}

// -----------------------------------------------------------------------------
// Contesto della run
// -----------------------------------------------------------------------------

/**
 * Istantanea dell'ordine (o del carrello) salvata nella run.
 *
 * È volutamente ridotta: al momento dell'invio i dati devono essere quelli del
 * trigger, non quelli attuali, e un documento leggero costa meno da leggere in
 * un dispatcher che ne processa centinaia per ciclo. La forma coincide con
 * `MergeOrderInput` del renderer, così il dispatcher la passa senza conversioni.
 */
export interface RunOrderContext {
  orderNumber?: string | null;
  externalId?: string | null;
  total?: number | null;
  currency?: string | null;
  placedAt?: IsoDate | null;
  abandonedAt?: IsoDate | null;
  items?: NormalizedOrderItem[];
  recoveryUrl?: string | null;
}

/** Massimo di righe conservate nel contesto: nelle email non se ne mostrano di più. */
const MAX_CONTEXT_ITEMS = 12;

function trimItems(items: NormalizedOrderItem[] | undefined): NormalizedOrderItem[] {
  return (items ?? []).slice(0, MAX_CONTEXT_ITEMS).map((item) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.total,
    family: item.family,
    brand: item.brand ?? null,
    printerModels: item.printerModels ?? [],
  }));
}

export function orderContextFrom(order: Order): RunOrderContext {
  return {
    orderNumber: order.orderNumber ?? null,
    externalId: order.externalId ?? null,
    total: order.total ?? null,
    currency: order.currency ?? null,
    placedAt: order.placedAt ?? null,
    items: trimItems(order.items),
    recoveryUrl: null,
  };
}

export function cartContextFrom(cart: AbandonedCart): RunOrderContext {
  return {
    orderNumber: cart.kind === 'payment' ? cart.externalId : null,
    externalId: cart.externalId ?? null,
    total: cart.total ?? null,
    currency: cart.currency ?? null,
    placedAt: null,
    abandonedAt: cart.abandonedAt ?? null,
    items: trimItems(cart.items),
    recoveryUrl: cart.recoveryUrl ?? null,
  };
}

/** Legge il contesto ordine di una run, qualunque sia il trigger che l'ha creata. */
export function readOrderContext(run: Pick<AutomationRun, 'context'>): RunOrderContext | null {
  const context = run.context as { order?: RunOrderContext } | undefined;
  return context?.order ?? null;
}
