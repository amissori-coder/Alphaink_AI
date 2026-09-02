/**
 * Dispatcher delle automazioni: ogni 5 minuti prende le `runs` scadute e le
 * trasforma in email realmente spedite.
 *
 * Ciclo di vita di una run:
 *
 *   scheduled ──claim──▶ (valutazione cancelIf) ──▶ sent
 *        │                        │
 *        │                        ├──▶ cancelled  (condizione soddisfatta,
 *        │                        │                contatto non più iscritto)
 *        │                        └──▶ skipped    (contenuto assente,
 *        │                                         modalità test senza indirizzi)
 *        └──────────────────────────▶ failed      (errore di invio o rendering)
 *
 * Punti delicati:
 *  - **Claim transazionale**: due istanze del dispatcher possono pescare la
 *    stessa run. La transazione scrive `processedAt` e chi arriva secondo la
 *    salta; un claim più vecchio di 10 minuti viene considerato abbandonato e
 *    può essere ripreso (l'istanza precedente è morta).
 *  - **Coupon prima dell'invio**: se la politica prevede un buono e l'emissione
 *    fallisce, l'email NON parte. Meglio nessun messaggio che un messaggio con
 *    un codice inesistente.
 *  - **Limite orario**: `maxSendsPerHour` è verificato contando gli invii
 *    dell'ultima ora prima di iniziare, così un picco di run scadute non brucia
 *    la reputazione del dominio.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  REVENUE_ORDER_STATUSES,
  displayNameFor,
  normalizeEmail,
} from '@alphaink/shared';
import type {
  Automation,
  AutomationRun,
  AutomationStep,
  CancelCondition,
  Contact,
  DocId,
  EmailDocument,
  IsoDate,
  ProductFamily,
  UtmParams,
} from '@alphaink/shared';

import { mapWithConcurrency } from '../lib/async';
import { APP_URL, BREVO_API_KEY, HEAVY_RUNTIME, LINK_SIGNING_KEY, STORE_SECRETS, TIMEZONE } from '../lib/config';
import { col, db, logActivity, nowIso, serializeDoc, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { createToken } from '../lib/signing';
import { sendTransactionalEmail } from '../brevo/transactional';
import { readApiKeyFromSecret, readBrevoSettings, resolveReplyTo, resolveSender } from '../brevo/settings';
import { getContactsByIds } from '../contacts/repository';
import { buildEmail, buildMergeContext, resolveMergeTags } from '../render';
import { issueCoupon } from './coupons';
import { isContactSendable, readOrderContext } from './enrollment';
import type { RunOrderContext } from './enrollment';
import {
  applyAutomationStats,
  dueRuns,
  findStep,
  getAutomation,
  readBrandingSettings,
  readTrackingSettings,
  runsRef,
  updateRun,
} from './repository';

const log = createLogger('automations.dispatcher');

/** Run prelevate al massimo in una corsa. */
export const DISPATCH_BATCH_SIZE = 300;

/** Invii in parallelo: oltre questa soglia Brevo inizia a rallentare. */
export const DISPATCH_CONCURRENCY = 8;

/** Budget di lavoro: lascia margine sul timeout di 540 s. */
export const DISPATCH_TIME_BUDGET_MS = 6 * 60 * 1000;

/** Un claim più vecchio di così appartiene a un'istanza morta: si può riprendere. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** Durata dei token di disiscrizione/preferenze inseriti nelle email. */
const TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60;

// -----------------------------------------------------------------------------
// URL di sistema
// -----------------------------------------------------------------------------

export interface SystemUrls {
  unsubscribeUrl: string;
  preferencesUrl: string;
  webviewUrl: string;
}

/**
 * Link firmati verso le pagine pubbliche (`unsubscribePage`, `preferencesPage`,
 * `webviewPage`). Un solo token per tutti e tre: contiene contatto ed email, ed
 * è verificabile senza interrogare Firestore.
 */
export function buildSystemUrls(
  appUrl: string,
  secret: string,
  contact: { id: DocId; email: string },
  ref: string,
): SystemUrls {
  const base = String(appUrl ?? '').replace(/\/+$/, '');
  if (!secret) {
    // Senza chiave di firma i link resterebbero falsificabili: si ripiega sulla
    // pagina preferenze generica, che chiede l'email al visitatore.
    return {
      unsubscribeUrl: `${base}/u`,
      preferencesUrl: `${base}/p`,
      webviewUrl: `${base}/v`,
    };
  }
  const token = createToken(
    {
      data: { c: contact.id, e: contact.email, r: ref },
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    },
    secret,
  );
  return {
    unsubscribeUrl: `${base}/u/${token}`,
    preferencesUrl: `${base}/p/${token}`,
    webviewUrl: `${base}/v/${token}`,
  };
}

// -----------------------------------------------------------------------------
// Claim
// -----------------------------------------------------------------------------

/**
 * Prende in carico la run: restituisce il documento aggiornato se il claim è
 * riuscito, `null` se qualcun altro se n'è già occupato.
 */
export async function claimRun(automationId: DocId, runId: DocId): Promise<AutomationRun | null> {
  const ref = runsRef(automationId).doc(runId);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const run: AutomationRun = {
      ...serializeDoc<AutomationRun>(snapshot.data() ?? {}),
      id: runId,
      automationId,
    };
    if (run.status !== 'scheduled') return null;
    const claimedAt = run.processedAt ? Date.parse(run.processedAt) : 0;
    if (claimedAt && Date.now() - claimedAt < STALE_CLAIM_MS) return null;
    tx.set(ref, { processedAt: nowIso() }, { merge: true });
    return run;
  });
}

// -----------------------------------------------------------------------------
// Condizioni di annullamento
// -----------------------------------------------------------------------------

/** Famiglie prodotto associate alla run (contesto o trigger dell'automazione). */
function familiesOf(run: AutomationRun, automation: Automation): ProductFamily[] {
  const context = run.context as { family?: string; families?: string[] } | undefined;
  if (context?.family) return [context.family as ProductFamily];
  if (context?.families?.length) return context.families as ProductFamily[];
  return (automation.trigger?.productFamilies ?? []) as ProductFamily[];
}

/**
 * Rivaluta le condizioni di annullamento immediatamente prima dell'invio.
 * Restituisce la prima condizione soddisfatta, oppure `null`.
 */
export async function evaluateCancelConditions(
  run: AutomationRun,
  automation: Automation,
  step: AutomationStep,
  contact: Contact,
): Promise<CancelCondition | null> {
  const conditions = step.cancelIf ?? [];
  if (!conditions.length) return null;

  const context = run.context as { orderId?: string; cartId?: string } | undefined;
  const triggeredAtMs = Date.parse(run.createdAt);

  for (const condition of conditions) {
    if (condition === 'contact_unsubscribed') {
      if (!isContactSendable(contact)) return condition;
      continue;
    }

    if (condition === 'order_completed') {
      const orderId = context?.orderId ?? (run.sourceType === 'order' ? run.sourceId : null);
      if (!orderId) continue;
      const snapshot = await col.orders().doc(orderId).get();
      if (snapshot.exists && REVENUE_ORDER_STATUSES.includes(snapshot.get('status'))) {
        return condition;
      }
      continue;
    }

    if (condition === 'cart_recovered') {
      const cartId = context?.cartId ?? (run.sourceType === 'cart' ? run.sourceId : null);
      if (!cartId) continue;
      const snapshot = await col.abandonedCarts().doc(cartId).get();
      if (snapshot.exists && (snapshot.get('recoveredAt') || snapshot.get('closedAt'))) {
        return condition;
      }
      continue;
    }

    if (condition === 'repurchased') {
      const families = familiesOf(run, automation);
      const lastByFamily = contact.stats?.lastOrderByFamily ?? {};
      const repurchased = families.some((family) => {
        const last = lastByFamily[family];
        return Boolean(last && Date.parse(last) > triggeredAtMs);
      });
      if (repurchased) return condition;
      continue;
    }

    if (condition === 'contact_purchased_any') {
      const last = contact.stats?.lastOrderAt;
      if (last && Date.parse(last) > triggeredAtMs) return condition;
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Contenuto
// -----------------------------------------------------------------------------

/** Documento dello step: quello proprio, altrimenti il template collegato. */
export async function resolveStepDocument(step: AutomationStep): Promise<EmailDocument | null> {
  if (step.document) return step.document;
  if (!step.templateId) return null;
  const snapshot = await col.templates().doc(step.templateId).get();
  if (!snapshot.exists) return null;
  const document = snapshot.get('document') as EmailDocument | undefined;
  return document ?? null;
}

/**
 * Tocco di attribuzione registrato all'invio.
 *
 * `touchType: 'send'` non fa parte dell'unione `AttributionTouch` (che copre
 * apertura e click): il modello di attribuzione interroga sempre per
 * `touchType == 'open' | 'click'`, quindi questo documento resta fuori dai
 * calcoli e serve solo a ricostruire la sequenza completa degli invii.
 */
interface SendTouch {
  contactId: DocId;
  email: string;
  source: 'automation';
  newsletterId: null;
  automationId: DocId;
  automationRunId: DocId;
  variantId: null;
  touchType: 'send';
  url: null;
  occurredAt: IsoDate;
  attributedOrderId: null;
}

// -----------------------------------------------------------------------------
// Esito dell'elaborazione di una run
// -----------------------------------------------------------------------------

export type RunOutcome = 'sent' | 'cancelled' | 'skipped' | 'failed' | 'claim_perso';

interface RunResult {
  outcome: RunOutcome;
  automationId: DocId;
  stepId: string;
  revenueCurrency?: string;
  error?: string;
}

interface DispatchEnvironment {
  apiKey: string;
  appUrl: string;
  signingKey: string;
  branding: Awaited<ReturnType<typeof readBrandingSettings>>;
  tracking: Awaited<ReturnType<typeof readTrackingSettings>>;
  brevo: Awaited<ReturnType<typeof readBrevoSettings>>;
}

function utmFor(automation: Automation, step: AutomationStep, env: DispatchEnvironment): UtmParams | null {
  if (!env.tracking.autoUtm) return null;
  return {
    source: env.tracking.utmSource || 'newsletter',
    medium: env.tracking.utmMedium || 'email',
    campaign: `automazione-${automation.key}`,
    content: step.id,
    term: null,
  };
}

/**
 * Elabora una singola run: valuta, costruisce, invia e aggiorna.
 * Non solleva: qualunque errore diventa `failed` e viene riportato al chiamante.
 */
async function processRun(
  run: AutomationRun,
  automation: Automation,
  contactsById: Map<DocId, Contact>,
  env: DispatchEnvironment,
): Promise<RunResult> {
  const base: RunResult = { outcome: 'failed', automationId: automation.id, stepId: run.stepId };

  const claimed = await claimRun(automation.id, run.id);
  if (!claimed) return { ...base, outcome: 'claim_perso' };

  const step = findStep(automation, run.stepId);
  if (!step) {
    await updateRun(automation.id, run.id, {
      status: 'skipped',
      skipReason: 'Lo step non esiste più nell\'automazione.',
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'skipped' };
  }

  const contact = contactsById.get(run.contactId) ?? null;
  if (!contact) {
    await updateRun(automation.id, run.id, {
      status: 'skipped',
      skipReason: 'Contatto non più presente in rubrica.',
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'skipped' };
  }

  // 1. Condizioni di annullamento.
  const cancelled = await evaluateCancelConditions(claimed, automation, step, contact);
  if (cancelled) {
    await updateRun(automation.id, run.id, {
      status: 'cancelled',
      cancelledReason: cancelled,
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'cancelled' };
  }
  if (!isContactSendable(contact)) {
    await updateRun(automation.id, run.id, {
      status: 'cancelled',
      cancelledReason: 'not_sendable',
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'cancelled' };
  }

  // 2. Contenuto.
  const document = await resolveStepDocument(step);
  if (!document) {
    await updateRun(automation.id, run.id, {
      status: 'skipped',
      skipReason: 'Lo step non ha un documento email né un template collegato.',
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'skipped' };
  }

  // 3. Destinatari (modalità test compresa).
  const recipients = automation.testMode
    ? (automation.testRecipients ?? []).map((email) => normalizeEmail(email)).filter(Boolean)
    : [normalizeEmail(contact.emailNormalized || contact.email)];
  if (!recipients.length) {
    await updateRun(automation.id, run.id, {
      status: 'skipped',
      skipReason: 'Modalità test attiva ma nessun indirizzo di prova configurato.',
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'skipped' };
  }

  try {
    // 4. Coupon: prima dell'invio, perché il codice finisce nel corpo dell'email.
    let couponCode: string | null = null;
    let couponExpiresAt: IsoDate | null = null;
    let couponLabel: string | null = null;
    if (step.coupon?.enabled) {
      const issued = await issueCoupon({ policy: step.coupon, contact, automation, run: claimed });
      couponCode = issued.code;
      couponExpiresAt = issued.expiresAt;
      couponLabel = issued.discountLabel;
    }

    // 5. Contesto di merge e URL di sistema.
    // Formato del riferimento d'invio condiviso con il modulo di tracciamento
    // (`parseSendRef`): `a:<automationId>:<stepId>:<runId>`. Portare anche la
    // run permette di attribuire click e aperture alla singola esecuzione.
    const ref = `a:${automation.id}:${step.id}:${run.id}`;
    const orderContext: RunOrderContext | null = readOrderContext(claimed);
    const urls = {
      ...buildSystemUrls(env.appUrl, env.signingKey, { id: contact.id, email: contact.email }, ref),
      recoveryUrl: orderContext?.recoveryUrl ?? env.branding.websiteUrl,
      couponUrl: null,
    };

    const merge = buildMergeContext({
      contact,
      order: orderContext ?? undefined,
      coupon: couponCode
        ? {
            code: couponCode,
            discountType: step.coupon?.discountType ?? 'percent',
            discountValue: step.coupon?.discountValue ?? 0,
            discountLabel: couponLabel,
            expiresAt: couponExpiresAt,
          }
        : undefined,
      branding: env.branding,
      urls,
      timezone: automation.timezone || TIMEZONE,
      locale: DEFAULT_LOCALE,
      currency: orderContext?.currency ?? DEFAULT_CURRENCY,
    });

    const subject = resolveMergeTags(step.subject, merge);
    const preheader = resolveMergeTags(step.preheader ?? '', merge);

    // 6. Costruzione dell'email.
    const email = buildEmail({
      document,
      context: { subject, preheader, merge, urls, branding: env.branding, contact },
      branding: env.branding,
      tracking: {
        clickTracking: env.tracking.useOwnClickTracking,
        openTracking: true,
        ref,
        contactId: contact.id,
        secret: env.signingKey,
        appUrl: env.appUrl,
        utm: utmFor(automation, step, env),
      },
    });

    if (email.blocking) {
      const problems = email.warnings.filter((warning) => warning.severity === 'errore');
      const message = problems.map((warning) => warning.message).join(' ');
      await updateRun(automation.id, run.id, {
        status: 'failed',
        error: message || 'Il contenuto dell\'email non è valido.',
        processedAt: nowIso(),
      });
      return { ...base, outcome: 'failed', error: message };
    }

    // 7. Invio.
    const sender = resolveSender(env.brevo, { email: automation.fromEmail, name: automation.fromName });
    const replyTo = resolveReplyTo(env.brevo, automation.replyTo ?? null);
    const name = displayNameFor({
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      email: contact.email,
    });

    const sent = await sendTransactionalEmail(env.apiKey, {
      to: recipients.map((email) => ({ email, name })),
      sender,
      replyTo,
      subject: automation.testMode ? `[TEST] ${subject}` : subject,
      htmlContent: email.html,
      textContent: email.text,
      source: 'automation',
      ref,
      tags: [automation.key, step.id],
      // Brevo restituisce `X-Mailin-custom` nei webhook: è il filo che lega
      // consegne, aperture e click a questa run e a questo contatto.
      headers: {
        'X-Mailin-custom': JSON.stringify({
          ref,
          source: 'automation',
          automationId: automation.id,
          automationRunId: run.id,
          contactId: contact.id,
        }),
      },
      // La chiave di deduplica protegge da un doppio invio in caso di retry.
      idempotencyKey: run.dedupeKey,
    });

    const sentAt = nowIso();
    await updateRun(automation.id, run.id, {
      status: 'sent',
      sentAt,
      processedAt: sentAt,
      messageId: sent.messageId || null,
      couponCode,
      couponExpiresAt,
      error: null,
      ...(automation.testMode ? { context: { testRecipients: recipients } } : {}),
    });

    // 8. Tocco di attribuzione e contatori del carrello.
    const touch: SendTouch = {
      contactId: contact.id,
      email: contact.emailNormalized || normalizeEmail(contact.email),
      source: 'automation',
      newsletterId: null,
      automationId: automation.id,
      automationRunId: run.id,
      variantId: null,
      touchType: 'send',
      url: null,
      occurredAt: sentAt,
      attributedOrderId: null,
    };
    await col.attributionTouches().add(touch);

    const cartId = (claimed.context as { cartId?: string } | undefined)?.cartId;
    if (cartId) {
      const cartRef = col.abandonedCarts().doc(cartId);
      const snapshot = await cartRef.get();
      if (snapshot.exists) {
        await cartRef.set(
          {
            remindersSent: (Number(snapshot.get('remindersSent')) || 0) + 1,
            lastReminderAt: sentAt,
            updatedAt: sentAt,
          },
          { merge: true },
        );
      }
    }

    return { ...base, outcome: 'sent' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore sconosciuto';
    log.error('Invio automazione non riuscito', error, {
      automationId: automation.id,
      runId: run.id,
      stepId: run.stepId,
    });
    await updateRun(automation.id, run.id, {
      status: 'failed',
      error: message,
      processedAt: nowIso(),
    });
    return { ...base, outcome: 'failed', error: message };
  }
}

// -----------------------------------------------------------------------------
// Limite orario
// -----------------------------------------------------------------------------

/**
 * Invii dell'ultima ora per un'automazione.
 * `select()` scarica solo i riferimenti dei documenti: serve contarli, non
 * leggerli.
 */
async function countSentLastHour(automationId: DocId, cap: number): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const snapshot = await runsRef(automationId)
    .where('sentAt', '>=', since)
    .select()
    .limit(cap + 1)
    .get();
  return snapshot.size;
}

// -----------------------------------------------------------------------------
// Corsa completa
// -----------------------------------------------------------------------------

export interface DispatchSummary {
  claimed: number;
  sent: number;
  cancelled: number;
  skipped: number;
  failed: number;
  throttled: number;
  durationMs: number;
}

/** Corpo del dispatcher, isolato per test e shell. */
export async function runAutomationDispatch(
  options: { limit?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<DispatchSummary> {
  const startedAt = Date.now();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
    throttled: 0,
    durationMs: 0,
  };

  const runs = await dueRuns(options.limit ?? DISPATCH_BATCH_SIZE);
  if (!runs.length) {
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const apiKey = readApiKeyFromSecret();
  if (!apiKey) {
    log.warn('Chiave API Brevo non configurata: nessun invio automazione eseguito', {
      pending: runs.length,
    });
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }

  const [brevo, branding, tracking] = await Promise.all([
    readBrevoSettings(),
    readBrandingSettings(),
    readTrackingSettings(),
  ]);

  let signingKey = '';
  try {
    signingKey = LINK_SIGNING_KEY.value() ?? '';
  } catch {
    signingKey = '';
  }
  let appUrl = 'https://newsletter.alphaink.net';
  try {
    appUrl = APP_URL.value() || appUrl;
  } catch {
    // Fuori dal runtime Functions il parametro non è risolvibile: resta il default.
  }

  const env: DispatchEnvironment = { apiKey, appUrl, signingKey, branding, tracking, brevo };

  // Automazioni coinvolte, caricate una sola volta.
  const automations = new Map<DocId, Automation>();
  for (const id of new Set(runs.map((run) => run.automationId).filter(Boolean))) {
    const automation = await getAutomation(id);
    if (automation) automations.set(id, automation);
  }

  // Limite orario: quante run possiamo ancora inviare per automazione.
  const budgetByAutomation = new Map<DocId, number>();
  for (const [id, automation] of automations) {
    const cap = automation.maxSendsPerHour ?? null;
    if (!cap) {
      budgetByAutomation.set(id, Number.POSITIVE_INFINITY);
      continue;
    }
    const alreadySent = await countSentLastHour(id, cap);
    budgetByAutomation.set(id, Math.max(0, cap - alreadySent));
  }

  // Selezione: si scartano le run senza automazione e quelle oltre il limite.
  const selected: AutomationRun[] = [];
  for (const run of runs) {
    const automation = automations.get(run.automationId);
    if (!automation) continue;
    const remaining = budgetByAutomation.get(run.automationId) ?? 0;
    if (remaining <= 0) {
      summary.throttled += 1;
      continue;
    }
    budgetByAutomation.set(run.automationId, remaining - 1);
    selected.push(run);
  }

  const contacts = await getContactsByIds(Array.from(new Set(selected.map((run) => run.contactId))));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

  const budget = options.budgetMs ?? DISPATCH_TIME_BUDGET_MS;
  const results = await mapWithConcurrency(
    selected,
    options.concurrency ?? DISPATCH_CONCURRENCY,
    async (run) => {
      if (Date.now() - startedAt > budget) {
        // Le run non lavorate restano `scheduled`: le riprende la corsa dopo.
        return null;
      }
      const automation = automations.get(run.automationId) as Automation;
      return processRun(run, automation, contactsById, env);
    },
  );

  // Statistiche aggregate: una scrittura per automazione.
  const deltas = new Map<
    DocId,
    { steps: Record<string, { sent?: number; cancelled?: number }>; sent: number; cancelled: number }
  >();

  for (const result of results) {
    if (!result) continue;
    if (result.outcome === 'claim_perso') continue;
    summary.claimed += 1;
    if (result.outcome === 'sent') summary.sent += 1;
    if (result.outcome === 'cancelled') summary.cancelled += 1;
    if (result.outcome === 'skipped') summary.skipped += 1;
    if (result.outcome === 'failed') summary.failed += 1;

    if (result.outcome !== 'sent' && result.outcome !== 'cancelled') continue;
    const entry = deltas.get(result.automationId) ?? { steps: {}, sent: 0, cancelled: 0 };
    const step = entry.steps[result.stepId] ?? {};
    if (result.outcome === 'sent') {
      step.sent = (step.sent ?? 0) + 1;
      entry.sent += 1;
    } else {
      step.cancelled = (step.cancelled ?? 0) + 1;
      entry.cancelled += 1;
    }
    entry.steps[result.stepId] = step;
    deltas.set(result.automationId, entry);
  }

  for (const [automationId, entry] of deltas) {
    await applyAutomationStats(automationId, {
      steps: entry.steps,
      automation: { sent: entry.sent, cancelled: entry.cancelled },
      lastRunAt: nowIso(),
      lastError: null,
    });
  }

  summary.durationMs = Date.now() - startedAt;
  log.info('Corsa del dispatcher completata', { ...summary });
  return summary;
}

export const scheduledAutomationDispatcher = onSchedule(
  {
    ...HEAVY_RUNTIME,
    schedule: 'every 5 minutes',
    timeZone: TIMEZONE,
    retryCount: 0,
    secrets: [BREVO_API_KEY, LINK_SIGNING_KEY, ...STORE_SECRETS],
  },
  async () => {
    const summary = await runAutomationDispatch();
    if (summary.sent > 0 || summary.failed > 0) {
      await logActivity({
        action: 'automation.dispatch',
        entityType: 'automation',
        userId: null,
        summary: `Automazioni: ${summary.sent} email inviate, ${summary.cancelled} annullate, ${summary.failed} in errore`,
        metadata: { ...summary },
        severity: summary.failed > 0 ? 'warning' : 'info',
      });
    }
  },
);

/**
 * Ultime run inviate di un'automazione: usato dal report.
 *
 * Si ordina solo per `sentAt` (indice automatico a campo singolo) e si filtra
 * lo stato in memoria: le run mai inviate hanno `sentAt` nullo e finiscono in
 * fondo all'ordinamento decrescente.
 */
export async function recentSentRuns(automationId: DocId, limit = 20): Promise<AutomationRun[]> {
  const snapshot = await runsRef(automationId)
    .orderBy('sentAt', 'desc')
    .limit(Math.min(limit * 3, 200))
    .get();
  return snapshot.docs
    .map((doc) => ({ ...withId<AutomationRun>(doc), automationId }))
    .filter((run) => run.status === 'sent' && Boolean(run.sentAt))
    .slice(0, limit);
}
