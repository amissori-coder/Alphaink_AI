/**
 * Punto di ingresso dei componenti dell'area newsletter.
 * Le pagine importano da qui, così i percorsi interni restano liberi di cambiare.
 */

export { AudiencePicker, type AudiencePickerProps } from './audience-picker';
export { CreateNewsletterForm, type CreateNewsletterFormProps } from './create-newsletter-form';
export { EditorShell, type EditorShellProps } from './editor-shell';
export { FunnelChart, funnelStages, type FunnelChartProps, type FunnelStage } from './funnel-chart';
export { NewNewsletterDialog, type NewNewsletterDialogProps } from './new-newsletter-dialog';
export { NewsletterDetail, type NewsletterDetailProps } from './newsletter-detail';
export { NewsletterList } from './newsletter-list';
export {
  NewsletterPreview,
  PreviewDialog,
  type NewsletterPreviewProps,
  type PreviewDialogProps,
} from './newsletter-preview';
export { NewsletterReport, type NewsletterReportProps } from './newsletter-report';
export { RecipientsTable, type RecipientsTableProps } from './recipients-table';
export { ScheduleDialog, type ScheduleDialogProps, zonedTimeToUtc } from './schedule-dialog';
export { SendTestDialog, type SendTestDialogProps } from './send-test-dialog';
export { StatsGrid, derivedRates, type StatsGridProps } from './stats-grid';
export {
  RecipientStatusBadge,
  StatusBadge,
  statusBadgeVariant,
  type RecipientStatusBadgeProps,
  type StatusBadgeProps,
} from './status-badge';
export { TemplateGallery, BLANK_TEMPLATE, type TemplateGalleryProps } from './template-gallery';
export { TimelineChart, type TimelineChartProps } from './timeline-chart';
export {
  ContactMultiSelect,
  ContactSingleSelect,
  useContactLookup,
  useContactSearch,
  type ContactMultiSelectProps,
  type ContactSingleSelectProps,
} from './contact-search';
export { useCreateNewsletter, useDefaultSender } from './use-create-newsletter';
export { useNewsletterActions, type UseNewsletterActionsResult } from './use-newsletter-actions';
export { useClusters, useNewsletters, useTemplates } from './use-newsletter-data';
export * from './constants';
export * from './types';
