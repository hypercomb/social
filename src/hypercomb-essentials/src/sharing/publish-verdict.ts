// sharing/publish-verdict.ts
//
// THE VERDICT LADDER — three signatures and a probe in, one row state out.
//
// Pure and separate from the drone on purpose: this is the honesty of the
// whole publish surface compressed into one function, and it is the thing
// most worth pinning with tests. Every rung above `drift` is a reason the
// comparison ITSELF cannot be trusted, and each must win over it — a panel
// that reports "changed here" when it actually means "I could not look" is
// worse than one that says nothing.

/** What a row can say about itself. */
export type PublishRowState =
  /** live === here, head bytes served, index fresh. */
  | 'live'
  /** verified index, but the branch has moved on here. */
  | 'drift'
  /** marked public, no index entry, never published. */
  | 'unpublished'
  /** published moments ago and the index has not caught up yet. */
  | 'pending'
  /** the index we can read is OLDER than one we signed — an edge is behind. */
  | 'stale-edge'
  /** the host asserted 404 for the live head. */
  | 'gone'
  /** nothing could be asserted (offline, CORS, 5xx, breaker). */
  | 'unknown'
  /** sealSubtree returned null — a child is cold. Not a difference. */
  | 'cannot-compare'
  /** the local side is still being computed. */
  | 'comparing'

/** How the one index read went, as the drone classifies it. */
export type PublishIndexState =
  'ok' | 'none' | 'unreachable' | 'http' | 'malformed' | 'forged' | 'checking'

export interface VerdictInput {
  /** Head named by the verified index, or null when it names none. */
  live: string | null
  /** Head sealing would produce now; null means COULD NOT SEE, never "differs". */
  here: string | null
  /** The served probe. `unknown` asserts nothing — it is not a failure. */
  served: 'served' | 'absent' | 'unknown'
  indexState: PublishIndexState
  /** The readable index is older than one we ourselves signed. */
  indexStale: boolean
  /** Our ledger's head for this branch, and when we published it (epoch ms). */
  record: { sealed: string; at: number } | undefined
  /** False when the row has no local path to seal (published elsewhere). */
  sealable: boolean
  /** Injected so the ladder stays pure and testable. */
  now?: number
}

/** How long a publish record counts as "just published". Past this window an
 *  index naming a different head is simply the authority — another device
 *  published — and saying `pending` forever would be the panel insisting its
 *  own memory outranks what the world actually serves. */
export const RECENT_PUBLISH_MS = 10 * 60 * 1000

export function publishVerdict(input: VerdictInput): PublishRowState {
  const { live, here, served, indexState, indexStale, record, sealable } = input
  const now = input.now ?? Date.now()

  // The index itself could not be believed — no row-level claim is possible.
  // `forged` is included here deliberately: it is reported once, loudly, at
  // the panel level, and must not also paint nine rows red.
  if (indexState !== 'ok' && indexState !== 'none') return 'unknown'
  // Nothing published. Only claim "not published" for a branch we can actually
  // publish; otherwise we simply do not know what this entry is.
  if (!live) return sealable ? 'unpublished' : 'unknown'
  // Authentic but superseded: an edge is serving an index older than ours.
  if (indexStale) return 'stale-edge'
  // The host ASSERTED absence. Only a 404 reaches here.
  if (served === 'absent') return 'gone'
  // We published a head the index still does not name, recently.
  if (record && record.sealed !== live && now - record.at < RECENT_PUBLISH_MS) return 'pending'
  // No local path to seal — we can see the world's side only.
  if (!sealable) return 'unknown'
  // Could not see our own side (a cold child). Say so; never call it drift.
  if (!here) return 'cannot-compare'
  if (here !== live) return 'drift'
  // Same head on both sides. `unknown` service (offline, CORS, breaker) is not
  // proof of service, so it does not earn the green light.
  return served === 'served' ? 'live' : 'unknown'
}
