// diamondcoreprocessor.com/history/layer-diff.ts
//
// Pure, stateless diff between two slim layer snapshots. The slim
// layer is a single ordered array — `children` (child layer sigs) —
// so the diff has only three possible shapes: child added, child
// removed, children reordered. The kind names retain `cell-*` for
// continuity with the renderer/UI, which translates sig deltas to
// display names.
//
// All other previously-reported diff kinds (content/tags/notes/bees/
// dependencies/layout/instructions) belonged to fields that are no
// longer in the layer. Each of those concerns now lives in its own
// primitive, and any per-primitive diff is the responsibility of the
// bee that owns that primitive — not this central layer differ.
//
// diffLayers(null, layer) treats the whole layer as additions — useful
// for rendering the first-ever layer in a location's history.
import type { LayerContent } from './history.service.js'

export type LayerDiff =
  | { kind: 'cell-added'; cell: string }
  | { kind: 'cell-removed'; cell: string }
  | { kind: 'cells-reordered'; from: string[]; to: string[] }

export const diffLayers = (
  prev: LayerContent | null,
  next: LayerContent,
): LayerDiff[] => {
  const prevChildren = prev?.children ?? []
  const nextChildren = next.children ?? []
  const diffs: LayerDiff[] = []

  // ── children: membership + order ─────────────────────────
  const prevSet = new Set(prevChildren)
  const nextSet = new Set(nextChildren)
  for (const c of nextChildren) if (!prevSet.has(c)) diffs.push({ kind: 'cell-added', cell: c })
  for (const c of prevChildren) if (!nextSet.has(c)) diffs.push({ kind: 'cell-removed', cell: c })
  if (setEquals(prevSet, nextSet) && !sequenceEquals(prevChildren, nextChildren)) {
    diffs.push({ kind: 'cells-reordered', from: [...prevChildren], to: [...nextChildren] })
  }

  return diffs
}

const setEquals = <T>(a: Set<T>, b: Set<T>): boolean => {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

const sequenceEquals = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
