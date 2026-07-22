// diamondcoreprocessor.com/history/hives-names-shape.spec.ts
//
// THE HIVES SHAPE — mechanical proof that the design in
// documentation/known-location-pools.md is buildable TODAY from shipped
// primitives, with no lineage sigbags in the entry path.
//
//   pool:   sign('hives:names')            — known location, colon-scoped
//   entry:  <pool>/<sign(hiveName)>/<sig>  — document-pool sub-bucket
//           holding ONE current record { name, head } (sealed head sig)
//   walk:   from the head, children only — not exercised here
//
// Drives the REAL Store.putPoolDoc / getPoolDoc (hypercomb-shared) and
// the REAL address derivations. What these tests freeze:
//   1. the pool address can never be minted by a location (colon rule)
//   2. the entry is name → head; NO lineageKey derivation anywhere
//   3. user names one level down are collision-free even when they
//      equal a root pool meaning ('clipboard')
//   4. same hive met "twice" = one bucket, one identity (no
//      entry-context parameter); head update keeps exactly one current
//   5. two hives coexist — the current-member drop never eats buckets

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { lineageKey } from './lineage-key.js'

// Shell globals BEFORE the module imports evaluate (Store and
// HistoryService both self-register at module scope).
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
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}
type StoreStatics = { poolSignature(meaning: string): Promise<string> }
let store: StoreLike
let StoreClass: StoreStatics

// ---- in-memory OPFS (the slice the doc-pool helpers touch) ----------

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    // Plain object, no Blob — getPoolDoc touches only .size and
    // .arrayBuffer(), and jsdom's Blob rejects cross-realm buffers.
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
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      f = new MockFile(name); this.files.set(name, f)
    }
    return f
  }
  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      d = new MockDir(name); this.dirs.set(name, d)
    }
    return d
  }
  async removeEntry(name: string): Promise<void> {
    if (!(this.files.delete(name) || this.dirs.delete(name))) throw new DOMException('NotFoundError', 'NotFoundError')
  }
  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [n, f] of this.files) yield [n, f]
    for (const [n, d] of this.dirs) yield [n, d]
  }
}

const sha256Hex = async (s: string): Promise<string> => {
  const b = new TextEncoder().encode(s)
  const h = await crypto.subtle.digest('SHA-256', b.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, '0')).join('')
}

const HIVES_MEANING = 'hives:names'

/** A hive entry record: name → sealed head. NOTHING ELSE — no lineage. */
type HiveEntry = { name: string; head: string }
const encode = (e: HiveEntry): ArrayBuffer => new TextEncoder().encode(JSON.stringify(e)).buffer as ArrayBuffer
const decode = (b: ArrayBuffer): HiveEntry => JSON.parse(new TextDecoder().decode(b)) as HiveEntry

const HEAD_A = 'a'.repeat(64)
const HEAD_B = 'b'.repeat(64)

describe('hives:names — the entry shape uses no lineage sigbags', () => {

  let root: MockDir
  let pool: MockDir

  beforeAll(async () => {
    const mod = await import('../../../../hypercomb-shared/core/store.js')
    StoreClass = mod.Store as unknown as StoreStatics
    store = new (mod.Store as unknown as new () => StoreLike)()
  })

  beforeEach(async () => {
    root = new MockDir()
    pool = await root.getDirectoryHandle(await StoreClass.poolSignature(HIVES_MEANING), { create: true })
  })

  it('no location can ever mint the pool address (colon rule)', async () => {
    const poolSig = await StoreClass.poolSignature(HIVES_MEANING)
    // Adversarial names a user might type at the root — including the
    // meaning string itself. lineageKey folds ':' to '-', so every one
    // hashes elsewhere.
    for (const name of ['hives:names', 'hives names', 'hives', 'hives-names']) {
      expect(await sha256Hex(lineageKey([name])), name).not.toBe(poolSig)
    }
  })

  it('entry = name → head via the real document-pool helpers; update keeps ONE current', async () => {
    const name = "Dylan's Cigar hive"
    const sig1 = await store.putPoolDoc(pool, encode({ name, head: HEAD_A }), name)
    expect(sig1).toMatch(/^[a-f0-9]{64}$/)

    let entry = decode((await store.getPoolDoc(pool, name))!)
    expect(entry).toEqual({ name, head: HEAD_A })

    // Head moves (new seal) — same name, replaced record.
    await store.putPoolDoc(pool, encode({ name, head: HEAD_B }), name)
    entry = decode((await store.getPoolDoc(pool, name))!)
    expect(entry.head).toBe(HEAD_B)

    // Exactly one current member in the bucket.
    const bucket = await pool.getDirectoryHandle(await StoreClass.poolSignature(name), { create: false })
    expect([...bucket.files.keys()]).toHaveLength(1)
  })

  it("a hive named 'clipboard' cannot collide with the root sign('clipboard') pool", async () => {
    // Same 64-hex bucket NAME as the root pool — but nested one level
    // down, so it is a different directory. Position types it.
    await store.putPoolDoc(pool, encode({ name: 'clipboard', head: HEAD_A }), 'clipboard')

    const clipboardSig = await StoreClass.poolSignature('clipboard')
    expect(pool.dirs.has(clipboardSig)).toBe(true)   // bucket inside hives:names
    expect(root.dirs.has(clipboardSig)).toBe(false)  // root pool untouched
  })

  it('same hive met from two places = one bucket, one identity; two hives coexist', async () => {
    const dylan = "Dylan's Cigar hive"
    await store.putPoolDoc(pool, encode({ name: dylan, head: HEAD_A }), dylan)
    await store.putPoolDoc(pool, encode({ name: 'Revolucion', head: HEAD_B }), 'Revolucion')

    // "Meeting places" don't exist in the reference — both reads are the
    // same bare name → head lookup, byte-identical.
    const viaFriends = decode((await store.getPoolDoc(pool, dylan))!)
    const viaHivesList = decode((await store.getPoolDoc(pool, dylan))!)
    expect(viaFriends).toEqual(viaHivesList)

    // The current-member drop is file-scoped: writing one hive never
    // removed the other's sub-bucket.
    expect(decode((await store.getPoolDoc(pool, 'Revolucion'))!).head).toBe(HEAD_B)
    expect(pool.dirs.size).toBe(2)
  })
})
