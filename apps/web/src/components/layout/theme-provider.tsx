'use client';

import * as React from 'react';

import {
  type ResolvedTheme,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  type Theme,
  isTheme,
} from '@/components/layout/theme-constants';

export type { ResolvedTheme, Theme };
export { THEME_LABELS, THEME_STORAGE_KEY };

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Alterna solo fra chiaro e scuro, partendo dal tema risolto. */
  toggleTheme: () => void;
}

// Il valore di default rende il contesto utilizzabile anche fuori dal provider
// (test, pagine pubbliche): nessun crash, tema chiaro.
const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => undefined,
  toggleTheme: () => undefined,
});

const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** `useLayoutEffect` lato client, `useEffect` durante il rendering server. */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

function readStoredTheme(fallback: Theme): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : fallback;
  } catch {
    // Modalità privata o storage disabilitato: si resta sul default.
    return fallback;
  }
}

function readSystemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Tema iniziale prima della lettura di `localStorage`. */
  defaultTheme?: Theme;
}

/**
 * Gestisce il tema chiaro/scuro applicando la classe `dark` su `<html>`.
 * La preferenza è persistita in `localStorage`; lo script inline
 * `<ThemeScript />` la applica prima del primo paint per evitare il lampeggio.
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>('light');

  // Allineamento con quanto già scritto dallo script inline.
  useIsomorphicLayoutEffect(() => {
    setThemeState(readStoredTheme(defaultTheme));
    setSystemTheme(readSystemTheme());
  }, [defaultTheme]);

  // Il sistema può cambiare tema mentre l'app è aperta.
  React.useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia(MEDIA_QUERY);
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Un'altra scheda ha cambiato tema: ci adeguiamo.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isTheme(event.newValue)) {
        setThemeState(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persistenza non disponibile: il tema resta valido per la sessione.
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Accesso al tema corrente. Fuori dal provider restituisce il tema chiaro. */
export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}
