import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante la navigazione verso l'elenco dei cluster. */
export default function ClusterLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>

      <Skeleton className="h-44 w-full" />

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-52" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}
