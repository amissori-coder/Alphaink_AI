import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante la navigazione verso il cruscotto analitico. */
export default function AnalyticsLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-44" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>

      <Skeleton className="h-[420px] w-full" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[360px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>

      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
