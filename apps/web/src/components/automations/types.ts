import type {
  Automation,
  AutomationKey,
  AutomationStats,
  AutomationStep,
  AutomationStepStats,
  CancelCondition,
  CouponPolicy,
  Delay,
  DocId,
  EmailDocument,
  FilterGroup,
  IsoDate,
  TriggerConfig,
} from '@alphaink/shared';

/**
 * Contratti delle callable dell'area automazioni.
 *
 * Rispecchiano fedelmente gli input/output di `functions/src/automations/callables.ts`:
 * non vanno modificati senza allineare anche il backend.
 */

/** Gravità degli avvisi prodotti dal renderer delle email. */
export type WarningSeverity = 'info' | 'avviso' | 'errore';

export interface RenderWarning {
  code: string;
  message: string;
  severity: WarningSeverity | string;
  blockId?: string;
  sectionId?: string;
}

// -----------------------------------------------------------------------------
// saveAutomation
// -----------------------------------------------------------------------------

/**
 * Step nel formato accettato dalla callable.
 *
 * Le statistiche non viaggiano dalla UI al server: restano di competenza del
 * motore, che le riporta sugli step esistenti.
 */
export interface AutomationStepPayload {
  id: string;
  name: string;
  enabled: boolean;
  delay: Delay;
  subject: string;
  preheader?: string | null;
  document?: EmailDocument | null;
  templateId?: string | null;
  cancelIf: CancelCondition[];
  coupon?: CouponPolicy | null;
}

export interface AutomationPayload {
  name: string;
  description?: string | null;
  enabled: boolean;
  testMode: boolean;
  testRecipients: string[];
  trigger: TriggerConfig;
  steps: AutomationStepPayload[];
  audienceFilter?: FilterGroup | null;
  excludeClusterIds: DocId[];
  cooldownDays: number;
  maxPerContactPerYear?: number | null;
  quietHours?: { start: string; end: string } | null;
  allowedWeekdays?: number[];
  maxSendsPerHour?: number | null;
  timezone: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}

export interface SaveAutomationInput extends AutomationPayload {
  /** Assente in creazione. */
  id?: string | null;
  /** Obbligatoria in creazione: determina i comportamenti del motore. */
  key?: AutomationKey | null;
}

export interface ToggleAutomationInput {
  automationId: DocId;
  enabled: boolean;
}

export interface ToggleAutomationResult {
  id: DocId;
  enabled: boolean;
}

// -----------------------------------------------------------------------------
// Anteprima e invio di prova
// -----------------------------------------------------------------------------

export interface PreviewStepInput {
  automationId: DocId;
  stepId: string;
  sampleContactId?: DocId | null;
}

export interface RenderedStep {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  warnings: RenderWarning[];
  blocking: boolean;
  /** Codice coupon di esempio, se lo step ne prevede uno. */
  couponCode: string | null;
}

export interface SendAutomationTestInput {
  automationId: DocId;
  stepId: string;
  recipients: string[];
  sampleContactId?: DocId | null;
}

export interface SendAutomationTestResult {
  sent: number;
  messageId: string;
  subject: string;
  warnings: RenderWarning[];
}

export interface ResetAutomationInput {
  automationId: DocId;
  /** Ripristina anche il pubblico (filtro ed esclusioni). */
  resetAudience: boolean;
}

// -----------------------------------------------------------------------------
// getAutomationReport
// -----------------------------------------------------------------------------

export interface AutomationReportInput {
  automationId: DocId;
  from?: IsoDate;
  to?: IsoDate;
  recentLimit?: number;
}

export interface AutomationStepReport {
  id: string;
  name: string;
  enabled: boolean;
  subject: string;
  delay: Delay;
  stats: AutomationStepStats;
  rates: { openRate: number; clickRate: number; cancelRate: number; conversionRate: number };
}

export interface AutomationReportPoint {
  /** Chiave giorno `YYYY-MM-DD` nel fuso dell'automazione. */
  day: string;
  sent: number;
  converted: number;
  revenue: number;
}

export interface AutomationRecentSend {
  runId: DocId;
  stepId: string;
  email: string;
  sentAt: IsoDate | null;
  messageId: string | null;
  couponCode: string | null;
  convertedOrderId: DocId | null;
  revenue: number | null;
}

export interface AutomationReport {
  automation: {
    id: DocId;
    key: AutomationKey;
    name: string;
    enabled: boolean;
    testMode: boolean;
    isCore: boolean;
    lastRunAt: IsoDate | null;
    lastError: string | null;
  };
  stats: AutomationStats;
  rates: { openRate: number; clickRate: number; conversionRate: number };
  steps: AutomationStepReport[];
  timeseries: AutomationReportPoint[];
  recent: AutomationRecentSend[];
  range: { from: IsoDate; to: IsoDate };
}

// -----------------------------------------------------------------------------
// Utilità di conversione
// -----------------------------------------------------------------------------

/** Riduce uno step del documento al payload accettato dalla callable. */
export function toStepPayload(step: AutomationStep): AutomationStepPayload {
  return {
    id: step.id,
    name: step.name,
    enabled: step.enabled,
    delay: step.delay,
    subject: step.subject,
    preheader: step.preheader ?? null,
    document: step.document ?? null,
    templateId: step.templateId ?? null,
    cancelIf: step.cancelIf ?? [],
    coupon: step.coupon ?? null,
  };
}

/** Costruisce l'input completo di `saveAutomation` a partire dal documento. */
export function toAutomationPayload(automation: Automation): AutomationPayload {
  return {
    name: automation.name,
    description: automation.description ?? null,
    enabled: automation.enabled,
    testMode: automation.testMode,
    testRecipients: automation.testRecipients ?? [],
    trigger: automation.trigger,
    steps: (automation.steps ?? []).map(toStepPayload),
    audienceFilter: automation.audienceFilter ?? null,
    excludeClusterIds: automation.excludeClusterIds ?? [],
    cooldownDays: automation.cooldownDays,
    maxPerContactPerYear: automation.maxPerContactPerYear ?? null,
    quietHours: automation.quietHours ?? null,
    allowedWeekdays: automation.allowedWeekdays ?? [0, 1, 2, 3, 4, 5, 6],
    maxSendsPerHour: automation.maxSendsPerHour ?? null,
    timezone: automation.timezone,
    fromName: automation.fromName,
    fromEmail: automation.fromEmail,
    replyTo: automation.replyTo ?? null,
  };
}
