import type { Metadata } from 'next';

import { EditorialCalendar } from '@/components/calendar';
import type { CalendarView } from '@/components/calendar';

export const metadata: Metadata = {
  title: 'Calendario editoriale',
  description:
    'Pianifica gli invii delle newsletter AlphaInk: viste mese, settimana e agenda, ripianificazione con trascinamento e automazioni sempre attive.',
};

const VIEWS: CalendarView[] = ['mese', 'settimana', 'agenda'];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Vista richiesta via querystring (`?vista=settimana`). */
function readView(params: SearchParams): CalendarView {
  const value = firstValue(params.vista);
  return VIEWS.find((view) => view === value) ?? 'mese';
}

/** Giorno richiesto via querystring (`?giorno=2026-09-14`). */
function readDay(params: SearchParams): string | null {
  const value = firstValue(params.giorno);
  return value && DAY_PATTERN.test(value) ? value : null;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <EditorialCalendar initialView={readView(params)} initialDate={readDay(params)} />
    </div>
  );
}
