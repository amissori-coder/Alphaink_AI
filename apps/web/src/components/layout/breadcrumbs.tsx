'use client';

import { ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { ROUTE_LABELS } from '@/components/layout/nav-items';
import { cn } from '@/lib/utils';

interface Crumb {
  href: string;
  label: string;
}

/** Riconosce gli identificativi Firestore per non mostrarli come etichetta. */
function looksLikeId(segment: string): boolean {
  return /^[A-Za-z0-9_-]{14,}$/.test(segment) && /\d/.test(segment);
}

function labelFor(segment: string): string {
  const known = ROUTE_LABELS[segment];
  if (known) return known;
  if (looksLikeId(segment)) return 'Dettaglio';
  const decoded = decodeURIComponent(segment).replace(/-/g, ' ');
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

/** Percorso della pagina corrente, ricavato dall'URL. */
export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();

  const crumbs = React.useMemo<Crumb[]>(() => {
    const segments = (pathname ?? '').split('/').filter(Boolean);
    return segments.map((segment, index) => ({
      href: `/${segments.slice(0, index + 1).join('/')}`,
      label: labelFor(segment),
    }));
  }, [pathname]);

  // Percorsi profondi: si mostrano la prima voce, i puntini e le ultime due.
  const visible: Array<Crumb | 'ellipsis'> =
    crumbs.length > 3 ? [crumbs[0]!, 'ellipsis', ...crumbs.slice(-2)] : crumbs;

  return (
    <nav aria-label="Percorso di navigazione" className={cn('flex min-w-0 items-center', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        <li className="flex items-center">
          <Link
            href="/dashboard"
            className="flex items-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Dashboard"
          >
            <Home className="size-4" aria-hidden="true" />
          </Link>
        </li>
        {visible.map((crumb, index) => {
          const isLast = index === visible.length - 1;
          return (
            <li key={crumb === 'ellipsis' ? `ellipsis-${index}` : crumb.href} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
              {crumb === 'ellipsis' ? (
                <span className="px-1 text-muted-foreground" aria-hidden="true">
                  …
                </span>
              ) : isLast ? (
                <span className="truncate font-medium text-foreground" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
