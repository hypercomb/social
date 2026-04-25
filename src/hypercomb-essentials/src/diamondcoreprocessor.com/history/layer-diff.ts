// diamondcoreprocessor.com/history/layer-diff.ts
//
// Pure, stateless diff between two slim layer snapshots. The slim
// layer is two named arrays — `cells` (ordered) and `hidden` (set) —
// so the diff has only three possible shapes: cell added, cell removed,
// cells reordered, plus visibility flips.
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
  | { kind: 'cell-hidden'; cell: string }
  | { kind: 'cell-unhidden'; cell: string }

const EMPTY: LayerContent = { name: '', cells: [], merkles: [], hidden: [] }

export const diffLayers = (
  prev: LayerContent | null,
  next: LayerContent,
): LayerDiff[] => {
  const p = prev ?? EMPTY
  const diffs: LayerDiff[] = []

  // ── cells: membership + order ────────────────────────────
  const prevCellSet = new Set(p.cells)
  const nextCellSet = new Set(next.cells)
  for (const c of next.cells) if (!prevCellSet.has(c)) diffs.push({ kind: 'cell-added', cell: c })
  for (const c of p.cells) if (!nextCellSet.has(c)) diffs.push({ kind: 'cell-removed', cell: c })
  if (setEquals(prevCellSet, nextCellSet) && !sequenceEquals(p.cells, next.cells)) {
    diffs.push({ kind: 'cells-reordered', from: [...p.cells], to: [...next.cells] })
  }

  // ── hidden: set diff ─────────────────────────────────────
  const prevHidden = new Set(p.hidden)
  const nextHidden = new Set(next.hidden)
  for (const c of next.hidden) if (!prevHidden.has(c)) diffs.push({ kind: 'cell-hidden', cell: c })
  for (const c of p.hidden) if (!nextHidden.has(c)) diffs.push({ kind: 'cell-unhidden', cell: c })

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
