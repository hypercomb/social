// hypercomb-runtime/src/store.visual-within-target.spec.ts
//
// "WITHIN TARGET, NO DERIVATIVE" IS A DERIVED RECORD; ONE DECODE PER SIG.
//
// `optimizeVisual` on a source at or under the atlas target decoded the
// full raw to measure it, found nothing to derive, and wrote nothing — so
// the NEXT session decoded it again, every session, for every small image.
// And two optimizer drones asking about one sig decoded it twice. These
// drive the REAL Store over an in-memory OPFS with a counting
// `createImageBitmap`: the first session decodes once and records the
// answer in the visual-optimization pool (D1/D2: keyed by the source sig,
// never load-bearing); a second session over the same disk decodes ZERO
// times; concurrent askers share one decode.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
  opfsRoot: unknown
  optimizeVisual(sig: string, raw: Blob): Promise<void>
  getOptimizedVisual(sig: string): Promise<Blob | null>
  isVisualWithinTarget(sig: string): Promise<boolean>
}
type StoreStatics = { poolSignature(meaning: string): Promise<string>; VISUAL_OPTIMIZATION_MEANING: string }
let StoreClass: StoreStatics
let make: (root: MockDir) => StoreLike

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const slice = this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
    return {
      name: this.name,
      size: this.bytes.byteLength,
      type: '',
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
    for (const [n, f] of [...this.files]) yield [n, f]
    for (const [n, d] of [...this.dirs]) yield [n, d]
  }
}

/** A decoder that reports a fixed size and counts every decode. */
const decodes = { count: 0 }
const sizes = new Map<Blob, { width: number; height: number }>()
const installDecoder = (): void => {
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    decodes.count++
    await new Promise(resolve => setTimeout(resolve, 1))
    const size = sizes.get(blob) ?? { width: 256, height: 256 }
    return { ...size, close: () => { /* noop */ } }
  })
  class FakeCanvas {
    constructor(public width: number, public height: number) {}
    getContext() { return { imageSmoothingEnabled: true, imageSmoothingQuality: 'low', drawImage: () => { /* noop */ } } }
    async convertToBlob() {
      // jsdom's Blob has no arrayBuffer(); the store reads the webp through it.
      const bytes = new Uint8Array([1, 2, 3, 4])
      return Object.assign(new Blob([bytes], { type: 'image/webp' }), { arrayBuffer: async () => bytes.buffer })
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
}

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const small = (): Blob => { const b = new Blob([new Uint8Array(16)]); sizes.set(b, { width: 300, height: 200 }); return b }
const large = (): Blob => { const b = new Blob([new Uint8Array(16)]); sizes.set(b, { width: 2048, height: 1024 }); return b }

beforeAll(async () => {
  const mod = await import('./store')
  StoreClass = mod.Store as unknown as StoreStatics
  make = (root: MockDir) => {
    const store = new (mod.Store as unknown as new () => StoreLike)()
    store.opfsRoot = root
    return store
  }
})

afterEach(() => { vi.unstubAllGlobals(); decodes.count = 0; sizes.clear() })

const withinTargetBucket = async (root: MockDir): Promise<MockDir | undefined> =>
  root.dirs.get(await StoreClass.poolSignature(StoreClass.VISUAL_OPTIMIZATION_MEANING))
    ?.dirs.get(await StoreClass.poolSignature('within-target'))

describe('within target, no derivative', () => {
  it('first session: one decode, a record keyed by the source sig; second session: zero decodes', async () => {
    installDecoder()
    const disk = new MockDir()
    const first = make(disk)
    await first.optimizeVisual(SIG_A, small())
    expect(decodes.count).toBe(1)
    // Nothing derived — no optimized entry — but the answer is on disk.
    expect(await first.getOptimizedVisual(SIG_A)).toBeNull()
    const bucket = await withinTargetBucket(disk)
    expect(bucket?.files.has(SIG_A)).toBe(true)
    const record = JSON.parse(new TextDecoder().decode(bucket!.files.get(SIG_A)!.bytes)) as Record<string, unknown>
    expect(record).toEqual({ source: SIG_A, width: 300, height: 200, target: 512 })
    // Same session again: nothing to do.
    await first.optimizeVisual(SIG_A, small())
    expect(decodes.count).toBe(1)

    // A SECOND SESSION over the same disk — the case that re-decoded every boot.
    const second = make(disk)
    expect(await second.isVisualWithinTarget(SIG_A)).toBe(true)
    await second.optimizeVisual(SIG_A, small())
    await second.optimizeVisual(SIG_A, small())
    expect(decodes.count).toBe(1)
  })

  it('a source above target still derives, and is not recorded as within target', async () => {
    installDecoder()
    const disk = new MockDir()
    const store = make(disk)
    await store.optimizeVisual(SIG_B, large())
    expect(decodes.count).toBe(1)
    expect(await store.getOptimizedVisual(SIG_B)).not.toBeNull()
    expect(await store.isVisualWithinTarget(SIG_B)).toBe(false)
    expect((await withinTargetBucket(disk))?.files.has(SIG_B) ?? false).toBe(false)
    await store.optimizeVisual(SIG_B, large())
    expect(decodes.count).toBe(1)
  })

  it('concurrent askers for one sig share one decode (the two optimizer drones)', async () => {
    installDecoder()
    const store = make(new MockDir())
    const raw = small()
    const first = store.optimizeVisual(SIG_A, raw)
    const again = store.optimizeVisual(SIG_A, raw)
    const third = store.optimizeVisual(SIG_A, raw)
    expect(again).toBe(first)
    expect(third).toBe(first)
    await Promise.all([first, again, third])
    expect(decodes.count).toBe(1)
    // And a different sig is its own work.
    await store.optimizeVisual(SIG_B, small())
    expect(decodes.count).toBe(2)
  })

  it('without a decoder nothing is recorded (no false negatives written)', async () => {
    const disk = new MockDir()
    const store = make(disk)
    await store.optimizeVisual(SIG_A, small())
    expect(await store.isVisualWithinTarget(SIG_A)).toBe(false)
    expect(await withinTargetBucket(disk)).toBeUndefined()
  })
})
