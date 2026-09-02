'use client';

import { Check, Laptop, Moon, Sun } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { THEME_LABELS, type Theme, useTheme } from '@/components/layout/theme-provider';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{ value: Theme; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Laptop },
];

/** Selettore del tema: chiaro, scuro o sincronizzato con il sistema. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('text-muted-foreground hover:text-foreground', className)}
          aria-label={`Tema: ${THEME_LABELS[theme]}. Cambia tema`}
        >
          {resolvedTheme === 'dark' ? (
            <Moon className="size-4" aria-hidden="true" />
          ) : (
            <Sun className="size-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Aspetto</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon className="size-4" aria-hidden="true" />
            <span>{THEME_LABELS[value]}</span>
            {theme === value ? <Check className="ml-auto size-4 !text-primary" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
