'use client';

import { BarChart3, Layers, Workflow } from 'lucide-react';
import * as React from 'react';

import { BrandLockup } from '@/components/layout/brand-mark';
import { ThemeProvider } from '@/components/layout/theme-provider';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { cn } from '@/lib/utils';

interface ValuePoint {
  icon: typeof Workflow;
  title: string;
  description: string;
}

const VALUE_POINTS: ValuePoint[] = [
  {
    icon: Workflow,
    title: 'Automazioni che lavorano da sole',
    description:
      'Coupon stampante, pagamenti abbandonati e riacquisti di toner e carta partono al momento giusto del ciclo di consumo.',
  },
  {
    icon: Layers,
    title: 'Cluster sempre aggiornati',
    description:
      'I clienti di alphaink.net e b2b.alphaink.net arrivano dal sito e si segmentano da soli per famiglia di prodotto e comportamento.',
  },
  {
    icon: BarChart3,
    title: 'Dal click all’incasso',
    description:
      'Consegne, aperture, click e fatturato attribuito, campagna per campagna, con i dati di Brevo e del negozio in un solo posto.',
  },
];

/**
 * Impaginazione a due colonne delle schermate di accesso: a sinistra il form,
 * a destra il pannello di brand con gradiente ciano → magenta.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <div className="grid min-h-screen bg-background lg:grid-cols-2">
        <div className="relative flex flex-col px-6 py-8 sm:px-10 lg:px-14">
          <div className="flex items-center justify-between">
            <BrandLockup />
            <ThemeToggle />
          </div>

          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-sm">{children}</div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} AlphaInk · Suite newsletter interna
          </p>
        </div>

        <BrandPanel className="hidden lg:flex" />
      </div>
    </ThemeProvider>
  );
}

/** Pannello promozionale con il claim e i tre punti di valore. */
function BrandPanel({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        'relative isolate flex-col justify-between overflow-hidden p-12 text-white',
        'bg-[linear-gradient(150deg,#006F9E_0%,#5B2C86_52%,#B4006B_100%)]',
        className,
      )}
    >
      {/* Decorazioni: aloni CMYK e trama a puntini, puramente estetiche. */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-ink-cyan/30 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-ink-magenta/30 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(currentColor_1px,transparent_1px)] [background-size:22px_22px]"
        aria-hidden="true"
      />

      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
          AlphaInk Newsletter Suite
        </p>
        <h2 className="mt-5 max-w-md text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
          L’inchiostro giusto, al cliente giusto, nel momento giusto.
        </h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
          Crea e pianifica le newsletter, lascia lavorare le automazioni e misura ogni euro generato:
          tutto collegato a Brevo e ai due negozi PrestaShop.
        </p>
      </div>

      <ul className="relative mt-10 space-y-6">
        {VALUE_POINTS.map((point) => {
          const Icon = point.icon;
          return (
            <li key={point.title} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{point.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-white/75">
                  {point.description}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="relative mt-10 text-xs text-white/60">
        Dati su Firebase · Invii e webhook gestiti da Brevo · Fuso orario Europe/Rome
      </p>
    </aside>
  );
}
