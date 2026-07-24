// diamondcoreprocessor.com/sharing/peer-divergence.ts
//
// "This tile you HOLD has something a peer is offering that you don't have
// yet." The set is read SYNCHRONOUSLY by the overlay's `visibleWhen` (icon
// visibility is computed on hover, where nothing async is allowed) and
// written by SwarmAdoptDrone's debounced scan.
//
// IN MEMORY ONLY — never persisted, never signature-keyed. A swarm-scoped
// judgement must not outlive the swarm: this is a GESTURE surface, not a
// STATE surface. Rejoining recomputes it from live announcements. (The
// durable counterpart, `dcp.toggleState`, is keyed by content signature and
// grows forever — writing swarm judgements there would re-match those bytes
// in every future context. Not here, not ever.)
//
// ADDITIVE SEMANTICS. Membership means "they have children you don't",
// never "your copy is stale". Adopt ADDS; it never removes or overwrites,
// and it never fires without an explicit gesture.

let diverged: ReadonlySet<string> = new Set()

/**
 * Replace the diverged set for the current location. Returns true when the
 * membership actually changed, so the caller only repaints on real news
 * (the scan re-runs on every peer burst; most produce the same answer).
 */
export function setDivergedLabels(labels: Iterable<string>): boolean {
  const next = new Set<string>()
  for (const l of labels) {
    const name = String(l ?? '').trim()
    if (name) next.add(name)
  }
  if (next.size === diverged.size) {
    let same = true
    for (const l of next) if (!diverged.has(l)) { same = false; break }
    if (same) return false
  }
  diverged = next
  return true
}

/** Sync predicate for overlay `visibleWhen` — is there anything to take on
 *  this held tile? False whenever we have no live answer (mesh off, scan
 *  not yet run, peer gone): the affordance is opt-in evidence, never a
 *  guess. */
export function peerDivergesAt(label: string): boolean {
  return diverged.has(String(label ?? '').trim())
}

/** Every held tile currently offering something — for panels/legends that
 *  want the whole picture rather than one label. */
export function divergedLabels(): readonly string[] {
  return [...diverged]
}

/** Drop the whole answer. Called on navigation and when the mesh goes
 *  quiet: a stale set would light adopt on tiles nobody is publishing. */
export function clearPeerDivergence(): boolean {
  if (diverged.size === 0) return false
  diverged = new Set()
  return true
}
