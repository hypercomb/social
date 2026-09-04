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
