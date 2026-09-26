// public-branches-pool.spec.ts — the public:branches pool is the set, and
// hc:public-branches the synchronous cache every renderer reads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isCellPublic, readPublicBranches, reconcilePublicBranches, setBranchPublic } from './tile-public.js'

/** A directory handle over a Map: enough of OPFS for one flat pool. */
const fakePool = () => {
  const files = new Map<string, string>()
  return {
    files,
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name) && !opts?.create) throw new DOMException('absent', 'NotFoundError')
      if (!files.has(name)) files.set(name, '')
      return {
        kind: 'file',
        getFile: async () => ({ text: async () => files.get(name) ?? '' }),
        createWritable: async () => {
          let text = ''
          return { write: async (part: ArrayBuffer) => { text += new TextDecoder().decode(part) }, close: async () => { files.set(name, text) } }
        },
      }
    },
    removeEntry: async (name: string) => { if (!files.delete(name)) throw new DOMException('absent', 'NotFoundError') },
    async *[Symbol.asyncIterator]() {
      for (const name of [...files.keys()]) yield [name, { kind: 'file', getFile: async () => ({ text: async () => files.get(name) ?? '' }) }]
    },
  }
}

let pool: ReturnType<typeof fakePool> | null
const ioc = (window as unknown as { ioc?: unknown })

beforeEach(() => {
  localStorage.clear()
  pool = fakePool()
  ioc.ioc = { get: (key: string) => key === '@hypercomb.social/Store' ? { getPool: async () => pool } : undefined }
})
afterEach(() => { delete ioc.ioc })

const pathsInPool = (): string[] =>
  [...pool!.files.values()].filter(Boolean).map(text => (JSON.parse(text) as { path: string }).path).sort()

describe('public branches pool', () => {
  it('writes the cache at once and the pool record after', async () => {
    setBranchPublic('/My Folder', 'Work', true)
    expect(readPublicBranches()).toEqual(['/my-folder/work'])
    expect(isCellPublic('/My Folder/Work', 'notes')).toBe(true)
    await vi.waitFor(() => expect(pathsInPool()).toEqual(['/my-folder/work']))
  })

  it('withdraws from both, and a reconcile does not bring it back', async () => {
    setBranchPublic('/', 'work', true)
    await vi.waitFor(() => expect(pathsInPool()).toEqual(['/work']))
    setBranchPublic('/', 'work', false)
    expect(readPublicBranches()).toEqual([])
    await vi.waitFor(() => expect(pathsInPool()).toEqual([]))
    await reconcilePublicBranches()
    expect(readPublicBranches()).toEqual([])
  })

  it('backfills a cache-only branch into the pool', async () => {
    localStorage.setItem('hc:public-branches', JSON.stringify(['/older']))
    expect(await reconcilePublicBranches()).toBe(1)
    expect(pathsInPool()).toEqual(['/older'])
  })

  it('a cleared browser gets its public branches back from the pool', async () => {
    setBranchPublic('/', 'work', true)
    await vi.waitFor(() => expect(pathsInPool()).toEqual(['/work']))
    localStorage.clear()
    expect(await reconcilePublicBranches()).toBe(1)
    expect(readPublicBranches()).toEqual(['/work'])
  })

  it('still answers from the cache when no store is up', () => {
    pool = null
    setBranchPublic('/', 'work', true)
    expect(isCellPublic('/work', 'x')).toBe(true)
  })
})
