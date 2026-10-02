// games/arkanoid/levels.spec.ts
//
// The participant's own Arkanoid walls: load / save / upsert / delete, kept in
// the `arkanoid:levels` document pool behind a ParticipantDocument. The store
// is a fake handed in through a stubbed window.ioc (the same shape
// preferences/participant-document.spec.ts uses), so nothing touches OPFS.
//
// levels.ts keeps its document in a module-level singleton, so every test
// resets the module registry and re-imports: each starts from a cold store.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentStoreLike } from '../../preferences/participant-document.js'

type Levels = typeof import('./levels.js')
let L: Levels

const text = (b: ArrayBuffer): string => new TextDecoder().decode(b)
const bytes = (v: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }

/** A store fake: pools exist only once WRITTEN; documents keyed by pool + sub-bucket. */
function fakeStore(seed: Record<string, unknown> = {}) {
  const pools = new Set<string>(Object.keys(seed).map(k => k.split('|')[0]!))
  const docs = new Map<string, ArrayBuffer>(Object.entries(seed).map(([k, v]) => [k, bytes(v)]))
  const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
  const store: DocumentStoreLike & { docs: Map<string, ArrayBuffer> } = {
    docs,
    initialize: async () => {},
    openPool: async m => pools.has(m) ? handle(m) : null,
    getPool: async m => { pools.add(m); return handle(m) },
    getPoolDoc: async (pool, subKey) => docs.get(`${pool!.name}|${subKey ?? ''}`) ?? null,
    putPoolDoc: async (pool, b, subKey) => { docs.set(`${pool.name}|${subKey ?? ''}`, b); return 'f'.repeat(64) },
  }
  return store
}

/** Make window.ioc hand `store` to whoever waits for the Store. No store = a cold, store-less page. */
function stubIoc(store?: DocumentStoreLike): void {
  if (!store) { vi.stubGlobal('ioc', undefined); return }
  vi.stubGlobal('ioc', {
    whenReady: (_key: string, cb: (v: unknown) => void) => cb(store),
    get: () => store,
  })
}

async function load(store?: DocumentStoreLike): Promise<Levels> {
  stubIoc(store)
  vi.resetModules()
  return await import('./levels.js')
}

const wall = (name: string, ...rows: string[]) => ({ name, rows })

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('Arkanoid custom levels: the grid they are painted on', () => {
  beforeEach(async () => { L = await load() })

  it('paints on an 11 by 12 grid', () => {
    expect(L.EDIT_COLS).toBe(11)
    expect(L.EDIT_ROWS).toBe(12)
  })

  it('emptyLevel is a blank EDIT_ROWS x EDIT_COLS grid carrying the name', () => {
    const e = L.emptyLevel('Blank')
    expect(e.name).toBe('Blank')
    expect(e.rows).toHaveLength(L.EDIT_ROWS)
    expect(e.rows.every(r => r === '.'.repeat(L.EDIT_COLS))).toBe(true)
  })

  it('cloneLevel copies the rows, so editing a clone leaves the original alone', () => {
    const a = wall('A', '111', '222')
    const b = L.cloneLevel(a) as { name: string; rows: string[] }
    b.rows[0] = 'xxx'
    expect(a.rows[0]).toBe('111')
    expect(b.name).toBe('A')
  })

  it('names its pool arkanoid:levels', () => {
    expect(L.ARKANOID_LEVELS_MEANING).toBe('arkanoid:levels')
  })
})

describe('Arkanoid custom levels: save / load / upsert / delete', () => {
  beforeEach(async () => { L = await load() })

  it('starts empty', () => {
    expect(L.loadCustomLevels()).toEqual([])
  })

  it('round-trips a saved list', () => {
    L.saveCustomLevels([wall('One', '111'), wall('Two', '2.2', '#.#')])
    expect(L.loadCustomLevels()).toEqual([wall('One', '111'), wall('Two', '2.2', '#.#')])
  })

  it('saving replaces the whole list', () => {
    L.saveCustomLevels([wall('One', '1'), wall('Two', '2')])
    L.saveCustomLevels([wall('Three', '3')])
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Three'])
  })

  it('upsert appends a new name and returns the new list', () => {
    const out = L.upsertCustomLevel(wall('One', '111'))
    expect(out.map(l => l.name)).toEqual(['One'])
    const out2 = L.upsertCustomLevel(wall('Two', '222'))
    expect(out2.map(l => l.name)).toEqual(['One', 'Two'])
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['One', 'Two'])
  })

  it('upsert replaces a level of the same name in place, keeping its position', () => {
    L.saveCustomLevels([wall('One', '1'), wall('Two', '2'), wall('Three', '3')])
    const out = L.upsertCustomLevel(wall('Two', '4444'))
    expect(out.map(l => l.name)).toEqual(['One', 'Two', 'Three'])
    expect(L.loadCustomLevels()[1].rows).toEqual(['4444'])
  })

  it('delete removes a level by name and returns the rest', () => {
    L.saveCustomLevels([wall('One', '1'), wall('Two', '2')])
    const out = L.deleteCustomLevel('One')
    expect(out.map(l => l.name)).toEqual(['Two'])
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Two'])
  })

  it('delete of an unknown name changes nothing', () => {
    L.saveCustomLevels([wall('One', '1')])
    expect(L.deleteCustomLevel('Nope').map(l => l.name)).toEqual(['One'])
    expect(L.loadCustomLevels()).toHaveLength(1)
  })

  it('upsert then delete leaves the store empty', () => {
    L.upsertCustomLevel(wall('Only', '1'))
    expect(L.deleteCustomLevel('Only')).toEqual([])
    expect(L.loadCustomLevels()).toEqual([])
  })

  it('load hands out copies: mutating the answer never reaches the store', () => {
    L.saveCustomLevels([wall('One', '111')])
    const a = L.loadCustomLevels()
    ;(a[0].rows as string[])[0] = 'zzz'
    a.length = 0
    expect(L.loadCustomLevels()).toEqual([wall('One', '111')])
  })

  it('save copies what it is given: later edits to the caller list do not leak in', () => {
    const mine = [wall('One', '111')]
    L.saveCustomLevels(mine)
    ;(mine[0].rows as string[])[0] = '999'
    expect(L.loadCustomLevels()[0].rows).toEqual(['111'])
  })

  it('drops malformed entries on save', () => {
    L.saveCustomLevels([
      wall('Good', '111'),
      { name: 7, rows: ['1'] } as never,
      { name: 'NoRows' } as never,
      { name: 'BadRow', rows: [1, 2] } as never,
      null as never,
    ])
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Good'])
  })

  it('refuses a tampered, oversize entry (more than 64 rows, or a row over 64 characters)', () => {
    L.saveCustomLevels([
      wall('TooTall', ...Array.from({ length: 65 }, () => '1')),
      wall('TooWide', '1'.repeat(65)),
      wall('Edge', ...Array.from({ length: 64 }, () => '1'.repeat(64))),
    ])
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Edge'])
  })
})

describe('Arkanoid custom levels: the document pool', () => {
  it('writes through to the arkanoid:levels pool and never to localStorage', async () => {
    const store = fakeStore()
    L = await load(store)
    L.saveCustomLevels([wall('One', '111')])
    await settle()
    const doc = store.docs.get('arkanoid:levels|')
    expect(doc).toBeDefined()
    expect(JSON.parse(text(doc!))).toEqual([wall('One', '111')])
    expect(localStorage.length).toBe(0)
  })

  it('an upsert lands in the pool too', async () => {
    const store = fakeStore()
    L = await load(store)
    L.upsertCustomLevel(wall('A', '1'))
    L.upsertCustomLevel(wall('B', '2'))
    await settle()
    expect(JSON.parse(text(store.docs.get('arkanoid:levels|')!)).map((l: { name: string }) => l.name)).toEqual(['A', 'B'])
  })

  it('a fresh page reads back what an earlier page saved', async () => {
    const store = fakeStore()
    L = await load(store)
    L.saveCustomLevels([wall('Kept', '1.1', '.2.')])
    await settle()

    L = await load(store)                                    // a new page: modules reset, same disk
    L.loadCustomLevels()                                     // first touch constructs the document
    await settle()
    expect(L.loadCustomLevels()).toEqual([wall('Kept', '1.1', '.2.')])
  })

  it('the pool wins over the legacy localStorage key once it answers', async () => {
    localStorage.setItem('hc:arkanoid-levels', JSON.stringify([wall('Old', '1')]))
    const store = fakeStore({ 'arkanoid:levels|': [wall('New', '2')] })
    L = await load(store)
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Old'])     // first frame: the legacy key
    await settle()
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['New'])
  })

  it('reads the legacy hc:arkanoid-levels key when there is no store yet, and never rewrites it', async () => {
    const legacy = JSON.stringify([wall('Legacy', '333')])
    localStorage.setItem('hc:arkanoid-levels', legacy)
    L = await load()
    expect(L.loadCustomLevels()).toEqual([wall('Legacy', '333')])
    L.upsertCustomLevel(wall('Fresh', '1'))
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Legacy', 'Fresh'])
    expect(localStorage.getItem('hc:arkanoid-levels')).toBe(legacy)
  })

  it('ignores a corrupt legacy key', async () => {
    localStorage.setItem('hc:arkanoid-levels', '{not json')
    L = await load()
    expect(L.loadCustomLevels()).toEqual([])
  })

  it('filters malformed entries out of a pool document', async () => {
    const store = fakeStore({ 'arkanoid:levels|': [wall('Fine', '1'), { name: 3, rows: [] }, 'junk'] })
    L = await load(store)
    L.loadCustomLevels()
    await settle()
    expect(L.loadCustomLevels().map(l => l.name)).toEqual(['Fine'])
  })

  it('an edit made before the disk answered outlives the disk', async () => {
    const store = fakeStore({ 'arkanoid:levels|': [wall('FromDisk', '1')] })
    L = await load(store)
    L.upsertCustomLevel(wall('Early', '2'))                  // the first call also constructs the document
    await settle()
    expect(L.loadCustomLevels().map(l => l.name)).toContain('Early')
  })
})
