// history/recents-census.ts
//
// THE RECENTS CENSUS — the pure rule. A hive's census is every atom under its
// root, each with the date it came into being, so the recents view can lay
// them out newest at the centre (documentation/recents-and-the-quick-tray.md,
// codex H7). This file holds the record shape and the fold; no DOM, no bus, no
// pool, so the rule runs in a spec.
//
// A record is keyed by the LAYER SIG it derives from and COMPOSES from its
// children's records: an unchanged child has an unchanged sig, so its census
// is still exactly true and is spliced in whole with its name prefixed to
// every path. Only the changed spine is ever re-derived — the same shape the
// molecule index has, for the same reason: a whole-hive walk on boot is the
// cost the tree epoch was built to kill.
//
// THE DATE. An atom's `at` is the earliest marker in the lineage bag at the
// location it was first derived at (the OPFS file date of `0000`). Markers
// are append-only and nothing is deleted, so once a location has a first
// marker that date never changes — which is what lets a sig-keyed record
// carry it. The same sig placed on a second page is a cache hit, so the
// record keeps the EARLIEST date it was first seen with: once per atom,
// first appearance, which is the doctrine's definition.
//
// Contract compliance (documentation/optimize-phase.md):
//   1. keyed by the SOURCE LAYER SIGNATURE — derive on miss, never update.
//   2. lives in `sign('recents:census')`, declared `index` kind — recomputable,
//      wipe-safe, GC-able.
//   3. never load-bearing — the reader answers null on a miss and the view
//      renders empty; no layer references it, no read path requires it.
//   4. mints no truth — no layers, no markers, no lineage writes.
//   5. COMPLETE-OR-ABSENT — a truncated record is never written.

import { declarePoolKind } from '@hypercomb/core'

/** Colon meaning (P4): a bare `recents` would be the bag of a tile so named. */
export const RECENTS_CENSUS_MEANING = 'recents:census'

/** Bump when the RULE changes; every prior record then misses on read and is
 *  re-minted by the phase. That reject-on-mismatch IS the invalidation. */
export const RECENTS_DERIVATION = 1

/** A guard on the SHAPE of the walk — a cycle is cheap per step. */
export const MAX_CENSUS_DEPTH = 24

/** A record holds at most this many atoms. Past it the record is truncated and
 *  never written — a bound on a pathological tree, not a limit anyone reaches. */
export const MAX_CENSUS_ENTRIES = 50_000

try { declarePoolKind(RECENTS_CENSUS_MEANING, 'index') } catch { /* an older core */ }

/** One atom in the census. `path` is RELATIVE to the record's own node — the
 *  names walked from it to the atom; the root record's paths are absolute. */
export interface CensusEntry {
  readonly sig: string
  readonly label: string
  readonly path: readonly string[]
  /** Epoch ms of the first marker that introduced the atom; 0 when the bag
   *  could not say (an atom whose bag is cold sorts oldest, never vanishes). */
  readonly at: number
}

export interface CensusRecord {
  readonly v: number
  readonly entries: readonly CensusEntry[]
  /** True when a budget or a cap cut the derivation short. Never persisted. */
  readonly truncated?: boolean
}

const SIG = /^[0-9a-f]{64}$/i

/**
 * Fold a node and its children's records into the node's record.
 *
 * ONCE PER ATOM: a sig already present (the same subtree placed twice under
 * one node) keeps its first occurrence, so the census counts atoms, never
 * placements. A null child — budget, depth cap, a cold manifest — makes the
 * parent TRUNCATED rather than silently smaller: a reader that honours the
 * flag must never be lied to.
 */
export const composeCensus = (
  self: { sig: string; label: string; at: number },
  children: ReadonlyArray<{ name: string; record: CensusRecord | null }>,
): CensusRecord => {
  const seen = new Set<string>([self.sig])
  const entries: CensusEntry[] = [{ sig: self.sig, label: self.label, path: [], at: self.at }]
  let truncated = false
  for (const child of children) {
    if (!child.record) { truncated = true; continue }
    if (child.record.truncated) truncated = true
    for (const entry of child.record.entries) {
      if (seen.has(entry.sig)) continue
      if (entries.length >= MAX_CENSUS_ENTRIES) { truncated = true; break }
      seen.add(entry.sig)
      entries.push({ ...entry, path: [child.name, ...entry.path] })
    }
  }
  return truncated ? { v: RECENTS_DERIVATION, entries, truncated: true } : { v: RECENTS_DERIVATION, entries }
}

const readableEntry = (raw: unknown): CensusEntry | null => {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const sig = typeof entry['sig'] === 'string' ? entry['sig'].toLowerCase() : ''
  if (!SIG.test(sig)) return null
  const path = Array.isArray(entry['path']) ? entry['path'].filter((s): s is string => typeof s === 'string') : null
  if (!path) return null
  const at = Number(entry['at'])
  return {
    sig,
    label: typeof entry['label'] === 'string' ? entry['label'] : '',
    path,
    at: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

/** Is this a record this build can read? The whole of invalidation, plus an
 *  element gate — a malformed entry is DROPPED, never thrown on. A truncated
 *  record on disk is a bug (never written), and reads as absent. */
export const readableCensus = (parsed: unknown): CensusRecord | null => {
  const record = parsed as CensusRecord | null
  if (!record || typeof record !== 'object') return null
  if (record.v !== RECENTS_DERIVATION || !Array.isArray(record.entries) || record.truncated === true) return null
  const entries: CensusEntry[] = []
  for (const raw of record.entries) {
    if (entries.length >= MAX_CENSUS_ENTRIES) break
    const entry = readableEntry(raw)
    if (entry) entries.push(entry)
  }
  return { v: RECENTS_DERIVATION, entries }
}

/** The census as the view reads it: newest first; an unknown date sorts
 *  oldest; ties keep the shallower, then the earlier-named, atom first. */
export const newestFirst = (record: CensusRecord | null): CensusEntry[] =>
  [...(record?.entries ?? [])].sort((a, b) =>
    (b.at - a.at)
    || (a.path.length - b.path.length)
    || a.label.localeCompare(b.label))
