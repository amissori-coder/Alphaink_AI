'use client';

import { ENGAGEMENT_TIER_LABELS } from '@alphaink/shared';
import type { ContactEngagement, EngagementTier } from '@alphaink/shared';
import * as React from 'react';

import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn, formatNumber, formatPercent, relativeTimeIt } from '@/lib/utils';

const BAR_COLORS: Record<EngagementTier, string> = {
  hot: 'bg-success',
  warm: 'bg-primary',
  cold: 'bg-warning',
  dormant: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
};

const TEXT_COLORS: Record<EngagementTier, string> = {
  hot: 'text-success',
  warm: 'text-primary',
  cold: 'text-warning-foreground',
  dormant: 'text-destructive',
  unknown: 'text-muted-foreground',
};

/** Riepilogo leggibile mostrato nel suggerimento del misuratore. */
function tooltipText(engagement: ContactEngagement): string {
  if (engagement.delivered === 0) {
    return 'Nessuna email consegnata: il punteggio non è ancora calcolabile.';
  }
  const openRate = engagement.opened / engagement.delivered;
  const clickRate = engagement.clicked / engagement.delivered;
  const parts = [
    `${formatNumber(engagement.delivered)} email consegnate`,
    `${formatPercent(openRate)} di aperture`,
    `${formatPercent(clickRate)} di click`,
  ];
  if (engagement.lastOpenedAt) {
    parts.push(`ultima apertura ${relativeTimeIt(engagement.lastOpenedAt)}`);
  }
  if (engagement.bounced > 0) parts.push(`${formatNumber(engagement.bounced)} bounce`);
  if (engagement.complaints > 0) {
    parts.push(`${formatNumber(engagement.complaints)} segnalazioni spam`);
  }
  return parts.join(' · ');
}

export interface EngagementMeterProps {
  engagement: ContactEngagement;
  /** Nasconde l'etichetta del livello, lasciando barra e punteggio. */
  compact?: boolean;
  className?: string;
}

/**
 * Misuratore dell'engagement: barra proporzionale al punteggio 0-100 e livello
 * derivato. Il punteggio è calcolato dal backend a ogni evento Brevo, qui viene
 * solo rappresentato.
 */
export function EngagementMeter({ engagement, compact = false, className }: EngagementMeterProps) {
  const tier = engagement.engagementTier ?? 'unknown';
  const score = Math.max(0, Math.min(100, engagement.engagementScore ?? 0));

  return (
    <SimpleTooltip content={tooltipText(engagement)}>
      <div className={cn('min-w-0 space-y-1', className)}>
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-full min-w-[3rem] max-w-[6rem] overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Punteggio di engagement: ${score} su 100, livello ${ENGAGEMENT_TIER_LABELS[tier]}`}
          >
            <div
              className={cn('h-full rounded-full transition-[width]', BAR_COLORS[tier])}
              style={{ width: `${Math.max(score, tier === 'unknown' ? 0 : 4)}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{score}</span>
        </div>
        {compact ? null : (
          <span className={cn('block text-[11px] font-medium', TEXT_COLORS[tier])}>
            {ENGAGEMENT_TIER_LABELS[tier]}
          </span>
        )}
      </div>
    </SimpleTooltip>
  );
}

export interface EngagementTierChipProps {
  tier: EngagementTier;
  className?: string;
}

/** Pastiglia colorata del solo livello di engagement. */
export function EngagementTierChip({ tier, className }: EngagementTierChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium',
        TEXT_COLORS[tier],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', BAR_COLORS[tier])} aria-hidden="true" />
      {ENGAGEMENT_TIER_LABELS[tier]}
    </span>
  );
}
