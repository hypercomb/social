// hypercomb-runtime/src/store.pool-doc.spec.ts
//
// DOCUMENT POOLS KEEP THEIR HISTORY (documentation/layer-pattern-audit.md, A1).
//
// `putPoolDoc` used to write the new document and then remove every other
// member, so the pool held exactly one and every earlier version was gone.
// Now each version is an immutable atom, a numbered marker (core's one marker
// writer) names the current one, and nothing is ever removed. These specs
// drive the REAL Store against an in-memory directory and count every
// removeEntry, so "nothing is removed" is measured rather than assumed.

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
let store: StoreLike
let StoreClass: StoreStatics

// ---- in-memory directory: the slice the document-pool helpers touch ----

let removals = 0

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
    removals++
    if (!(this.files.delete(name) || this.dirs.delete(name))) throw new DOMException(`${name} not found`, 'NotFoundError')
  }
  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [n, f] of [...this.files]) yield [n, f]
    for (const [n, d] of [...this.dirs]) yield [n, d]
  }
  put(name: string, text: string): void {
    const f = new MockFile(name)
    f.bytes = new TextEncoder().encode(text)
    this.files.set(name, f)
  }
}

const SIG = /^[a-f0-9]{64}$/
const MARKER = /^\d{8}$/
const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer
const textOf = (buf: ArrayBuffer | null): string | null => buf ? new TextDecoder().decode(buf) : null
const sha256 = async (text: string): Promise<string> => {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}
const atoms = (dir: MockDir): string[] => [...dir.files.keys()].filter(n => SIG.test(n)).sort()
const markers = (dir: MockDir): string[] => [...dir.files.keys()].filter(n => MARKER.test(n)).sort()
const markerTarget = (dir: MockDir, name: string): string =>
  (JSON.parse(new TextDecoder().decode(dir.files.get(name)!.bytes)) as { layer: string }).layer

/** A colon-scoped document pool at the root, its meaning registered by
 *  derivation exactly as `Store.getPool` registers it. */
const colonPool = async (meaning: string): Promise<MockDir> =>
  new MockDir(await StoreClass.poolSignature(meaning))

beforeAll(async () => {
  const mod = await import('./store')
  StoreClass = mod.Store as unknown as StoreStatics
  store = new (mod.Store as unknown as new () => StoreLike)()
})

describe('putPoolDoc — every version is kept, the max marker is current', () => {
  it('two different writes leave BOTH atoms and two markers; the head is the second', async () => {
    removals = 0
    const pool = await colonPool('spec:journal')
    const first = await store.putPoolDoc(pool, bytesOf('{"entries":["monday"]}'))
    const second = await store.putPoolDoc(pool, bytesOf('{"entries":["monday","tuesday"]}'))
    expect(first).toMatch(SIG)
    expect(second).toMatch(SIG)
    expect(second).not.toBe(first)

    expect(atoms(pool)).toEqual([first!, second!].sort())
    expect(markers(pool)).toEqual(['00000000', '00000001'])
    expect(markerTarget(pool, '00000000')).toBe(first)
    expect(markerTarget(pool, '00000001')).toBe(second)
    expect(textOf(await store.getPoolDoc(pool))).toBe('{"entries":["monday","tuesday"]}')
    expect(removals).toBe(0)
  })

  it('re-writing the bytes that are already current adds no marker', async () => {
    removals = 0
    const pool = await colonPool('spec:palette')
    const a = await store.putPoolDoc(pool, bytesOf('"red"'))
    expect(await store.putPoolDoc(pool, bytesOf('"red"'))).toBe(a)
    expect(markers(pool)).toEqual(['00000000'])

    // A change back to an EARLIER version is a new item in place of the
    // current one: one more marker, the atom shared, nothing removed.
    const b = await store.putPoolDoc(pool, bytesOf('"blue"'))
    expect(await store.putPoolDoc(pool, bytesOf('"red"'))).toBe(a)
    expect(markers(pool)).toEqual(['00000000', '00000001', '00000002'])
    expect([markerTarget(pool, '00000001'), markerTarget(pool, '00000002')]).toEqual([b, a])
    expect(atoms(pool)).toEqual([a!, b!].sort())
    expect(textOf(await store.getPoolDoc(pool))).toBe('"red"')
    expect(removals).toBe(0)
  })

  it('two racing writes both land: the second takes the next marker name', async () => {
    removals = 0
    const pool = await colonPool('spec:race')
    const [x, y] = await Promise.all([
      store.putPoolDoc(pool, bytesOf('"x"'), 'doc'),
      store.putPoolDoc(pool, bytesOf('"y"'), 'doc'),
    ])
    expect(x).toMatch(SIG)
    expect(y).toMatch(SIG)
    const bucket = await pool.getDirectoryHandle(await StoreClass.poolSignature('doc'))
    expect(markers(bucket)).toEqual(['00000000', '00000001'])
    expect([markerTarget(bucket, '00000000'), markerTarget(bucket, '00000001')].sort()).toEqual([x!, y!].sort())
    expect(removals).toBe(0)
  })
})

describe('getPoolDoc — head first, the old shape still reads', () => {
  it('a pool holding only an old-style member (no marker) still reads, and the next write marks beside it', async () => {
    removals = 0
    const pool = await colonPool('spec:legacy')
    const bucket = await pool.getDirectoryHandle(await StoreClass.poolSignature('en'), { create: true })
    const oldText = '{"hello":"hi"}'
    const oldSig = await sha256(oldText)
    bucket.put(oldSig, oldText)

    expect(textOf(await store.getPoolDoc(pool, 'en'))).toBe(oldText)

    const next = await store.putPoolDoc(pool, bytesOf('{"hello":"hello"}'), 'en')
    expect(markers(bucket)).toEqual(['00000000'])
    expect(markerTarget(bucket, '00000000')).toBe(next)
    expect(atoms(bucket)).toEqual([oldSig, next!].sort())   // the old document is kept, not migrated
    expect(textOf(await store.getPoolDoc(pool, 'en'))).toBe('{"hello":"hello"}')
    expect(removals).toBe(0)
  })

  it('subKey buckets are independent: each has its own atoms, markers and head', async () => {
    removals = 0
    const pool = await colonPool('spec:locales')
    await store.putPoolDoc(pool, bytesOf('"en-1"'), 'en')
    await store.putPoolDoc(pool, bytesOf('"ja-1"'), 'ja')
    await store.putPoolDoc(pool, bytesOf('"en-2"'), 'en')

    const en = await pool.getDirectoryHandle(await StoreClass.poolSignature('en'))
    const ja = await pool.getDirectoryHandle(await StoreClass.poolSignature('ja'))
    expect(markers(en)).toEqual(['00000000', '00000001'])
    expect(markers(ja)).toEqual(['00000000'])
    expect(atoms(en)).toHaveLength(2)
    expect(atoms(ja)).toHaveLength(1)
    expect(textOf(await store.getPoolDoc(pool, 'en'))).toBe('"en-2"')
    expect(textOf(await store.getPoolDoc(pool, 'ja'))).toBe('"ja-1"')
    expect([...pool.files.keys()]).toEqual([])                 // nothing at the pool level
    expect(await store.getPoolDoc(pool, 'fr')).toBeNull()
    expect(removals).toBe(0)
  })
})

describe('a space that is not provably the caller\'s gets no marker', () => {
  it('a molecule address (an unregistered bare word) receives no marker and loses nothing', async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    // sign('people') as a participant mints it by typing a word: nobody
    // registered it, and it holds someone's lineage and gathered members.
    const molecule = new MockDir(await sha256('people'))
    const rootLayer = 'e'.repeat(64)
    molecule.put('00000000', JSON.stringify({ layer: rootLayer }))
    const theirs = await sha256('{"member":"theirs"}')
    molecule.put(theirs, '{"member":"theirs"}')

    const sig = await store.putPoolDoc(molecule, bytesOf('{"mine":true}'))
    expect(sig).toMatch(SIG)
    expect(markers(molecule)).toEqual(['00000000'])            // their lineage did not advance
    expect(markerTarget(molecule, '00000000')).toBe(rootLayer)
    expect(atoms(molecule)).toEqual([sig!, theirs].sort())     // their member is untouched
    // Their head names a layer at the root, not a document here, so the read
    // falls back to a member — never to the marker's own bytes.
    const read = textOf(await store.getPoolDoc(molecule))
    expect(['{"member":"theirs"}', '{"mine":true}']).toContain(read)
    expect(removals).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a registered BARE-WORD pool receives no marker either', async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const bare = new MockDir(await StoreClass.poolSignature('viewport'))
    await store.putPoolDoc(bare, bytesOf('{"x":1}'))
    await store.putPoolDoc(bare, bytesOf('{"x":2}'))
    expect(markers(bare)).toEqual([])
    expect(atoms(bare)).toHaveLength(2)                        // kept, not swept
    expect(removals).toBe(0)
    warn.mockRestore()
  })

  it('a proven space whose markers name nothing held here is a stranger\'s lineage — no marker is added', async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const pool = await colonPool('spec:foreign')
    const bucket = await pool.getDirectoryHandle(await StoreClass.poolSignature('k'), { create: true })
    bucket.put('00000000', JSON.stringify({ layer: 'f'.repeat(64) }))

    const sig = await store.putPoolDoc(pool, bytesOf('"doc"'), 'k')
    expect(sig).toMatch(SIG)
    expect(markers(bucket)).toEqual(['00000000'])
    expect(atoms(bucket)).toEqual([sig!])
    expect(removals).toBe(0)
    warn.mockRestore()
  })

  it('an author bucket inside the target refuses the marker, exactly as it refused the sweep', async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const pool = await colonPool('spec:buckets')
    await pool.getDirectoryHandle('a'.repeat(64), { create: true })
    await store.putPoolDoc(pool, bytesOf('"doc"'))
    expect(markers(pool)).toEqual([])
    expect(removals).toBe(0)
    warn.mockRestore()
  })
})

describe("{ keep: 'current' } — what the software writes on its own is not a save", () => {
  // "Saves never happen without human intent" (jwize, 2026-10-03): a write
  // nobody chose to make keeps only the current document, the shape every
  // pool had before 2026-10-01.
  const CURRENT = { keep: 'current' as const }

  it('leaves exactly one atom and no marker, and reads it back', async () => {
    const pool = await colonPool('spec:checkpoint')
    await store.putPoolDoc(pool, bytesOf('"one"'), undefined, CURRENT)
    const last = await store.putPoolDoc(pool, bytesOf('"two"'), undefined, CURRENT)
    expect(atoms(pool)).toEqual([last!])
    expect(markers(pool)).toEqual([])
    expect(textOf(await store.getPoolDoc(pool))).toBe('"two"')
  })

  it('clears the versions an earlier keep-everything write left in its own space', async () => {
    const pool = await colonPool('spec:working-state')
    await store.putPoolDoc(pool, bytesOf('"a"'), 'k')
    await store.putPoolDoc(pool, bytesOf('"b"'), 'k')
    const bucket = await pool.getDirectoryHandle(await StoreClass.poolSignature('k'))
    expect(markers(bucket)).toHaveLength(2)
    const c = await store.putPoolDoc(pool, bytesOf('"c"'), 'k', CURRENT)
    expect(atoms(bucket)).toEqual([c!])
    expect(markers(bucket)).toEqual([])
    expect(textOf(await store.getPoolDoc(pool, 'k'))).toBe('"c"')
  })

  it("removes nothing where the space is not provably the caller's", async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const molecule = new MockDir(await sha256('neighbours'))
    const theirs = await sha256('{"member":"theirs"}')
    molecule.put(theirs, '{"member":"theirs"}')
    const mine = await store.putPoolDoc(molecule, bytesOf('{"mine":true}'), undefined, CURRENT)
    expect(atoms(molecule)).toEqual([mine!, theirs].sort())
    expect(removals).toBe(0)
    warn.mockRestore()
  })

  it('removes nothing beside an author bucket or a foreign name', async () => {
    removals = 0
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const pool = await colonPool('spec:shared-space')
    pool.put('b'.repeat(64), '"older"')
    pool.put('notes.txt', 'not ours')
    await store.putPoolDoc(pool, bytesOf('"newer"'), undefined, CURRENT)
    expect(pool.files.has('b'.repeat(64))).toBe(true)
    expect(removals).toBe(0)
    warn.mockRestore()
  })
})
