'use client';

import { EMPTY_STATS, safeRate } from '@alphaink/shared';
import type { NewsletterStats } from '@alphaink/shared';
import {
  BadgeEuro,
  Ban,
  MailCheck,
  MousePointerClick,
  Eye,
  ShoppingCart,
  Users,
  UserMinus,
} from 'lucide-react';
import * as React from 'react';

import { StatCard } from '@/components/ui/stat-card';
import { cn, formatCurrency, formatNumber, formatPercent } from '@/lib/utils';

export interface StatsGridProps {
  stats?: NewsletterStats | null;
  loading?: boolean;
  /** Mostra solo le sei metriche principali. */
  compact?: boolean;
  className?: string;
}

interface Tile {
  key: string;
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  icon: React.ReactNode;
  tooltip?: string;
  /** Esclusa dalla versione compatta. */
  secondary?: boolean;
}

/**
 * Griglia delle metriche di una newsletter.
 * I valori sono già consolidati dai webhook Brevo: qui si formattano soltanto.
 */
export function StatsGrid({ stats, loading = false, compact = false, className }: StatsGridProps) {
  const data = stats ?? EMPTY_STATS;
  const bounces = data.softBounces + data.hardBounces;
  const currency = data.currency || 'EUR';

  const tiles: Tile[] = [
    {
      key: 'recipients',
      label: 'Destinatari',
      value: formatNumber(data.recipients),
      hint: `${formatNumber(data.requested)} email richieste a Brevo`,
      icon: <Users />,
      tooltip: 'Contatti inclusi nella spedizione dopo le esclusioni del pubblico.',
    },
    {
      key: 'delivered',
      label: 'Consegnate',
      value: formatNumber(data.delivered),
      hint: `${formatPercent(data.deliveryRate)} di consegna`,
      icon: <MailCheck />,
      tooltip: 'Email accettate dal server del destinatario.',
    },
    {
      key: 'opened',
      label: 'Aperture uniche',
      value: formatNumber(data.uniqueOpened),
      hint: `${formatPercent(data.openRate)} · ${formatNumber(data.opened)} aperture totali`,
      icon: <Eye />,
      tooltip: 'Contatti distinti che hanno aperto almeno una volta.',
    },
    {
      key: 'clicked',
      label: 'Click unici',
      value: formatNumber(data.uniqueClicked),
      hint: `${formatPercent(data.clickRate)} · CTOR ${formatPercent(data.clickToOpenRate)}`,
      icon: <MousePointerClick />,
      tooltip: 'Contatti distinti che hanno cliccato almeno un link.',
    },
    {
      key: 'orders',
      label: 'Ordini attribuiti',
      value: formatNumber(data.orders),
      hint: `${formatPercent(data.conversionRate)} di conversione`,
      icon: <ShoppingCart />,
      tooltip: 'Ordini collegati alla newsletter dal modello di attribuzione attivo.',
    },
    {
      key: 'revenue',
      label: 'Fatturato attribuito',
      value: formatCurrency(data.revenue, currency),
      hint: `${formatCurrency(data.revenuePerRecipient, currency)} per destinatario`,
      icon: <BadgeEuro />,
      tooltip: 'Valore degli ordini attribuiti, al netto degli stati non conteggiati.',
    },
    {
      key: 'bounces',
      label: 'Bounce',
      value: formatNumber(bounces),
      hint: `${formatPercent(data.bounceRate)} · ${formatNumber(data.hardBounces)} permanenti`,
      icon: <Ban />,
      tooltip: 'Somma di bounce temporanei e permanenti sulle email richieste.',
      secondary: true,
    },
    {
      key: 'unsubscribed',
      label: 'Disiscrizioni',
      value: formatNumber(data.unsubscribed),
      hint:
        data.complaints > 0
          ? `${formatPercent(data.unsubscribeRate)} · ${formatNumber(data.complaints)} segnalazioni spam`
          : `${formatPercent(data.unsubscribeRate)} sulle consegnate`,
      icon: <UserMinus />,
      tooltip: 'Contatti che hanno annullato l’iscrizione dopo questa email.',
      secondary: true,
    },
  ];

  const visible = compact ? tiles.filter((tile) => !tile.secondary) : tiles;

  return (
    <div
      className={cn(
        'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
        compact ? 'xl:grid-cols-3' : 'xl:grid-cols-4',
        className,
      )}
    >
      {visible.map((tile) => (
        <StatCard
          key={tile.key}
          label={tile.label}
          value={tile.value}
          hint={tile.hint}
          icon={tile.icon}
          tooltip={tile.tooltip}
          loading={loading}
        />
      ))}
    </div>
  );
}

/** Tassi ricalcolati sul volume effettivo, usati quando le statistiche sono parziali. */
export function derivedRates(stats: NewsletterStats): {
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
} {
  return {
    openRate: stats.openRate || safeRate(stats.uniqueOpened, stats.delivered),
    clickRate: stats.clickRate || safeRate(stats.uniqueClicked, stats.delivered),
    clickToOpenRate: stats.clickToOpenRate || safeRate(stats.uniqueClicked, stats.uniqueOpened),
  };
}
