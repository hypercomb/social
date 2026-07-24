// diamond-core-processor/src/app/core/hive-snapshot-lineage.spec.ts
//
// THE HIVE SNAPSHOT LINEAGE — proof that a named hive snapshot pushed up
// from hypercomb lands in its OWN lineage, distinct from the install
// history, and reads back by name.
//
// What these tests freeze:
//   1. `hive` and `home` are SEPARATE lineages — naming a content
//      snapshot never touches the install history, and vice versa. This
//      is the whole reason the lineage exists: "restore" must never be
//      ambiguous about whether it restores your TILES or your PACKAGES.
//   2. A snapshot is a POINTER — saveHiveSnapshot stores the seal sig and
//      a label; it never requires the closure's bytes to be present
//      (those arrive separately via the push queue's `intake`).
//   3. Auto-naming counts within the hive lineage only.
//   4. Garbage seals are refused rather than recorded, so the lineage
//      can never name something that isn't a signature.
//   5. Re-recording the same (seal, label) is idempotent — re-snapshotting
//      an unchanged hive does not grow the lineage.
//
// Drives the REAL DcpDomainStorage against an in-memory OPFS.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---- in-memory OPFS (the slice DcpDomainStorage touches) ------------

/** The service writes Blobs, Uint8Arrays and strings. jsdom's Blob has no
 *  usable `arrayBuffer()` here, so fall through to `text()` and finally
 *  FileReader — content in this lineage is UTF-8 JSON or a hex sig. */
async function toBytes(data: unknown): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return new Uint8Array(data)
  const blobish = data as { arrayBuffer?: () => Promise<ArrayBuffer>; text?: () => Promise<string> }
  if (typeof blobish?.arrayBuffer === 'function') return new Uint8Array(await blobish.arrayBuffer())
  if (typeof blobish?.text === 'function') return new TextEncoder().encode(await blobish.text())
  if (data instanceof Blob) {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(data)
    })
    return new TextEncoder().encode(text)
  }
  return new Uint8Array(0)
}

class MockFile {
  kind = 'file' as const
  bytes = new Uint8Array(0)
  constructor(public name: string) {}
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string>; size: number }> {
    const slice = this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer
    // Plain object, not a File — readers use `.arrayBuffer()` (content) and
    // `.text()` (marker sigs), and jsdom's File/Blob is unusable here.
    return {
      arrayBuffer: () => Promise.resolve(slice),
      text: () => Promise.resolve(new TextDecoder().decode(this.bytes)),
      size: this.bytes.byteLength,
    }
  }
  async createWritable(): Promise<{ write(d: unknown): Promise<void>; close(): Promise<void> }> {
    return {
      write: async (data: unknown) => {
        this.bytes = await toBytes(data)
      },
      close: async () => { /* committed on write */ },
    }
  }
}

class MockDir {
  kind = 'directory' as const
  children = new Map<string, MockDir | MockFile>()
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDir> {
    const hit = this.children.get(name)
    if (hit instanceof MockDir) return hit
    if (!opts?.create) throw new Error(`NotFoundError: ${name}`)
    const dir = new MockDir(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFile> {
    const hit = this.children.get(name)
    if (hit instanceof MockFile) return hit
    if (!opts?.create) throw new Error(`NotFoundError: ${name}`)
    const file = new MockFile(name)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> { this.children.delete(name) }

  // #markerNumbers iterates the handle directly, so both shapes are needed.
  async *entries(): AsyncGenerator<[string, MockDir | MockFile]> {
    for (const [k, v] of [...this.children]) yield [k, v]
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<[string, MockDir | MockFile]> {
    for (const [k, v] of [...this.children]) yield [k, v]
  }
}

let opfsRoot: MockDir

vi.hoisted(() => { /* nothing to stub before import — no DI in this service */ })

// ---- suite ----------------------------------------------------------

describe('hive snapshot lineage', () => {
  let storage: {
    saveHiveSnapshot(name: string, sealSig: string): Promise<string | null>
    loadHiveSnapshots(): Promise<{ name: string; sealSig: string }[]>
    loadHomeHistory(): Promise<{ name: string; logicalRootSig: string }[]>
    markerCount(lineage: string): Promise<number>
  }

  const SEAL_A = 'a'.repeat(64)
  const SEAL_B = 'b'.repeat(64)

  beforeEach(async () => {
    opfsRoot = new MockDir('/')
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: { getDirectory: async () => opfsRoot } },
      configurable: true,
      writable: true,
    })
    const mod = await import('./dcp-domain-storage.service')
    storage = new mod.DcpDomainStorage() as unknown as typeof storage
  })

  it('records a named snapshot and reads it back', async () => {
    const root = await storage.saveHiveSnapshot('before the redesign', SEAL_A)
    expect(root).toMatch(/^[a-f0-9]{64}$/)

    const list = await storage.loadHiveSnapshots()
    expect(list).toEqual([{ name: 'before the redesign', sealSig: SEAL_A }])
  })

  it('keeps hive snapshots OUT of the install history', async () => {
    await storage.saveHiveSnapshot('content point', SEAL_A)

    // The install history is a different lineage and must be untouched —
    // naming your tiles is not naming your packages.
    expect(await storage.loadHomeHistory()).toEqual([])
    expect(await storage.markerCount('home')).toBe(0)
    expect(await storage.markerCount('hive')).toBeGreaterThan(0)
  })

  it('stores a POINTER — the sealed closure need not be present', async () => {
    // No content for SEAL_A was ever put; recording still succeeds,
    // because the bytes arrive on their own through `intake`.
    const root = await storage.saveHiveSnapshot('pointer only', SEAL_A)
    expect(root).not.toBeNull()
    expect((await storage.loadHiveSnapshots())[0].sealSig).toBe(SEAL_A)
  })

  it('auto-names within the hive lineage', async () => {
    await storage.saveHiveSnapshot('', SEAL_A)
    await storage.saveHiveSnapshot('', SEAL_B)
    const names = (await storage.loadHiveSnapshots()).map(s => s.name)
    expect(names).toContain('snapshot-1')
    expect(names).toContain('snapshot-2')
  })

  it('refuses a seal that is not a signature', async () => {
    expect(await storage.saveHiveSnapshot('bad', 'not-a-sig')).toBeNull()
    expect(await storage.saveHiveSnapshot('empty', '')).toBeNull()
    expect(await storage.loadHiveSnapshots()).toEqual([])
    expect(await storage.markerCount('hive')).toBe(0)
  })

  it('is idempotent for an unchanged hive', async () => {
    await storage.saveHiveSnapshot('same point', SEAL_A)
    const after1 = await storage.markerCount('hive')
    await storage.saveHiveSnapshot('same point', SEAL_A)
    const after2 = await storage.markerCount('hive')
    expect(after2).toBe(after1)
    expect(await storage.loadHiveSnapshots()).toHaveLength(1)
  })

  it('keeps distinct seals as distinct entries', async () => {
    await storage.saveHiveSnapshot('first', SEAL_A)
    await storage.saveHiveSnapshot('second', SEAL_B)
    const list = await storage.loadHiveSnapshots()
    expect(list.map(s => s.sealSig).sort()).toEqual([SEAL_A, SEAL_B].sort())
  })
})
