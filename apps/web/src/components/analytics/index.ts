/**
 * API pubblica dell'area analytics.
 *
 * `AnalyticsView` e `NewsletterComparison` sono le due viste complete; i
 * componenti Recharts sono esposti perché riusabili anche fuori da qui (il
 * dettaglio automazione usa `TimeSeriesChart` e `FunnelChart`).
 */

// --- Viste complete ----------------------------------------------------------
export { AnalyticsView } from './analytics-view';
export { NewsletterComparison, MAX_COMPARED } from './newsletter-comparison';

// --- Componenti riutilizzabili ----------------------------------------------
export { TimeSeriesChart } from './time-series-chart';
export type {
  TimeSeriesChartProps,
  TimeSeriesDatum,
  TimeSeriesSeries,
} from './time-series-chart';
export { FunnelChart, buildFunnel } from './funnel-chart';
export type { FunnelChartProps, FunnelStage, FunnelStageInput } from './funnel-chart';
export { HeatmapChart, emptyHeatmap } from './heatmap-chart';
export type { HeatmapChartProps } from './heatmap-chart';
export { ComparisonBars } from './comparison-bars';
export type { ComparisonBarsProps, ComparisonCategory, ComparisonSeries } from './comparison-bars';
export { RevenueByChannel } from './revenue-by-channel';
export type { RevenueByChannelProps } from './revenue-by-channel';
export { MetricDelta } from './metric-delta';
export type { MetricDeltaProps } from './metric-delta';

// --- Componenti di supporto --------------------------------------------------
export { BreakdownCard } from './breakdown-card';
export type { BreakdownCardProps } from './breakdown-card';
export { TopLinksCard, shortenUrl } from './top-links-card';
export type { TopLinksCardProps } from './top-links-card';
export { NewsletterTable } from './newsletter-table';
export type { NewsletterTableProps } from './newsletter-table';
export { AutomationsTable } from './automations-table';
export type { AutomationsTableProps, AutomationTableRow } from './automations-table';
export { ListHealthCard } from './list-health-card';
export type { ListHealthCardProps } from './list-health-card';
export { PeriodPicker } from './period-picker';
export type { PeriodPickerProps } from './period-picker';
export { PeriodComparison } from './period-comparison';
export type { PeriodComparisonProps } from './period-comparison';

// --- Dati, aggregazioni e formattazione -------------------------------------
export {
  ANALYTICS_PERIODS,
  DETAIL_REPORT_LIMIT,
  PERIOD_COMPARE_LABELS,
  PERIOD_LABELS,
  TOP_NEWSLETTER_LIMIT,
  useAnalyticsMetrics,
  useNewsletterReports,
  useTrackingSettings,
} from './use-analytics-data';
export type { AnalyticsPeriod, NewsletterReportEntry } from './use-analytics-data';
export { buildOpenHeatmap, mergeBreakdown, mergeTopLinks } from './aggregate';
export type { OpenHeatmap } from './aggregate';
export {
  formatAxisValue,
  formatDelta,
  formatValue,
} from './format';
export type { ValueFormat } from './format';
export {
  formatDayLabel,
  formatDayLabelLong,
  sequentialColor,
  sequentialTextColor,
  useAnalyticsPalette,
} from './palette';
export type { AnalyticsPalette } from './palette';
export { getDashboardMetrics, getNewsletterReport } from './api';
export * from './types';
