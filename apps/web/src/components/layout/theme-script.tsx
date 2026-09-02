import { THEME_STORAGE_KEY } from '@/components/layout/theme-constants';

/**
 * Script eseguito prima del primo paint: applica la classe `dark` leggendo la
 * preferenza salvata, così la pagina non lampeggia in bianco al caricamento.
 * Deve restare un componente server (niente `'use client'`) per finire
 * nell'HTML iniziale ed essere valutato durante il parsing del documento.
 */
const SOURCE = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'&&t!=='system'){t='system';}var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export function ThemeScript() {
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SOURCE }} />;
}
