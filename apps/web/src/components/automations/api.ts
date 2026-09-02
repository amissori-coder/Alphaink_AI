'use client';

import type { Automation } from '@alphaink/shared';

import { callable } from '@/lib/firebase/client';

import type {
  AutomationReport,
  AutomationReportInput,
  PreviewStepInput,
  RenderedStep,
  ResetAutomationInput,
  SaveAutomationInput,
  SendAutomationTestInput,
  SendAutomationTestResult,
  ToggleAutomationInput,
  ToggleAutomationResult,
} from './types';

/**
 * Callable delle Cloud Functions usate dall'area automazioni.
 * I nomi corrispondono esattamente a quelli esportati dalle Functions.
 */

export const saveAutomation = callable<SaveAutomationInput, Automation>('saveAutomation', {
  timeoutMs: 180_000,
});

export const toggleAutomation = callable<ToggleAutomationInput, ToggleAutomationResult>(
  'toggleAutomation',
);

export const sendAutomationTest = callable<SendAutomationTestInput, SendAutomationTestResult>(
  'sendAutomationTest',
  { timeoutMs: 180_000 },
);

export const previewAutomationStep = callable<PreviewStepInput, RenderedStep>(
  'previewAutomationStep',
  { timeoutMs: 180_000 },
);

export const resetAutomationToDefaults = callable<ResetAutomationInput, Automation>(
  'resetAutomationToDefaults',
  { timeoutMs: 180_000 },
);

export const getAutomationReport = callable<AutomationReportInput, AutomationReport>(
  'getAutomationReport',
  { timeoutMs: 180_000 },
);
