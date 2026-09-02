'use client';

import { callable } from '@/lib/firebase/client';

import type {
  DashboardMetricsInput,
  DashboardMetricsResult,
  NewsletterReportInput,
  NewsletterReportResult,
} from './types';

/**
 * Callable analitiche.
 * `getAutomationReport` vive in `@/components/automations/api`: è la stessa
 * funzione usata dal dettaglio automazione e non va duplicata.
 */

export const getDashboardMetrics = callable<DashboardMetricsInput, DashboardMetricsResult>(
  'getDashboardMetrics',
  { timeoutMs: 180_000 },
);

export const getNewsletterReport = callable<NewsletterReportInput, NewsletterReportResult>(
  'getNewsletterReport',
  { timeoutMs: 180_000 },
);
