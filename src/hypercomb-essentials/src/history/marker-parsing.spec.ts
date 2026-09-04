// history/marker-parsing.spec.ts
//
// EVERY MARKER SCAN, DRIVEN AGAINST A BAG THAT SHARES ITS ADDRESS WITH A POOL.
//
// The root cause of this whole family is `parseInt`, not a missing regex.
// `parseInt('99999999ab3f…', 10)` returns the PREFIX 99999999 — it stops at
// the first non-digit — so pairing it with an `isNaN` reject is exactly the
// check its prefix semantics defeats. `Number` of the same name is NaN.
//
// The consequences, all reproduced below:
//   * `replay` read a pool member as a HistoryOp, and with `upTo` set a member
//     that parsed HIGH broke the loop early and truncated the replay.
//   * `head` picked the head by raw string max, which does not merely tolerate
//     members but PREFERS them ('00abc' > '00000012').
//   * `list` counted every file as a revision.
//   * the minters turned a member's prefix into `String(100000000)
//     .padStart(8, '0')` — nine digits, which /^\d{8}$/ then rejects forever.
//
// These drive the REAL HistoryService against an in-memory OPFS root, so they
// fail if the production guards are removed.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { MARKER_CEILING, classifyDirectoryEntry, markerName } from '@hypercomb/core'
import { lineageKey } from './lineage-key.js'

vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>)['get'] = () => undefined
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
  }
})

type HistoryServiceCtor = new () => {
  commitLayer(sig: string, layer: { name: string; children?: string[] }): Promise<string>
  replay(sig: string, upTo?: number): Promise<unknown[]>
  head(sig: string): Promise<{ index: number; op: unknown } | null>
  list(): Promise<{ signature: string; count: number }[]>
  removeEntries(sig: string, filenames: string[]): Promise<number>
  listLayers(sig: string): Promise<{ filename: string }[]>
}
let HistoryService: HistoryServiceCtor

// ── the in-memory OPFS slice HistoryService touches ────────────────────────

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  lastModified = 1
  constructor(public name: string) {}
  async getFile(): Promise<File> {
    const slice = this.bytes.buffer.slice(
      this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength,
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

const sha256Hex = async (s: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}
const bagSignature = (segments: string[]): Promise<string> => sha256Hex(lineageKey(segments))

const write = async (dir: MockDir, name: string, text: string): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
}

/** THE EXACT FAILING INPUT: a 64-hex name beginning with eight digits. */
const DIGIT_LEADING_SIG = '99999999ab3f4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5'
/** A milder one — `parseInt` yields 4, so it silently becomes op index 4. */
const LOW_DIGIT_SIG = '4d0f8a11bbbb0000cccc1111dddd2222eeee3333ffff4444aaaa5555bbbb6666'

describe('the failing input itself', () => {
  it('parseInt returns the PREFIX where Number returns NaN', () => {
    expect(parseInt(DIGIT_LEADING_SIG, 10)).toBe(99999999)
    expect(Number(DIGIT_LEADING_SIG)).toBeNaN()
    expect(parseInt(LOW_DIGIT_SIG, 10)).toBe(4)
    expect(Number(LOW_DIGIT_SIG)).toBeNaN()
  })

  it('a raw string max PREFERS a member over every realistic marker', () => {
    expect(LOW_DIGIT_SIG > '00000012').toBe(true)
    expect(DIGIT_LEADING_SIG > '99999999').toBe(true)
  })

  it('the marker minted from that prefix is out of range and unreadable', () => {
    expect(String(99999999 + 1).padStart(8, '0')).toBe('100000000')
    expect(classifyDirectoryEntry('100000000')).toBe('foreign')
    expect(markerName(MARKER_CEILING + 1)).toBeNull()
  })
})

describe('HistoryService marker scans, at a colliding address', () => {
  let root: MockDir
  let address: string
  let bag: MockDir

  beforeAll(async () => {
    HistoryService = (await import('./history.service.js')).HistoryService as unknown as HistoryServiceCtor
  })

  beforeEach(async () => {
    root = new MockDir()
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store' ? { hypercombRoot: root, opfsRoot: root } : undefined

    // A tile named `bees` — which is also sign('bees'), a live bare-word pool.
    address = await bagSignature(['bees'])
    bag = await root.getDirectoryHandle(address, { create: true })

    // Three real markers of this tile's own history…
    await write(bag, '00000000', JSON.stringify({ name: 'bees' }))
    await write(bag, '00000001', JSON.stringify({ name: 'bees', children: [] }))
    await write(bag, '00000002', JSON.stringify({ name: 'bees', children: [] }))
    // …sharing the directory with somebody else's members, one of which is
    // JSON (so it would parse) and one of which is not.
    await write(bag, DIGIT_LEADING_SIG, JSON.stringify({ name: 'a molecule atom' }))
    await write(bag, LOW_DIGIT_SIG, 'not json at all')
    // …and an author bucket.
    await bag.getDirectoryHandle('a'.repeat(64), { create: true })
  })

  it('replay reads the markers only — never a pool member', async () => {
    const ops = await (new HistoryService()).replay(address)
    expect(ops).toHaveLength(3)
    for (const op of ops) expect((op as { name?: string }).name).toBe('bees')
  })

  it('a bounded replay is not truncated by a member that sorts before the markers', async () => {
    // `entries.sort()` puts '00000000' first, but a digit-leading member can
    // parse HIGH — and the unguarded `index > upTo` break then returned zero
    // ops for a perfectly ordinary request.
    const ops = await (new HistoryService()).replay(address, 1)
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.length).toBeLessThanOrEqual(2)
  })

  it('head is the highest MARKER, not the highest name', async () => {
    const head = await (new HistoryService()).head(address)
    expect(head).not.toBeNull()
    expect(head?.index).toBe(2)
    expect((head?.op as { name?: string }).name).toBe('bees')
  })

  it('list counts revisions, not files', async () => {
    const listed = await (new HistoryService()).list()
    const row = listed.find(r => r.signature === address)
    expect(row?.count).toBe(3)
  })

  it('committing here mints an in-range 8-digit marker, never nine', async () => {
    const history = new HistoryService()
    await history.commitLayer(address, { name: 'bees', children: [] })
    const minted = [...bag.files.keys()].filter(n => classifyDirectoryEntry(n) === 'marker')
    for (const name of minted) expect(name).toMatch(/^\d{8}$/)
    expect(minted).toContain('00000003')
    expect([...bag.files.keys()].some(n => n.length === 9)).toBe(false)
  })

  it('the members and the author bucket are still there after a commit', async () => {
    await (new HistoryService()).commitLayer(address, { name: 'bees', children: [] })
    expect([...bag.files.keys()]).toContain(DIGIT_LEADING_SIG)
    expect([...bag.files.keys()]).toContain(LOW_DIGIT_SIG)
    expect([...bag.dirs.keys()]).toContain('a'.repeat(64))
  })

  it('removeEntries refuses a name that is not a marker', async () => {
    const history = new HistoryService()
    expect(await history.removeEntries(address, [DIGIT_LEADING_SIG])).toBe(0)
    expect([...bag.files.keys()]).toContain(DIGIT_LEADING_SIG)
    // …and still removes a real marker, so the primitive is not just broken.
    expect(await history.removeEntries(address, ['00000000'])).toBe(1)
    expect([...bag.files.keys()]).not.toContain('00000000')
  })

  it('listLayers offers marker filenames only', async () => {
    const layers = await (new HistoryService()).listLayers(address)
    for (const entry of layers) expect(entry.filename).toMatch(/^\d{8}$/)
  })
})
