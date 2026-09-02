import type { Metadata } from 'next';

import { AuthShell } from '@/components/layout/auth-shell';
import { ThemeScript } from '@/components/layout/theme-script';

// Nessun `title` qui: definirlo consumerebbe il template del layout radice
// e le pagine figlie perderebbero il suffisso «· AlphaInk Newsletter».
export const metadata: Metadata = {
  description: 'Accedi alla suite newsletter di AlphaInk.',
};

/** Impaginazione comune alle schermate pubbliche di autenticazione. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ThemeScript />
      <AuthShell>{children}</AuthShell>
    </>
  );
}
