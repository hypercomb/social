// diamondcoreprocessor.com/history/layer-placement.ts
//
// The low-level layer-placement primitives, shared by every caller that
// re-points a parent's `children` slot to content sourced from elsewhere —
// clipboard paste and swarm adopt.
//
// `flattenLayerTree` is the primitive both callers use: it re-expresses a
// source subtree as `committer.importTree([...])` updates so the whole dump
// commits deepest-first with ONE shared up-cascade to root.
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

/** A cell name becomes a lineage PATH SEGMENT, and history.sign joins segments
 *  with '/', so a name containing a separator or control char would address a
 *  DIFFERENT existing location. Reject such names at every trust boundary (the
 *  branch root in swarm-adopt.drone.ts, and every adopted descendant in
 *  flattenLayerTree) so a crafted peer subtree can't collide with — and
 *  overwrite — the participant's own nested tiles. */
const UNSAFE_CELL_NAME = /[\\/\x00-\x1f]/

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

/** Like {@link childNamesOf}, but also reports whether any child sig failed to
 *  resolve (a COLD pool miss). A membership SET (adopt/unfold recomputing a
 *  parent's `children`) MUST abort on a cold miss rather than write a list that
 *  silently drops the unresolved sibling — that drop is a PERMANENT wipe of a
 *  tile whose bytes merely weren't warm. `coldMiss` lets the caller tell "child
 *  confirmed absent" from "couldn't see the child". */
export async function childNamesOfStrict(
  history: PlacementHistory,
  parent: PlacementLayer | null,
): Promise<{ names: string[]; coldMiss: boolean }> {
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  const names: string[] = []
  let coldMiss = false
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (!child) { coldMiss = true; continue }
    if (typeof child.name === 'string' && child.name.length > 0) names.push(child.name)
  }
  return { names, coldMiss }
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

/** Resolve the layer at the CURRENT location robustly: the parent-chain walk
 *  (resolveLayerAt), then the history CURSOR as a last resort.
 *
 *  The renderer warms the current location through the cursor
 *  (currentLayerSig → getLayerBySig), NOT through currentLayerAt's own-bag
 *  cache. So for a location whose own bag is cold — never committed into, or
 *  simply not yet warmed after a reload — resolveLayerAt can still return null
 *  while the cursor holds the layer the user is plainly looking at.
 *
 *  Mutation paths that compute a full new `children` list for the CURRENT
 *  location and SET it (delete survivors, cut, paste) MUST use this. The bare
 *  `currentLayerAt(sign(segments))` read returns null on a cold location and
 *  the usual `if (!parent) return` guard turns the whole op into a silent
 *  no-op — the exact "tile never disappears on delete" failure. Mirrors the
 *  clipboard worker's #resolveParentLayer and the move drone's
 *  #resolveCurrentParent; pass `currentLayerSig` only for the location the
 *  user is actually viewing (the cursor describes the current location). */
export async function resolveCurrentLayer(
  history: PlacementHistory,
  domain: unknown,
  segments: readonly string[],
  currentLayerSig: string | undefined | null,
): Promise<PlacementLayer | null> {
  const viaChain = await resolveLayerAt(history, domain, segments)
  if (viaChain) return viaChain
  if (currentLayerSig) return await history.getLayerBySig(currentLayerSig)
  return null
}

/** Flatten a source layer subtree into a list of `importTree` updates rooted at
 *  `destSegments` — the mechanical-cascade counterpart to cloneLayerTree.
 *
 *  cloneLayerTree re-homes by committing each node DIRECTLY (one raw marker per
 *  node, no cascade), relying on the call site's trailing `update()` to fold the
 *  top into the parent and back-cascade just that one branch. flattenLayerTree
 *  instead RE-EXPRESSES the subtree as `{ segments, layer }` updates so the
 *  caller can feed them — together with the target parent's children change — to
 *  a SINGLE `committer.importTree([...])`. importTree commits the whole batch
 *  deepest-first with one shared up-cascade to root and emits the per-level
 *  cell:added/removed reconciliation, exactly like create and bulk-import.
 *
 *  Each node's `children` slot is converted from child SIGS to child NAMES so
 *  importTree (nameSlots: ['children']) re-resolves them to the freshly-committed
 *  dest markers — deepest-first guarantees a child is committed before its parent
 *  resolves it, so the hierarchy rebuilds level by level. Every OTHER slot
 *  (properties, notes, …) rides along as sigs verbatim — pool-addressed, valid at
 *  any path. Children that don't resolve to a named layer are dropped, mirroring
 *  cloneLayerTree. */
export async function flattenLayerTree(
  history: PlacementHistory,
  layer: PlacementLayer,
  destSegments: readonly string[],
): Promise<{ segments: string[]; layer: { name?: string; [slot: string]: unknown } }[]> {
  const childSigs = Array.isArray(layer.children) ? layer.children : []
  const childLayers: PlacementLayer[] = []
  const childNames: string[] = []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (!child || typeof child.name !== 'string' || child.name.length === 0) continue
    // Untrusted (adopted) child names arrive here via getLayerBySig on signed
    // peer layers. A name that is really a path (separator/control char) would
    // masquerade as a multi-segment lineage path below (destSegments + name) and
    // overwrite a colliding local tile. Drop it, exactly like an unresolvable
    // child — the branch root name is guarded the same way in swarm-adopt.drone.ts.
    if (UNSAFE_CELL_NAME.test(child.name)) {
      console.warn('[flattenLayerTree] dropped child with unsafe name (path-separator/control char):', child.name)
      continue
    }
    childLayers.push(child)
    childNames.push(child.name)
  }

  // This node: every source slot verbatim, `children` swapped sigs → names.
  const node: { name?: string; [slot: string]: unknown } = {}
  for (const [slot, value] of Object.entries(layer)) {
    if (slot === 'children') continue
    node[slot] = value
  }
  // Bracket access: `children` rides the index signature, not the declared
  // `name` key — the Angular build enforces noPropertyAccessFromIndexSignature.
  node['children'] = childNames

  const updates: { segments: string[]; layer: { name?: string; [slot: string]: unknown } }[] = [
    { segments: [...destSegments], layer: node },
  ]
  for (const child of childLayers) {
    updates.push(...await flattenLayerTree(history, child, [...destSegments, child.name as string]))
  }
  return updates
}
