// sharing/device-sync.store.ts
//
// THIS DEVICE'S SIDE OF THE WALK, over the real store (device-sync.ts says what
// the walk is). Three faces of one store:
//
//   syncStore   what the walk reads and appends: the head of every lineage bag,
//               and a forward-only marker append.
//   serveOf     what a link answers a peer with: atoms, heads, markers.
//   localIo     what the replication walker reads and writes: bare signatures
//               at the root.
//
// WHICH DIRECTORIES ARE BAGS. The root is an untagged union of lineage bags and
// pools (documentation/known-location-pools.md), so a sig-named directory is
// taken as a plain lineage bag only when ALL of these hold:
//   - the pool registry does not know its name as a pool address;
//   - every entry in it is a marker (an eight-digit file) — a directory that
//     also holds sig-named files or directories is a pool or a molecule, whatever
//     the registry has heard of, and is left alone;
//   - its highest marker reads as `{ layer: <sig> }`.
// Anything else is skipped, never an error: the walk would rather leave a node
// out than push a marker into a space that is not a lineage.
//
// WRITES. Atoms go in through `putResource` (the store's one door for sig-named
// bytes) and markers through core's `writeLayerMarker` (the one marker writer,
// which never replaces a marker). This file holds no raw storage write.

import { MARKER_NAME, SIGNATURE_NAME, isPoolAddress, writeLayerMarker } from '@hypercomb/core'
import type { BagHead, Serve } from './device-link.js'
import type { SyncStore } from './device-sync.js'

export type RealStoreLike = {
  hypercombRoot?: FileSystemDirectoryHandle
  initialize?: () => Promise<void>
  getResourceLocal?: (signature: string) => Promise<Blob | null>
  getLayerPoolBytes?: (signature: string) => Promise<Uint8Array | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
}

const HEX64 = /^[0-9a-f]{64}$/

const root = (store: RealStoreLike): FileSystemDirectoryHandle | null => store.hypercombRoot ?? null

const layerOf = async (file: FileSystemFileHandle): Promise<string | null> => {
  try {
    const record = JSON.parse(await (await file.getFile()).text()) as { layer?: unknown }
    return HEX64.test(String(record.layer)) ? String(record.layer) : null
  } catch { return null }
}

/** The head of one directory if — and only if — it is a plain lineage bag. */
const headOf = async (bag: string, dir: FileSystemDirectoryHandle): Promise<BagHead | null> => {
  let latest = ''
  try {
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind === 'file' && MARKER_NAME.test(name)) { if (name > latest) latest = name; continue }
      // A member, a bucket, a stray file: not a plain lineage. (`.crswap` files
      // are Chromium's swap files for a write in flight; they are not content.)
      if (name.endsWith('.crswap')) continue
      return null
    }
  } catch { return null }
  if (!latest) return null
  const layer = await layerOf(await dir.getFileHandle(latest))
  return layer ? { bag, name: latest, layer } : null
}

export const bagHeads = async (store: RealStoreLike): Promise<BagHead[]> => {
  await store.initialize?.().catch(() => {})
  const dir = root(store)
  if (!dir) return []
  const heads: BagHead[] = []
  try {
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'directory' || !SIGNATURE_NAME.test(name) || !HEX64.test(name)) continue
      if (await isPoolAddress(name).catch(() => true)) continue
      const head = await headOf(name, handle as FileSystemDirectoryHandle)
      if (head) heads.push(head)
    }
  } catch { /* an unreadable root yields what was read */ }
  return heads
}

export const markerLayerOf = async (store: RealStoreLike, bag: string, name: string): Promise<string | null> => {
  const dir = root(store)
  if (!dir || !HEX64.test(bag) || !MARKER_NAME.test(name)) return null
  try {
    return await layerOf(await (await dir.getDirectoryHandle(bag)).getFileHandle(name))
  } catch { return null }
}

/** Bytes of a held atom; never starts a network fetch. */
export const readAtom = async (store: RealStoreLike, signature: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  if (!HEX64.test(signature)) return null
  try {
    const blob = await store.getResourceLocal?.(signature)
    if (blob && blob.size > 0) return new Uint8Array(await blob.arrayBuffer())
    const layer = await store.getLayerPoolBytes?.(signature)
    if (layer && layer.length > 0) return new Uint8Array(layer)
  } catch { /* not held */ }
  return null
}

export const syncStore = (store: RealStoreLike): SyncStore => ({
  heads: () => bagHeads(store),
  markerLayer: (bag, name) => markerLayerOf(store, bag, name),
  async appendMarker(bag, name, layer) {
    const dir = root(store)
    if (!dir || !HEX64.test(bag) || !MARKER_NAME.test(name) || !HEX64.test(layer)) return false
    // Never a marker in a space that is not a lineage, and never one that
    // names a layer this device does not hold.
    if (await isPoolAddress(bag).catch(() => true)) return false
    if (!(await readAtom(store, layer))) return false
    try {
      const bagDir = await dir.getDirectoryHandle(bag, { create: true })
      const existing = await headOf(bag, bagDir)
      const expected = existing ? String(Number(existing.name) + 1).padStart(8, '0') : '00000000'
      // Forward only: the very next name, or nothing. A bag that is not a plain
      // lineage (headOf null with entries in it) is refused rather than marked.
      if (name !== expected) return false
      if (!existing) {
        let entries = 0
        for await (const _entry of (bagDir as unknown as { entries(): AsyncIterable<unknown> }).entries()) entries++
        if (entries > 0) return false
      }
      await writeLayerMarker(bagDir, layer, name)
      return true
    } catch { return false }
  },
})

export const serveOf = (store: RealStoreLike): Exclude<Serve, (...args: never[]) => unknown> => ({
  atom: signature => readAtom(store, signature),
  heads: () => bagHeads(store),
  marker: (bag, name) => markerLayerOf(store, bag, name),
})

/** The replication walker's local half: bare signatures at the root. */
export const localIo = (store: RealStoreLike) => ({
  read: (signature: string) => readAtom(store, signature),
  async write(signature: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!store.putResource) throw new Error('no store to write to')
    // putResource names the bytes itself; a mismatch means the walker's check
    // and the store's disagree, which must never be silent.
    const named = await store.putResource(new Blob([bytes]), { emit: false })
    if (named !== signature) throw new Error(`stored ${named} for ${signature}`)
  },
})
