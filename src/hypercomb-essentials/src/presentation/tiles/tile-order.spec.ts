// tile-order.spec.ts — WHERE EACH TILE SITS, on its own. Local tiles keep
// their persisted slot (a collision is demoted, never shuffled); a peer's
// index is honoured only on a slot free here; the rest are score-filled and
// remembered for the session, never persisted by a render; a new tile's
// slot is persisted at the event's own address.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const written: { segments: readonly string[]; name: string; props: Record<string, unknown> }[] = []
vi.mock('../../editor/tile-properties.js', () => ({
  writeTilePropertiesAt: async (segments: readonly string[], name: string, props: Record<string, unknown>) => { written.push({ segments, name, props }) },
  readTilePropertiesAt: async () => ({}),
  cellLocationSig: async (segments: readonly string[], name: string) => [...segments, name].join('/'),
}))

import { TileOrder, type OrderHost } from './tile-order.js'

const INDEX: Record<string, number | undefined> = {}
const services: Record<string, unknown> = {}
const MAX = 6

const host = (over: Partial<OrderHost> = {}) => {
  const placed: string[] = []
  const calls = { invalidated: 0 }
  const h: OrderHost & { placed: string[]; calls: typeof calls } = {
    placed, calls,
    axial: () => ({ count: MAX, items: new Map(Array.from({ length: MAX + 1 }, (_, i) => [i, { q: i, r: 0 }])) }),
    lineage: () => ({ explorerSegments: () => ['home'] }),
    slots: () => ({ snapshot: () => ({ names: [...placed] }), addAt: (name, slot) => { placed[slot] = name; return true } }),
    referenceDraft: () => null,
    keyword: () => '',
    tagsFor: () => [],
    invalidate: () => { calls.invalidated++ },
    ...over,
  }
  return h
}

beforeEach(() => {
  for (const k of Object.keys(INDEX)) delete INDEX[k]
  for (const k of Object.keys(services)) delete services[k]
  written.length = 0
  services['@diamondcoreprocessor.com/IndexNurse'] = { read: async (_segs: readonly string[], name: string) => INDEX[name] }
  ;(window as any).ioc = { get: (key: string) => services[key] }
})
afterEach(() => { delete (window as any).ioc })

const dir = null as unknown as FileSystemDirectoryHandle
const order = (o: TileOrder, names: string[], local = names, peers?: Map<string, number>, navPass = false) =>
  o.pinned(dir, names, new Set(local), false, peers, ['home'], navPass)

describe('the pinned order', () => {
  it('seats local tiles at their persisted index and demotes a collision, never shuffling the owner', async () => {
    Object.assign(INDEX, { a: 2, b: 0, c: 2 })
    const sparse = await order(new TileOrder(host()), ['a', 'b', 'c'])
    expect(sparse[0]).toBe('b')
    expect(sparse[2]).toBe('a')
    // c collided with a: it is score-filled (lowest free with no tracker), not dropped.
    expect(sparse.indexOf('c')).toBe(1)
  })

  it('honours a peer\'s index only where the slot is free here', async () => {
    Object.assign(INDEX, { mine: 3 })
    const sparse = await order(new TileOrder(host()), ['mine', 'theirs', 'other'], ['mine'], new Map([['theirs', 3], ['other', 5]]))
    expect(sparse[3]).toBe('mine')
    expect(sparse[5]).toBe('other')
    expect(sparse.indexOf('theirs')).toBe(0)
  })

  it('remembers a score-filled slot for the session — a pan never moves it — and never persists it', async () => {
    services['@diamondcoreprocessor.com/AxialService'] = { Adjacents: new Map() }
    const tracker = { scores: new Map([[4, { off: 0, center: 0 }], [2, { off: 1, center: 1 }]]) }
    services['@diamondcoreprocessor.com/CenterSlotTracker'] = tracker
    const o = new TileOrder(host())
    expect((await order(o, ['n'])).indexOf('n')).toBe(4)
    // The camera moved: slot 2 now scores best. The tile stays where it was.
    tracker.scores = new Map([[2, { off: 0, center: 0 }], [4, { off: 3, center: 3 }]])
    expect((await order(o, ['n'])).indexOf('n')).toBe(4)
    expect(written).toEqual([])
    // Leaving the location forgets it.
    o.forgetAll()
    expect((await order(o, ['n'])).indexOf('n')).toBe(2)
  })

  it('on a navigation pass takes the lowest free slot, never the camera\'s score', async () => {
    services['@diamondcoreprocessor.com/CenterSlotTracker'] = { scores: new Map([[0, { off: 9, center: 9 }], [4, { off: 0, center: 0 }]]) }
    services['@diamondcoreprocessor.com/AxialService'] = { Adjacents: new Map() }
    const scored = await order(new TileOrder(host()), ['n'])
    expect(scored.indexOf('n')).toBe(4)
    const nav = await order(new TileOrder(host()), ['n'], undefined, undefined, true)
    expect(nav.indexOf('n')).toBe(0)
  })

  it('narrows on the >? keyword by name or mark', async () => {
    Object.assign(INDEX, { apple: 0, pear: 1, plum: 2 })
    const o = new TileOrder(host({ keyword: () => 'um', tagsFor: label => label === 'pear' ? ['plump'] : [] }))
    const sparse = await o.order('pinned', dir, new Set(['apple', 'pear', 'plum']), new Set(['apple', 'pear', 'plum']), null)
    expect(sparse.slice(0, 3)).toEqual(['', 'pear', 'plum'])
  })
})

describe('placing a new tile', () => {
  it('seats it, remembers it, and persists its index at the event\'s own address', () => {
    const h = host()
    const o = new TileOrder(h)
    const slot = o.placeNew('fresh', ['elsewhere'])
    expect(slot).toBe(0)
    expect(h.placed[0]).toBe('fresh')
    expect(written).toEqual([{ segments: ['elsewhere'], name: 'fresh', props: { index: 0 } }])
    // Already placed: kept where it is, never re-persisted.
    expect(o.placeNew('fresh', ['elsewhere'])).toBe(0)
    expect(written).toHaveLength(1)
  })

  it('an explicit place-at persists the one index and repaints; a reorder only repaints', async () => {
    const h = host()
    const o = new TileOrder(h)
    await o.placeAt('moved', 4)
    expect(written).toEqual([{ segments: ['home'], name: 'moved', props: { index: 4 } }])
    o.reorder()
    expect(h.calls.invalidated).toBe(2)
  })
})
