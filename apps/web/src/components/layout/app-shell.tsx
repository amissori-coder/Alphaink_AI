'use client';

import { COLLECTIONS, type Automation, type Newsletter } from '@alphaink/shared';
import { limit, orderBy, where } from 'firebase/firestore';
import { LogOut, ShieldCheck } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { GlobalSearch } from '@/components/layout/global-search';
import { AppHeader } from '@/components/layout/header';
import { type NavBadges } from '@/components/layout/nav-items';
import { Sidebar } from '@/components/layout/sidebar';
import { SIDEBAR_STORAGE_KEY } from '@/components/layout/theme-constants';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { BrandLockup } from '@/components/layout/brand-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useCollectionQuery } from '@/lib/hooks/use-collection';

/** Stati in cui una newsletter occupa uno slot futuro nel calendario. */
const PENDING_STATUSES = ['scheduled', 'queued'] as const;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Scheletro mostrato mentre si risolve la sessione. */
function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-64 shrink-0 flex-col gap-3 bg-sidebar p-4 lg:flex" aria-hidden="true">
        <BrandLockup className="text-sidebar-foreground" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full bg-sidebar-accent/60" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-border px-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-8 w-56" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Caricamento dell&apos;applicazione in corso
      </span>
    </div>
  );
}

/** Account autenticato ma senza profilo o disattivato. */
function NoAccessScreen() {
  const { user, appUser, signOut } = useAuth();
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-start">
          <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-warning/15 text-warning-foreground">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <CardTitle>Accesso non ancora abilitato</CardTitle>
          <CardDescription>
            {appUser?.disabled
              ? 'Il tuo account è stato disattivato da un amministratore.'
              : 'Il tuo account non ha ancora un ruolo assegnato per questa area.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Chiedi a un amministratore di AlphaInk di abilitare l&apos;indirizzo{' '}
            <span className="font-medium text-foreground">{appUser?.email || user?.email}</span>, poi
            effettua di nuovo l&apos;accesso.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              router.replace('/login');
            }}
          >
            <LogOut aria-hidden="true" />
            Esci
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Guscio dell'area riservata: protezione delle rotte, barra laterale
 * collassabile, intestazione con ricerca globale e gestione del tema.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, role, loading, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  // Preferenza della barra laterale, ripristinata dopo il mount.
  React.useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Persistenza non disponibile: la scelta vale per la sessione.
      }
      return next;
    });
  }, []);

  // Protezione delle rotte: senza sessione si torna all'accesso.
  React.useEffect(() => {
    if (loading || user) return;
    const next = pathname && pathname !== '/dashboard' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [loading, user, pathname, router]);

  // Scorciatoia da tastiera per la ricerca globale.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // La navigazione chiude il pannello mobile.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const ready = Boolean(user) && Boolean(role);

  const pendingNewsletters = useCollectionQuery<Newsletter>(
    COLLECTIONS.newsletters,
    [where('status', 'in', [...PENDING_STATUSES]), orderBy('schedule.sendAt', 'asc'), limit(99)],
    { enabled: ready && can('newsletter:read'), key: 'badge-pianificate' },
  );

  const automations = useCollectionQuery<Automation>(COLLECTIONS.automations, [], {
    enabled: ready && can('automations:read'),
    key: 'badge-automazioni',
  });

  const badges = React.useMemo<NavBadges>(
    () => ({
      scheduledNewsletters: pendingNewsletters.data.length,
      activeAutomations: automations.data.filter((automation) => automation.enabled).length,
    }),
    [pendingNewsletters.data, automations.data],
  );

  if (loading || !user) return <ShellSkeleton />;
  if (!role) return <NoAccessScreen />;

  return (
    <ThemeProvider>
      <div className="flex min-h-screen bg-background">
        <div className="sticky top-0 hidden h-screen shrink-0 lg:flex">
          <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} badges={badges} />
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground sm:max-w-none"
          >
            <SheetTitle className="sr-only">Navigazione principale</SheetTitle>
            <Sidebar variant="mobile" badges={badges} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            onOpenMobileNav={() => setMobileOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
          />
          <main id="contenuto" className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1400px] animate-fade-in">{children}</div>
          </main>
        </div>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </ThemeProvider>
  );
}
