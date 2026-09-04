// commands/remove-confirm.ts
//
// Shared confirmation + sub-tree counting for tile removal. Deleting a tile
// drops its ENTIRE branch from the hierarchy (the tile leaves its parent's
// `children`, so every tile nested beneath it goes with it). Before committing
// we count how many tiles are nested under the targets and — when there are
// any — raise the glassmorphic confirm dialog showing that count. Leaf deletes
// (nothing nested) skip the prompt and stay frictionless — so a caller must
// NOT promise a confirmation, and the machine catalogue no longer does.
// Every delete is undoable regardless: the layer bytes survive, so undo
// restores the branch. Removal is not a delete at all — it is one
// `LayerCommitter.update` setting the parent's children slot to the survivors.
//
// Both removal paths funnel through here so the gesture behaves identically:
//   • TileActionsDrone.#removeTile  — Delete/Backspace over a hovered tile
//   • RemoveQueenBee.execute        — vertical selection menu, /remove, etc.

import { CHILD_SLOTS, requestConfirm } from '@hypercomb/core'

// A resolved child layer carries its `name` (identity) and its own `children`
// sigs. The PARENT we count under only needs `children` — keeping its type
// free of `name` avoids clashing with callers whose layer type has an index
// signature (which would otherwise type `name` as `unknown`).
type ChildLayer = { name?: string; children?: readonly string[] }
type ParentLayer = { children?: readonly string[] }
type HistoryLike = {
  getLayerBySig(sig: string): Promise<ChildLayer | null>
}

/** Every child signature a layer holds, across ALL child slots.
 *
 *  This read `layer.children` alone until 2026-09-03, and the canonical
 *  resolution order is `CHILD_SLOTS = ['cells', 'layers', 'children']` — built
 *  modules emit `cells`, some trees use `layers`. A tile whose subtree hung off
 *  either slot counted ZERO nested, so the one dialog `/remove` raises was
 *  skipped precisely when a whole branch was about to leave the page. Widening
 *  the walk can only ever raise the count, never lower it. */
const childSigsOfLayer = (layer: { [slot: string]: unknown } | null): readonly string[] => {
  for (const slot of CHILD_SLOTS) {
    const held = layer?.[slot]
    if (Array.isArray(held) && held.length) return held.filter(sig => typeof sig === 'string')
  }
  return []
}

/** Count every tile nested beneath `layerSig` (its whole sub-tree, NOT the
 *  node itself). Walks the child slots recursively via getLayerBySig —
 *  warm-cached, and content-addressed sigs cannot cycle (a parent's sig derives
 *  from its children's), so the walk always terminates. */
async function countSubtree(history: HistoryLike, layerSig: string): Promise<number> {
  const layer = await history.getLayerBySig(layerSig)
  const childSigs = childSigsOfLayer(layer as { [slot: string]: unknown } | null)
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
  const childSigs = childSigsOfLayer(parentLayer as unknown as { [slot: string]: unknown })
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
 *  true to proceed. Leaf removals skip the dialog unless `always` is set,
 *  which protects direct remove-icon clicks from accidental deletion. */
export async function confirmRemoval(
  history: HistoryLike,
  parentLayer: ParentLayer | null,
  targetNames: readonly string[],
  { always = false }: { always?: boolean } = {},
): Promise<boolean> {
  const nested = await countTilesBeneath(history, parentLayer, targetNames)
  if (nested <= 0 && !always) return true

  return requestConfirm({
    title: 'confirm.delete-title',
    // Plural on the number of TILES being deleted (one named tile vs N).
    message: nested > 0 ? 'confirm.remove-message' : 'confirm.delete-message',
    messageParams: { name: targetNames[0] ?? '', count: targetNames.length },
    // Plural on the number of NESTED tiles — the hierarchy count, in red.
    ...(nested > 0
      ? {
          warning: 'confirm.remove-children',
          warningParams: { count: nested },
        }
      : {}),
    danger: true,
  })
}
