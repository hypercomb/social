// pheromones/pheromone-marks.ts
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
  /** The read-only open. A READ must not mint the pool — see `readRecord`. */
  openPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
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
 *  writes, which are the only sanctioned writers.
 *
 *  AN ENTRY IS ONLY EVER AN ANSWER. Nothing here is written for a read that
 *  could not reach the pool — see `readFromPool`. That rule is what makes the
 *  cache permanent-by-design safe: a permanent cache of a failure is a wrong
 *  answer nothing can ever correct. */
const cache = new Map<string, readonly string[]>()

/** The shared "no marks" value handed back for a read that did NOT land. It is
 *  deliberately not put in the cache. */
const NONE: readonly string[] = Object.freeze([])

/** Did this rejection mean "the member is not there"? That is an ANSWER — the
 *  participant has not marked these bytes. Every other rejection means the read
 *  failed, which is not. */
const isAbsent = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'NotFoundError'

/**
 * THE MARKS ALREADY IN HAND — synchronous, and `undefined` when this sig has
 * never been read.
 *
 * The distinction is the whole point: `[]` means "read it, no marks", while
 * `undefined` means "no idea yet". A synchronous gate that cannot tell those
 * apart has to treat an unread signature as unmarked, which is a verdict it
 * has no evidence for. Callers that get `undefined` should allow and, if they
 * care, kick `sigMarksOf` so the next pass has an answer.
 */
export function sigMarksKnown(sig: string): readonly string[] | undefined {
  if (!SIG_RE.test(sig)) return undefined
  return cache.get(sig.toLowerCase())
}

/**
 * ONE READ, AND WHETHER IT LANDED.
 *
 * This separation is the whole fix. The old body wrapped everything in one
 * `try` and cached the result unconditionally, so THREE outcomes collapsed
 * into one permanent `[]`:
 *
 *   the member is absent          — an answer, and the common one
 *   the read threw                — NOT an answer
 *   `store()` was undefined       — NOT an answer
 *
 * Only the first is evidence. Caching the other two latched "no marks" onto a
 * signature for the life of the tab, and since `readRecord` returns early on a
 * cache hit, nothing ever re-read it. That fails OPEN on the DROP half: a
 * signature the participant excluded was admitted forever because one read
 * raced the Store into IoC. (KEEP fails safe — an empty mark list is admitted
 * by `unknown is not absent` — so the damage was one-sided, on exactly the
 * half whose only job is to refuse.)
 *
 * It became reachable when the intake gate started kicking this read at first
 * sight of a peer signature: the earliest, least settled moment in a session,
 * which is precisely when the Store is most likely to be missing.
 */
async function readFromPool(sig: string): Promise<{ landed: boolean; marks: string[] }> {
  const st = store()
  // THE RACE THE GATE OPENED. No Store in IoC yet is not "no marks".
  if (!st) return { landed: false, marks: [] }

  let pool: FileSystemDirectoryHandle | null
  try {
    // READ-ONLY OPEN. `getPool` creates, so consulting the marks of one
    // stranger's signature used to mint `sign('pheromones:content')` on a
    // hive that has never marked anything — a directory claiming a feature
    // the participant does not use, in a root every walker enumerates.
    pool = await (st.openPool?.(MARKS_MEANING) ?? st.getPool(MARKS_MEANING))
  } catch { return { landed: false, marks: [] } }

  // NO POOL IS AN ANSWER. `openPool` does not create, so its absence means this
  // participant has never marked anything and no record can exist. Treating it
  // as a failure would make every gate call on a never-marked hive — the common
  // case — re-open a directory that will never be there.
  //
  // (`Store.openPool` does fold a genuinely unreadable root into the same null;
  // that conflation is one level down and noted on `openPool` itself. A hive
  // whose root cannot be opened at all has failed harder than a mark cache.)
  if (!pool) return { landed: true, marks: [] }

  let handle: FileSystemFileHandle
  try {
    handle = await pool.getFileHandle(sig, { create: false })
  } catch (err) {
    // Absent member = unmarked bytes, and that IS the answer. Anything else —
    // a torn handle, a quota error — is the pool refusing to be read.
    return isAbsent(err) ? { landed: true, marks: [] } : { landed: false, marks: [] }
  }

  try {
    const parsed = JSON.parse(await (await handle.getFile()).text()) as { marks?: unknown }
    return { landed: true, marks: normalizeTags(parsed?.marks) }
  } catch {
    // The member exists but would not read or parse. Deliberately NOT an
    // answer: "there is a record here and I could not see it" must not resolve
    // to "there are no marks here", which is the fail-open direction. The cost
    // of getting this wrong is a refusal that silently stops refusing; the cost
    // of retrying is one read per commit on a corrupt record that should not
    // exist, since `writeRecord` is the only writer and always writes JSON.
    return { landed: false, marks: [] }
  }
}

async function readRecord(sig: string): Promise<readonly string[]> {
  const known = cache.get(sig)
  if (known) return known
  const read = await readFromPool(sig)
  // A READ THAT DID NOT LAND IS NOT AN ANSWER, so it is not remembered as one.
  // The caller gets "no marks" for now — intake must never break on a failed
  // read — and the next caller asks again.
  if (!read.landed) return NONE
  const frozen = Object.freeze(read.marks)
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
  sigMarksKnown,
  addSigMark,
  removeSigMark,
})
