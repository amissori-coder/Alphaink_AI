import * as React from 'react';

import { cn } from '@/lib/utils';

/** Segnaposto animato usato negli stati di caricamento. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Caricamento in corso"
      className={cn('shimmer rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** Scheletro di tabella: `rows` righe per `columns` colonne. */
function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-9 flex-1', columnIndex === 0 && 'max-w-[220px]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export { Skeleton, SkeletonTable };
