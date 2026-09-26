// hypercomb-runtime/src/boot-pack.ts
//
// THE BOOT PACK — one read instead of hundreds. A warm boot of an installed
// hive imports ~600 package files from OPFS; reading them one by one costs
// ~12x what reading the same bytes as one file does (measured 2026-09-26:
// 855 files, 10.6 MB, ~255 ms apart vs ~20 ms together).
//
// A DERIVED CACHE, never truth. It holds exactly the bee and dependency files
// the last boot of this package asked for, as one transfer pack
// (transfer-pack.ts), in Cache Storage under the installed package's root
// signature. The loaders take bytes from it first and read the single file
// on a miss. When a boot missed anything, a fresh pack is written once the
// bees are loaded, from the bytes that boot already served, so no file is
// read twice. A new install has a new root, so its pack
// starts empty; every member is content-addressed, so a stale pack can only
// be incomplete, never wrong. Nothing is hashed: the members were hashed when
// they were stored.

import { EffectBus } from '@hypercomb/core'
import { installedPackageSig } from './installed-package.js'
import { decodeTransferPack, encodeTransferPack } from './transfer-pack.js'

const CACHE = 'hypercomb-boot-pack-v1'
const keyOf = (root: string): string => `/@boot-pack/${root}`

let opened: Promise<Map<string, Uint8Array> | null> | null = null
let released = false
let missed = 0
/** Every file this boot served, from the pack or read on its own: the next pack. */
const served = new Map<string, Uint8Array>()

const open = (): Promise<Map<string, Uint8Array> | null> => opened ??= (async () => {
  const root = installedPackageSig()
  if (!root || typeof caches === 'undefined') return null
  try {
    const hit = await (await caches.open(CACHE)).match(keyOf(root))
    if (!hit) return null
    const members = decodeTransferPack(new Uint8Array(await hit.arrayBuffer()))
    return members ? new Map(members) : null
  } catch { return null }
})()

/** Bytes of a held bee or dependency: from the boot pack, or read on their
 *  own by `read` on a miss. Either way they are kept for the next pack. */
export const packedBytes = async (
  sig: string,
  read: () => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> => {
  watch()
  if (released) return read()
  const packed = (await open())?.get(sig)
  if (packed) { served.set(sig, packed); return packed }
  missed++
  const bytes = await read()
  if (bytes?.byteLength) served.set(sig, bytes)
  return bytes
}

/** Write the pack of everything this boot served. No file is read again. */
const mint = async (): Promise<void> => {
  const root = installedPackageSig()
  const members = [...served]
  served.clear()
  if (!root || !members.length || typeof caches === 'undefined') return
  try {
    const cache = await caches.open(CACHE)
    await cache.put(keyOf(root), new Response(encodeTransferPack(members)))
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname !== keyOf(root)) await cache.delete(request)
    }
  } catch { /* a cache; the files are still there */ }
}

// Once the bees are in, the pack's job for this boot is done: let the bytes go,
// and write a fresh pack when anything had to be read on its own. The host
// says `loader:bees-done` more than once (critical bees first, the rest
// after), so this waits for the last one.
let settle: ReturnType<typeof setTimeout> | null = null
let watching = false
const watch = (): void => {
  if (watching || typeof EffectBus.on !== 'function') return
  watching = true
  EffectBus.on('loader:bees-done', onBeesDone)
}
const onBeesDone = (): void => {
  if (settle) clearTimeout(settle)
  settle = setTimeout(() => {
    released = true
    opened = null
    if (!missed) { served.clear(); return }
    missed = 0
    void mint()
  }, 3000)
}
