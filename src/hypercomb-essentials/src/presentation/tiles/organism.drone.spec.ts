// The organism is a way of LOOKING, and looking must cost the hive nothing.
// Drives OrganismDrone through a stubbed world — the axial grid, the lineage,
// a layer store — and pins the two contracts that a live run broke, plus the
// ranking itself and the release.
//
// Both regressions were real and shipped in the first cut:
//
//   1. The projection was built from the PAGE's slots only. `project()`
//      replaces AxialService.items outright, so an 11-entry matrix left a
//      grid with 11 slots and stranded every other index.
//   2. Projecting asks for a repaint; the repaint republishes
//      `render:cell-count`; that effect triggers a re-rank. The drone
//      answered its own render forever, and because each pass re-ranked from
//      the tiles the last pass had drawn, tiles missing from one frame were
//      evicted for good.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { setTileStacks } from './tile-stack.js'

type Coord = { q: number; r: number }
type Matrix = ReadonlyMap<number, Coord>

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
}

const { OrganismDrone, ORGANISM_SET, ORGANISM_CHANGED } = await import('./organism.drone.js')
type Organism = InstanceType<typeof OrganismDrone>

/** A spiral big enough to hold the page and then some — the surplus is the
 *  point: a projection must not shrink it. */
const CAPACITY = 40
const RING: Coord[] = [
  { q: 0, r: 0 },
  { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 },
  { q: -1, r: -1 }, { q: 2, r: -1 }, { q: 1, r: 1 }, { q: -2, r: 1 }, { q: -2, r: 0 },
]
const spiral = (): Map<number, Coord> => {
  const m = new Map<number, Coord>()
  for (let i = 0; i < CAPACITY; i++) m.set(i, RING[i] ?? { q: 100 + i, r: -50 })
  return m
}

const last = <T>(effect: string): T | undefined => {
  let value: T | undefined
  EffectBus.on<T>(effect, p => { value = p })()
  return value
}

/** A layer tree keyed by name — the shape organism-weight walks. */
type Node = { name: string; kids?: Node[] }
const storeOf = (root: Node) => {
  const bySig = new Map<string, { name: string; children: string[] }>()
  let n = 0
  const add = (node: Node): string => {
    const sig = `sig-${n++}`
    bySig.set(sig, { name: node.name, children: (node.kids ?? []).map(add) })
    return sig
  }
  const rootSig = add(root)
  return {
    sign: async () => 'loc',
    currentLayerAt: async () => bySig.get(rootSig) ?? null,
    getLayerBySig: async (sig: string) => bySig.get(sig) ?? null,
  }
}

/** research is the densest, then people, then design; the rest are empty. */
const PAGE: Node = {
  name: '/',
  kids: [
    { name: 'alpha' },
    { name: 'research', kids: [{ name: 'a', kids: [{ name: 'x' }, { name: 'y' }] }, { name: 'b' }, { name: 'c' }] },
    { name: 'people', kids: [{ name: 'a', kids: [{ name: 'x' }] }, { name: 'b' }] },
    { name: 'design', kids: [{ name: 'a' }] },
    { name: 'zeta' },
  ],
}
/** Canonical slots, in the order the renderer hands them out. */
const LABELS = ['alpha', 'research', 'people', 'design', 'zeta']

let project: ReturnType<typeof vi.fn>
let items: Map<number, Coord>
let projected: boolean
let drone: Organism

const matrixAt = (call: number): Matrix => project.mock.calls[call][0] as Matrix
const beat = (): Promise<void> =>
  (drone as unknown as { heartbeat: (g: string) => Promise<void> }).heartbeat('')

/** Publish a page: label i sits at whatever coordinate the CURRENT grid gives
 *  slot i — which is what the renderer actually does. */
const publishPage = (labels: readonly string[] = LABELS): void => {
  const coords = labels.map((_, i) => items.get(i) ?? { q: 0, r: 0 })
  EffectBus.emit('render:cell-count', { count: labels.length, labels: [...labels], coords })
}

/** The page as the renderer would draw it under the live grid. */
const drawn = (labels: readonly string[] = LABELS): Record<string, string> => {
  const out: Record<string, string> = {}
  labels.forEach((label, slot) => {
    const c = items.get(slot)
    out[label] = c ? `${c.q},${c.r}` : 'MISSING'
  })
  return out
}

/** Which label the projection put at each rank, cheapest way to read a rank
 *  order back out: rank r lives at the coordinate of the r-th page slot. */
const rankOrder = (matrix: Matrix, labels: readonly string[] = LABELS): string[] => {
  const rankByCoord = new Map<string, number>()
  labels.forEach((_, rank) => {
    const c = spiral().get(rank)
    if (c) rankByCoord.set(`${c.q},${c.r}`, rank)
  })
  const out: string[] = []
  for (const [slot, coord] of matrix) {
    const rank = rankByCoord.get(`${coord.q},${coord.r}`)
    if (rank !== undefined && labels[slot]) out[rank] = labels[slot]
  }
  return out
}

beforeEach(async () => {
  vi.useFakeTimers()
  EffectBus.clear()
  setTileStacks(new Map())
  services.clear()
  items = spiral()
  projected = false
  project = vi.fn((matrix: Matrix | null) => {
    if (matrix === null) { items = spiral(); projected = false; return true }
    items = new Map(matrix)
    projected = true
    return true
  })
  services.set('@diamondcoreprocessor.com/AxialService', {
    project,
    get items() { return items },
    get projected() { return projected },
    get capacity() { return CAPACITY },
  })
  services.set('@hypercomb.social/Lineage', { explorerSegments: () => [] })
  services.set('@diamondcoreprocessor.com/HistoryService', storeOf(PAGE))

  drone = new OrganismDrone()
  await beat()
  publishPage()
})

afterEach(() => { vi.useRealTimers() })

const enter = async (mode: 'organism' | 'texture' = 'organism', promote?: string): Promise<void> => {
  EffectBus.emit(ORGANISM_SET, promote ? { mode, promote } : { mode })
  await vi.runAllTimersAsync()
}

describe('the ranking', () => {
  it('puts the densest tile at the centre and thins outward', async () => {
    await enter()
    const order = rankOrder(matrixAt(0))
    // research 6, people 4, design 1, then the two empties by canonical index.
    expect(order).toEqual(['research', 'people', 'design', 'alpha', 'zeta'])
  })

  it('reports which ontology answered, so the number never changes meaning silently', async () => {
    await enter()
    expect(last<{ ontology: string }>(ORGANISM_CHANGED)?.ontology).toBe('descendants')
  })

  it('ranks on holders instead the moment a peer holds one of the page tiles', async () => {
    // design is thin by descendants but held by three participants.
    setTileStacks(new Map([
      ['design', [{ pubkey: '' }, { pubkey: 'a' }, { pubkey: 'b' }]],
      ['research', [{ pubkey: '' }]],
    ]))
    await enter()
    const changed = last<{ ontology: string }>(ORGANISM_CHANGED)
    expect(changed?.ontology).toBe('holders')
    expect(rankOrder(matrixAt(0))[0]).toBe('design')
  })
})

describe('contract: a projection is a FULL slot matrix', () => {
  it('keeps every slot the spiral had, not just the page\'s', async () => {
    await enter()
    expect(matrixAt(0).size).toBe(CAPACITY)
    expect(items.size).toBe(CAPACITY)
  })

  it('leaves coordinates outside the page exactly where the spiral put them', async () => {
    await enter()
    const before = spiral()
    for (let slot = LABELS.length; slot < CAPACITY; slot++) {
      expect(items.get(slot)).toEqual(before.get(slot))
    }
  })

  it('never puts two tiles on one coordinate', async () => {
    await enter()
    const seen = new Set([...matrixAt(0).values()].map(c => `${c.q},${c.r}`))
    expect(seen.size).toBe(matrixAt(0).size)
  })

  it('re-uses only the coordinates the page already occupied', async () => {
    await enter()
    const pageCoords = new Set(LABELS.map((_, i) => {
      const c = spiral().get(i)!
      return `${c.q},${c.r}`
    }))
    for (let slot = 0; slot < LABELS.length; slot++) {
      const c = items.get(slot)!
      expect(pageCoords.has(`${c.q},${c.r}`)).toBe(true)
    }
  })
})

describe('contract: a projection must not answer its own render', () => {
  it('does not re-project when the repaint republishes the same page', async () => {
    await enter()
    expect(project).toHaveBeenCalledTimes(1)

    // This is the loop: the renderer answers our projection with a cell-count
    // carrying the coordinates WE just assigned.
    for (let i = 0; i < 5; i++) { publishPage(); await vi.runAllTimersAsync() }
    expect(project).toHaveBeenCalledTimes(1)
  })

  it('keeps every tile across those repaints — the loop used to evict them', async () => {
    await enter()
    for (let i = 0; i < 5; i++) { publishPage(); await vi.runAllTimersAsync() }
    const places = drawn()
    expect(Object.values(places).filter(v => v === 'MISSING')).toEqual([])
    expect(new Set(Object.values(places)).size).toBe(LABELS.length)
  })

  it('still re-ranks when the page genuinely changes', async () => {
    await enter()
    expect(project).toHaveBeenCalledTimes(1)
    // design gains enough to overtake people.
    services.set('@diamondcoreprocessor.com/HistoryService', storeOf({
      name: '/',
      kids: [
        { name: 'alpha' },
        { name: 'research', kids: [{ name: 'a' }] },
        { name: 'people', kids: [{ name: 'a' }] },
        { name: 'design', kids: [{ name: 'a', kids: [{ name: 'x' }, { name: 'y' }, { name: 'z' }] }, { name: 'b' }] },
        { name: 'zeta' },
      ],
    }))
    publishPage()
    await vi.runAllTimersAsync()
    expect(project).toHaveBeenCalledTimes(2)
    expect(rankOrder(matrixAt(1))[0]).toBe('design')
  })
})

describe('one projector', () => {
  it('refuses when somebody else already holds the grid, however many passes have gone by', async () => {
    // The bug this pins: the guard asked whether we held a spiral SNAPSHOT,
    // and #readPage cached one on every render pass regardless of mode. So
    // after the first pass the guard was disarmed, and the organism
    // flattened the phone's rail matrix with no record it had existed.
    publishPage()
    await vi.runAllTimersAsync()

    const rails = new Map<number, Coord>([[0, { q: 9, r: 9 }], [1, { q: 8, r: 9 }]])
    items = new Map(rails)
    projected = true
    project.mockClear()

    await enter()
    expect(project).not.toHaveBeenCalled()
    expect(items).toEqual(rails)
    expect(last<{ refused?: string }>(ORGANISM_CHANGED)?.refused).toMatch(/rails/)
  })
})

describe('the word always gets an answer', () => {
  it('answers "off" even when it was never on', async () => {
    EffectBus.emit(ORGANISM_SET, { mode: 'off' })
    await vi.runAllTimersAsync()
    expect(last<{ mode: string }>(ORGANISM_CHANGED)?.mode).toBe('off')
  })

  it('answers a second identical request instead of going silent', async () => {
    await enter()
    const first = last<{ placed: number }>(ORGANISM_CHANGED)
    EffectBus.emit(ORGANISM_CHANGED, { mode: 'off', ontology: 'none', promote: null, promoted: 0, placed: -1 })
    await enter()
    // Same matrix, so no second projection — but the word still hears back.
    expect(project).toHaveBeenCalledTimes(1)
    expect(last<{ placed: number }>(ORGANISM_CHANGED)?.placed).toBe(first?.placed)
  })
})

describe('leaving', () => {
  it('gives the map back exactly as it was', async () => {
    const before = drawn()
    await enter()
    expect(drawn()).not.toEqual(before)

    EffectBus.emit(ORGANISM_SET, { mode: 'off' })
    await vi.runAllTimersAsync()
    expect(project).toHaveBeenLastCalledWith(null)
    expect(drawn()).toEqual(before)
    expect(items.size).toBe(CAPACITY)
  })

  it('leaves the ranking behind when the participant walks into a tile', async () => {
    await enter()
    EffectBus.emit('location:changed', {})
    await vi.runAllTimersAsync()
    expect(project).toHaveBeenLastCalledWith(null)
  })
})

describe('the texture', () => {
  const TAGS = {
    research: ['work'], alpha: ['work'],
    people: ['folk'],
    design: ['make'], zeta: ['make'],
  }

  it('lays each kind as one contiguous run, heaviest kind first', async () => {
    EffectBus.emit('render:tags', { tags: [], byLabel: TAGS })
    await enter('texture')
    const order = rankOrder(matrixAt(0))
    const kinds = order.map(label => TAGS[label as keyof typeof TAGS][0])
    // work = research 6 + alpha 0 = 6; folk = people 4; make = design 1 + zeta 0 = 1.
    expect(kinds).toEqual(['work', 'work', 'folk', 'make', 'make'])
    expect(order[0]).toBe('research')
  })
})

describe('lifting a kind to the top', () => {
  const TAGS = { design: ['make'], zeta: ['make'], research: ['work'], people: ['work'], alpha: ['work'] }

  it('meets the promoted kind first without disturbing either band\'s order', async () => {
    EffectBus.emit('render:tags', { tags: [], byLabel: TAGS })
    await enter('organism', 'make')
    // make: design 1, zeta 0. then the rest by weight: research 6, people 4, alpha 0.
    expect(rankOrder(matrixAt(0))).toEqual(['design', 'zeta', 'research', 'people', 'alpha'])
  })

  it('says how many it lifted, so a kind nothing wears is not a silent no-op', async () => {
    EffectBus.emit('render:tags', { tags: [], byLabel: TAGS })
    await enter('organism', 'nobodywearsthis')
    expect(last<{ promoted: number }>(ORGANISM_CHANGED)?.promoted).toBe(0)
  })
})
