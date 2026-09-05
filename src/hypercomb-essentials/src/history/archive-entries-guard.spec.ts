// history/archive-entries-guard.spec.ts
//
// `removeEntries` WAS HARDENED. `archiveEntries` — ITS TWIN — WAS NOT.
//
// The 2026-09 pass added this to `removeEntries`, with the reason in place:
//
//     // ARBITRARY CALLER-SUPPLIED NAMES, HARD-DELETED. The sole caller passes
//     // marker filenames, but nothing enforced it — and this bag's address may
//     // be a molecule's. A marker is the only thing this primitive owns.
//     if (classifyDirectoryEntry(filename) !== 'marker') { …refuse… }
//
// `archiveEntries` takes the identical argument — `(locationSig, filenames)` —
// from the identical surfaces (/flatten, /collapse-history, and now the
// history viewer's per-row delete), against the identical directory, and ends
// in `bag.removeEntry(filename)` with NO classification. It classifies names
// ONLY in the high-water loop above the removal, which skips non-markers for
// counting and then archives them anyway.
//
// `sign('clipboard')` is a bare word, so that bag's address IS the clipboard
// pool's. A filename that is not a marker is, by construction, not this
// primitive's to move: it is a pool member, an author bucket, or content.
// Soft-delete is not a licence either — the member is GONE FROM ITS POOL, and
// the pool is what the clipboard, the substrate reference set and the
// backgrounds collection each read to know what they hold.

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
  archiveEntries(locationSig: string, filenames: string[]): Promise<number>
}
let HistoryService: HistoryServiceCtor

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

const sha256Hex = async (s: string): Promise<string> => {
  const bytes = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const write = async (dir: MockDir, name: string, text: string): Promise<void> => {
  const h = await dir.getFileHandle(name, { create: true })
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
}

describe('archiveEntries owns markers, and nothing else', () => {
  let root: MockDir

  beforeAll(async () => {
    HistoryService = (await import('./history.service.js')).HistoryService as unknown as HistoryServiceCtor
  })

  beforeEach(() => {
    root = new MockDir()
    ;(globalThis as Record<string, unknown>)['get'] = (key: string) =>
      key === '@hypercomb.social/Store'
        ? {
            hypercombRoot: root,
            opfsRoot: root,
            getPool: async (meaning: string) =>
              root.getDirectoryHandle(await sha256Hex(meaning), { create: true }),
          }
        : undefined
  })

  it('archives a MARKER (the case it exists for)', async () => {
    const address = await sha256Hex('clipboard')
    const bag = await root.getDirectoryHandle(address, { create: true })
    await write(bag, '00000000', JSON.stringify({ layer: 'a'.repeat(64) }))

    const history = new HistoryService()
    expect(await history.archiveEntries(address, ['00000000'])).toBe(1)
    expect([...bag.files.keys()]).not.toContain('00000000')
  })

  it('refuses a pool MEMBER sharing the bag address', async () => {
    // A root tile named `clipboard` puts its markers in sign('clipboard') —
    // the participant's clipboard pool. The members there are not history.
    const address = await sha256Hex('clipboard')
    const shared = await root.getDirectoryHandle(address, { create: true })
    const member = 'b'.repeat(64)
    await write(shared, member, JSON.stringify({ label: 'a copied tile' }))
    await write(shared, '00000000', JSON.stringify({ layer: 'a'.repeat(64) }))

    const history = new HistoryService()
    await history.archiveEntries(address, [member])

    expect(
      [...shared.files.keys()],
      'a pool member is not a marker — archiveEntries must refuse it, exactly as removeEntries does',
    ).toContain(member)
  })

  it('refuses a foreign name outright', async () => {
    const address = await sha256Hex('clipboard')
    const shared = await root.getDirectoryHandle(address, { create: true })
    await write(shared, '__meta__', '{"items":[]}')
    await write(shared, '00000000', JSON.stringify({ layer: 'a'.repeat(64) }))

    const history = new HistoryService()
    await history.archiveEntries(address, ['__meta__'])

    expect([...shared.files.keys()]).toContain('__meta__')
  })
})
