// hypercomb-runtime/src/store.head-memo.spec.ts — DOCUMENT HEADS ARE MEMOIZED.
//
// `getPoolDoc` used to enumerate the whole document space on every read to
// find the max marker, and `putPoolDoc` enumerated it twice. These drive the
// REAL Store against an in-memory directory that counts every `entries()`
// walk: a write walks once (the structural proof needs every entry), a read
// walks never, and a second tab's write is seen by the first tab's next
// read without a walk — the marker it wrote is the next name in sequence.

import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g['get'] = () => undefined
  g['register'] = () => { /* noop */ }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

type StoreLike = {
  putPoolDoc(pool: MockDir, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
  getPoolDoc(pool: MockDir | undefined, subKey?: string): Promise<ArrayBuffer | null>
}
type StoreStatics = { poolSignature(meaning: string): Promise<string> }
let StoreClass: StoreStatics
let make: () => StoreLike

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    return {
      name: this.name,
      size: this.bytes.byteLength,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
    } as unknown as File
  }
  async createWritable() {
    return {
      write: async (chunk: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk)
          : chunk instanceof Uint8Array ? new Uint8Array(chunk) : new Uint8Array(chunk)
      },
      close: async () => { /* noop */ },
      abort: async () => { /* noop */ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  files = new Map<string, MockFile>()
  dirs = new Map<string, MockDir>()
  /** Every `entries()` walk of this directory. */
  walks = 0
  constructor(public name = '') {}
  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    let f = this.files.get(name)
    if (!f) {
      if (!opts.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      f = new MockFile(name); this.files.set(name, f)
    }
    return f
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException(`${name} not found`, 'NotFoundError')
      d = new MockDir(name); this.dirs.set(name, d)
    }
    return d
  }
  async removeEntry(name: string): Promise<void> {
    if (!(this.files.delete(name) || this.dirs.delete(name))) throw new DOMException(`${name} not found`, 'NotFoundError')
  }
  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    this.walks++
    for (const [n, f] of [...this.files]) yield [n, f]
    for (const [n, d] of [...this.dirs]) yield [n, d]
  }
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer
const textOf = (buf: ArrayBuffer | null): string | null => buf ? new TextDecoder().decode(buf) : null
const MARKER = /^\d{8}$/
const markers = (dir: MockDir): string[] => [...dir.files.keys()].filter(n => MARKER.test(n)).sort()

const colonPool = async (meaning: string): Promise<MockDir> =>
  new MockDir(await StoreClass.poolSignature(meaning))

beforeAll(async () => {
  const mod = await import('./store')
  StoreClass = mod.Store as unknown as StoreStatics
  make = () => new (mod.Store as unknown as new () => StoreLike)()
})

describe('document head memo', () => {
  it('reads never walk the directory once the head is known; writes walk once', async () => {
    const store = make()
    const pool = await colonPool('memo:test')
    await store.putPoolDoc(pool, bytesOf('one'))
    expect(pool.walks).toBe(1)
    await store.putPoolDoc(pool, bytesOf('two'))
    await store.putPoolDoc(pool, bytesOf('three'))
    expect(pool.walks).toBe(3)
    expect(markers(pool)).toEqual(['00000000', '00000001', '00000002'])
    for (let i = 0; i < 10; i++) expect(textOf(await store.getPoolDoc(pool))).toBe('three')
    expect(pool.walks).toBe(3)
  })

  it('a sub-bucket is its own key: (pool, subKey) reads cost no walk either', async () => {
    const store = make()
    const pool = await colonPool('memo:buckets')
    await store.putPoolDoc(pool, bytesOf('a1'), 'a')
    await store.putPoolDoc(pool, bytesOf('b1'), 'b')
    await store.putPoolDoc(pool, bytesOf('a2'), 'a')
    const bucketA = pool.dirs.get(await StoreClass.poolSignature('a'))!
    const bucketB = pool.dirs.get(await StoreClass.poolSignature('b'))!
    expect([bucketA.walks, bucketB.walks]).toEqual([2, 1])
    for (let i = 0; i < 5; i++) {
      expect(textOf(await store.getPoolDoc(pool, 'a'))).toBe('a2')
      expect(textOf(await store.getPoolDoc(pool, 'b'))).toBe('b1')
    }
    expect([bucketA.walks, bucketB.walks]).toEqual([2, 1])
    expect(pool.walks).toBe(0)
  })

  it('a second tab\'s write is seen by the first tab\'s next read, with no walk', async () => {
    const tabA = make()
    const tabB = make()
    const pool = await colonPool('memo:two-tabs')
    await tabA.putPoolDoc(pool, bytesOf('from a'))
    expect(textOf(await tabA.getPoolDoc(pool))).toBe('from a')
    const before = pool.walks
    // Tab B has never read this space: its write walks once, as every write does.
    await tabB.putPoolDoc(pool, bytesOf('from b'))
    expect(pool.walks).toBe(before + 1)
    expect(textOf(await tabA.getPoolDoc(pool))).toBe('from b')
    expect(pool.walks).toBe(before + 1)
    // And tab A's next write lands AFTER tab B's marker — never over it.
    await tabA.putPoolDoc(pool, bytesOf('a again'))
    expect(markers(pool)).toEqual(['00000000', '00000001', '00000002'])
    expect(textOf(await tabB.getPoolDoc(pool))).toBe('a again')
  })

  it('a cold read of a space another tab wrote scans once, then never again', async () => {
    const writer = make()
    const reader = make()
    const pool = await colonPool('memo:cold-reader')
    await writer.putPoolDoc(pool, bytesOf('v1'))
    await writer.putPoolDoc(pool, bytesOf('v2'))
    const before = pool.walks
    expect(textOf(await reader.getPoolDoc(pool))).toBe('v2')
    expect(pool.walks).toBe(before + 1)
    expect(textOf(await reader.getPoolDoc(pool))).toBe('v2')
    expect(pool.walks).toBe(before + 1)
    await writer.putPoolDoc(pool, bytesOf('v3'))
    expect(textOf(await reader.getPoolDoc(pool))).toBe('v3')
    expect(pool.walks).toBe(before + 2) // the writer's own walk; the reader probed
  })

  it('keep: current forgets the head, so the restarted sequence is read correctly', async () => {
    const store = make()
    const pool = await colonPool('memo:current')
    await store.putPoolDoc(pool, bytesOf('one'))
    await store.putPoolDoc(pool, bytesOf('two'))
    await store.putPoolDoc(pool, bytesOf('only'), undefined, { keep: 'current' })
    expect(markers(pool)).toEqual([])
    expect(textOf(await store.getPoolDoc(pool))).toBe('only')
    await store.putPoolDoc(pool, bytesOf('next'))
    expect(markers(pool)).toEqual(['00000000'])
    expect(textOf(await store.getPoolDoc(pool))).toBe('next')
  })
})
