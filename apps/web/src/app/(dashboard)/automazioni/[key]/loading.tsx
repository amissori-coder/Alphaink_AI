import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante l'apertura della configurazione di un'automazione. */
export default function AutomazioneDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <Skeleton className="h-10 w-[28rem] max-w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
