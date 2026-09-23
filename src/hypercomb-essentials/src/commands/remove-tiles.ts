// commands/remove-tiles.ts
//
// THE SHARED MUTATION CORE BEHIND /remove — the word and the tutorial's
// cleanup both take tiles off a page through it. A bee is never imported for
// a value (atomic-modules-plan.md), so it lives here, in a dependency both
// import.

import { EffectBus } from '@hypercomb/core'
import { resolveCurrentLayer } from '../history/layer-placement.js'
import type { PlacementHistory } from '../history/layer-placement.js'

export type LineageLike = {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}

export type HistoryServiceLike = {
  sign(l: LineageLike): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ children?: readonly string[]; [k: string]: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: string } | null>
}

export type LayerCommitterLike = {
  update(
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ): Promise<string>
}

/**
 * Sig-preserving drop of `targets` (canonical rendered names) from the layer
 * at `segments` — the shared mutation core behind /remove and the tutorial's
 * provenance-gated cleanup. NO confirmation of its own: callers own consent
 * (the queen passes the nested-children dialog via `opts.confirm`; the
 * tutorial only ever targets a tour-minted planner whose merkle sig is
 * verified unchanged). Returns true when a commit actually ran.
 */
export async function removeTilesAt(
  segments: readonly string[],
  targets: readonly string[],
  opts: { confirm?: (history: HistoryServiceLike, parent: { children?: readonly string[] }) => Promise<boolean> } = {},
): Promise<boolean> {
  if (targets.length === 0) return false

  const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
  const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
  const committer = get('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
  if (!lineage || !history || !committer) return false

  // Resolve the parent layer ROBUSTLY. The bare currentLayerAt(sign(segments))
  // reads the location's OWN history bag, which is COLD/empty for any location
  // never committed into (its content lives as a child sig in its parent,
  // pool-addressed) or simply not yet warmed after a reload — so it returns
  // null even when the layer plainly renders, and the old `if (!parent) return`
  // made delete a silent no-op ("tile never disappears"). resolveCurrentLayer
  // walks the parent chain, then falls back to the cursor (the source the
  // renderer warms for the current location). Mirrors the clipboard worker's
  // #resolveParentLayer and the move drone's #resolveCurrentParent.
  const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as { currentLayerSig?: string } | undefined
  const parent = await resolveCurrentLayer(
    history as unknown as PlacementHistory,
    lineage.domain,
    segments,
    cursor?.currentLayerSig,
  )
  if (!parent) return false

  if (opts.confirm && !(await opts.confirm(history, parent))) return false

  // SIG-PRESERVING drop. Keep every surviving child's EXACT stored sig and
  // remove only the target(s). Do NOT rebuild `children` from survivor NAMES:
  // committer.update resolves a `children` NAME slot via latestMarkerSigFor on
  // each survivor's OWN bag, which AUTO-MINTS an empty {name} layer for any
  // survivor whose own bag is cold — e.g. freshly-installed content whose child
  // bags aren't materialised. That silently replaces a survivor's real sig with
  // an empty one, so the renderer (which reads each child's image from its
  // stored sig) paints it as a no-image tile. Dropping the target sig and
  // re-committing the remaining sigs verbatim preserves every survivor exactly.
  const childSigs = Array.isArray(parent.children) ? parent.children : []
  const targetSet = new Set(targets)
  const survivorSigs: string[] = []
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(sig)
    // Drop only sigs we can positively identify as a target; keep everything
    // else (incl. an unreadable sibling) so a cold miss never wipes a tile.
    if (child && typeof child.name === 'string' && targetSet.has(child.name)) continue
    survivorSigs.push(String(sig))
  }

  // Notify downstream UI subscribers (activity log, substrate, slot
  // machine, tile-overlay) BEFORE awaiting the commit so the visual
  // unmount runs immediately. LayerCommitter.update is O(siblings)
  // per ancestor depth and can take seconds with large layers; gating
  // the visual on it makes deletes feel broken.
  //
  // `viaUpdate: true` tells LayerCommitter's per-event commit listener
  // to skip queueing — the upcoming committer.update() call IS the
  // atomic commit for this whole operation. Without the flag, N tiles
  // produce N history markers (one per event); with it, the whole
  // multi-delete collapses into a single marker.
  for (const name of targets) {
    EffectBus.emit('cell:removed', { cell: name, segments, viaUpdate: true })
  }

  // Empty nameSlots → the committer SETs `children` to these exact sigs (no
  // name→sig re-resolution, no auto-mint). Other slots (decorations, notes,
  // properties) are preserved — #commit hydrates them from the previous layer.
  await committer.update(segments, { children: survivorSigs }, new Set<string>())
  return true
}
