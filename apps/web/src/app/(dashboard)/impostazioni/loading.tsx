import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante la navigazione verso le Impostazioni. */
export default function ImpostazioniLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-[30rem] max-w-full" />
        </div>
      </div>

      <div className="flex gap-3 border-b border-border pb-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-28 shrink-0" />
        ))}
      </div>

      <div className="space-y-5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-border p-6">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-96 max-w-full" />
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((__, field) => (
                <div key={field} className="space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only" role="status">
        Caricamento delle impostazioni in corso
      </span>
    </div>
  );
}
