import { describe, expect, it } from 'vitest'
import { countCrossings, packColumn, placeTabs, segmentsCross, type PackItem, type PlaceInput, type TabIn } from './placement.js'
import { layoutFor } from './layout.js'
import type { ModelGeometry, Pt, TileModel } from '../models/tile-model.js'

// a deterministic generator (mulberry32): the property test must repeat exactly
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('packColumn', () => {
  const pack = (desired: number[], top = 0, bottom = 1000, gap = 8, h = 32) => {
    const items: PackItem[] = desired.map(d => ({ desired: d, h }))
    packColumn(items, top, bottom, gap)
    return items.map(i => i.top)
  }

  it('leaves well-spaced items where they asked to be', () => {
    expect(pack([10, 100, 300])).toEqual([10, 100, 300])
  })

  it('sorts by the desired top', () => {
    expect(pack([300, 10, 100])).toEqual([10, 100, 300])
  })

  it('pushes colliding items down by height + gap', () => {
    expect(pack([100, 105, 110])).toEqual([100, 140, 180])
  })

  it('starts no higher than the top limit', () => {
    expect(pack([0, 0], 8)).toEqual([8, 48])
  })

  it('pulls items back up from the bottom limit', () => {
    // the last would end at 1000+; it comes up, and the one above it makes room
    expect(pack([950, 960], 0, 1000)).toEqual([928, 968])
  })

  it('property: no overlaps, order preserved, within the limits (seeded)', () => {
    const rnd = seeded(20261025)
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rnd() * 6)
      const h = 24 + Math.floor(rnd() * 24)
      const gap = 4 + Math.floor(rnd() * 10)
      const items: PackItem[] = Array.from({ length: n }, () => ({ desired: rnd() * 900, h }))
      const order = items.map(i => i.desired).sort((a, b) => a - b)
      packColumn(items, 8, 1000, gap)
      expect(items.map(i => i.desired)).toEqual(order)                 // sorted, not reordered by the push
      for (let k = 0; k < n; k++) {
        const it = items[k]
        expect(it.top! + it.h).toBeLessThanOrEqual(1000 + 1e-9)
        if (k > 0) expect(it.top!).toBeGreaterThanOrEqual(items[k - 1].top! + items[k - 1].h + gap - 1e-9)
      }
      expect(items[0].top!).toBeGreaterThanOrEqual(8 - 1e-9 - (n * (h + gap) > 992 ? 1e9 : 0))
    }
  })
})

describe('crossings', () => {
  const P = (x: number, y: number): Pt => ({ x, y })

  it('counts a constructed X', () => {
    const lines = new Map<string, readonly Pt[]>([['a', [P(0, 0), P(10, 10)]], ['b', [P(0, 10), P(10, 0)]]])
    expect(countCrossings(lines)).toBe(1)
    expect(segmentsCross([P(0, 0), P(10, 10)], [P(0, 10), P(10, 0)])).toBe(true)
  })

  it('does not count parallel lines, touching ends, or a leader against itself', () => {
    expect(countCrossings(new Map([['a', [P(0, 0), P(10, 0)]], ['b', [P(0, 5), P(10, 5)]]]))).toBe(0)
    expect(countCrossings(new Map([['a', [P(0, 0), P(5, 5)]], ['b', [P(5, 5), P(10, 0)]]]))).toBe(0)
    expect(countCrossings(new Map([['a', [P(0, 0), P(10, 10), P(0, 10), P(10, 0)]]]))).toBe(0)
  })

  it('counts every crossing between kinked leaders', () => {
    const lines = new Map<string, readonly Pt[]>([
      ['a', [P(0, 0), P(5, 10), P(10, 10)]],
      ['b', [P(0, 10), P(5, 0), P(10, 0)]],
    ])
    expect(countCrossings(lines)).toBe(1)
  })
})

// a six-part stand-in: three on the left, three on the right, anchors ordered in y,
// shaped like the real thing but with no model behind it
const MODEL = {
  id: 'stub', labelKey: 'k', label: 'stub', defaultVariant: 'a',
  variants: [{ id: 'a', labelKey: 'k', label: 'a' }, { id: 'b', labelKey: 'k', label: 'b' }],
  geometry: (size: number) => ({ size, extent: { min: 0, max: size } } as unknown as ModelGeometry),
  parts: [],
} as unknown as TileModel

const anchors = (S: number): TabIn[] => [
  { id: 'l1', side: 'left', anchor: { x: 0.43 * S, y: 0.18 * S } },
  { id: 'l2', side: 'left', anchor: { x: 0.2 * S, y: 0.33 * S } },
  { id: 'l3', side: 'left', anchor: { x: 0.1 * S, y: 0.5 * S } },
  { id: 'r1', side: 'right', anchor: { x: 0.93 * S, y: 0.07 * S } },
  { id: 'r2', side: 'right', anchor: { x: 0.85 * S, y: 0.2 * S } },
  { id: 'r3', side: 'right', anchor: { x: 0.9 * S, y: 0.75 * S } },
  { id: 'q', side: 'right', anchor: null, free: true },
]

const inputFor = (width: number, height: number, scale: number, open?: string, toolWidth = 520): PlaceInput | null => {
  const em = 16 * scale
  const lay = layoutFor({ rootWidth: width, rootRem: 16, em, desk: { w: width - 56, h: height }, model: MODEL, variant: 'a' })
  if (lay.layout !== 'wide') return null
  const U = lay.unit
  return {
    tabs: anchors(lay.size).map(t => (t.id === open ? { ...t, open: { bodyHeight: 180 * U } } : t)),
    extent: lay.extent, figure: lay.figure, size: lay.size, viewport: lay.viewport, unit: U,
    tab: lay.tab, card: lay.card,
    toolbar: { reach: lay.figure.left + lay.size / 2 + (toolWidth * U) / 2, top: lay.figure.top + lay.size + 22 * U },
  }
}

describe('placeTabs', () => {
  it('puts each tab level with its anchor, so the leader is straight', () => {
    const i = inputFor(1920, 1080, 1)!
    const p = placeTabs(i)
    const l2 = p.tabs.get('l2')!
    expect(l2.headTop + 16).toBeCloseTo(i.figure.top + 0.33 * i.size, 5)
    expect(p.leaders.get('l2')!).toHaveLength(2)
    expect(p.leaders.has('q')).toBe(false)
  })

  it('left tabs sit left of the extent, right tabs right of it', () => {
    const i = inputFor(1920, 1080, 1)!
    const p = placeTabs(i)
    expect(p.tabs.get('l1')!.left + p.tabs.get('l1')!.width).toBeLessThanOrEqual(i.figure.left + i.extent.min)
    expect(p.tabs.get('r1')!.left).toBeGreaterThanOrEqual(i.figure.left + i.extent.max)
  })

  it('kinks a leader whose tab was pushed off the anchor line', () => {
    const i = inputFor(1920, 1080, 1)!
    i.tabs = [
      { id: 'a', side: 'left', anchor: { x: 100, y: 200 } },
      { id: 'b', side: 'left', anchor: { x: 100, y: 205 } },
    ]
    const p = placeTabs(i)
    expect(p.leaders.get('a')!.length + p.leaders.get('b')!.length).toBe(5)
    expect(p.crossings).toBe(0)
  })

  it('covered-tab rule: an open card hides the tabs it would half-cover, and only on its own side', () => {
    const i = inputFor(1920, 1080, 1, 'l1')!
    const p = placeTabs(i)
    expect(p.tabs.get('l1')!.covered).toBe(false)
    expect(p.tabs.get('l2')!.covered).toBe(true)          // 0.15 S below, inside the card
    expect(p.tabs.get('r2')!.covered).toBe(false)
    // nothing moved
    const rest = placeTabs(inputFor(1920, 1080, 1)!)
    for (const id of ['l1', 'l2', 'l3', 'r1', 'r2', 'r3']) expect(p.tabs.get(id)!.headTop).toBe(rest.tabs.get(id)!.headTop)
  })

  it('a leader that would run under a neighbour\'s open card is not drawn, its dot stays', () => {
    const p = placeTabs(inputFor(1920, 1080, 1, 'l1')!)
    expect(p.hiddenLeaders.has('l2')).toBe(true)
    expect(p.leaders.has('l2')).toBe(true)
    expect(p.hiddenLeaders.has('r2')).toBe(false)
  })

  it('a card that would leave the viewport grows up, head fixed', () => {
    const i = inputFor(1920, 1080, 1, 'l3')!
    i.tabs = i.tabs.map(t => (t.id === 'l3' ? { ...t, open: { bodyHeight: 900 } } : t))
    const p = placeTabs(i)
    const l3 = p.tabs.get('l3')!
    expect(l3.grow).toBe('up')
    expect(l3.top).toBe(Math.round(l3.headTop - 900))
  })

  it('crowded-toolbar rule: a toolbar reaching the right column lifts that column\'s bottom limit', () => {
    const roomy = placeTabs(inputFor(1920, 1080, 1, undefined, 400)!)
    expect(roomy.crowded).toBe(false)
    const narrowDesk = inputFor(1100, 760, 1, undefined, 900)!
    const p = placeTabs(narrowDesk)
    expect(p.crowded).toBe(true)
    const toolTop = narrowDesk.toolbar!.top
    for (const id of ['r1', 'r2', 'r3', 'q']) expect(p.tabs.get(id)!.headTop + 32).toBeLessThanOrEqual(toolTop - 4 + 1e-9)
  })

  it('the free tab keeps to the toolbar row when the toolbar is clear of it', () => {
    const i = inputFor(1920, 1080, 1, undefined, 400)!
    const p = placeTabs(i)
    const row = i.toolbar!.top + (44 - 32) / 2
    expect(p.tabs.get('q')!.headTop).toBe(row)
  })

  describe('forced-state matrix: 0 crossings, 0 overlaps, 0 off-screen', () => {
    const states = [undefined, 'l1', 'l2', 'l3', 'r1', 'r2', 'r3', 'q']
    for (const width of [1440, 1280, 1100, 1000]) {
      for (const scale of [1, 1.4]) {
        it(`${width} wide at ${scale * 100}% text`, () => {
          let ran = 0
          for (const open of states) {
            for (const toolWidth of [400, 700]) {
              const i = inputFor(width, 900, scale, open, toolWidth)
              if (!i) continue                       // narrow arrangement: no leaders
              ran++
              const p = placeTabs(i)
              expect(p.crossings, `${open} ${toolWidth}`).toBe(0)
              expect(p.overlaps, `${open} ${toolWidth}`).toEqual([])
              expect(p.offscreen, `${open} ${toolWidth}`).toEqual([])
            }
          }
          if (width >= 1280 && scale === 1) expect(ran).toBeGreaterThan(0)
        })
      }
    }
  })
})
