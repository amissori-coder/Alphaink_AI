import { AppShell } from '@/components/layout/app-shell';
import { ThemeScript } from '@/components/layout/theme-script';

/**
 * Guscio dell'area riservata: tutte le rotte figlie richiedono un utente
 * autenticato con un ruolo assegnato.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      <AppShell>{children}</AppShell>
    </>
  );
}
