import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante la navigazione verso la libreria media. */
export default function MediaLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-52 w-full" />
        ))}
      </div>

      <span className="sr-only" role="status">
        Caricamento della libreria media in corso
      </span>
    </div>
  );
}
