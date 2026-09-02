import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante l'apertura del confronto fra newsletter. */
export default function ConfrontoNewsletterLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Skeleton className="h-40 w-full" />

      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[340px] w-full" />
        ))}
      </div>

      <Skeleton className="h-64 w-full" />
    </div>
  );
}
