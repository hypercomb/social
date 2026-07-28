// diamond-core-processor/src/app/core/revision-identity.ts

/**
 * IDENTITY vs REVISION.
 *
 * A signature names BYTES, not a thing. Two sigs of the same source file at
 * two build generations are two revisions of ONE artifact — the installer must
 * show (and the hive must run) exactly one of them. Nothing in the layer format
 * says which sigs are siblings, so identity has to be derived: a code artifact
 * IS its class name at its lineage.
 *
 *   identity = "<lineage>/<ClassName>"        e.g. "presentation/tiles/TileOverlayDrone"
 *   revision = the signature
 *
 * Three duplicate shapes exist, and only the middle one is a revision:
 *
 *   - SAME SIG, two parents — one artifact referenced from two layers.
 *     NOT a revision. Activation is keyed by signature and happens once, so
 *     one sig is one running instance and one switch; the duplicate is purely
 *     a rendering artifact and is collapsed only in flattened/merged views.
 *   - SAME IDENTITY, different sigs, same source — a build-generation skew.
 *     THIS is a revision: one wins, the rest are recorded as superseded.
 *   - SAME CLASS NAME, different lineage or different domain — a fork or a
 *     mirror, not a revision. Different identities, never folded together.
 *
 * An artifact whose class name can't be resolved has NO identity: it can never
 * be proven a duplicate, so it is never collapsed away.
 */

/** The identity of a code artifact, or null when it has none (unnameable). */
export function identityKey(lineage: string | undefined, className: string | null | undefined): string | null {
  const name = (className ?? '').trim()
  if (!name) return null
  return `${(lineage ?? '').trim()}/${name}`
}

/** One candidate revision. `rank` orders precedence — LOWEST WINS — and is the
 *  caller's to define, because "which revision is active" means different
 *  things at different altitudes (tree depth inside one resolve; section
 *  precedence across a domain; domain order across the install). Ties break on
 *  `order` (document order), so collapse is deterministic and never depends on
 *  Map iteration luck. */
export interface RevisionCandidate<T> {
  sig: string
  identity: string | null
  rank: number
  order: number
  item: T
}

export interface CollapseResult<T> {
  /** The winning candidate per identity, in the order their winners appeared. */
  kept: RevisionCandidate<T>[]
  /** Winning sig → the sigs it supersedes (other revisions of that identity). */
  superseded: Map<string, string[]>
  /** Every sig that LOST — the set that must not render, activate, or ship. */
  losers: Set<string>
}

/**
 * Collapse candidates to one revision per identity.
 *
 * Candidates with no identity always survive (see the doctrine above), as do
 * repeated appearances of the SAME sig — those are one artifact seen twice,
 * not a revision conflict, so they are folded to a single entry rather than
 * one of them being declared a loser.
 */
export function collapseRevisions<T>(candidates: RevisionCandidate<T>[]): CollapseResult<T> {
  const winners = new Map<string, RevisionCandidate<T>>()

  const better = (a: RevisionCandidate<T>, b: RevisionCandidate<T>) =>
    a.rank !== b.rank ? a.rank < b.rank : a.order < b.order

  for (const c of candidates) {
    if (!c.identity) continue
    const current = winners.get(c.identity)
    if (!current || better(c, current)) winners.set(c.identity, c)
  }

  const superseded = new Map<string, string[]>()
  const losers = new Set<string>()
  for (const c of candidates) {
    if (!c.identity) continue
    const winner = winners.get(c.identity)!
    if (c.sig === winner.sig) continue
    losers.add(c.sig)
    const list = superseded.get(winner.sig) ?? []
    if (!list.includes(c.sig)) list.push(c.sig)
    superseded.set(winner.sig, list)
  }

  // Emit in first-appearance order so the collapsed list reads like the source.
  const kept: RevisionCandidate<T>[] = []
  const emittedIdentity = new Set<string>()
  const emittedSig = new Set<string>()
  for (const c of candidates) {
    if (!c.identity) {
      // Identityless: it stands alone, but a repeat of a sig already emitted
      // is the same artifact seen twice — drop the echo, don't call it a loser.
      if (emittedSig.has(c.sig)) continue
      emittedSig.add(c.sig)
      kept.push(c)
      continue
    }
    if (emittedIdentity.has(c.identity)) continue
    emittedIdentity.add(c.identity)
    kept.push(winners.get(c.identity)!)
  }

  return { kept, superseded, losers }
}
