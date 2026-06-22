// diamondcoreprocessor.com/commands/remove-confirm.ts
//
// Shared confirmation + sub-tree counting for tile removal. Deleting a tile
// drops its ENTIRE branch from the hierarchy (the tile leaves its parent's
// `children`, so every tile nested beneath it goes with it). Before committing
// we count how many tiles are nested under the targets and — when there are
// any — raise the glassmorphic confirm dialog showing that count. Leaf deletes
// (nothing nested) skip the prompt and stay frictionless. Every delete is
// undoable regardless: the layer bytes survive, so undo restores the branch.
//
// Both removal paths funnel through here so the gesture behaves identically:
//   • TileActionsDrone.#removeTile  — Delete/Backspace over a hovered tile
//   • RemoveQueenBee.execute        — vertical selection menu, /remove, etc.

import { requestConfirm } from '@hypercomb/core'

// A resolved child layer carries its `name` (identity) and its own `children`
// sigs. The PARENT we count under only needs `children` — keeping its type
// free of `name` avoids clashing with callers whose layer type has an index
// signature (which would otherwise type `name` as `unknown`).
type ChildLayer = { name?: string; children?: readonly string[] }
type ParentLayer = { children?: readonly string[] }
type HistoryLike = {
  getLayerBySig(sig: string): Promise<ChildLayer | null>
}

/** Count every tile nested beneath `layerSig` (its whole sub-tree, NOT the
 *  node itself). Walks `children` recursively via getLayerBySig — warm-cached,
 *  and content-addressed sigs cannot cycle (a parent's sig derives from its
 *  children's), so the walk always terminates. */
async function countSubtree(history: HistoryLike, layerSig: string): Promise<number> {
  const layer = await history.getLayerBySig(layerSig)
  const childSigs = Array.isArray(layer?.children) ? layer!.children! : []
  let total = childSigs.length
  for (const sig of childSigs) total += await countSubtree(history, sig)
  return total
}

/** Total tiles nested beneath the named targets, resolved against the parent
 *  layer's `children` sigs (names are the truth — see remove.queen). */
export async function countTilesBeneath(
  history: HistoryLike,
  parentLayer: ParentLayer | null,
  targetNames: readonly string[],
): Promise<number> {
  if (!parentLayer) return 0
  const childSigs = Array.isArray(parentLayer.children) ? parentLayer.children : []
  const targets = new Set(targetNames)
  let total = 0
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(sig)
    if (child && typeof child.name === 'string' && targets.has(child.name)) {
      total += await countSubtree(history, sig)
    }
  }
  return total
}

/** Ask the user to confirm removing `targetNames` from `parentLayer`. Returns
 *  true to proceed. When nothing is nested beneath the targets there is no
 *  branch to lose, so the dialog is skipped and we proceed immediately. */
export async function confirmRemoval(
  history: HistoryLike,
  parentLayer: ParentLayer | null,
  targetNames: readonly string[],
): Promise<boolean> {
  const nested = await countTilesBeneath(history, parentLayer, targetNames)
  if (nested <= 0) return true

  return requestConfirm({
    title: 'confirm.delete-title',
    // Plural on the number of TILES being deleted (one named tile vs N).
    message: 'confirm.remove-message',
    messageParams: { name: targetNames[0] ?? '', count: targetNames.length },
    // Plural on the number of NESTED tiles — the hierarchy count, in red.
    warning: 'confirm.remove-children',
    warningParams: { count: nested },
    danger: true,
  })
}
