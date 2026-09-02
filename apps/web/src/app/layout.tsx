import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Toaster } from 'sonner';

import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query-client';
import { cn } from '@/lib/utils';

import './globals.css';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'AlphaInk Newsletter',
    template: '%s · AlphaInk Newsletter',
  },
  description:
    'Suite AlphaInk per creare, pianificare e inviare newsletter con Brevo: cluster clienti, automazioni comportamentali, tracking degli acquisti e calendario editoriale.',
  applicationName: 'AlphaInk Newsletter',
  authors: [{ name: 'AlphaInk', url: 'https://alphaink.net' }],
  keywords: ['newsletter', 'email marketing', 'Brevo', 'PrestaShop', 'AlphaInk'],
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8FAFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1120' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning className={cn(fontSans.variable, fontMono.variable)}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <QueryProvider>
          <AuthProvider>
            {children}
            <Toaster
              position="bottom-right"
              theme="system"
              richColors
              closeButton
              expand={false}
              duration={4500}
              toastOptions={{
                classNames: {
                  toast:
                    'group rounded-lg border border-border bg-popover text-popover-foreground shadow-popover',
                  description: 'text-muted-foreground',
                  actionButton: 'bg-primary text-primary-foreground',
                  cancelButton: 'bg-muted text-muted-foreground',
                },
              }}
            />
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
