'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { BrandLockup } from '@/components/layout/brand-mark';
import { EMPTY_NAV_BADGES, NAV_GROUPS, type NavBadges, type NavItem, isActivePath } from '@/components/layout/nav-items';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useAuth } from '@/lib/auth-context';
import { cn, formatNumber } from '@/lib/utils';

export interface SidebarProps {
  /** Barra ridotta a sole icone. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  badges?: NavBadges;
  /** Invocata dopo un clic su una voce: chiude il pannello su mobile. */
  onNavigate?: () => void;
  /** La variante mobile è sempre estesa e senza pulsante di riduzione. */
  variant?: 'desktop' | 'mobile';
  className?: string;
}

function badgeValue(item: NavItem, badges: NavBadges): number {
  return item.badge ? badges[item.badge] ?? 0 : 0;
}

/**
 * Navigazione principale dell'applicazione.
 * Nasconde le voci per cui l'utente non ha il permesso e mostra i contatori
 * dinamici (newsletter pianificate, automazioni attive).
 */
export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  badges = EMPTY_NAV_BADGES,
  onNavigate,
  variant = 'desktop',
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const { can } = useAuth();
  const isCollapsed = variant === 'desktop' && collapsed;

  const groups = React.useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => can(item.permission)),
      })).filter((group) => group.items.length > 0),
    [can],
  );

  return (
    <nav
      aria-label="Navigazione principale"
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground',
        isCollapsed ? 'w-[68px]' : 'w-64',
        'transition-[width] duration-200 ease-out',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-sidebar-border',
          isCollapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="AlphaInk Newsletter, vai alla dashboard"
        >
          <BrandLockup compact={isCollapsed} />
        </Link>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {groups.length === 0 ? (
          <p className="px-2 py-4 text-xs text-sidebar-foreground/60">
            Nessuna sezione disponibile per il tuo ruolo.
          </p>
        ) : null}

        {groups.map((group) => (
          <div key={group.id} className="mb-4 last:mb-0">
            {isCollapsed ? (
              <div className="mx-2 mb-2 h-px bg-sidebar-border" aria-hidden="true" />
            ) : (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/45">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item.href);
                const count = badgeValue(item, badges);
                const Icon = item.icon;

                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
                      active
                        ? 'bg-sidebar-accent text-white'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white',
                      isCollapsed && 'justify-center px-0',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <Icon className={cn('size-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
                    {isCollapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                    {count > 0 && !isCollapsed ? (
                      <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                        {formatNumber(count)}
                      </span>
                    ) : null}
                    {count > 0 && isCollapsed ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-3 top-2 size-1.5 rounded-full bg-primary"
                      />
                    ) : null}
                  </Link>
                );

                return (
                  <li key={item.href}>
                    {isCollapsed ? (
                      <SimpleTooltip
                        side="right"
                        content={count > 0 ? `${item.label} · ${formatNumber(count)}` : item.label}
                      >
                        {link}
                      </SimpleTooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {variant === 'desktop' && onToggleCollapse ? (
        <div className={cn('shrink-0 border-t border-sidebar-border p-2', isCollapsed && 'flex justify-center')}>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Espandi la barra laterale' : 'Riduci la barra laterale'}
            aria-pressed={isCollapsed}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-sidebar-foreground/60 outline-none transition-colors',
              'hover:bg-sidebar-accent/60 hover:text-white focus-visible:ring-2 focus-visible:ring-primary',
              isCollapsed ? 'justify-center px-0 py-2' : 'w-full',
            )}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden="true" />
                <span>Riduci menu</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
