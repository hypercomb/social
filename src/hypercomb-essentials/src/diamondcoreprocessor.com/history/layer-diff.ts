// diamondcoreprocessor.com/history/layer-diff.ts
//
// Pure, stateless diff between two layer snapshots. Consumers (activity
// feed, "what-will-disappear" preview, cursor navigation labels) call this
// to derive a set of human-meaningful changes from two LayerContent values.
//
// diffLayers(null, layer) treats the whole layer as additions — useful for
// rendering the first-ever layer in a location's history.
import type { LayerContent } from './history.service.js'

export type LayerDiff =
  | { kind: 'cell-added'; cell: string }
  | { kind: 'cell-removed'; cell: string }
  | { kind: 'cells-reordered'; from: string[]; to: string[] }
  | { kind: 'cell-hidden'; cell: string }
  | { kind: 'cell-unhidden'; cell: string }
  | { kind: 'content-added'; cell: string; sig: string }
  | { kind: 'content-removed'; cell: string; sig: string }
  | { kind: 'content-changed'; cell: string; prevSig: string; nextSig: string }
  | { kind: 'tags-changed'; cell: string; prev: string[]; next: string[] }
  | { kind: 'notes-added'; cell: string; sig: string }
  | { kind: 'notes-removed'; cell: string; sig: string }
  | { kind: 'notes-changed'; cell: string; prevSig: string; nextSig: string }
  | { kind: 'bee-registered'; key: string }
  | { kind: 'bee-unregistered'; key: string }
  | { kind: 'dependency-added'; sig: string }
  | { kind: 'dependency-removed'; sig: string }
  | { kind: 'layout-changed'; prevSig: string; nextSig: string }
  | { kind: 'instructions-changed'; prevSig: string; nextSig: string }

const EMPTY: LayerContent = {
  version: 2,
  cells: [],
  hidden: [],
  contentByCell: {},
  tagsByCell: {},
  notesByCell: {},
  bees: [],
  dependencies: [],
  layoutSig: '',
  instructionsSig: '',
}

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

  // ── contentByCell: per-cell signature ────────────────────
  const contentKeys = union(Object.keys(p.contentByCell), Object.keys(next.contentByCell))
  for (const cell of contentKeys) {
    const a = p.contentByCell[cell] ?? ''
    const b = next.contentByCell[cell] ?? ''
    if (a === b) continue
    if (!a) diffs.push({ kind: 'content-added', cell, sig: b })
    else if (!b) diffs.push({ kind: 'content-removed', cell, sig: a })
    else diffs.push({ kind: 'content-changed', cell, prevSig: a, nextSig: b })
  }

  // ── tagsByCell: per-cell array (canonically sorted in layer) ──
  const tagKeys = union(Object.keys(p.tagsByCell), Object.keys(next.tagsByCell))
  for (const cell of tagKeys) {
    const a = p.tagsByCell[cell] ?? []
    const b = next.tagsByCell[cell] ?? []
    if (sequenceEquals(a, b)) continue
    diffs.push({ kind: 'tags-changed', cell, prev: [...a], next: [...b] })
  }

  // ── notesByCell: per-cell signature pointer to the current note set ──
  const notesKeys = union(Object.keys(p.notesByCell), Object.keys(next.notesByCell))
  for (const cell of notesKeys) {
    const a = p.notesByCell[cell] ?? ''
    const b = next.notesByCell[cell] ?? ''
    if (a === b) continue
    if (!a) diffs.push({ kind: 'notes-added', cell, sig: b })
    else if (!b) diffs.push({ kind: 'notes-removed', cell, sig: a })
    else diffs.push({ kind: 'notes-changed', cell, prevSig: a, nextSig: b })
  }

  // ── bees / dependencies: set diff ────────────────────────
  const prevBees = new Set(p.bees)
  const nextBees = new Set(next.bees)
  for (const k of next.bees) if (!prevBees.has(k)) diffs.push({ kind: 'bee-registered', key: k })
  for (const k of p.bees) if (!nextBees.has(k)) diffs.push({ kind: 'bee-unregistered', key: k })

  const prevDeps = new Set(p.dependencies)
  const nextDeps = new Set(next.dependencies)
  for (const s of next.dependencies) if (!prevDeps.has(s)) diffs.push({ kind: 'dependency-added', sig: s })
  for (const s of p.dependencies) if (!nextDeps.has(s)) diffs.push({ kind: 'dependency-removed', sig: s })

  // ── composite sigs: single scalar compare ────────────────
  if (p.layoutSig !== next.layoutSig) {
    diffs.push({ kind: 'layout-changed', prevSig: p.layoutSig, nextSig: next.layoutSig })
  }
  if (p.instructionsSig !== next.instructionsSig) {
    diffs.push({ kind: 'instructions-changed', prevSig: p.instructionsSig, nextSig: next.instructionsSig })
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

const union = (a: string[], b: string[]): string[] => {
  const set = new Set(a)
  for (const k of b) set.add(k)
  return [...set]
}
