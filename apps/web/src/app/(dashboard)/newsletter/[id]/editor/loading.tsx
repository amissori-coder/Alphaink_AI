import { Skeleton } from '@/components/ui/skeleton';

/** Scheletro mostrato durante l'apertura dell'editor. */
export default function NewsletterEditorLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Skeleton className="size-9" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <Skeleton className="h-[70vh] w-full" />
    </div>
  );
}
