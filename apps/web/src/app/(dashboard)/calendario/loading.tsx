import { CalendarSkeleton } from '@/components/calendar';
import { Skeleton } from '@/components/ui/skeleton';

/** Stato di caricamento della rotta del calendario. */
export default function CalendarioLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <CalendarSkeleton />
    </div>
  );
}
