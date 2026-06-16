// diamondcoreprocessor.com/history/layer-placement.ts
//
// The two low-level layer-placement primitives, shared by every caller
// that re-points a parent's `children` slot to content sourced from
// elsewhere — clipboard paste, swarm adopt, and the registry migration.
//
// Under the layer-primitive doctrine a cell IS its layer: content
// (children, properties, notes, …) lives in the history bag addressed by
// the cell's lineage sig, and the parent merely references the cell's
// head sig in its `children` slot. Placement never moves bytes — it
// re-homes the cell's layer subtree so the cell is reachable at its
// destination lineage, then the call site re-points `children`.
//
// These functions are PURE layer ops: no IoC, no broker, no pulse. The
// caller resolves the services and triggers the synchronize.

export interface PlacementHistory {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<PlacementLayer | null>
  commitLayer(locationSig: string, layer: PlacementLayer): Promise<string>
  getLayerBySig(sig: string): Promise<PlacementLayer | null>
}

export interface PlacementLineage {
  explorerSegments(): readonly string[]
  readonly domain?: unknown
}

/** Minimal layer shape — `name` identifies the cell, `children` holds
 *  child-layer sigs (the merkle backbone). Other slots ride along via the
 *  index signature so a clone preserves them. */
export interface PlacementLayer {
  name?: string
  children?: readonly string[]
  [slot: string]: unknown
}

/** Resolve a parent layer's `children` sigs to child display names.
 *  Names are the truth — each child layer's own `name` field — and the
 *  committer re-resolves them to head sigs at commit time. Mirrors the
 *  resolution show-cell uses so membership edits all agree on the same
 *  authoritative list. */
export async function childNamesOf(
  history: PlacementHistory,
  parent: PlacementLayer | null,
): Promise<string[]> {
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  const names: string[] = []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && typeof child.name === 'string' && child.name.length > 0) {
      names.push(child.name)
    }
  }
  return names
}

/** Resolve a single child cell's layer (and its sig) via its PARENT's
 *  `children` slot — the authoritative membership path the renderer uses.
 *
 *  A cell's content lives as a child SIG in the parent (pool-addressed via
 *  getLayerBySig), NOT necessarily as a head marker in the cell's own
 *  lineage bag: a cell that has never been navigated into has an empty /
 *  absent own bag, so `currentLayerAt(childLocSig)` returns null for it even
 *  though the cell plainly exists and renders. Resolving through the parent
 *  is what childNamesOf, show-cell, and the cascade all do — clipboard
 *  validate / paste must agree or they'll treat live tiles as ghosts. */
export async function childLayerOf(
  history: PlacementHistory,
  parent: PlacementLayer | null,
  label: string,
): Promise<{ sig: string; layer: PlacementLayer } | null> {
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && child.name === label) return { sig: String(sig), layer: child }
  }
  return null
}

/** Resolve the layer AT a location robustly, through the parent chain.
 *
 *  `currentLayerAt(sign(segments))` reads the location's OWN history bag,
 *  which is EMPTY for any location never committed into — its content lives
 *  only as a child sig in its parent (pool-addressed). For such a location
 *  the direct read returns null even though the layer plainly exists and
 *  renders. We then resolve the grandparent (recursively) and pull the
 *  child by name from its `children` slot — exactly how the renderer reaches
 *  a sub-layer it has never minted a bag for.
 *
 *  Callers that compute a "full new children list" and SET it (cut survivors,
 *  paste existing) MUST use this, not the bare own-bag read: a null/partial
 *  read makes the SET wipe the siblings it couldn't see. Returns null only
 *  when the location genuinely has no layer anywhere up the chain. */
export async function resolveLayerAt(
  history: PlacementHistory,
  domain: unknown,
  segments: readonly string[],
): Promise<PlacementLayer | null> {
  const locSig = await history.sign({ domain, explorerSegments: () => segments })
  const direct = await history.currentLayerAt(locSig)
  if (direct) return direct
  if (segments.length === 0) return null
  const parent = await resolveLayerAt(history, domain, segments.slice(0, -1))
  const found = await childLayerOf(history, parent, segments[segments.length - 1])
  return found?.layer ?? null
}

/** Re-home a layer subtree at `destCellSegments` by re-committing each
 *  node at its destination lineage sig. The child sigs inside a cloned
 *  layer stay valid verbatim — they resolve through the global pool
 *  regardless of which bag's marker points at them — so the clone's only
 *  effect is one destination marker per node, making the content
 *  reachable by navigating the new path. No OPFS walk; the source folders
 *  don't exist in this architecture. */
export async function cloneLayerTree(
  history: PlacementHistory,
  lineage: PlacementLineage,
  layer: PlacementLayer,
  destCellSegments: readonly string[],
): Promise<void> {
  const dstLocSig = await history.sign({
    domain: lineage.domain,
    explorerSegments: () => destCellSegments,
  })
  await history.commitLayer(dstLocSig, layer)

  const childSigs = Array.isArray(layer.children) ? layer.children : []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (!child || typeof child.name !== 'string' || child.name.length === 0) continue
    await cloneLayerTree(history, lineage, child, [...destCellSegments, child.name])
  }
}
