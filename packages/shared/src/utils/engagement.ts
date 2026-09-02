import type { ContactEngagement, EngagementTier } from '../types/contact';

const DAY_MS = 86_400_000;

/**
 * Punteggio di engagement 0-100.
 *
 * Combina:
 *  - recency dell'ultima interazione (peso 45)
 *  - tasso di apertura sulle email consegnate (peso 25)
 *  - tasso di click sulle email consegnate (peso 30)
 * e penalizza bounce e segnalazioni spam.
 */
export function computeEngagementScore(
  engagement: Pick<
    ContactEngagement,
    'delivered' | 'opened' | 'clicked' | 'bounced' | 'complaints' | 'lastOpenedAt' | 'lastClickedAt'
  >,
  /** Istante di riferimento (epoch ms). Passato esplicitamente per rendere la funzione pura. */
  now: number,
): number {
  const reference = Number.isFinite(now) && now > 0 ? now : 0;
  const delivered = Math.max(0, engagement.delivered);
  if (delivered === 0) return 0;

  const openRate = Math.min(1, engagement.opened / delivered);
  const clickRate = Math.min(1, engagement.clicked / delivered);

  const lastInteraction = Math.max(
    engagement.lastOpenedAt ? Date.parse(engagement.lastOpenedAt) : 0,
    engagement.lastClickedAt ? Date.parse(engagement.lastClickedAt) : 0,
  );

  let recencyScore = 0;
  if (lastInteraction > 0 && reference > 0) {
    const days = Math.max(0, (reference - lastInteraction) / DAY_MS);
    // 0 giorni → 45 punti; 180 giorni → 0 punti, decadimento lineare.
    recencyScore = Math.max(0, 45 * (1 - days / 180));
  }

  const penalty = engagement.complaints * 15 + engagement.bounced * 5;
  const raw = recencyScore + openRate * 25 + clickRate * 30 - penalty;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

export function engagementTierFromScore(score: number, delivered: number): EngagementTier {
  if (delivered === 0) return 'unknown';
  if (score >= 65) return 'hot';
  if (score >= 40) return 'warm';
  if (score >= 15) return 'cold';
  return 'dormant';
}

export const EMPTY_ENGAGEMENT: ContactEngagement = {
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  bounced: 0,
  complaints: 0,
  lastSentAt: null,
  lastOpenedAt: null,
  lastClickedAt: null,
  engagementScore: 0,
  engagementTier: 'unknown',
};
