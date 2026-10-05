// search/hive-search.service.spec.ts — a record is complete, or it is not a record.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { HiveSearchService } from './hive-search.service.js'

const SIG = 'a'.repeat(64)

/** A pool fake: files by name. */
const fakePool = () => {
  const files = new Map<string, string>()
  const pool = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw new Error('nf')
      return {
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => ({ write: async (t: string) => { files.set(name, t) }, close: async () => {} }),
      }
    },
  } as unknown as FileSystemDirectoryHandle
  return { pool, files }
}

const withStore = (pool: FileSystemDirectoryHandle) => {
  const resolve = (key: string) => key === '@hypercomb.social/Store' ? { getPool: async () => pool } : undefined
  // the service resolves its store through the IoC; a bare global is a decoy here
  ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
  vi.stubGlobal('get', resolve)
}

describe('writeRecord', () => {
  it('refuses a TRUNCATED record — not to disk, not to the memo — so the next pass derives again', async () => {
    const { pool, files } = fakePool()
    withStore(pool)
    const service = new HiveSearchService()
    await service.writeRecord(SIG, { v: 1, rows: [], truncated: true })
    expect(files.size).toBe(0)
    expect(await service.readRecord(SIG)).toBeNull()
  })

  it('writes a complete record, and reads it back', async () => {
    const { pool, files } = fakePool()
    withStore(pool)
    const service = new HiveSearchService()
    await service.writeRecord(SIG, { v: 1, rows: [] })
    expect(files.has(SIG)).toBe(true)
    expect(await service.readRecord(SIG)).toEqual({ v: 1, rows: [] })
  })
})

describe('warmBranches', () => {
  it('gives every branch of a root too big for one record a record of its own', async () => {
    // A root past the row cap keeps no record, and its derive stops adding
    // branches at the cap — the later branches were never derived at all.
    const { pool, files } = fakePool()
    const sig = (n: number): string => n.toString(16).padStart(64, '0')
    const manifests = new Map<string, unknown[]>([
      [sig(1), [{ sig: sig(2), layer: { name: 'big' } }, { sig: sig(3), layer: { name: 'dolphin' } }]],
      [sig(3), [{ sig: sig(4), layer: { name: 'members' } }]],
    ])
    const store = { getPool: async () => pool, readChildrenManifest: async (s: string) => manifests.get(s) ?? null }
    const resolve = (key: string) => key === '@hypercomb.social/Store' ? store : undefined
    ;(globalThis as unknown as { ioc: { get: (k: string) => unknown } }).ioc.get = resolve
    vi.stubGlobal('get', resolve)
    const service = new HiveSearchService()
    // 'big' already has a record; 'dolphin' is the branch the root never reached.
    await service.writeRecord(sig(2), { v: 1, rows: [] })
    await service.warmBranches(sig(1), { nodes: 50 })
    expect(files.has(sig(3))).toBe(true)
    expect((await service.readRecord(sig(3)))?.rows.map(row => row.name)).toEqual(['members'])
  })
})
