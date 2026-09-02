import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante l'apertura della scheda di una newsletter. */
export default function NewsletterDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      <Skeleton className="h-9 w-72" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[480px] w-full lg:col-span-2" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    </div>
  );
}
