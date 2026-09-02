/**
 * Calendario editoriale delle newsletter.
 *
 * Punto d'ingresso unico: le pagine importano da `@/components/calendar`.
 */

export { EditorialCalendar } from './editorial-calendar';
export type { EditorialCalendarProps } from './editorial-calendar';

export { CalendarSkeleton } from './calendar-skeleton';
export type { CalendarSkeletonProps } from './calendar-skeleton';

export { CalendarToolbar } from './calendar-toolbar';
export type { CalendarToolbarProps } from './calendar-toolbar';

export { CalendarFiltersBar } from './calendar-filters-bar';
export type { CalendarFiltersBarProps } from './calendar-filters-bar';

export { CalendarLegend } from './calendar-legend';
export type { CalendarLegendProps } from './calendar-legend';

export { MonthView } from './month-view';
export type { MonthViewProps } from './month-view';

export { WeekView } from './week-view';
export type { WeekViewProps } from './week-view';

export { AgendaView } from './agenda-view';
export type { AgendaViewProps } from './agenda-view';

export { DayDropZone } from './day-drop-zone';
export type { DayDropZoneProps } from './day-drop-zone';

export { EntryChip, EntryChipOverlay, StatusDot, describeItem } from './entry-chip';
export type { EntryChipProps } from './entry-chip';

export { EntryRow } from './entry-row';
export type { EntryRowProps } from './entry-row';

export { EntryDetailSheet } from './entry-sheet';
export type { EntryDetailSheetProps } from './entry-sheet';

export { RescheduleDialog } from './reschedule-dialog';
export type { RescheduleDialogProps } from './reschedule-dialog';

export { NewNewsletterDialog } from './new-newsletter-dialog';
export type { NewNewsletterDialogProps } from './new-newsletter-dialog';

export { AutomationsSheet, AutomationsStrip } from './automations-panel';
export type { AutomationsSheetProps, AutomationsStripProps } from './automations-panel';

export { useCalendarData } from './use-calendar-data';
export type { UseCalendarDataOptions, UseCalendarDataResult } from './use-calendar-data';

export { useCalendarActions } from './use-calendar-actions';
export type {
  CalendarWarning,
  RescheduleInput,
  UseCalendarActionsResult,
} from './use-calendar-actions';

export type {
  CalendarEntry,
  CalendarEntryStats,
  CalendarFilters,
  CalendarItem,
  CalendarRange,
  CalendarView,
  GetCalendarEntriesInput,
  GetCalendarEntriesResult,
  RescheduleUndo,
} from './types';

export {
  ALL_CATEGORIES,
  ALL_STATUSES,
  BUSINESS_TIMEZONE,
  CALENDAR_VIEWS,
  DRAGGABLE_STATUSES,
  EMPTY_FILTERS,
  ROUTES as CALENDAR_ROUTES,
} from './constants';

export {
  buildRange,
  dayId,
  groupByDay,
  matchesFilters,
  parseDayId,
  rangeTitle,
  shiftAnchor,
  statusColor,
  statusLabel,
} from './utils';
