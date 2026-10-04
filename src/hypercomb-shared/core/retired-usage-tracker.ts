// hypercomb-shared/core/retired-usage-tracker.ts
//
// THE USAGE TRACKER IS RETIRED (jwize, 2026-10-03: "we don't do any tracking,
// this is an antipattern … any tracker is overhead"). It recorded, per tile, a
// visit count, decayed dwell time and last-visit time, in the pool
// `usage:dwell` (sub-bucket sign('v1')) and a write-ahead queue in
// localStorage `hc:usage-pending`. This file removes what it left behind.
//
// EVERY BUILD CARRIES THIS, AND IT RUNS ON EVERY BOOT. A machine is cleaned
// whenever it patches to a build that has it, however long ago it last ran
// the tracker, and if anything ever writes under the old names again it is
// removed again. No "done" flag is kept: a flag would be one more thing
// stored, and the check costs one no-create open.
//
// It removes ONLY what the tracker could have written: in its sub-bucket,
// sig-named atoms and 000x markers; in the pool, that one sub-bucket. Any
// other entry means the space is not provably the tracker's, and everything
// is left as it is. The pool address carries a colon, so no tile can reach it.

import { SignatureService, classifyDirectoryEntry } from '@hypercomb/core'
import type { Store } from '@hypercomb/runtime/store'

const USAGE_MEANING = 'usage:dwell'
const USAGE_SUBKEY = 'v1'
const PENDING_KEY = 'hc:usage-pending'

type Entry = [string, FileSystemHandle]
type RetireStore = Pick<Store, 'openPool' | 'hypercombRoot'>

const entriesOf = async (dir: FileSystemDirectoryHandle): Promise<Entry[]> => {
  const out: Entry[] = []
  for await (const entry of (dir as unknown as { entries(): AsyncIterable<Entry> }).entries()) out.push(entry)
  return out
}

/** Remove the tracker's leftovers. True when nothing of it remains; false when
 *  something unexpected was found and left in place. Never throws. */
export const retireUsageTracker = async (store: RetireStore | undefined): Promise<boolean> => {
  try { globalThis.localStorage?.removeItem(PENDING_KEY) } catch { /* storage blocked */ }
  if (!store?.openPool) return true
  try {
    const pool = await store.openPool(USAGE_MEANING)
    if (!pool) return true
    const bucketName = await SignatureService.sign(new TextEncoder().encode(USAGE_SUBKEY).buffer as ArrayBuffer)
    const poolEntries = await entriesOf(pool)
    if (poolEntries.some(([name, handle]) => name !== bucketName || handle.kind !== 'directory')) return false
    for (const [, handle] of poolEntries) {
      const bucket = handle as FileSystemDirectoryHandle
      const own = await entriesOf(bucket)
      const foreign = own.some(([name, h]) => {
        const kind = classifyDirectoryEntry(name, h.kind === 'directory')
        return kind !== 'member' && kind !== 'marker'
      })
      if (foreign) return false
      for (const [name] of own) await bucket.removeEntry(name)
      await pool.removeEntry(bucketName)
    }
    await store.hypercombRoot.removeEntry(pool.name)
    return true
  } catch { return false }
}

window.ioc?.whenReady?.('@hypercomb.social/Store', (store: unknown) => {
  // Off the boot path: nothing here is urgent.
  const run = (): void => { void retireUsageTracker(store as RetireStore) }
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (idle) idle(run, { timeout: 10_000 })
  else setTimeout(run, 5_000)
})
