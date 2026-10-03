// hypercomb-observation.ts
//
// THE READ GRAMMAR LIVES IN CORE (core/hive-reads.ts) — re-exported here for
// the window and the specs that grew up on this module.

export {
  MAX_OBSERVATIONS,
  READ_PAGE_CHARS,
  OBSERVATION_VERBS,
  CODE_HITS,
  HypercombObservationError,
  parseHypercombObservationGrammars,
  executeHypercombObservationPlan,
  foreignReads,
  formatHypercombObservationReceipt,
} from '@hypercomb/core'
export type {
  HypercombObservationVerb,
  HypercombObservation,
  HypercombBytesRead,
  HypercombCodeHit,
  HypercombCodeRead,
  HypercombFindRead,
  HypercombNodeRead,
  HypercombHistoryRead,
  HypercombSummaryRead,
  HypercombRead,
  HypercombObservationPlan,
  HypercombObservedNode,
  HypercombTreeRead,
  HypercombTreeReader,
  HypercombObservationReceipt,
} from '@hypercomb/core'
