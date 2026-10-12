// hypercomb-shared/core/retired-statistics.ts
//
// WE COLLECT NO STATISTICS (jwize, 2026-10-03: "we don't do any tracking, this
// is an antipattern … any tracker is overhead bloat"). Only a live, concurrent
// count is allowed. Every tracker our code used to run is retired, and this
// file removes what they left on a participant's machine — along with the
// keys of retired writes nothing ever read back.
//
// EVERY BUILD CARRIES THIS, AND IT RUNS ON EVERY BOOT. A machine is cleaned
// whenever it patches to a build that has it, however long ago it last ran a
// tracker, and if anything ever writes under these names again it is removed
// again. No "done" flag is kept: a flag would be one more thing stored, and
// each check costs one no-create open.
//
// In a pool it removes ONLY what a tracker could have written: sig-named atoms
// and 000x markers in that tracker's own document space. Any other entry there
// means the space is not provably the tracker's, and it is left as it is. A
// pool is removed only once it is empty — `portals:recent` keeps its `home`
// mark, which is a choice the participant made, not a statistic. Every
// meaning carries a colon, so no tile can reach these addresses.

import { SignatureService, classifyDirectoryEntry } from '@hypercomb/core'
import type { Store } from '@hypercomb/runtime/store'

/** Browser keys a retired tracker wrote. */
export const RETIRED_STATISTIC_KEYS: readonly string[] = Object.freeze([
  'hc:usage-pending',        // usage tracker: per-tile visits and dwell
  'hc:recent-portals',       // recent portals: the walking trail (legacy copy)
  'hc:spoken-habits',        // spoken habits: run counts and phrasings
  'hc:chat-route-visited',   // conversations opened, and when
  'hc:recent-commands',      // commands run
  'hc:perf-boot-marks',      // boot timings
  'hc:perf-last-boot',
  'hc:perf-find-last',
])

/** Browser key PREFIXES — one key per location. */
export const RETIRED_STATISTIC_PREFIXES: readonly string[] = Object.freeze([
  'hc:history-cursor:',      // the history cursor's rewound position: written, never read
])

/** Document spaces a retired tracker wrote: a pool, or one sub-bucket of it. */
export const RETIRED_STATISTIC_SPACES: readonly { meaning: string; subKey?: string }[] = Object.freeze([
  { meaning: 'usage:dwell', subKey: 'v1' },
  { meaning: 'portals:recent', subKey: 'recent' },
  { meaning: 'habits:spoken' },
])

type Entry = [string, FileSystemHandle]
type RetireStore = Pick<Store, 'openPool' | 'hypercombRoot'>

const entriesOf = async (dir: FileSystemDirectoryHandle): Promise<Entry[]> => {
  const out: Entry[] = []
  for await (const entry of (dir as unknown as { entries(): AsyncIterable<Entry> }).entries()) out.push(entry)
  return out
}

/** Remove every atom and marker in `dir`, or nothing when it holds anything
 *  else. True when it was emptied. */
const clearDocumentSpace = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
  const entries = await entriesOf(dir)
  const foreign = entries.some(([name, handle]) => {
    const kind = classifyDirectoryEntry(name, handle.kind === 'directory')
    return kind !== 'member' && kind !== 'marker'
  })
  if (foreign) return false
  for (const [name] of entries) await dir.removeEntry(name)
  return true
}

const retireSpace = async (store: RetireStore, meaning: string, subKey?: string): Promise<boolean> => {
  try {
    const pool = await store.openPool(meaning)
    if (!pool) return true
    if (subKey) {
      const bucketName = await SignatureService.sign(new TextEncoder().encode(subKey).buffer as ArrayBuffer)
      let bucket: FileSystemDirectoryHandle | undefined
      try { bucket = await pool.getDirectoryHandle(bucketName, { create: false }) } catch { bucket = undefined }
      if (bucket) {
        if (!await clearDocumentSpace(bucket)) return false
        await pool.removeEntry(bucketName)
      }
    } else if (!await clearDocumentSpace(pool)) {
      return false
    }
    if ((await entriesOf(pool)).length === 0) await store.hypercombRoot.removeEntry(pool.name)
    return true
  } catch { return false }
}

/** Remove what the retired trackers left. True when nothing of theirs
 *  remains; false when something unexpected was found and left in place.
 *  Never throws. */
export const retireStatistics = async (store: RetireStore | undefined): Promise<boolean> => {
  try {
    const keys = globalThis.localStorage
    for (const key of RETIRED_STATISTIC_KEYS) keys?.removeItem(key)
    for (let i = (keys?.length ?? 0) - 1; i >= 0; i--) {
      const key = keys?.key(i)
      if (key && RETIRED_STATISTIC_PREFIXES.some(prefix => key.startsWith(prefix))) keys?.removeItem(key)
    }
  } catch { /* storage blocked */ }
  if (!store?.openPool) return true
  let clean = true
  for (const { meaning, subKey } of RETIRED_STATISTIC_SPACES) {
    if (!await retireSpace(store, meaning, subKey)) clean = false
  }
  return clean
}

window.ioc?.whenReady?.('@hypercomb.social/Store', (store: unknown) => {
  // Off the boot path: nothing here is urgent.
  const run = (): void => { void retireStatistics(store as RetireStore) }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (idle) idle(run, { timeout: 10_000 })
  else setTimeout(run, 5_000)
})
