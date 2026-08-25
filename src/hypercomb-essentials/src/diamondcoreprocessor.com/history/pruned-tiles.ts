// diamondcoreprocessor.com/history/pruned-tiles.ts
//
// THE LAYER OF DELETED TILES.
//
// `/remove` is sig-preserving: it drops a child's sig from the parent's
// `children` and commits. Nothing on disk is destroyed — the child's bag,
// its layers and its whole branch stay exactly where they were, which is
// what makes undo a one-liner (restore the parent layer, the tile is back).
//
// The cost of that bargain is that a hive accumulates. Every tile ever
// deleted is still resident, still addressable, still occupying bytes, and
// invisible: nothing in the interface lists it, so nothing can ever get rid
// of it. This module is the listing.
//
// WHAT A DELETED TILE IS. A location's markers are its revisions, oldest to
// newest. Every marker points at a layer, every layer names its children by
// sig, every child sig resolves to a layer carrying a `name`. Union the
// names across every revision, subtract the names the HEAD still carries,
// and what is left are the tiles this location once had and no longer does.
// That set is a layer in its own right — one the participant can walk onto
// and prune.
//
// WHY BY NAME, NOT BY SIG. The name IS the path segment (see lineage-key):
// `[...segments, name]` addresses one lineage bag, so at a given location a
// name is a tile's identity across all of its revisions, while its sig
// changes on every edit. A tile edited eight times before it was deleted is
// ONE deleted tile with eight layer sigs behind it, not eight ghosts. The
// hexagon shows the name; the purge takes every sig that ever stood behind
// it.
//
// RE-ADDS ARE NOT DELETIONS. A name that was removed and later created again
// is in the head's children, so it never enters this set — the tile you are
// looking at now is not junk, whatever happened to it in between.

import { childSigsOf, type PlacementLayer } from './layer-placement.js'

/** One tile this location used to carry and does not any more. */
export type PrunedTile = {
  /** The tile's name — its path segment, and what the hexagon shows. */
  readonly name: string
  /** Every layer sig this name held here, oldest first. The newest is what
   *  the ghost renders from (the tile as it last stood); all of them are
   *  what a purge has to account for. */
  readonly sigs: readonly string[]
  /** `at` of the newest revision that still listed it — when it was last
   *  part of this location. */
  readonly lastSeenAt: number
}

/** What the scan reads. Supplied by the caller so this stays a pure
 *  function over markers — the service passes HistoryService, the spec
 *  passes a fixture. */
export type PrunedScanSource = {
  /** Markers oldest → newest: which layer each revision points at, and when. */
  readonly markers: ReadonlyArray<{ readonly layerSig: string; readonly at: number }>
  /** Resolve a layer by sig. Null means "unreadable" — the scan skips it
   *  rather than guessing, so a cold or purged sig can never invent or
   *  erase a deleted tile. */
  readLayer(sig: string): Promise<PlacementLayer | null>
  /** Optional cooperative yield, called every few hundred reads. The ROOT
   *  location's bag gains a marker on every change made ANYWHERE in the
   *  hive, so this scan can be thousands of revisions deep there — long
   *  enough to stall paint and input if it runs in one unbroken slice. The
   *  service passes a real yield; a spec passes nothing. */
  yieldNow?(): Promise<void>
}

/**
 * The deleted tiles at one location, newest deletion first.
 *
 * Cost is O(revisions × children) resolves, but every resolve is keyed by
 * child SIG and memoized here: a child's sig only changes when that child
 * changes, so a location with a long history and stable children reads each
 * child once, not once per revision. The scan runs when prune mode opens,
 * never on a render path.
 */
export const collectPrunedTiles = async (src: PrunedScanSource): Promise<PrunedTile[]> => {
  const markers = src.markers
  if (markers.length === 0) return []

  // sig → name, resolved once. Null caches a definitive miss so an
  // unreadable child isn't re-read on every revision that listed it.
  const nameBySig = new Map<string, string | null>()
  let reads = 0
  const breathe = async (): Promise<void> => {
    if (!src.yieldNow) return
    if (++reads % 250 !== 0) return
    await src.yieldNow()
  }
  const nameOf = async (sig: string): Promise<string | null> => {
    const cached = nameBySig.get(sig)
    if (cached !== undefined) return cached
    let name: string | null = null
    try {
      await breathe()
      const layer = await src.readLayer(sig)
      const raw = layer?.name
      name = typeof raw === 'string' && raw.trim().length > 0 ? raw : null
    } catch { name = null }
    nameBySig.set(sig, name)
    return name
  }

  // name → sigs (insertion-ordered, deduped) and the newest `at` that
  // carried it.
  const sigsByName = new Map<string, string[]>()
  const lastSeenByName = new Map<string, number>()
  // The names the newest READABLE revision carries. Not simply the last
  // marker: a head whose layer failed to resolve would read as "carries
  // nothing", and every tile at this location would be reported deleted.
  let liveNames: Set<string> | null = null

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]
    await breathe()
    const layer = await src.readLayer(marker.layerSig).catch(() => null)
    if (!layer) continue

    const revisionNames = new Set<string>()
    for (const childSig of childSigsOf(layer)) {
      const name = await nameOf(childSig)
      if (!name) continue
      revisionNames.add(name)
      const sigs = sigsByName.get(name)
      if (!sigs) sigsByName.set(name, [childSig])
      else if (!sigs.includes(childSig)) sigs.push(childSig)
      const seen = lastSeenByName.get(name) ?? 0
      if (marker.at > seen) lastSeenByName.set(name, marker.at)
    }
    liveNames = revisionNames
  }

  if (!liveNames) return []

  const out: PrunedTile[] = []
  for (const [name, sigs] of sigsByName) {
    if (liveNames.has(name)) continue
    out.push({ name, sigs, lastSeenAt: lastSeenByName.get(name) ?? 0 })
  }
  // Newest deletion first — the thing you just threw away is the thing you
  // are most likely here to get rid of for good.
  out.sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.name.localeCompare(b.name))
  return out
}

/** Hard ceiling on a branch walk. A cycle is impossible in a merkle tree
 *  (a layer cannot contain itself — its sig would have to be known before
 *  it was computed), but a corrupted or adversarial layer set could still
 *  fan out unboundedly, and a purge must never hang the tab. */
const BRANCH_SIG_LIMIT = 20000

/** One place in a deleted tile's branch: where it sits (so its lineage bag
 *  can be addressed) and every layer sig ever seen there. */
export type BranchNode = {
  /** Full path from the hive root — `[...locationSegments, name, …]`. */
  readonly segments: readonly string[]
  /** Layer sigs seen at this path, across every revision that named it. */
  readonly sigs: readonly string[]
}

/**
 * A deleted tile's whole branch, BY PLACE.
 *
 * A deleted tile takes its branch with it (that is what `/remove`'s nested
 * confirm is warning about), so a purge that only took the top layer would
 * leave the descendants resident and unreachable — junk no listing can ever
 * show again. Two things have to be found for each of them: the layer sigs
 * (content, shared by hash with anything byte-identical) and the PATH (which
 * is what addresses a lineage bag, and is unique to this branch).
 *
 * Keyed by path rather than by sig, because that is what makes the bag
 * removal safe: `sign(lineageKey(segments))` names one place in one hive, so
 * removing it can never touch a look-alike elsewhere — while the layer bytes
 * at a sig may well be somebody else's too.
 *
 * Breadth-first, deduped by (path, sig), capped.
 */
export const collectBranchNodes = async (
  seedSigs: readonly string[],
  seedSegments: readonly string[],
  readLayer: (sig: string) => Promise<PlacementLayer | null>,
): Promise<BranchNode[]> => {
  const byPath = new Map<string, { segments: string[]; sigs: Set<string> }>()
  const queue: Array<{ sig: string; segments: string[] }> = []
  let seen = 0

  const note = (sig: string, segments: string[]): void => {
    // JSON, not a separator character: a tile name may contain anything a
    // participant can type, and a joined key can only be unambiguous if the
    // separator cannot appear inside a segment. (The doctrine ratchet also
    // forbids the literal NUL that would otherwise be reached for here — see
    // doctrine.spec.ts, 'literal control byte'.)
    const key = JSON.stringify(segments)
    let node = byPath.get(key)
    if (!node) { node = { segments, sigs: new Set() }; byPath.set(key, node) }
    if (node.sigs.has(sig)) return
    node.sigs.add(sig)
    seen++
    queue.push({ sig, segments })
  }

  for (const sig of seedSigs) note(sig, [...seedSegments])

  for (let head = 0; head < queue.length && seen < BRANCH_SIG_LIMIT; head++) {
    const { sig, segments } = queue[head]
    const layer = await readLayer(sig).catch(() => null)
    if (!layer) continue
    for (const childSig of childSigsOf(layer)) {
      const child = await readLayer(childSig).catch(() => null)
      const name = typeof child?.name === 'string' ? child.name.trim() : ''
      // A child whose layer will not resolve has no name, and without a name
      // there is no path — so it contributes a sig at its PARENT's place
      // rather than being dropped. The purge still accounts for the bytes;
      // it just has no bag of its own to remove.
      note(childSig, name ? [...segments, name] : segments)
      if (seen >= BRANCH_SIG_LIMIT) break
    }
  }

  return [...byPath.values()].map(n => ({ segments: n.segments, sigs: [...n.sigs] }))
}

/** Every layer sig in a deleted tile's branch, flat. Convenience over
 *  `collectBranchNodes` for callers that only need the content addresses. */
export const collectBranchSigs = async (
  seeds: readonly string[],
  readLayer: (sig: string) => Promise<PlacementLayer | null>,
): Promise<string[]> => {
  const nodes = await collectBranchNodes(seeds, [], readLayer)
  const out = new Set<string>()
  for (const node of nodes) for (const sig of node.sigs) out.add(sig)
  return [...out]
}
