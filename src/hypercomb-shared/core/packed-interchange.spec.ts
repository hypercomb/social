// hypercomb-shared/core/packed-interchange.spec.ts
//
// Conformance §7: the packed store's internal representation is legal only
// because it can emit and ingest the portable interchange form losslessly.
// This proves that end to end — through the REAL facade over the REAL engine,
// not a mock of either. The only stand-in is the destination folder, which is
// a plain in-memory directory.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { NativeRootDirectory, type NativeBridge } from '@hypercomb/runtime/native-filesystem'
import {
  MemorySyncFile,
  PackedStoreEngine,
  markerFilename,
} from '@hypercomb/runtime/packed-store-engine'
import {
  changed,
  exportInterchange,
  restoreInterchange,
  type DirectoryLike,
  type FileLike,
} from './packed-interchange'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const text = (raw: Uint8Array | null | undefined): string | null =>
  raw ? new TextDecoder().decode(raw) : null

const address = (seed: number): string =>
  seed.toString(16).padStart(8, '0').repeat(8)

// Content is addressed by its REAL hash: the interchange refuses bytes that
// do not hash to their name, so the one content fixture carries its true
// signature. Bags and pools keep synthetic addresses — those are directories.
const LAYER_SIG = await SignatureService.sign(bytes('layer bytes').buffer as ArrayBuffer)

/**
 * The packed engine behind the SAME bridge interface the worker implements,
 * so `NativeRootDirectory` runs over it unchanged. This is the whole
 * architecture in miniature: the facade cannot tell a worker from a function
 * call, which is exactly why one interchange implementation serves every
 * backend.
 *
 * Content signatures are not real hashes here (the engine trusts the sig it
 * is handed; the worker verifies before calling), so a synthetic address is
 * used and `content_put_raw` returns the requested name.
 */
const bridgeOver = (engine: PackedStoreEngine, contentSigs = new Map<string, string>()): NativeBridge => ({
  invoke: async (command: string, payload?: unknown, options?: { headers?: Record<string, string> }) => {
    const p = (payload ?? {}) as { sig?: string; name?: string }
    switch (command) {
      case 'content_has':
        return engine.hasContent(p.sig!)
      case 'content_get_raw': {
        const found = engine.getContent(p.sig!)
        if (!found) throw Object.assign(new Error('not found'), { kind: 'NotFound' })
        return found.slice().buffer
      }
      case 'content_put_raw': {
        const raw = new Uint8Array(payload as ArrayBuffer)
        // Stand-in for signing: the caller told us the name via the map.
        const sig = contentSigs.get(new TextDecoder().decode(raw)) ?? ''
        engine.putContent(sig, raw)
        return sig
      }
      case 'dir_get_raw': {
        const index = /^\d{8}$/.test(p.name!) ? Number(p.name) : null
        const found = index !== null
          ? engine.getMarker(p.sig!, index)
          : engine.getPool(p.sig!, p.name!)
        if (!found) throw Object.assign(new Error('not found'), { kind: 'NotFound' })
        return found.slice().buffer
      }
      case 'dir_put_raw': {
        const sig = options!.headers!['x-hc-sig']
        const name = decodeURIComponent(options!.headers!['x-hc-name'])
        const raw = new Uint8Array(payload as ArrayBuffer)
        const index = /^\d{8}$/.test(name) ? Number(name) : null
        if (index !== null) engine.setMarker(sig, index, raw)
        else engine.putPool(sig, name, raw)
        return null
      }
      case 'raw_dir_entries':
        return engine.dirEntries(p.sig!)
      case 'raw_root_entries':
        return engine.rootEntries()
      case 'raw_dir_remove': {
        const index = /^\d{8}$/.test(p.name!) ? Number(p.name) : null
        return index !== null ? engine.removeMarker(p.sig!, index) : engine.removePool(p.sig!, p.name!)
      }
      case 'raw_remove':
        return false
      default:
        throw new Error(`unexpected command ${command}`)
    }
  },
})

/** A plain in-memory directory — the export destination. */
class MemoryDirectory implements DirectoryLike {
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Map<string, MemoryDirectory>()

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike> {
    if (!this.files.has(name) && !options?.create) throw new Error(`${name} not found`)
    const files = this.files
    return {
      getFile: async () => {
        const found = files.get(name)
        if (!found) throw new Error(`${name} not found`)
        return { arrayBuffer: async () => found.slice().buffer, size: found.length }
      },
      createWritable: async () => {
        let pending = new Uint8Array()
        return {
          write: async (data: unknown) => { pending = data as Uint8Array },
          close: async () => { files.set(name, pending) },
        }
      },
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike> {
    let found = this.dirs.get(name)
    if (!found) {
      if (!options?.create) throw new Error(`${name} not found`)
      found = new MemoryDirectory()
      this.dirs.set(name, found)
    }
    return found
  }

  async *entries(): AsyncIterable<[string, { kind: string }]> {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }]
    for (const name of this.dirs.keys()) yield [name, { kind: 'directory' }]
  }
}

/** A packed hive with content, a bag, a pool, and a colliding address. */
const buildHive = () => {
  const engine = PackedStoreEngine.open(new MemorySyncFile())
  const contentSigs = new Map<string, string>([['layer bytes', LAYER_SIG]])
  engine.putContent(LAYER_SIG, bytes('layer bytes'))
  engine.putMarkerAt(address(2), 0, bytes('marker zero'))
  engine.putMarkerAt(address(2), 7, bytes('marker seven'))
  engine.putPool(address(3), 'clip', bytes('a clipboard record'))
  // A bare-word pool and a same-named tile's bag are ONE address.
  engine.putMarkerAt(address(4), 0, bytes('collided marker'))
  engine.putPool(address(4), 'member', bytes('collided member'))
  return { engine, root: new NativeRootDirectory(bridgeOver(engine, contentSigs)) as unknown as DirectoryLike }
}

describe('packed store: interchange (conformance §7)', () => {
  it('exports the packed store into the portable form', async () => {
    const { root } = buildHive()
    const folder = new MemoryDirectory()
    const moved = await exportInterchange(root, folder)

    expect(text(folder.files.get(LAYER_SIG))).toBe('layer bytes')
    expect(text(folder.dirs.get(address(2))?.files.get(markerFilename(0)))).toBe('marker zero')
    expect(text(folder.dirs.get(address(2))?.files.get(markerFilename(7)))).toBe('marker seven')
    expect(text(folder.dirs.get(address(3))?.files.get('clip'))).toBe('a clipboard record')
    expect(moved.content).toBe(1)
    expect(moved.markers).toBe(3)
    expect(moved.poolMembers).toBe(2)
    expect(changed(moved)).toBe(true)
  })

  it('keeps a colliding address as ONE directory holding both kinds', async () => {
    const { root } = buildHive()
    const folder = new MemoryDirectory()
    await exportInterchange(root, folder)

    const collided = folder.dirs.get(address(4))!
    expect([...collided.files.keys()].sort()).toEqual([markerFilename(0), 'member'])
  })

  it('round-trips into a fresh packed store, byte for byte', async () => {
    const { root } = buildHive()
    const folder = new MemoryDirectory()
    await exportInterchange(root, folder)

    // A brand new, empty store — nothing carried over but the folder.
    const fresh = PackedStoreEngine.open(new MemorySyncFile())
    const freshRoot = new NativeRootDirectory(
      bridgeOver(fresh, new Map([['layer bytes', LAYER_SIG]])),
    ) as unknown as DirectoryLike
    const restored = await restoreInterchange(folder, freshRoot)

    expect(text(fresh.getContent(LAYER_SIG))).toBe('layer bytes')
    expect(text(fresh.getMarker(address(2), 0))).toBe('marker zero')
    expect(text(fresh.getMarker(address(2), 7))).toBe('marker seven')
    expect(fresh.head(address(2))?.index).toBe(7)      // head survives as the max index
    expect(text(fresh.getPool(address(3), 'clip'))).toBe('a clipboard record')
    expect(text(fresh.getMarker(address(4), 0))).toBe('collided marker')
    expect(text(fresh.getPool(address(4), 'member'))).toBe('collided member')
    expect(changed(restored)).toBe(true)
  })

  it('is idempotent — a second restore imports nothing', async () => {
    const { root } = buildHive()
    const folder = new MemoryDirectory()
    await exportInterchange(root, folder)

    const fresh = PackedStoreEngine.open(new MemorySyncFile())
    const freshRoot = new NativeRootDirectory(
      bridgeOver(fresh, new Map([['layer bytes', LAYER_SIG]])),
    ) as unknown as DirectoryLike

    await restoreInterchange(folder, freshRoot)
    const second = await restoreInterchange(folder, freshRoot)

    expect(changed(second)).toBe(false)
    expect(second.contentSkipped).toBe(1)
    expect(second.markersSkipped).toBe(3)
    expect(second.poolMembersSkipped).toBe(2)
  })

  it('restore UNIONS rather than replaces — an occupied marker index is history', async () => {
    const folder = new MemoryDirectory()
    const incoming = await folder.getDirectoryHandle(address(2), { create: true }) as MemoryDirectory
    incoming.files.set(markerFilename(0), bytes('incoming zero'))
    incoming.files.set(markerFilename(1), bytes('incoming one'))

    // The live hive already holds a DIFFERENT marker at index 0.
    const live = PackedStoreEngine.open(new MemorySyncFile())
    live.putMarkerAt(address(2), 0, bytes('live zero'))
    const liveRoot = new NativeRootDirectory(bridgeOver(live)) as unknown as DirectoryLike

    const moved = await restoreInterchange(folder, liveRoot)

    // Index 0 is untouched; index 1 is new and lands.
    expect(text(live.getMarker(address(2), 0))).toBe('live zero')
    expect(text(live.getMarker(address(2), 1))).toBe('incoming one')
    expect(moved.markers).toBe(1)
    expect(moved.markersSkipped).toBe(1)
  })

  it('exporting twice into one folder reports no second change', async () => {
    const { root } = buildHive()
    const folder = new MemoryDirectory()
    await exportInterchange(root, folder)
    const second = await exportInterchange(root, folder)
    expect(changed(second)).toBe(false)
  })

  it('refuses content whose bytes do not hash to its name — a listing is not a proof', async () => {
    const folder = new MemoryDirectory()
    folder.files.set(address(5), bytes('bytes that are not what the name claims'))
    folder.files.set(LAYER_SIG, bytes('layer bytes'))
    const fresh = PackedStoreEngine.open(new MemorySyncFile())
    const freshRoot = new NativeRootDirectory(
      bridgeOver(fresh, new Map([['layer bytes', LAYER_SIG]])),
    ) as unknown as DirectoryLike

    const restored = await restoreInterchange(folder, freshRoot)

    expect(restored.contentRefused).toBe(1)
    expect(restored.content).toBe(1)
    expect(fresh.hasContent(address(5))).toBe(false)
    expect(text(fresh.getContent(LAYER_SIG))).toBe('layer bytes')
  })

  it('ignores files that are not part of a hive', async () => {
    const folder = new MemoryDirectory()
    folder.files.set('README.md', bytes('a hive folder may hold notes'))
    const fresh = PackedStoreEngine.open(new MemorySyncFile())
    const freshRoot = new NativeRootDirectory(bridgeOver(fresh)) as unknown as DirectoryLike

    const moved = await restoreInterchange(folder, freshRoot)
    expect(changed(moved)).toBe(false)
    expect(fresh.contentSigs()).toEqual([])
  })
})
