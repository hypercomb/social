// diamondcoreprocessor.com/history/pool-bag-collision.spec.ts
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

type HistoryServiceCtor = new () => { purgeNonLayerFiles(sig: string): Promise<void> }
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
    let h = this.files.get(name)
    if (!h) {
      if (!opts.create) throw new DOMException('NotFoundError', 'NotFoundError')
      h = new MockFile(name)
      this.files.set(name, h)
    }
    return h
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<MockDir> {
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

  it('a genuinely polluted lineage bag is still cleaned', async () => {
    // Same shape, but NOT a pool address — /flatten must keep working.
    const address = await bagSignature(['some-ordinary-tile'])
    const bag = await root.getDirectoryHandle(address, { create: true })
    await write(bag, '00000000', JSON.stringify({ name: 'some-ordinary-tile' }))
    await write(bag, 'notes.txt', 'stray junk')
    await write(bag, '0'.repeat(64), 'pre-merkle sig pointer')

    const history = new HistoryService()
    await history.purgeNonLayerFiles(address)

    expect(names(bag)).toEqual(['00000000'])
  })
})
