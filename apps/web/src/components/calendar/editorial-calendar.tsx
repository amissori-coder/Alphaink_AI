'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { CalendarDays, CalendarPlus, ListFilter, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth-context';
import { toastWarning } from '@/lib/toast';

import { AgendaView } from './agenda-view';
import { AutomationsSheet, AutomationsStrip } from './automations-panel';
import { CalendarFiltersBar } from './calendar-filters-bar';
import { CalendarLegend } from './calendar-legend';
import { CalendarSkeleton } from './calendar-skeleton';
import { CalendarToolbar } from './calendar-toolbar';
import { EMPTY_FILTERS, ROUTES } from './constants';
import { EntryChipOverlay } from './entry-chip';
import { EntryDetailSheet } from './entry-sheet';
import { MonthView } from './month-view';
import { NewNewsletterDialog } from './new-newsletter-dialog';
import { RescheduleDialog } from './reschedule-dialog';
import type { CalendarFilters, CalendarItem, CalendarView } from './types';
import { useCalendarActions } from './use-calendar-actions';
import { useCalendarData } from './use-calendar-data';
import {
  buildRange,
  combineDayWithTime,
  parseDayId,
  rangeTitle,
  shiftAnchor,
} from './utils';
import { WeekView } from './week-view';

export interface EditorialCalendarProps {
  /** Vista iniziale, tipicamente da querystring. */
  initialView?: CalendarView;
  /** Giorno iniziale `YYYY-MM-DD`. */
  initialDate?: string | null;
  className?: string;
}

/** Anticipo minimo quando si sposta una newsletter su oggi. */
const MIN_LEAD_MINUTES = 15;

function ensureFuture(date: Date): Date {
  const now = Date.now();
  if (date.getTime() > now + 60_000) return date;
  const next = new Date(now + MIN_LEAD_MINUTES * 60_000);
  next.setSeconds(0, 0);
  return next;
}

/**
 * Calendario editoriale delle newsletter.
 *
 * Riunisce le tre viste (mese, settimana, agenda), i filtri, il pannello di
 * dettaglio, la ripianificazione con trascinamento e la fascia delle
 * automazioni sempre attive.
 */
export function EditorialCalendar({
  initialView = 'mese',
  initialDate = null,
  className,
}: EditorialCalendarProps) {
  const { can } = useAuth();
  const canWrite = can('newsletter:write');
  const canSchedule = can('newsletter:schedule');

  // Il calendario dipende dall'orario locale: si disegna solo dopo il montaggio
  // per non generare differenze fra render server e client.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const [view, setView] = React.useState<CalendarView>(initialView);
  const [anchor, setAnchor] = React.useState<Date>(() =>
    initialDate ? parseDayId(initialDate) : new Date(),
  );
  const [filters, setFilters] = React.useState<CalendarFilters>({ ...EMPTY_FILTERS });

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedFallback, setSelectedFallback] = React.useState<CalendarItem | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const [rescheduleItem, setRescheduleItem] = React.useState<CalendarItem | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);

  const [createDay, setCreateDay] = React.useState<Date | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const [automationsOpen, setAutomationsOpen] = React.useState(false);
  const [draggedItem, setDraggedItem] = React.useState<CalendarItem | null>(null);

  const range = React.useMemo(() => buildRange(view, anchor), [view, anchor]);
  const data = useCalendarData(range, filters, { enabled: mounted });
  const actions = useCalendarActions();

  const title = React.useMemo(
    () => (mounted ? rangeTitle(view, anchor) : ''),
    [mounted, view, anchor],
  );

  const selectedItem = React.useMemo(
    () => data.items.find((item) => item.id === selectedId) ?? selectedFallback,
    [data.items, selectedId, selectedFallback],
  );

  const selectedNewsletter = selectedItem?.newsletterId
    ? data.newsletterById.get(selectedItem.newsletterId) ?? null
    : null;

  const selectedAutomation = selectedItem?.automationId
    ? data.automations.find((automation) => automation.id === selectedItem.automationId) ?? null
    : null;

  const plannedAutomationSends = React.useMemo(
    () =>
      data.items
        .filter((item) => item.type === 'automation')
        .reduce((total, item) => total + item.occurrences, 0),
    [data.items],
  );

  const dragEnabled = canSchedule && view !== 'agenda';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Un piccolo spostamento distingue il clic dal trascinamento.
      activationConstraint: { distance: 6 },
    }),
  );

  const openEntry = React.useCallback((item: CalendarItem) => {
    setSelectedId(item.id);
    setSelectedFallback(item);
    setDetailOpen(true);
  }, []);

  const openCreate = React.useCallback(
    (day: Date | null) => {
      if (!canWrite) {
        toastWarning('Non hai i permessi per creare newsletter.');
        return;
      }
      setCreateDay(day);
      setCreateOpen(true);
    },
    [canWrite],
  );

  const openReschedule = React.useCallback((item: CalendarItem) => {
    setRescheduleItem(item);
    setRescheduleOpen(true);
  }, []);

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const item = event.active.data.current?.item as CalendarItem | undefined;
    setDraggedItem(item ?? null);
  }, []);

  const handleDragEnd = React.useCallback(
    async (event: DragEndEvent) => {
      const item = event.active.data.current?.item as CalendarItem | undefined;
      const targetDayId = event.over?.data.current?.dayId as string | undefined;
      setDraggedItem(null);

      if (!item || !item.newsletterId || !targetDayId) return;
      if (targetDayId === item.dayId) return;

      const target = ensureFuture(combineDayWithTime(parseDayId(targetDayId), item.date));
      await actions.reschedule({ item, sendAt: target.toISOString(), origin: 'trascinamento' });
    },
    [actions],
  );

  const announcements = React.useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) => {
        const item = active.data.current?.item as CalendarItem | undefined;
        return item ? `Hai preso ${item.title}. Trascinala su un altro giorno.` : undefined;
      },
      onDragOver: ({ over }) => {
        const day = over?.data.current?.dayId as string | undefined;
        return day ? `Sopra il giorno ${day}.` : undefined;
      },
      onDragEnd: ({ active, over }) => {
        const item = active.data.current?.item as CalendarItem | undefined;
        const day = over?.data.current?.dayId as string | undefined;
        if (!item) return undefined;
        return day
          ? `${item.title} spostata al giorno ${day}.`
          : `${item.title} rilasciata fuori dal calendario: nessuna modifica.`;
      },
      onDragCancel: ({ active }) => {
        const item = active.data.current?.item as CalendarItem | undefined;
        return item ? `Spostamento di ${item.title} annullato.` : undefined;
      },
    }),
    [],
  );

  if (!mounted) {
    return <CalendarSkeleton cells={initialView === 'settimana' ? 7 : 42} className={className} />;
  }

  const hasEntries = data.items.length > 0;
  const hasVisible = data.filteredItems.length > 0;

  const grid =
    view === 'mese' ? (
      <MonthView
        range={range}
        anchor={anchor}
        byDay={data.byDay}
        onOpenEntry={openEntry}
        onCreateAt={openCreate}
        dragEnabled={dragEnabled}
        canCreate={canWrite}
      />
    ) : view === 'settimana' ? (
      <WeekView
        range={range}
        byDay={data.byDay}
        onOpenEntry={openEntry}
        onCreateAt={openCreate}
        dragEnabled={dragEnabled}
        canCreate={canWrite}
      />
    ) : (
      <AgendaView
        range={range}
        byDay={data.byDay}
        onOpenEntry={openEntry}
        onCreateAt={openCreate}
        canCreate={canWrite}
      />
    );

  return (
    <div className={className}>
      <PageHeader
        title="Calendario editoriale"
        description="Pianifica gli invii, controlla lo stato delle campagne e sposta le newsletter trascinandole su un altro giorno."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={ROUTES.newsletters}>
                <ListFilter aria-hidden="true" />
                Tutte le newsletter
              </Link>
            </Button>
            <Button onClick={() => openCreate(null)} disabled={!canWrite}>
              <CalendarPlus aria-hidden="true" />
              Nuova newsletter
            </Button>
          </>
        }
      >
        <CalendarToolbar
          view={view}
          onViewChange={setView}
          title={title}
          onPrevious={() => setAnchor((current) => shiftAnchor(view, current, -1))}
          onNext={() => setAnchor((current) => shiftAnchor(view, current, 1))}
          onToday={() => setAnchor(new Date())}
          search={filters.search}
          onSearchChange={(search) => setFilters((current) => ({ ...current, search }))}
          onRefresh={data.refetch}
          refreshing={data.refreshing}
        />
      </PageHeader>

      <div className="mt-4 space-y-4">
        <CalendarFiltersBar
          filters={filters}
          onChange={setFilters}
          clusters={data.clusters}
          tagOptions={data.tagOptions}
          totalCount={data.items.length}
          visibleCount={data.filteredItems.length}
        />

        <AutomationsStrip
          automations={data.activeAutomations}
          plannedInRange={plannedAutomationSends}
          onOpen={() => setAutomationsOpen(true)}
        />

        {data.error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>Impossibile caricare il calendario</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              {data.error.message}
              <Button variant="outline" size="sm" onClick={data.refetch}>
                Riprova
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {data.loading ? (
          <CalendarSkeleton cells={view === 'settimana' ? 7 : 42} />
        ) : (
          <>
            {!hasEntries ? (
              <EmptyState
                compact
                icon={<CalendarDays />}
                title="Nessun invio in questo periodo"
                description="Pianifica una newsletter oppure spostati su un altro mese per vedere le campagne già programmate."
                action={
                  canWrite ? (
                    <Button size="sm" onClick={() => openCreate(null)}>
                      <CalendarPlus aria-hidden="true" />
                      Nuova newsletter
                    </Button>
                  ) : undefined
                }
                secondaryAction={
                  <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
                    Torna a oggi
                  </Button>
                }
              />
            ) : !hasVisible ? (
              <EmptyState
                compact
                icon={<ListFilter />}
                title="Nessuna voce corrisponde ai filtri"
                description="Modifica i criteri di ricerca per vedere le newsletter del periodo."
                action={
                  <Button size="sm" variant="outline" onClick={() => setFilters({ ...EMPTY_FILTERS })}>
                    Azzera filtri
                  </Button>
                }
              />
            ) : null}

            {view === 'agenda' && !hasVisible ? null : (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                accessibility={{
                  announcements,
                  screenReaderInstructions: {
                    draggable:
                      'Trascina con il mouse una bozza o una newsletter pianificata per spostarla su un altro giorno. Con la tastiera, apri la voce con Invio e usa Ripianifica.',
                  },
                }}
                onDragStart={handleDragStart}
                onDragEnd={(event) => {
                  void handleDragEnd(event);
                }}
                onDragCancel={() => setDraggedItem(null)}
              >
                {grid}
                <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
                  {draggedItem ? <EntryChipOverlay item={draggedItem} /> : null}
                </DragOverlay>
              </DndContext>
            )}
          </>
        )}

        <CalendarLegend showDragHint={canSchedule} />
      </div>

      <EntryDetailSheet
        item={selectedItem}
        newsletter={selectedNewsletter}
        automation={selectedAutomation}
        clusterNameById={data.clusterNameById}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={(item) => {
          if (item.newsletterId) actions.openEditor(item.newsletterId);
        }}
        onDuplicate={(item) => {
          void actions.duplicate(item);
        }}
        onReschedule={(item) => {
          setDetailOpen(false);
          openReschedule(item);
        }}
        onCancelSchedule={async (item) => {
          const result = await actions.cancelSchedule(item);
          if (result) setDetailOpen(false);
          return result;
        }}
        onOpenAutomations={() => {
          setDetailOpen(false);
          setAutomationsOpen(true);
        }}
        canWrite={canWrite}
        canSchedule={canSchedule}
        pending={Boolean(actions.pendingId)}
      />

      <RescheduleDialog
        item={rescheduleItem}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        pending={actions.isRescheduling}
        onConfirm={async (sendAt) => {
          if (!rescheduleItem) return;
          const result = await actions.reschedule({ item: rescheduleItem, sendAt });
          if (result) {
            setRescheduleOpen(false);
            setAnchor(new Date(sendAt));
          }
        }}
      />

      <NewNewsletterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        day={createDay}
        pending={actions.isCreating}
        onCreate={actions.createDraft}
        onCreated={(newsletter) => actions.openEditor(newsletter.id)}
      />

      <AutomationsSheet
        open={automationsOpen}
        onOpenChange={setAutomationsOpen}
        automations={data.automations}
      />
    </div>
  );
}
