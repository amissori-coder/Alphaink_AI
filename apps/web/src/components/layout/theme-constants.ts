/**
 * Costanti del tema condivise fra il provider client e lo script inline
 * eseguito nell'HTML iniziale. Volutamente senza `'use client'`: deve poter
 * essere importato anche da un componente server.
 */

/** Preferenza scelta dall'utente. `system` segue le impostazioni del sistema operativo. */
export type Theme = 'light' | 'dark' | 'system';

/** Tema effettivamente applicato al documento. */
export type ResolvedTheme = 'light' | 'dark';

/** Chiave di `localStorage` usata per persistere la preferenza. */
export const THEME_STORAGE_KEY = 'alphaink.theme';

/** Chiave di `localStorage` per lo stato compresso della barra laterale. */
export const SIDEBAR_STORAGE_KEY = 'alphaink.sidebar.collapsed';

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Chiaro',
  dark: 'Scuro',
  system: 'Sistema',
};

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}
