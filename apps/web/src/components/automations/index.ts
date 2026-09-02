/**
 * API pubblica dell'area automazioni.
 *
 * Le rotte importano da qui: `AutomationsList` per l'elenco e
 * `AutomationDetail` per la configurazione; il resto è esposto per il riuso
 * (diagramma del flusso, campo ritardo, politica coupon).
 */

// --- Viste complete ----------------------------------------------------------
export { AutomationsList } from './automations-list';
export { AutomationDetail } from './automation-detail';
export type { AutomationDetailProps } from './automation-detail';

// --- Schede della configurazione --------------------------------------------
export { FlowTab } from './flow-tab';
export type { FlowTabProps } from './flow-tab';
export { AudienceTab } from './audience-tab';
export type { AudienceTabProps } from './audience-tab';
export { ScheduleTab } from './schedule-tab';
export type { ScheduleTabProps } from './schedule-tab';
export { SenderTab } from './sender-tab';
export type { SenderTabProps } from './sender-tab';
export { StatsTab } from './stats-tab';
export type { StatsTabProps } from './stats-tab';
export { TestModeCard } from './test-mode-card';
export type { TestModeCardProps } from './test-mode-card';

// --- Componenti riutilizzabili ----------------------------------------------
export { AutomationCard, periodTotals } from './automation-card';
export type { AutomationCardProps } from './automation-card';
export { FlowDiagram, TriggerNode } from './flow-diagram';
export type { FlowDiagramProps, TriggerNodeProps } from './flow-diagram';
export { StepCard } from './step-card';
export type { StepCardProps } from './step-card';
export { DelayInput, delayEquivalentLabel, humanizeDelay } from './delay-input';
export type { DelayInputProps } from './delay-input';
export { CouponPolicyForm, couponSummary } from './coupon-policy-form';
export type { CouponPolicyFormProps } from './coupon-policy-form';

// --- Finestre ----------------------------------------------------------------
export { StepEditorDialog } from './step-editor-dialog';
export type { StepEditorDialogProps, StepEmailPatch } from './step-editor-dialog';
export { StepPreviewDialog } from './step-preview-dialog';
export type { StepPreviewDialogProps } from './step-preview-dialog';

// --- Dati e azioni -----------------------------------------------------------
export {
  reportRangeFrom,
  useAutomation,
  useAutomationReport,
  useAutomationReports,
  useAutomations,
} from './use-automations-data';
export type { AutomationReportEntry, UseAutomationReportOptions } from './use-automations-data';
export {
  usePreviewStep,
  useResetAutomation,
  useSaveAutomation,
  useSendAutomationTest,
  useToggleAutomation,
} from './use-automation-actions';
export { useAutomationDraft } from './use-automation-draft';
export type { AutomationDraft } from './use-automation-draft';

// --- Contratti e costanti ----------------------------------------------------
export * from './constants';
export * from './types';
export {
  getAutomationReport,
  previewAutomationStep,
  resetAutomationToDefaults,
  saveAutomation,
  sendAutomationTest,
  toggleAutomation,
} from './api';
