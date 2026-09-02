import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante la navigazione verso l'elenco delle newsletter. */
export default function NewsletterLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-9 w-72 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <Skeleton className="h-[520px] w-full" />
    </div>
  );
}
