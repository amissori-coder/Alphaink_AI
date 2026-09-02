/**
 * Motore di segmentazione AlphaInk.
 *
 * Attenzione ai nomi: la callable `recomputeCluster` (contratto API) e la
 * funzione del motore hanno lo stesso nome. Qui vince la callable, mentre la
 * funzione del motore è riesportata come `recomputeClusterMembership`. Chi ha
 * bisogno del motore importi da `./engine` oppure usi l'alias.
 */

export * from './evaluator';
export * from './query-planner';
export * from './brevo-lists';

export {
  DEFAULT_PAGE_SIZE,
  MAX_CLUSTER_MEMBERS,
  MEMBERSHIP_INDEX_MAX_AGE_MS,
  PREVIEW_MAX_SCAN,
  PURCHASE_FACTS_WINDOW_DAYS,
  detachClusterFromContacts,
  emptyAudienceReasons,
  estimateAudienceSize,
  loadContactsByIds,
  loadPurchaseFacts,
  previewClusterDefinition,
  previewClusterRules,
  recomputeCluster as recomputeClusterMembership,
  resolveAudience,
  resolveClusterContacts,
  resolveClusterMembers,
} from './engine';
export type {
  AudienceExclusionReason,
  AudienceReasons,
  ClusterLike,
  RecomputeClusterResult,
  ResolveAudienceOptions,
  ResolveClusterOptions,
  ResolvedAudience,
  ResolvedCluster,
} from './engine';

export * from './callables';
export * from './scheduled';
