// hypercomb-core/src/core/level-roster.ts
//
// THE LEVEL ROSTER — the one answer to "which tiles are at this level?".
//
// Three surfaces used to ask that question three different ways, and gave
// three different answers: the canvas collapses a parent's children by NAME,
// the chat window's tiles rail walks the tree (and collapses too), while the
// command line's cell suggestions — which the notes panel's tile list also
// reads — walked `children` straight and showed the same tile once per sig.
// That is why one hive listed `pheromone-workflow` three times in the notes
// panel and once in the chat window.
//
// The rule, stated once, here: THE NAME IS THE PATH SEGMENT. Two children of
// one parent carrying the same name are not two tiles — they are two sigs (an
// older revision left beside its replacement, an adopt that landed next to its
// own copy) addressing ONE location. First sig wins, order preserved.
//
// It lives in core because the surfaces that need it sit on both sides of the
// module boundary: the rail is a drone in essentials, the suggestions provider
// is shell plumbing in shared, and a module may never import the shell. Core
// is the only place both can reach.
//
// Pure reader. Structural interfaces only — it never imports HistoryService or
// the Store, it just describes the two calls it needs.

const SIG = /^[0-9a-f]{64}$/

/** Canonical child-layer slot names, in resolution precedence. A layer's child
 *  sigs live under ONE of these: built modules emit `cells`, some trees use
 *  `layers`, hive-authored content uses `children`. */
export const CHILD_SLOTS = ['cells', 'layers', 'children'] as const

/** Minimal layer shape — `name` identifies the cell, the child slots hold
 *  child-layer sigs. Everything else rides the index signature. */
export type RosterLayer = { name?: string; [slot: string]: unknown }

export type RosterHistory = {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<RosterLayer | null>
  getLayerBySig(sig: string): Promise<RosterLayer | null>
  childrenManifestFor?(layer: RosterLayer): Promise<Array<{ sig: string; layer: RosterLayer }> | null>
}

export type RosterStore = { getResource(sig: string): Promise<Blob | null> }

/** One tile at a level, as every surface should read it. */
export type RosterRow = {
  readonly name: string
  /** The child's own LAYER signature. */
  readonly sig: string
  /** Its tile-properties resource sig, when it has one (the picture lives there). */
  readonly propsSig?: string
  /** How many children IT declares — the chevron's reason to exist. */
  readonly childCount: number
  /** Its full path from the root. */
  readonly segments: readonly string[]
}

/** A layer's declared child sigs, across every canonical child slot. The slot
 *  may hold the array inline OR a signature pointing at a JSON array resource
 *  — both shapes are live in the wild, so both are resolved. */
export async function childSigsOfLayer(layer: RosterLayer, store: RosterStore): Promise<string[]> {
  for (const slot of CHILD_SLOTS) {
    const value = (layer as Record<string, unknown>)[slot]
    if (Array.isArray(value) && value.length > 0) {
      return value.map(s => String(s)).filter(s => SIG.test(s))
    }
    if (typeof value === 'string' && SIG.test(value)) {
      try {
        const blob = await store.getResource(value)
        if (!blob) return []
        const parsed = JSON.parse(await blob.text()) as unknown
        if (Array.isArray(parsed)) return parsed.map(s => String(s)).filter(s => SIG.test(s))
      } catch { /* malformed pointer — treat as childless */ }
      return []
    }
  }
  return []
}

/** Child sigs read straight off the layer's slots, no resource resolution.
 *  The cheap read used while chasing a path down the parent chain. */
export function childSigsInline(layer: RosterLayer): string[] {
  for (const slot of CHILD_SLOTS) {
    const value = (layer as Record<string, unknown>)[slot]
    if (Array.isArray(value) && value.length > 0) return value.map(s => String(s)).filter(s => SIG.test(s))
  }
  return []
}

/** The tile-properties resource sig from a layer's `properties` slot. The slot
 *  is an array holding at most one sig (see editor/tile-properties). */
export function propsSigOf(layer: RosterLayer): string | undefined {
  const slot = (layer as Record<string, unknown>)['properties']
  if (!Array.isArray(slot) || slot.length === 0) return undefined
  const sig = String(slot[0])
  return SIG.test(sig) ? sig : undefined
}

/**
 * A parent's children, resolved to layers and COLLAPSED BY NAME — the single
 * definition of "the tiles inside this one". Manifest first: the children
 * manifest inlines every child layer, so one pool read replaces N byte reads,
 * and it is only trusted when it covers every declared child.
 */
export async function childLayersOf(
  parent: RosterLayer,
  history: RosterHistory,
  store: RosterStore,
  childSigs?: readonly string[],
): Promise<Array<{ sig: string; name: string; layer: RosterLayer }>> {
  const sigs = childSigs ?? await childSigsOfLayer(parent, store)
  if (sigs.length === 0) return []

  const inlined = new Map<string, RosterLayer>()
  if (typeof history.childrenManifestFor === 'function') {
    const manifest = await history.childrenManifestFor(parent).catch(() => null)
    if (manifest && manifest.length === sigs.length) {
      for (const entry of manifest) inlined.set(String(entry.sig), entry.layer)
    }
  }

  const seen = new Set<string>()
  const out: Array<{ sig: string; name: string; layer: RosterLayer }> = []
  for (const sig of sigs) {
    const layer = inlined.get(sig) ?? await history.getLayerBySig(sig)
    if (!layer) continue
    const name = typeof layer.name === 'string' && layer.name.length > 0 ? layer.name : sig.slice(0, 8)
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ sig, name, layer })
  }
  return out
}

/**
 * The layer standing at a path. The own-bag read is tried first; a cell that
 * has never been navigated into has an EMPTY bag, so a direct read returns
 * null for a tile that plainly exists and renders — hence the walk down the
 * parent chain, which is the path the renderer itself uses. This fallback is
 * why a list built on this agrees with the canvas instead of going blank or
 * stale one level in.
 */
export async function resolveLevelLayer(
  segments: readonly string[],
  history: RosterHistory,
): Promise<{ layer: RosterLayer | null; locationSig: string }> {
  const path = [...segments]
  const locationSig = await history.sign({ explorerSegments: () => path })
  const direct = await history.currentLayerAt(locationSig)
  if (direct) return { layer: direct, locationSig }

  let layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [] }))
  for (const segment of path) {
    if (!layer) break
    let found: RosterLayer | null = null
    for (const sig of childSigsInline(layer)) {
      const child = await history.getLayerBySig(sig)
      if (child?.name === segment) { found = child; break }
    }
    layer = found
  }
  return { layer, locationSig }
}

/**
 * Every tile at `segments`, in the parent's own order, one row per name.
 * THE list — the chat window's tiles rail, the notes panel's tile list and
 * the command line's cell suggestions all read this and therefore agree.
 */
export async function levelRoster(
  segments: readonly string[],
  history: RosterHistory,
  store: RosterStore,
): Promise<readonly RosterRow[]> {
  const path = [...segments]
  const { layer } = await resolveLevelLayer(path, history)
  if (!layer) return []

  const children = await childLayersOf(layer, history, store)
  const rows: RosterRow[] = []
  for (const child of children) {
    const grandChildren = await childSigsOfLayer(child.layer, store)
    rows.push({
      name: child.name,
      sig: child.sig,
      propsSig: propsSigOf(child.layer),
      childCount: grandChildren.length,
      segments: [...path, child.name],
    })
  }
  return rows
}
