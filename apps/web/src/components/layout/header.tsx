'use client';

import { Menu, Search } from 'lucide-react';
import * as React from 'react';

import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AppHeaderProps {
  /** Apre la navigazione a scomparsa su schermi stretti. */
  onOpenMobileNav: () => void;
  /** Apre la ricerca globale. */
  onOpenSearch: () => void;
  className?: string;
}

/** Intestazione fissa: percorso di navigazione, ricerca, tema e menu utente. */
export function AppHeader({ onOpenMobileNav, onOpenSearch, className }: AppHeaderProps) {
  const [shortcut, setShortcut] = React.useState('Ctrl K');

  // Il modificatore dipende dal sistema: si calcola dopo il mount per non
  // generare differenze fra HTML del server e del client.
  React.useEffect(() => {
    const isApple = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform || window.navigator.userAgent);
    setShortcut(isApple ? '⌘ K' : 'Ctrl K');
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-5',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Apri il menu di navigazione"
      >
        <Menu className="size-4" aria-hidden="true" />
      </Button>

      <Breadcrumbs className="min-w-0 flex-1" />

      <button
        type="button"
        onClick={onOpenSearch}
        className={cn(
          'hidden h-8 w-56 items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 text-xs text-muted-foreground transition-colors md:flex',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span>Cerca…</span>
        <kbd className="ml-auto rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] tracking-wide">
          {shortcut}
        </kbd>
      </button>

      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSearch}
        aria-label="Apri la ricerca globale"
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>

      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
