// diamondcoreprocessor.com/history/layer-diff.ts
//
// Pure, stateless diff between two layer snapshots. The layer is now
// open-shaped: `name` + optional `children` + any number of slot
// fields contributed by registered LayerSlots (notes, tags, future
// features). The diff walks each field generically:
//
//   - `children`: membership + order → cell-added / cell-removed /
//     cells-reordered (kind names retain `cell-*` for continuity with
//     the renderer/UI, which translates sig deltas to display names).
//   - Every other field present on either side: `slot-changed` with
//     the slot name and before/after values. The history viewer can
//     render slot diffs generically by slot name, or specialise per
//     slot if a richer per-field diff is wanted.
//
// diffLayers(null, layer) treats the whole layer as additions — useful
// for rendering the first-ever layer in a location's history.
import type { LayerContent } from './history.service.js'

export type LayerDiff =
  | { kind: 'cell-added'; cell: string }
  | { kind: 'cell-removed'; cell: string }
  | { kind: 'cells-reordered'; from: string[]; to: string[] }
  | { kind: 'slot-changed'; slot: string; from: unknown; to: unknown }

export const diffLayers = (
  prev: LayerContent | null,
  next: LayerContent,
): LayerDiff[] => {
  const prevChildren = (prev?.children ?? []) as string[]
  const nextChildren = (next.children ?? []) as string[]
  const diffs: LayerDiff[] = []

  // ── children: membership + order ─────────────────────────
  const prevSet = new Set(prevChildren)
  const nextSet = new Set(nextChildren)
  for (const c of nextChildren) if (!prevSet.has(c)) diffs.push({ kind: 'cell-added', cell: c })
  for (const c of prevChildren) if (!nextSet.has(c)) diffs.push({ kind: 'cell-removed', cell: c })
  if (setEquals(prevSet, nextSet) && !sequenceEquals(prevChildren, nextChildren)) {
    diffs.push({ kind: 'cells-reordered', from: [...prevChildren], to: [...nextChildren] })
  }

  // ── slots: any field other than name/children ────────────
  // Iterate the union of slot keys present on either side. Two
  // layer JSONs that produced byte-equal canonical bytes had equal
  // slot values, so JSON-string equality is a sound deep compare
  // here (slot values are required to be JSON-serializable and
  // already canonical-shaped by their owning subsystem).
  const prevSlotKeys = prev ? Object.keys(prev).filter(k => k !== 'name' && k !== 'children') : []
  const nextSlotKeys = Object.keys(next).filter(k => k !== 'name' && k !== 'children')
  const slotKeys = new Set<string>([...prevSlotKeys, ...nextSlotKeys])
  for (const key of [...slotKeys].sort()) {
    const a = prev?.[key]
    const b = next[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ kind: 'slot-changed', slot: key, from: a, to: b })
    }
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
