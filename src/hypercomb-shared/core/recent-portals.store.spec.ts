// hypercomb-shared/core/recent-portals.store.spec.ts
//
// RECENT IS THE PIN'S OWN HISTORY. Every pin is a document write, and a
// document write keeps its versions (an atom plus a `000x` marker), so the
// Recent list is only those markers read back: newest first, one row per
// place, the hive root never a row, an unreadable marker passed over. The
// current pin leads even before it reaches disk.

import { beforeAll, describe, expect, it } from 'vitest'
import type { DocumentStoreLike } from './participant-document'

type Doc = { home: { label: string; segments: string[]; at: number } | null }

const sig = (n: number): string => n.toString(16).padStart(64, '0')

/** One directory of the fake OPFS: named files, each a string body. */
const directory = (files: Record<string, string>) => ({
  name: 'bucket',
  async *entries(): AsyncIterable<[string, { kind: 'file' }]> {
    for (const name of Object.keys(files)) yield [name, { kind: 'file' }]
  },
  async getFileHandle(name: string) {
    if (!(name in files)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' })
    const body = files[name]!
    const bytes = new TextEncoder().encode(body)
    return {
      getFile: async () => ({
        size: bytes.byteLength,
        text: async () => body,
        arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
      }),
    }
  },
})

/** A pool whose `home` sub-bucket holds these versions, oldest first. A
 *  `null` entry is a marker that names an atom nobody holds. */
const poolWith = (versions: ReadonlyArray<Doc | null>) => {
  const files: Record<string, string> = {}
  versions.forEach((doc, i) => {
    const atom = sig(i + 1)
    if (doc) files[atom] = JSON.stringify(doc)
    files[String(i + 1).padStart(8, '0')] = JSON.stringify({ layer: atom })
  })
  const bucket = directory(files)
  return { name: 'pool', getDirectoryHandle: async () => bucket } as unknown as FileSystemDirectoryHandle
}

const storeOf = (pool: FileSystemDirectoryHandle): DocumentStoreLike => ({
  openPool: async () => pool,
  getPool: async () => pool,
  getPoolDoc: async () => null,
  putPoolDoc: async () => sig(99),
})

const home = (label: string, segments: string[], at: number): Doc => ({ home: { label, segments, at } })

let Store: typeof import('./recent-portals.store').RecentPortalsStore

beforeAll(async () => {
  // The module registers its singleton at load; give it somewhere to go.
  const g = globalThis as { register?: (key: string, value: unknown) => void }
  g.register ??= () => {}
  Store = (await import('./recent-portals.store')).RecentPortalsStore
})

const make = (versions: ReadonlyArray<Doc | null>) => {
  const pool = poolWith(versions)
  return new Store({ whenStore: ready => ready(storeOf(pool)) })
}

describe('RecentPortalsStore.recent', () => {
  it('reads every pinned place back from the markers, newest first, once each', async () => {
    const store = make([
      home('alpha', ['alpha'], 1),
      home('beta', ['work', 'beta'], 2),
      { home: null },
      home('alpha', ['alpha'], 3),
    ])
    const rows = await store.recent()
    expect(rows.map(r => r.segments.join('/'))).toEqual(['alpha', 'work/beta'])
  })

  it('passes over a marker that names nothing readable', async () => {
    const store = make([home('alpha', ['alpha'], 1), null, home('gamma', ['gamma'], 3)])
    expect((await store.recent()).map(r => r.label)).toEqual(['gamma', 'alpha'])
  })

  it('puts a fresh pin first, before it has reached disk', async () => {
    const store = make([home('alpha', ['alpha'], 1)])
    store.pin('delta', ['delta'])
    expect((await store.recent()).map(r => r.label)).toEqual(['delta', 'alpha'])
    expect(store.home?.segments).toEqual(['delta'])
    expect(store.isHome(['delta'])).toBe(true)
  })

  it('an empty path releases the pin: home is the hive root again', async () => {
    const store = make([])
    store.pin('delta', ['delta'])
    store.pin('', [])
    expect(store.home).toBeUndefined()
    expect(store.isHome([])).toBe(true)
  })
})
