// core/location-marker.spec.ts
//
// THE MARKER WRITE KEEPS ITS OWN ERROR (CC-3) and NAMES A TAKEN NAME (CC-1).
//
// A full device makes the stream's write() reject with QuotaExceededError; the
// stream is then ERRORED, and the old `finally { close() }` threw "Cannot close
// a ERRORED writable stream" over it — so no caller could ever recognise "out
// of space". A marker name another tab already wrote is refused with a NAMED
// error, so a writer can tell "re-read the head and re-apply" from a broken
// write.
//
// THE HEAD MEMO (second half). `latestLayerMarker` walks every entry of a bag
// on every call. The memo answers a repeat read with targeted lookups: the
// next name in sequence is absent (the memo holds) or present (another tab
// advanced the bag — walk forward to it). Those cases count the walks over an
// in-memory directory, so "no scan" is measured, not assumed.

import { describe, expect, it } from 'vitest'
import { MarkerHeadMemo, latestLayerMarker, layerMarkerBytes, writeLayerMarker } from './location-marker.js'

const LAYER = 'a'.repeat(64)

const quota = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/** A writable that behaves like Chrome's after a failed write: write rejects,
 *  close then throws a TypeError, abort is accepted. */
class ErroringWritable {
  aborted = false
  async write(): Promise<void> { throw quota() }
  async close(): Promise<void> { throw new TypeError('Cannot close a ERRORED writable stream') }
  async abort(): Promise<void> { this.aborted = true }
}

class Bag {
  readonly files = new Map<string, Uint8Array>()
  writable: ErroringWritable | null = null
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException(`${name} absent`, 'NotFoundError')
      this.files.set(name, new Uint8Array())
    }
    return {
      kind: 'file' as const,
      createWritable: async () => this.writable ?? {
        write: async (data: ArrayBuffer) => { this.files.set(name, new Uint8Array(data)) },
        close: async () => {},
        abort: async () => {},
      },
      getFile: async () => new Blob([this.files.get(name)!.slice().buffer as ArrayBuffer]),
    }
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }] as const
  }
}

describe('writeLayerMarker', () => {
  it('rethrows the write\'s QuotaExceededError, not the close() TypeError, and aborts the stream', async () => {
    const bag = new Bag()
    bag.writable = new ErroringWritable()
    const failure = await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, LAYER, '00000001')
      .then(() => null, (error: unknown) => error as { name?: string })
    expect(failure?.name).toBe('QuotaExceededError')
    expect(bag.writable.aborted).toBe(true)
  })

  it('refuses a name another writer already holds with a NAMED error, never overwriting it', async () => {
    const bag = new Bag()
    await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, LAYER, '00000001')
    const before = bag.files.get('00000001')!.slice()
    const failure = await writeLayerMarker(bag as unknown as FileSystemDirectoryHandle, 'b'.repeat(64), '00000001')
      .then(() => null, (error: unknown) => error as { name?: string; message?: string })
    expect(failure?.name).toBe('MarkerExistsError')
    expect(failure?.message).toMatch(/Location marker 00000001 already exists/)
    expect(bag.files.get('00000001')).toEqual(before)
  })
})

// ── the head memo ───────────────────────────────────────────────────────

class MemoryFile {
  readonly kind = 'file'
  bytes = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile(): Promise<File> {
    const exact = this.bytes.slice().buffer
    return Object.assign(new Blob([exact]), {
      name: this.name, lastModified: 1,
      arrayBuffer: async () => exact,
      text: async () => new TextDecoder().decode(exact),
    }) as File
  }
  async createWritable() {
    return {
      write: async (value: ArrayBuffer | Uint8Array) => { this.bytes = new Uint8Array(value) },
      close: async () => {},
      abort: async () => {},
    }
  }
}

class MemoryDirectory {
  readonly kind = 'directory'
  readonly files = new Map<string, MemoryFile>()
  /** Every `entries()` walk — the cost the memo removes. */
  walks = 0
  constructor(readonly name = 'bag') {}
  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) throw new DOMException('File absent', 'NotFoundError')
      this.files.set(name, file = new MemoryFile(name))
    }
    return file
  }
  async *entries() {
    this.walks++
    for (const entry of [...this.files]) yield entry
  }
}

const bag = () => new MemoryDirectory() as unknown as FileSystemDirectoryHandle & MemoryDirectory
const sig = (n: number) => n.toString(16).padStart(64, '0')
/** A marker written on disk by ANOTHER tab: bytes only, no memo note. */
const peerWrites = async (dir: MemoryDirectory, name: string, layer: string) => {
  const file = await dir.getFileHandle(name, { create: true })
  file.bytes = new Uint8Array(layerMarkerBytes(layer))
}

describe('MarkerHeadMemo', () => {
  it('scans once, then answers repeat reads with no walk of the bag', async () => {
    const dir = bag()
    for (let i = 0; i < 5; i++) await peerWrites(dir, String(i).padStart(8, '0'), sig(i))
    const memo = new MarkerHeadMemo()
    expect(await memo.head('k', dir)).toEqual({ name: '00000004', layer: sig(4) })
    expect(dir.walks).toBe(1)
    for (let i = 0; i < 10; i++) expect(await memo.head('k', dir)).toEqual({ name: '00000004', layer: sig(4) })
    expect(dir.walks).toBe(1)
    expect(await latestLayerMarker(dir)).toEqual({ name: '00000004', layer: sig(4) })
    expect(dir.walks).toBe(2)
  })

  it('finds another tab\'s markers by walking forward, without a scan', async () => {
    const dir = bag()
    await peerWrites(dir, '00000000', sig(0))
    const memo = new MarkerHeadMemo()
    await memo.head('k', dir)
    await peerWrites(dir, '00000001', sig(1))
    await peerWrites(dir, '00000002', sig(2))
    expect(await memo.head('k', dir)).toEqual({ name: '00000002', layer: sig(2) })
    expect(dir.walks).toBe(1)
  })

  it('an empty space is remembered too: the first marker is found by one lookup', async () => {
    const dir = bag()
    const memo = new MarkerHeadMemo()
    expect(await memo.head('k', dir)).toBeNull()
    expect(memo.peek('k')).toBeNull()
    expect(await memo.head('k', dir)).toBeNull()
    expect(dir.walks).toBe(1)
    await peerWrites(dir, '00000000', sig(7))
    expect(await memo.head('k', dir)).toEqual({ name: '00000000', layer: sig(7) })
    expect(dir.walks).toBe(1)
  })

  it('this tab\'s own write is noted and read back with no lookup of the directory at all', async () => {
    const dir = bag()
    const memo = new MarkerHeadMemo()
    expect(await memo.head('k', dir)).toBeNull()
    const { name } = await writeLayerMarker(dir, sig(3), '00000000')
    memo.note('k', { name, layer: sig(3) })
    expect(memo.peek('k')).toEqual({ name: '00000000', layer: sig(3) })
    expect(await memo.head('k', dir)).toEqual({ name: '00000000', layer: sig(3) })
    expect(dir.walks).toBe(1)
  })

  it('a walk past its bound falls back to one scan, and the memo is right afterwards', async () => {
    const dir = bag()
    await peerWrites(dir, '00000000', sig(0))
    const memo = new MarkerHeadMemo()
    await memo.head('k', dir)
    const far = MarkerHeadMemo.FORWARD_WALK + 5
    for (let i = 1; i <= far; i++) await peerWrites(dir, String(i).padStart(8, '0'), sig(i))
    expect(await memo.head('k', dir)).toEqual({ name: String(far).padStart(8, '0'), layer: sig(far) })
    expect(dir.walks).toBe(2)
    expect(await memo.head('k', dir)).toEqual({ name: String(far).padStart(8, '0'), layer: sig(far) })
    expect(dir.walks).toBe(2)
  })

  it('forget drops the key; the cap evicts the oldest key', async () => {
    const dir = bag()
    const memo = new MarkerHeadMemo(2)
    await memo.head('a', dir)
    await memo.head('b', dir)
    await memo.head('c', dir)
    expect(memo.peek('a')).toBeUndefined()
    expect(memo.peek('b')).toBeNull()
    memo.forget('b')
    expect(memo.peek('b')).toBeUndefined()
    expect(memo.peek('c')).toBeNull()
  })
})
