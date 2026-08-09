// diamondcoreprocessor.com/pheromones/pheromone-marks.ts
//
// THE UNIONED MARK READ — `marksOf(target)` — and the sig-keyed carrier
// behind its second half. The uniform decoration model
// (documentation/uniform-decoration.md) has exactly two places a pheromone
// can live, and one read that consumers use so filters never care which
// carried what:
//
//   LOCATION marks — "the thing living HERE". The existing tag decoration,
//     indexed by location in decoration-kind-index; follows the tile through
//     edits. The DEFAULT carrier.
//   SIG marks — "these exact BYTES, wherever they appear". This module's
//     pool: `sign('pheromones:content')`, one record per target signature,
//     member file NAMED BY that sig (the substrate:references pattern — the
//     pool listing IS the index, lookup is O(1) by anchor, no scan). Marks
//     here do NOT follow edits (new bytes = new sig) and DO follow
//     duplication (same bytes elsewhere arrive pre-marked) — use only when
//     you mean the bytes: an audited bundle, a reviewed image.
//
// This pool is TRUTH — minted by user action, never from the optimize phase
// (a cold client cannot rebuild "what I marked" from layers). Records are
// complete-or-absent: the whole `{ marks }` document is rewritten on every
// change, and an emptied record is REMOVED, so absence collapses to "no
// marks" and no partial state exists. Community deposits (decay, intensity,
// strangers' keys) are a different thing and stay in `pheromones:deposits`
// — see documentation/pheromones.md.
//
// Registered in IoC as '@diamondcoreprocessor.com/PheromoneMarks' so shell
// surfaces (which may never import essentials) reach the union read the
// same way they reach DecorationService.

import { EffectBus } from '@hypercomb/core'
import { normalizeTags } from '../notes/note-tree.js'
import { tagsForLabel, tagsForSegments } from '../commands/decoration-kind-index.js'

const MARKS_MEANING = 'pheromones:content'
const SIG_RE = /^[0-9a-f]{64}$/

type StoreLike = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}

const store = (): StoreLike | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc?.get?.<StoreLike>('@hypercomb.social/Store')

/** What a mark read can aim at. Give whichever halves you hold; the union
 *  covers every carrier the target resolves to:
 *    label    — a cell on the page being rendered (sync index resolution)
 *    segments — an exact location anywhere in the hive
 *    sig      — exact bytes (a resource, a bundle, an envelope)
 *  A target with both a location and a sig unions all of it. */
export type MarkTarget = {
  readonly label?: string
  readonly segments?: readonly string[]
  readonly sig?: string
}

/** In-memory record cache, target sig → sorted marks. An entry mirrors the
 *  pool exactly (absence = no record); invalidated only by this module's own
 *  writes, which are the only sanctioned writers. */
const cache = new Map<string, readonly string[]>()

async function readRecord(sig: string): Promise<readonly string[]> {
  const known = cache.get(sig)
  if (known) return known
  let marks: string[] = []
  try {
    const pool = await store()?.getPool(MARKS_MEANING)
    if (pool) {
      const handle = await pool.getFileHandle(sig, { create: false })
      const parsed = JSON.parse(await (await handle.getFile()).text()) as { marks?: unknown }
      marks = normalizeTags(parsed?.marks)
    }
  } catch { /* absent record = no marks — the normal case */ }
  const frozen = Object.freeze(marks)
  cache.set(sig, frozen)
  return frozen
}

async function writeRecord(sig: string, marks: readonly string[]): Promise<boolean> {
  const pool = await store()?.getPool(MARKS_MEANING)
  if (!pool) return false
  try {
    if (marks.length === 0) {
      // Complete-or-absent: an emptied record is removed, never left as `[]`.
      try { await pool.removeEntry(sig) } catch { /* already absent */ }
    } else {
      const handle = await pool.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(JSON.stringify({ marks })) } finally { await writable.close() }
    }
    cache.set(sig, Object.freeze([...marks]))
    EffectBus.emit('pheromones:marks-changed', { sig, marks })
    return true
  } catch { return false }
}

/** The marks on exact bytes — the sig carrier alone. */
export async function sigMarksOf(sig: string): Promise<readonly string[]> {
  if (!SIG_RE.test(sig)) return []
  return await readRecord(sig.toLowerCase())
}

/** Put a mark on exact bytes. Idempotent; sorted-set semantics match the
 *  tag normalizer, so two writers land identical records. */
export async function addSigMark(sig: string, mark: string): Promise<boolean> {
  if (!SIG_RE.test(sig)) return false
  const key = sig.toLowerCase()
  const prior = await readRecord(key)
  const next = normalizeTags([...prior, mark])
  if (next.length === prior.length) return true
  return await writeRecord(key, next)
}

/** Take a mark off exact bytes. Removing the last one removes the record. */
export async function removeSigMark(sig: string, mark: string): Promise<boolean> {
  if (!SIG_RE.test(sig)) return false
  const key = sig.toLowerCase()
  const clean = mark.trim()
  const prior = await readRecord(key)
  const next = prior.filter(m => m !== clean)
  if (next.length === prior.length) return true
  return await writeRecord(key, next)
}

/**
 * THE union read. Location marks ∪ sig marks, sorted, deduped — consumers
 * (filters, views, badges) never branch on which carrier answered. A filter
 * is a bouquet over exactly this set; the filter language never mentions
 * types, which is what lets every new kind of thing be filterable at birth.
 */
export async function marksOf(target: MarkTarget): Promise<readonly string[]> {
  const out = new Set<string>()
  if (target.segments?.length) for (const m of tagsForSegments(target.segments)) out.add(m)
  else if (target.label) for (const m of tagsForLabel(target.label)) out.add(m)
  if (target.sig) for (const m of await sigMarksOf(target.sig)) out.add(m)
  return [...out].sort()
}

// The union read + sig carrier, reachable from OUTSIDE essentials — the same
// loose-IoC seam OverlapMetrics and ContextIndex use.
window.ioc.register('@diamondcoreprocessor.com/PheromoneMarks', {
  marksOf,
  sigMarksOf,
  addSigMark,
  removeSigMark,
})
