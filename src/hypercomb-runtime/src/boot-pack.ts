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
// bees are loaded, at idle time. A new install has a new root, so its pack
// starts empty; every member is content-addressed, so a stale pack can only
// be incomplete, never wrong. Nothing is hashed: the members were hashed when
// they were stored.

import { EffectBus } from '@hypercomb/core'
import { installedPackageSig } from './installed-package.js'
import { decodeTransferPack, encodeTransferPack } from './transfer-pack.js'

const CACHE = 'hypercomb-boot-pack-v1'
const keyOf = (root: string): string => `/@boot-pack/${root}`

type Kind = 'bee' | 'dependency'
export type BootPackSource = {
  getBeeBytes(sig: string): Promise<Uint8Array | null>
  getDependencyBytes(sig: string): Promise<Uint8Array | null>
}

let opened: Promise<Map<string, Uint8Array> | null> | null = null
let released = false
const asked = new Map<string, Kind>()
let missed = 0
let source: BootPackSource | null = null

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

/** Bytes of a held bee or dependency from the boot pack, or null (then read
 *  the file). Records the ask, so the next pack holds what this boot used. */
export const packedBytes = async (sig: string, kind: Kind, from: BootPackSource): Promise<Uint8Array | null> => {
  source ??= from
  watch()
  asked.set(sig, kind)
  if (released) return null
  const bytes = (await open())?.get(sig) ?? null
  if (!bytes) missed++
  return bytes
}

/** Write the pack of everything this boot asked for. */
const mint = async (): Promise<void> => {
  const root = installedPackageSig()
  if (!root || !source || !asked.size || typeof caches === 'undefined') return
  const members: Array<[string, Uint8Array]> = []
  for (const [sig, kind] of asked) {
    const bytes = kind === 'bee' ? await source.getBeeBytes(sig) : await source.getDependencyBytes(sig)
    if (bytes) members.push([sig, bytes])
  }
  if (!members.length) return
  try {
    const cache = await caches.open(CACHE)
    await cache.put(keyOf(root), new Response(encodeTransferPack(members)))
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname !== keyOf(root)) await cache.delete(request)
    }
    missed = 0
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
    if (!missed && asked.size) return
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    if (idle) idle(() => { void mint() }, { timeout: 5000 })
    else void mint()
  }, 3000)
}
