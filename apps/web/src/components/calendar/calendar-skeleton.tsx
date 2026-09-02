import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface CalendarSkeletonProps {
  /** Numero di celle della griglia: 42 per il mese, 7 per la settimana. */
  cells?: number;
  className?: string;
}

/** Scheletro del calendario, condiviso fra `loading.tsx` e il primo render. */
export function CalendarSkeleton({ cells = 42, className }: CalendarSkeletonProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: cells }).map((_, index) => (
            <div key={index} className="min-h-[6rem] bg-card p-2 sm:min-h-[7.5rem]">
              <Skeleton className="mb-2 size-6 rounded-full" />
              {index % 3 === 0 ? <Skeleton className="h-5 w-full" /> : null}
              {index % 5 === 0 ? <Skeleton className="mt-1 h-5 w-3/4" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
