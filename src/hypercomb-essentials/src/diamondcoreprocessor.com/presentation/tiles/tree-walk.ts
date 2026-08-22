// diamondcoreprocessor.com/presentation/tiles/tree-walk.ts
//
// Ring-by-ring hierarchy walk feeding the sideways tree view. Breadth-first
// on purpose: the view is read ring by ring (one column per ring), so the
// walk delivers whole rings and can report progress and stop cleanly on a
// budget rather than diving one deep spine first.
//
// MANIFEST FIRST. The children manifest in sign('manifests') is keyed by the
// PARENT layer's own sig and inlines every child layer, so one pool read
// replaces N per-child byte lookups — and it resolves names even when the
// child bytes are cold locally, which is exactly the case a whole-subtree
// walk hits. It is only trusted when it covers every declared child
// (complete-or-absent); a short manifest falls back to byte reads per child.
//
// The walk never writes. It is a reader over layers the hive already holds.

import {
  childLayersOf, childSigsOfLayer, propsSigOf, resolveLevelLayer,
} from '@hypercomb/core'
import { type PlacementLayer } from '../../history/layer-placement.js'
import type { TreeNode } from './tree-layout.js'

const SIG = /^[0-9a-f]{64}$/

// The child resolution itself — slots, sig-pointer arrays, manifest-first
// inlining, and the collapse of a parent's children BY NAME — lives in core
// (level-roster.ts) so the shell's own level readers give the same answer as
// this walk. Re-exported under their long-standing names for existing callers.
export { childSigsOfLayer as resolveChildSigs, propsSigOf }

export type WalkHistory = {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<PlacementLayer | null>
  getLayerBySig(sig: string): Promise<PlacementLayer | null>
  childrenManifestFor?(layer: PlacementLayer): Promise<Array<{ sig: string; layer: { name?: string; [k: string]: unknown } }> | null>
}

export type WalkStore = { getResource(sig: string): Promise<Blob | null> }

/** Where the tree is rooted. A signature roots anywhere in the merkle tree
 *  (including content that is not reachable from the participant's own
 *  path); segments root at a lineage location. */
export type TreeRoot = {
  readonly sig?: string
  readonly segments?: readonly string[]
  /** Display name for the trunk; falls back to the layer's own name. */
  readonly label?: string
}

export type WalkOptions = {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly onProgress?: (progress: { ring: number; nodes: number }) => void
  /** Checked between rings — abandons the walk when the view has moved on. */
  readonly cancelled?: () => boolean
}

export type WalkResult = {
  readonly nodes: TreeNode[]
  /** True when a depth or node budget cut the walk short. */
  readonly truncated: boolean
  /** True when the trunk sig is a LOCATION sig (path-rooted) rather than a
   *  layer sig — the two are different addresses and the rail says so. */
  readonly rootSigIsLocation: boolean
  readonly error?: string
}

/** Resolve the trunk layer. A path-rooted trunk resolves through the parent
 *  chain: a cell never navigated into has an EMPTY own bag, so the direct
 *  own-bag read returns null for a cell that plainly exists and renders. */
async function resolveRoot(
  root: TreeRoot,
  history: WalkHistory,
): Promise<{ layer: PlacementLayer | null; sig: string; isLocation: boolean }> {
  if (root.sig && SIG.test(root.sig)) {
    const direct = await history.getLayerBySig(root.sig)
    if (direct) return { layer: direct, sig: root.sig, isLocation: false }
    // Not a layer sig — it may still be a LOCATION sig with a live head.
    const atLocation = await history.currentLayerAt(root.sig)
    return { layer: atLocation, sig: root.sig, isLocation: atLocation !== null }
  }

  // Own bag first, then down the parent chain — core owns that resolution so
  // the rail, the notes list and the canvas all land on the same layer.
  const resolved = await resolveLevelLayer([...(root.segments ?? [])], history)
  return { layer: resolved.layer as PlacementLayer | null, sig: resolved.locationSig, isLocation: true }
}

/** The layer behind a placed node. A child node holds a LAYER sig; a
 *  path-rooted trunk holds a LOCATION sig — try both. */
async function layerOfNode(node: TreeNode, history: WalkHistory): Promise<PlacementLayer | null> {
  const direct = await history.getLayerBySig(node.sig).catch(() => null)
  if (direct) return direct
  return history.currentLayerAt(node.sig).catch(() => null)
}

/**
 * Grow specific nodes one ring deeper, appending their children to the node
 * array. This is how the view deepens under the eye: the first walk lays down
 * a shallow shape fast, and whatever the viewport lands on gets resolved from
 * there. Expansion is not bounded by the initial depth — moving around IS the
 * request for more levels.
 *
 * Returns a NEW array; targets come back marked walked so a node is never
 * expanded twice. Children of one target stay contiguous, which is what keeps
 * sibling order stable in the layout across passes.
 */
export async function expandNodes(
  existing: readonly TreeNode[],
  targetIds: readonly number[],
  history: WalkHistory,
  store: WalkStore,
  options: { maxNodes: number; cancelled?: () => boolean },
): Promise<{ nodes: TreeNode[]; added: number }> {
  const nodes: TreeNode[] = [...existing]
  const targets = new Set(targetIds)
  let added = 0

  for (const id of targetIds) {
    if (options.cancelled?.()) break
    if (nodes.length >= options.maxNodes) break
    const node = nodes[id]
    if (!node || node.walked) continue

    const layer = await layerOfNode(node, history)
    if (!layer) {
      // Unreadable here — mark it walked so the viewport does not ask again
      // every time it drifts past.
      nodes[id] = { ...node, walked: true }
      continue
    }

    // Manifest-first, one row per NAME — core's rule, same as the ring walk.
    const children = await childLayersOf(layer, history, store)

    let complete = true
    for (const child of children) {
      if (nodes.length >= options.maxNodes) { complete = false; break }
      const grandChildren = await childSigsOfLayer(child.layer, store)
      nodes.push({
        id: nodes.length,
        parent: id,
        sig: child.sig,
        name: child.name,
        depth: node.depth + 1,
        segments: node.segments ? [...node.segments, child.name] : null,
        childCount: grandChildren.length,
        propsSig: propsSigOf(child.layer),
        // A child with children of its own is the next frontier — it resolves
        // when the viewport reaches it.
        walked: grandChildren.length === 0,
      })
      added++
    }
    // Hit the ceiling part-way through: leave it unwalked so the rest can
    // still arrive if room frees up. Marking it done would strand them.
    if (complete) nodes[id] = { ...node, walked: true }
  }

  void targets
  return { nodes, added }
}

/**
 * Walk a subtree ring by ring into a flat node array (parents always precede
 * their children, which is what the layout's iterative traversal assumes).
 */
export async function walkTree(
  root: TreeRoot,
  history: WalkHistory,
  store: WalkStore,
  options: WalkOptions,
): Promise<WalkResult> {
  const nodes: TreeNode[] = []
  let truncated = false

  let resolved: { layer: PlacementLayer | null; sig: string; isLocation: boolean }
  try {
    resolved = await resolveRoot(root, history)
  } catch (err) {
    return { nodes, truncated: false, rootSigIsLocation: false, error: String((err as Error)?.message ?? err) }
  }
  if (!resolved.layer) {
    return {
      nodes, truncated: false, rootSigIsLocation: resolved.isLocation,
      error: 'nothing resolves at that address',
    }
  }

  const rootSegments = root.sig ? null : [...(root.segments ?? [])]
  const rootChildren = await childSigsOfLayer(resolved.layer, store)
  const rootName = root.label
    ?? (typeof resolved.layer.name === 'string' && resolved.layer.name.length > 0 ? resolved.layer.name : null)
    ?? (rootSegments?.length ? rootSegments[rootSegments.length - 1] : 'hive')

  // `walked` means "its children HAVE been resolved" — never "is about to
  // be". A node marked walked on intent becomes invisible to viewport
  // deepening the moment a budget cuts the walk before reaching it, which
  // leaves the tree permanently stuck at its first shape.
  nodes.push({
    id: 0, parent: -1, sig: resolved.sig, name: rootName, depth: 0,
    segments: rootSegments, childCount: rootChildren.length,
    propsSig: propsSigOf(resolved.layer),
    walked: rootChildren.length === 0,
  })

  // The frontier carries the layer objects so the next ring never re-reads
  // what the previous ring already resolved.
  let frontier: Array<{ id: number; layer: PlacementLayer; sigs: string[]; segments: readonly string[] | null }> =
    options.maxDepth > 0
      ? [{ id: 0, layer: resolved.layer, sigs: rootChildren, segments: rootSegments }]
      : []

  for (let depth = 1; depth <= options.maxDepth && frontier.length > 0; depth++) {
    if (options.cancelled?.()) return { nodes, truncated: true, rootSigIsLocation: resolved.isLocation }
    const next: typeof frontier = []

    for (const parent of frontier) {
      if (parent.sigs.length === 0) continue

      // Manifest-first and ONE NAME PER PARENT — core's rule (level-roster),
      // the same one the canvas has always applied: the name IS the path
      // segment, so two children called `x` are two sigs pointing at ONE
      // location, not two tiles. First sig wins, order preserved.
      const children = await childLayersOf(parent.layer, history, store, parent.sigs)

      let complete = true
      for (const child of children) {
        if (nodes.length >= options.maxNodes) { truncated = true; complete = false; break }
        const childSigs = await childSigsOfLayer(child.layer, store)
        const segments = parent.segments ? [...parent.segments, child.name] : null
        const id = nodes.length

        nodes.push({
          id, parent: parent.id, sig: child.sig, name: child.name, depth, segments,
          childCount: childSigs.length,
          propsSig: propsSigOf(child.layer),
          walked: childSigs.length === 0,
        })
        // Queue for the next ring only while there IS a next ring. Past the
        // depth budget the node simply stays unwalked — that is the frontier
        // the viewport resolves later, not a loss.
        if (depth < options.maxDepth && childSigs.length > 0) {
          next.push({ id, layer: child.layer as PlacementLayer, sigs: childSigs, segments })
        }
      }
      // Only now is the parent's child list actually resolved.
      if (complete) nodes[parent.id] = { ...nodes[parent.id], walked: true }
      if (nodes.length >= options.maxNodes) { truncated = true; break }
    }

    options.onProgress?.({ ring: depth, nodes: nodes.length })
    if (truncated) break
    frontier = next
  }

  // Anything still holding unwalked children means a budget cut the tree.
  if (!truncated && nodes.some(n => !n.walked)) truncated = true

  return { nodes, truncated, rootSigIsLocation: resolved.isLocation }
}
