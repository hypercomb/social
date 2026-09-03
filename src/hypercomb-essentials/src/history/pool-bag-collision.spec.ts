// history/pool-bag-collision.spec.ts
//
// POOL / LINEAGE-BAG ADDRESS COLLISION — data-loss reproduction + guard.
//
// Pools of meaning and lineage sigbags share ONE flat OPFS root namespace:
//
//   pool address = sha256(meaning)                     (Store.poolSignature)
//   bag address  = sha256(lineageKey(segments))        (HistoryService.sign)
//
// `lineageKey` preserves letters and digits, so for a BARE-WORD meaning the
// two preimages are byte-identical and the two addresses ARE the same
// directory. A root tile named `clipboard` therefore commits its history
// markers INTO the sign('clipboard') pool — and `/flatten` at that location
// hard-deletes every sig-named member it finds there (the pool's contents).
//
// These tests drive the REAL HistoryService against an in-memory OPFS root,
// so they fail if the production guard is removed.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { lineageKey } from './lineage-key.js'
import { BARE_WORD_POOL_MEANINGS, SCOPED_POOL_MEANINGS } from '@hypercomb/core'

// The service module self-registers into `window.ioc` at import time, so the
// shell globals it expects must exist BEFORE the import is evaluated.
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
  }
})

type HistoryServiceCtor = new () => {
  purgeNonLayerFiles(sig: string): Promise<void>
  commitLayer(sig: string, layer: { name: string; children?: string[] }): Promise<string>
  removeLineageBag(sig: string): Promise<boolean>
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
}

// -------------------------------------------------
// helpers
// -------------------------------------------------

const sha256Hex = async (s: string): Promise<string> => {
  const bytes = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** sign(meaning) — byte-for-byte what Store.poolSignature computes. */
const poolSignature = (meaning: string): Promise<string> => sha256Hex(meaning)

/** The bag address for a location path — what HistoryService.sign computes. */
const bagSignature = (segments: string[]): Promise<string> => sha256Hex(lineageKey(segments))

const write = async (dir: MockDir, name: string, text: string): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
}

const names = (dir: MockDir): string[] => [...dir.files.keys()].sort()

/** Every bare-word pool meaning live in the codebase today. */
const BARE_WORD_MEANINGS = BARE_WORD_POOL_MEANINGS

// -------------------------------------------------

describe('pool address / lineage bag address collision', () => {

  let root: MockDir

  beforeAll(async () => {
    HistoryService = (await import('./history.service.js')).HistoryService as unknown as HistoryServiceCtor
  })

  beforeEach(() => {
    root = new MockDir()
    // HistoryService reads its OPFS root from IoC via the ambient `get`.
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store' ? { hypercombRoot: root, opfsRoot: root } : undefined
  })

  it('a bare-word pool meaning hashes to the SAME address as a same-named root tile', async () => {
    for (const meaning of BARE_WORD_MEANINGS) {
      expect(await poolSignature(meaning), meaning).toBe(await bagSignature([meaning]))
    }
  })

  it('a meaning carrying a colon can NEVER be produced by a location', async () => {
    for (const meaning of SCOPED_POOL_MEANINGS) {
      expect(await poolSignature(meaning), meaning).not.toBe(await bagSignature([meaning]))
    }
  })

  // ---- the data-loss path ----------------------------------------

  it('/flatten must NOT destroy sig-named pool members sharing a bag address', async () => {
    const address = await poolSignature('clipboard')
    expect(address).toBe(await bagSignature(['clipboard']))

    // The user's real clipboard pool: sig-named members.
    const pool = await root.getDirectoryHandle(address, { create: true })
    const members = [
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
    ]
    for (const m of members) await write(pool, m, `clipboard payload ${m.slice(0, 4)}`)

    // Committing at a root tile named `clipboard` lands markers in the
    // very same directory (HistoryService.getBag opens it `create: true`).
    await write(pool, '00000000', JSON.stringify({ name: 'clipboard' }))
    await write(pool, '00000001', JSON.stringify({ name: 'clipboard', children: [] }))

    const history = new HistoryService()
    await history.purgeNonLayerFiles(address)

    // The markers may be reshaped, but the user's pool must survive.
    for (const m of members) {
      expect(names(pool), `pool member ${m.slice(0, 4)} was destroyed`).toContain(m)
    }
  })

  it('a genuinely polluted lineage bag has its MARKERS cleaned', async () => {
    // Same shape, but NOT a pool address — /flatten must keep working.
    const address = await bagSignature(['some-ordinary-tile'])
    const bag = await root.getDirectoryHandle(address, { create: true })
    await write(bag, '00000000', JSON.stringify({ name: 'some-ordinary-tile' }))
    await write(bag, '00000001', 'a'.repeat(64))  // pre-merkle bare-sig marker
    await write(bag, '00000002', 'not json at all')

    const history = new HistoryService()
    await history.purgeNonLayerFiles(address)

    expect(names(bag)).toEqual(['00000000'])
  })

  // 2026-09-02 — a deliberate narrowing, not a regression. Purge used to drop
  // every non-marker file in a bag as "pre-merkle pollution". Under the
  // molecule model a 64-hex file inside a sig-named directory is
  // INDISTINGUISHABLE from a pool member or a succession atom: same name
  // shape, same "not a v2 layer" content. The registry guard above cannot
  // save them either, because a molecule address is minted by anyone typing
  // a word and no registry can enumerate it.
  //
  // Leaving them is inert — every reader (listLayers, #scanLatestMarker,
  // refreshLineageCache) already filters by marker shape. Deleting them was
  // the only irreversible option on the table.
  // See documentation/hypergraph-molecule-lineage.md.
  it('leaves non-marker files alone, even in an ordinary tile\'s bag', async () => {
    const address = await bagSignature(['another-ordinary-tile'])
    const bag = await root.getDirectoryHandle(address, { create: true })
    await write(bag, '00000000', JSON.stringify({ name: 'another-ordinary-tile' }))
    await write(bag, 'notes.txt', 'stray junk')
    await write(bag, '0'.repeat(64), 'could be pollution — could be a member')

    const history = new HistoryService()
    await history.purgeNonLayerFiles(address)

    expect(names(bag)).toEqual(['00000000', '0'.repeat(64), 'notes.txt'].sort())
  })

  // removeLineageBag is the OTHER hard delete, and it is recursive. Its
  // registry guard (isPoolAddress) only recognises meanings a module
  // registered — which is exactly the address that CANNOT be registered under
  // the molecule model, since any participant mints one by typing a word.
  // The structural guard is what covers it: THE ENTRY DECIDES. A directory is
  // removable only when every entry in it is a marker.
  // See hypercomb-core/src/core/directory-safety.ts.
  describe('removeLineageBag — the entry decides, never the directory', () => {
    it('removes a pure lineage bag: every entry is the caller\'s own marker', async () => {
      const address = await bagSignature(['a-tile-with-only-history'])
      const bag = await root.getDirectoryHandle(address, { create: true })
      await write(bag, '00000000', JSON.stringify({ name: 'a-tile-with-only-history' }))
      await write(bag, '00000001', JSON.stringify({ name: 'a-tile-with-only-history' }))

      const history = new HistoryService()
      expect(await history.removeLineageBag(address)).toBe(true)
      expect([...root.dirs.keys()]).not.toContain(address)
    })

    it('REFUSES an unregistered MOLECULE address holding another participant\'s head bucket', async () => {
      // `people` is an ordinary tile name — no registry knows it. Its bag
      // address is also the molecule, and the molecule holds per-author head
      // buckets. A recursive remove here destroys other people's history.
      const address = await bagSignature(['people'])
      const bag = await root.getDirectoryHandle(address, { create: true })
      await write(bag, '00000000', JSON.stringify({ name: 'people' }))
      const bucket = await bag.getDirectoryHandle('b'.repeat(64), { create: true })
      await write(bucket, 'c'.repeat(64), 'another author\'s succession head')

      const history = new HistoryService()
      expect(await history.removeLineageBag(address)).toBe(false)
      expect([...root.dirs.keys()]).toContain(address)
      expect([...bag.dirs.keys()]).toContain('b'.repeat(64))
    })

    it('REFUSES a bag holding sig-named member files', async () => {
      const address = await bagSignature(['a-tile-that-is-also-a-pool'])
      const bag = await root.getDirectoryHandle(address, { create: true })
      await write(bag, '00000000', JSON.stringify({ name: 'a-tile-that-is-also-a-pool' }))
      await write(bag, 'd'.repeat(64), 'somebody\'s member')

      const history = new HistoryService()
      expect(await history.removeLineageBag(address)).toBe(false)
      expect(names(bag)).toContain('d'.repeat(64))
    })

    it('REFUSES a bag holding an unrecognised entry — unknown provenance is not yours', async () => {
      const address = await bagSignature(['a-tile-with-a-stray'])
      const bag = await root.getDirectoryHandle(address, { create: true })
      await write(bag, '00000000', JSON.stringify({ name: 'a-tile-with-a-stray' }))
      await write(bag, 'notes.txt', 'who put this here')

      const history = new HistoryService()
      expect(await history.removeLineageBag(address)).toBe(false)
    })
  })

  it('purge at the ROOT lineage keeps canonical markers (root layer name is empty)', async () => {
    // The ROOT bag is sha256('') and its canonical layer signs as EMPTY
    // ({"name":"",...} — EMPTY_LAYER_CONTENT). Regression: the keep-test
    // once required a NON-EMPTY name and knew nothing of pointer records,
    // so a purge at the root dropped every real marker (verified live:
    // listLayers(rootSig) → 1 marker, purge → 0).
    const address = await bagSignature([])
    const bag = await root.getDirectoryHandle(address, { create: true })
    // Legacy inline shape: the root layer itself, name ''.
    await write(bag, '00000000', JSON.stringify({ name: '', children: [] }))
    // Modern pointer shape — what commitLayer writes.
    await write(bag, '00000001', JSON.stringify({ layer: 'd'.repeat(64) }))
    // Pre-merkle bare-sig marker — must still drop, even at the root.
    await write(bag, '00000002', 'e'.repeat(64))

    const history = new HistoryService()
    await history.purgeNonLayerFiles(address)

    expect(names(bag)).toEqual(['00000000', '00000001'])
  })

  it('repairs a legacy empty-content FILE blocking the root lineage DIRECTORY', async () => {
    const rootSig = await bagSignature([])
    const collision = await root.getFileHandle(rootSig, { create: true })
    expect((await collision.getFile()).size).toBe(0)

    const history = new HistoryService()
    await expect(history.commitLayer(rootSig, { name: '', children: ['a'.repeat(64)] })).resolves.toMatch(/^[0-9a-f]{64}$/)

    expect(root.files.has(rootSig)).toBe(false)
    const bag = await root.getDirectoryHandle(rootSig, { create: false })
    expect(names(bag)).toEqual(['00000000', '00000001'])
  })
})
