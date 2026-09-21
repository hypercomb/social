// sharing/branch-difference.ts
//
// "Is there anything under this tile the publisher holds and I don't — at ANY
// depth?" The divergence scan's fourth rule (swarm-adopt.drone.ts). Rule 3
// asks the same question one level in, from the mesh cache; this one walks
// the publisher's own branch, from the branch sig every offer carries, against
// the tile you hold. A grandchild you never took keeps the adopt-all door lit
// on every ancestor you did take.
//
// Names, not signatures — for the reason rule 3 gives: the fold re-homes by
// name, so an adopted copy's bytes never equal the publisher's. Pairs are
// matched by name at each level and walked together.
//
// LOCAL READS ONLY. `getLayerBySig` answers from this device; the walk never
// waits on a network. A layer that is not here yet is NO EVIDENCE — that
// subtree is skipped, never claimed, and the answer says it was INCOMPLETE so
// the caller can bring the publisher's layer records here and ask again.
// Absence of evidence is not divergence (the rule every rule in the scan
// keeps).

import {
  childSigsOf,
  type PlacementHistory,
  type PlacementLayer,
} from '../history/layer-placement.js'

/** Most publisher layers one question may read. A branch past this is walked
 *  as far as the budget goes, and only what was actually read can answer yes. */
export const BRANCH_DIFFERENCE_LAYER_BUDGET = 400

/** My children by lowercased name, or null when any of them is not readable
 *  here — a name I cannot read might be the one the publisher is offering. */
const childrenByName = async (
  history: PlacementHistory,
  layer: PlacementLayer,
): Promise<Map<string, PlacementLayer> | null> => {
  const out = new Map<string, PlacementLayer>()
  for (const sig of childSigsOf(layer)) {
    const child = await history.getLayerBySig(sig).catch(() => null)
    if (!child) return null
    const name = String(child.name ?? '').trim().toLowerCase()
    if (name && !out.has(name)) out.set(name, child)
  }
  return out
}

/** What one walk found. `unheld` is only ever true on evidence; `incomplete`
 *  says some publisher layer was not on this device, so a `false` is not the
 *  final word. */
export interface BranchDifference {
  readonly unheld: boolean
  readonly incomplete: boolean
}

/**
 * Does the publisher's branch `theirSig` hold a tile, anywhere beneath its
 * root, whose name path is missing from `mine` (the layer you hold at `at`)?
 * A path you gave back (`isTombstoned`) never counts — deleting a tile is how
 * you say you don't want it, and that must not light the door again.
 */
export async function publisherHoldsUnheldBelow(
  history: PlacementHistory,
  theirSig: string,
  mine: PlacementLayer,
  at: readonly string[],
  isTombstoned: (path: readonly string[]) => boolean,
  budget = BRANCH_DIFFERENCE_LAYER_BUDGET,
): Promise<BranchDifference> {
  let left = budget
  let incomplete = false
  const walked = new Set<string>()

  const walk = async (theirs: string, local: PlacementLayer, path: readonly string[]): Promise<boolean> => {
    if (walked.has(theirs)) return false
    if (left <= 0) { incomplete = true; return false }
    walked.add(theirs)
    left--
    const theirLayer = await history.getLayerBySig(theirs).catch(() => null)
    if (!theirLayer) { incomplete = true; return false }
    const theirChildren = childSigsOf(theirLayer)
    if (theirChildren.length === 0) return false
    const held = await childrenByName(history, local)
    if (!held) return false
    for (const childSig of theirChildren) {
      const child = await history.getLayerBySig(childSig).catch(() => null)
      const name = String(child?.name ?? '').trim()
      if (!name) { incomplete = true; continue }
      const childPath = [...path, name]
      if (isTombstoned(childPath)) continue
      const mineHere = held.get(name.toLowerCase())
      if (!mineHere) return true
      if (await walk(childSig, mineHere, childPath)) return true
    }
    return false
  }

  const unheld = await walk(theirSig, mine, at)
  return { unheld, incomplete: !unheld && incomplete }
}
