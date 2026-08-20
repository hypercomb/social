// diamondcoreprocessor.com/assistant/ask-scope.ts
//
// ONE STRUCTURAL ASK PER BRANCH — and none while an ANCESTOR is being
// restructured. Unrelated branches run at the same time.
//
// A structural ask (`task:'break-apart'`, `task:'organize'`) reshapes a subtree.
// Two of them are only safe together when their subtrees do not overlap:
//
//   /a/b  break-apart + /a/c break-apart → CONCURRENT. Different subtrees;
//                                        neither can see the other's work.
//   /a    organize    + /a/b break-apart → CONFLICT. Organize re-homes b into a
//                                        group, so b is no longer at /a/b —
//                                       the break-apart would create children
//                                        under a path that moved out from
//                                        under it.
//   /a/b  break-apart + /a/b break-apart → CONFLICT. The same work twice: both
//                                        drain, both create, and the second
//                                        either duplicates tiles or gets
//                                        stopped by hand. (Observed live: a
//                                        double-tap put two identical asks for
//                                        ai-inside/data-privacy in the pool.)
//
// So the test is ANCESTOR-OR-SELF IN EITHER DIRECTION: refuse when one scope
// path is a prefix of the other. Disjoint paths never conflict and are
// allowed to proceed together — that is the normal case for a foreach over a
// layer's leaves, which is why a blunt one-at-a-time lock would be wrong.
//
// Content-addressing does NOT catch even the exact-duplicate case: the record
// carries `askedAt`, so identical intent at two instants signs to two
// signatures. Scope, not signature, is the identity that matters.
//
// The index is a CACHE with a short life, not a ledger. It re-reads the pool
// when stale so a retired ask stops blocking, and `claim()` marks a scope the
// instant it is minted so a foreach cannot race itself between reads. Erring
// toward allowing is correct: a refused ask is invisible, a duplicate one is
// cheap and obvious.

/** How long a pool scan is trusted. Long enough that one foreach over a
 *  layer's leaves scans once, short enough that a retire frees the branch
 *  almost immediately. */
const TTL_MS = 1_500

type StoreLike = {
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
}

/** What a pending structural ask is holding. */
export type PendingScope = { task: string; path: readonly string[] }

/** Is `a` an ancestor of, or equal to, `b`? Compared SEGMENT-WISE — a string
 *  prefix test would make `/ai` an ancestor of `/ai-inside`. */
const isAncestorOrSelf = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length > b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Do two subtrees overlap? True when either contains the other. */
export const scopesConflict = (a: readonly string[], b: readonly string[]): boolean =>
  isAncestorOrSelf(a, b) || isAncestorOrSelf(b, a)

export class PendingAskIndex {
  #held: PendingScope[] = []
  #at = 0

  /** The pending ask whose subtree overlaps `path`, or null when the branch
   *  is free. Returns the holder so the caller can say WHICH ask is in the
   *  way — "already being organized" is actionable, "refused" is not.
   *  Null on any read failure: a pool we could not read must not silently
   *  block the work. */
  async conflict(path: readonly string[]): Promise<PendingScope | null> {
    await this.#refresh()
    return this.#held.find(h => scopesConflict(h.path, path)) ?? null
  }

  /** Hold a subtree immediately, before the write lands, so a foreach cannot
   *  mint two overlapping asks inside one scan window. */
  claim(task: string, path: readonly string[]): void {
    this.#held.push({ task, path: [...path] })
  }

  /** Drop a hold — the ask it named never landed, so the branch is free
   *  again rather than blocked until the cache expires. */
  release(path: readonly string[]): void {
    const i = this.#held.findIndex(h => h.path.length === path.length && isAncestorOrSelf(h.path, path))
    if (i >= 0) this.#held.splice(i, 1)
  }

  async #refresh(): Promise<void> {
    if (Date.now() - this.#at < TTL_MS) return
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.listOptimizations || !store?.getOptimization) return

    try {
      const sigs = await store.listOptimizations()
      const held: PendingScope[] = []
      for (const sig of sigs) {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        let rec: { kind?: unknown; payload?: Record<string, unknown> }
        try { rec = JSON.parse(await blob.text()) } catch { continue }
        if (rec?.kind !== 'ask') continue
        const p = rec.payload ?? {}
        const task = typeof p['task'] === 'string' ? p['task'] : ''
        // Only STRUCTURAL asks hold a branch. A question changes nothing, so
        // it never blocks — and may be asked twice on purpose.
        if (!task) continue
        if (p['status'] && p['status'] !== 'pending') continue
        held.push({ task, path: scopePathOf(p) })
      }
      this.#held = held
      this.#at = Date.now()
    } catch (err) {
      // Leave the previous view in place and let it expire; do not block.
      console.warn('[ask-scope] could not scan the ask pool:', err)
    }
  }
}

/** The subtree an ask reshapes, read from its payload.
 *
 *  Minters write `scopePath` explicitly — the drone knows its own topology
 *  and should not make this module infer it. The fallback derives it the way
 *  the two current tasks do (break-apart creates UNDER its target; organize
 *  reshapes the layer it stands on) so a record minted before `scopePath`
 *  existed still holds the right branch instead of the root. */
export const scopePathOf = (payload: Record<string, unknown>): string[] => {
  const explicit = payload['scopePath']
  if (Array.isArray(explicit)) return explicit.map(s => String(s ?? '')).filter(Boolean)

  const segments = Array.isArray(payload['segments'])
    ? (payload['segments'] as unknown[]).map(s => String(s ?? '')).filter(Boolean)
    : []
  const targets = Array.isArray(payload['targets'])
    ? (payload['targets'] as unknown[]).map(s => String(s ?? '')).filter(Boolean)
    : []
  return targets.length === 1 ? [...segments, targets[0]] : segments
}
