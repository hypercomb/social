// sharing/image-updates.ts
//
// NEW PICTURES FOR A NAME — what domains offer, and what THIS participant has
// already been shown.
//
// A tile's pictures are a pool by NAME (`sign(name)` — peer-images.ts). The
// answer is the same wherever that name sits in the hierarchy; every cache
// here is keyed by the name alone. A scan asks only a host that has already
// answered a pool, so painting the hive does not 404 every publisher. When a domain
// reports a picture for a name that this participant has not seen, the tile
// wears a badge (image-update-badge.drone.ts); opening the images wall and
// either taking a picture or dismissing marks what was on offer as SEEN.
//
// THE SEEN RECORD IS PRIVATE. It lives in this participant's own pool of
// meaning (`image:seen`), one record per name, listing only the signatures of
// pictures already shown. It is never published, never counted and never sent
// anywhere — it exists so a badge appears once and goes away when answered.
//
// FIRST SIGHT IS A BASELINE: a name this participant has never been shown
// pictures for records everything on offer right now as seen, so only pictures
// that arrive LATER raise a badge — switching the feature on does not light
// every tile in the hive.
//
// Everything is pointers (signatures). Nothing here fetches picture bytes.

import { EffectBus, SignatureService } from '@hypercomb/core'
import { meaningPoolImageCandidates } from './peer-images.js'

export const IMAGE_SEEN_POOL = 'image:seen'
const SEEN_KIND = 'image:seen'
const SEEN_VERSION = 1
/** Hosts can report later; an answer is asked again after this. The badge looks
 *  at every visible tile, so it asks rarely; the hover asks for ONE tile and may
 *  ask sooner. */
const BADGE_REFRESH_MS = 300_000
const HOVER_REFRESH_MS = 45_000
/** Asks to the hosts in flight at once, so a page of tiles never opens a fetch per tile. */
const MAX_IN_FLIGHT = 4

/** Emitted (payload `{ label }`) whenever what is on offer or unseen for a name changed. */
export const IMAGE_UPDATES_EFFECT = 'images:updates'

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

type SeenRecord = { kind: typeof SEEN_KIND; v: number; label: string; seen: string[]; at: number }

type Entry = {
  at: number
  /** Everything on offer for the name. */
  offered: ReadonlySet<string>
  /** On offer and not yet shown to this participant. */
  unseen: ReadonlySet<string>
}

const entries = new Map<string, Entry>()
const pending = new Set<string>()
const EMPTY: ReadonlySet<string> = new Set()

const store = (): StoreLike | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined

const pool = async (): Promise<{ s: StoreLike; dir: FileSystemDirectoryHandle } | null> => {
  const s = store()
  const dir = await s?.getPool?.(IMAGE_SEEN_POOL)
  return s && dir ? { s, dir } : null
}

/** The record's name: the signature of the tile's name, never the words (a name is a pool address, not a file name). */
const keyOf = async (label: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(label).buffer as ArrayBuffer)

/** The pictures this participant has been shown for a name; null when none was ever recorded. */
const readSeen = async (label: string): Promise<Set<string> | null> => {
  try {
    const held = await pool()
    const bytes = await held?.s.getPoolDoc?.(held.dir, await keyOf(label))
    if (!bytes) return null
    const record = JSON.parse(new TextDecoder().decode(bytes)) as SeenRecord
    if (record?.kind !== SEEN_KIND || record.v !== SEEN_VERSION || !Array.isArray(record.seen)) return null
    return new Set(record.seen.filter((s): s is string => typeof s === 'string'))
  } catch { return null }
}

const writeSeen = async (label: string, seen: ReadonlySet<string>): Promise<boolean> => {
  try {
    const held = await pool()
    if (!held?.s.putPoolDoc) return false
    const record: SeenRecord = { kind: SEEN_KIND, v: SEEN_VERSION, label, seen: [...seen], at: Date.now() }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    // One member per name, replaced in place — nothing accumulates.
    return !!(await held.s.putPoolDoc(held.dir, bytes, await keyOf(label), { keep: 'current' }))
  } catch { return false }
}

const refresh = async (label: string): Promise<void> => {
  try {
    const found = await meaningPoolImageCandidates(label, 'scan')
    const offered = new Set(found.map(c => c.previewSig))
    const seen = await readSeen(label)
    let unseen: Set<string>
    if (seen === null) {
      // First sight: everything on offer now is the baseline, not news.
      unseen = new Set()
      if (offered.size) await writeSeen(label, offered)
    } else {
      unseen = new Set([...offered].filter(sig => !seen.has(sig)))
    }
    const before = entries.get(label)
    entries.set(label, { at: Date.now(), offered, unseen })
    const changed = !before || before.unseen.size !== unseen.size || before.offered.size !== offered.size
    if (changed) EffectBus.emit(IMAGE_UPDATES_EFFECT, { label })
  } catch {
    entries.set(label, { at: Date.now(), offered: EMPTY, unseen: EMPTY })
  }
}

const touch = (label: string, maxAgeMs: number): Entry | undefined => {
  const known = entries.get(label)
  const fresh = known && Date.now() - known.at < maxAgeMs
  if (!fresh && !pending.has(label) && pending.size < MAX_IN_FLIGHT) {
    pending.add(label)
    void refresh(label).finally(() => pending.delete(label))
  }
  return known
}

/** Pictures domains offer for this name. Answers at once from what is known and
 *  asks again in the background when the answer is old. */
export const offeredPictures = (label: string): ReadonlySet<string> => touch(label, HOVER_REFRESH_MS)?.offered ?? EMPTY

/** Pictures on offer for this name that this participant has not been shown. */
export const unseenPictures = (label: string): ReadonlySet<string> => touch(label, BADGE_REFRESH_MS)?.unseen ?? EMPTY

/** The unseen pictures, asked fresh — for the wall, which marks what is new as it opens. */
export const unseenNow = async (label: string): Promise<ReadonlySet<string>> => {
  await refresh(label)
  return entries.get(label)?.unseen ?? EMPTY
}

/** Mark pictures as shown: taking one, or dismissing the rest, both answer the badge. */
export const markSeen = async (label: string, pictures: Iterable<string>): Promise<void> => {
  const seen = (await readSeen(label)) ?? new Set<string>()
  for (const sig of pictures) seen.add(sig)
  await writeSeen(label, seen)
  const known = entries.get(label)
  entries.set(label, { at: Date.now(), offered: known?.offered ?? EMPTY, unseen: EMPTY })
  EffectBus.emit(IMAGE_UPDATES_EFFECT, { label })
}

/** Forget the cache — the next ask goes to the hosts and the record again. */
export const forgetImageUpdates = (): void => { entries.clear(); pending.clear() }
