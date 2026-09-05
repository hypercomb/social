// history/prune-reference-blindness.spec.ts
//
// PRUNE IS BLIND TO EVERY REFERENCE THAT IS NOT A MARKER.
//
// `HistoryService.referencesOutside` is the ONE authority prune consults
// before `removeContentSigs` hard-deletes `<root>/<sig>`. `enumerateBags` was
// fixed to visit EVERY sig-named root directory (no registry skip), but the
// walk inside each one still reads only MARKER files:
//
//     if (handle.kind !== 'file') continue          ← every sub-directory
//     if (!MARKER_RE.test(name)) continue           ← every pool member
//
// So two whole classes of live reference are invisible to it:
//
//   1. A POOL MEMBER. A member's BYTES may name a content sig (a background
//      record naming its picture, a comfy generation naming its image, a
//      clipboard entry naming a copied visual), and a member's NAME may BE a
//      content sig — that is exactly the shape `SubstrateService.addReference`
//      writes: an EMPTY file named by the image's signature, whose own doc
//      comment says "the image bytes at the root are content, possibly
//      referenced from tiles or other collections". Prune never reads either.
//
//   2. AN AUTHOR BUCKET. Under the molecule direction a name's molecule holds
//      `sign(name)/<pubkey>/<sha256(headClaim)>` — another participant's
//      succession, one directory level down. `kind !== 'file'` skips the whole
//      bucket, so every atom only THEY reference is unreferenced to us.
//
// The packed collector already got this right — `packed-collect.ts` walks
// `engine.pools()` "because they may REFERENCE content — a clipboard entry
// naming a copied image, for one. Their referents must survive." The OPFS
// prune path does not, and it is the one that deletes a participant's bytes.
//
// These tests drive the REAL HistoryService against an in-memory OPFS root.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
  }
})

type HistoryServiceCtor = new () => {
  referencesOutside(
    locationSig: string,
    candidates: readonly string[],
  ): Promise<{ found: Set<string>; authoritative: boolean }>
}
let HistoryService: HistoryServiceCtor

// -------------------------------------------------
// in-memory OPFS (the slice HistoryService touches)
// -------------------------------------------------

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  lastModified = 1
  constructor(public name: string) {}

  async getFile(): Promise<File> {
    const slice = this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer
    return Object.assign(new Blob([slice]), {
      lastModified: this.lastModified,
      name: this.name,
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(slice)),
    }) as unknown as File
  }

  async createWritable() {
    return {
      write: async (chunk: ArrayBuffer | Uint8Array | string) => {
        this.bytes = typeof chunk === 'string'
          ? new TextEncoder().encode(chunk)
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
  constructor(public name: string = '') {}

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<MockFile> {
    if (this.dirs.has(name)) throw new DOMException('Type mismatch', 'TypeMismatchError')
    let h = this.files.get(name)
    if (!h) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      h = new MockFile(name)
      this.files.set(name, h)
    }
    return h
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
    if (this.files.has(name)) throw new DOMException('Type mismatch', 'TypeMismatchError')
    let d = this.dirs.get(name)
    if (!d) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      d = new MockDir(name)
      this.dirs.set(name, d)
    }
    return d
  }

  async removeEntry(name: string): Promise<void> {
    const hit = this.files.delete(name) || this.dirs.delete(name)
    if (!hit) throw new DOMException('NotFoundError', 'NotFoundError')
  }

  async *entries(): AsyncIterable<[string, MockFile | MockDir]> {
    for (const [n, h] of this.files) yield [n, h]
    for (const [n, d] of this.dirs) yield [n, d]
  }

  async *keys(): AsyncIterable<string> {
    for (const n of this.files.keys()) yield n
    for (const n of this.dirs.keys()) yield n
  }
}

const write = async (dir: MockDir, name: string, text: string): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
}

/** A distinct 64-hex address per seed. */
const addr = (seed: string): string =>
  seed.repeat(64).slice(0, 64)

describe('prune reference-blindness', () => {
  let root: MockDir

  beforeAll(async () => {
    HistoryService = (await import('./history.service.js')).HistoryService as unknown as HistoryServiceCtor
  })

  beforeEach(() => {
    root = new MockDir()
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store' ? { hypercombRoot: root, opfsRoot: root } : undefined
  })

  it('sees a reference held in a MARKER (the case that already works)', async () => {
    const picture = addr('a')
    const otherBag = await root.getDirectoryHandle(addr('1'), { create: true })
    await write(otherBag, '00000000', JSON.stringify({ layer: picture }))

    const history = new HistoryService()
    const { found } = await history.referencesOutside(addr('2'), [picture])
    expect([...found]).toContain(picture)
  })

  it('sees a reference NAMED by a pool member — the substrate references shape', async () => {
    // SubstrateService.addReference: `pool.getFileHandle(signature, {create:true})`
    // — an EMPTY file whose NAME is the image's content signature. The image
    // bytes live at `<root>/<sig>`. Nothing else on disk names that sig, so a
    // prune of the tile the image came from deletes the collection's picture.
    const picture = addr('a')
    await write(root, picture, 'the image bytes')          // <root>/<sig>
    const references = await root.getDirectoryHandle(addr('3'), { create: true })
    await write(references, picture, '')                    // the reference marker

    const history = new HistoryService()
    const { found } = await history.referencesOutside(addr('2'), [picture])
    expect(
      [...found],
      'a pool member NAMED by a content sig is a live reference — prune must not delete it',
    ).toContain(picture)
  })

  it('sees a reference held in a pool member\'s BYTES', async () => {
    // `backgrounds:screen`, `comfy:generations`, the clipboard: a member is a
    // record that NAMES content. The packed collector reads exactly these.
    const picture = addr('b')
    const pool = await root.getDirectoryHandle(addr('4'), { create: true })
    await write(pool, addr('5'), JSON.stringify({ picture, wash: 0.4 }))

    const history = new HistoryService()
    const { found } = await history.referencesOutside(addr('2'), [picture])
    expect(
      [...found],
      'a pool member whose bytes name a sig is a live reference',
    ).toContain(picture)
  })

  it('sees a reference held one level down, in another author\'s bucket', async () => {
    // `sign(name)/<pubkey>/<sha256(headClaim)>` — the molecule shape from
    // documentation/hypergraph-molecule-lineage.md. `kind !== 'file'` skips
    // the bucket whole, so every atom only that author references reads as
    // unreferenced to us, and prune is licensed to delete it.
    const atom = addr('c')
    const molecule = await root.getDirectoryHandle(addr('6'), { create: true })
    await write(molecule, '00000000', JSON.stringify({ layer: addr('7') }))  // our own history
    const bucket = await molecule.getDirectoryHandle(addr('8'), { create: true })
    await write(bucket, addr('9'), JSON.stringify({ head: atom, seq: 3 }))

    const history = new HistoryService()
    const { found } = await history.referencesOutside(addr('2'), [atom])
    expect(
      [...found],
      "another author's head claim is a live reference — prune must not delete what it points at",
    ).toContain(atom)
  })

  it('an unreadable sub-directory must at least cost AUTHORITY', async () => {
    // Fail-closed fallback: if the walk will not read buckets, it may not
    // claim its answer is authoritative — `authoritative` is the only thing
    // standing between a partial view and an irreversible delete.
    const atom = addr('c')
    const molecule = await root.getDirectoryHandle(addr('6'), { create: true })
    const bucket = await molecule.getDirectoryHandle(addr('8'), { create: true })
    await write(bucket, addr('9'), JSON.stringify({ head: atom }))

    const history = new HistoryService()
    const { found, authoritative } = await history.referencesOutside(addr('2'), [atom])
    expect(
      found.has(atom) || !authoritative,
      'either the bucket is read, or the answer is not authoritative — never "clear to delete"',
    ).toBe(true)
  })
})
