// hypercomb-core/src/usage.types.ts
//
// Minimal usage-ranking contract. The implementation (UsageTracker) lives in
// hypercomb-shared; this interface lets essentials modules (e.g. the history
// preloader) consult local usage weights to order what they warm first —
// WITHOUT importing from shared, which would violate the dependency direction.
//
// The tracker records, per location signature, a recency-decayed dwell + visit
// count (local-only, per-participant — never shared, never in history). It is
// consumed purely as a best-effort ordering heuristic: its absence, or an
// unseen sig, must collapse to the prior (un-ranked) behaviour.

export interface UsageRanker {
  /** Recency-decayed usage weight for a location sig; 0 when unseen. */
  weight(sig: string): number
  /**
   * Stable-sort `sigs` by weight descending. Unseen sigs (weight 0) keep their
   * original relative order at the tail, so ranking a cold set is a no-op.
   * Never throws; returns a new array.
   */
  rank(sigs: readonly string[]): string[]
  /**
   * Record an INTERACTION with a tile — meeting it counts, whether or not the
   * navigation that follows ever settles. Optional so a host without a tracker
   * (or an older one) collapses to no-op; callers use `ranker.bump?.(sig)`.
   * Durable: each bump lands in a write-ahead queue before it is folded into
   * the persisted record, so a crash never loses the count.
   */
  bump?(sig: string, n?: number): void
  /** Raw interaction count for a tile (visits + bumps); 0 when unseen. */
  interactions?(sig: string): number
}

export const USAGE_IOC_KEY = '@hypercomb.social/UsageTracker'
