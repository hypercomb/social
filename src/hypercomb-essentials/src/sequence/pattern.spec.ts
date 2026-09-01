import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STEP,
  honeycombCoords,
  maxOffset,
  parsePattern,
  patternBounds,
  patternCapacity,
  patternPixel,
  patternRecord,
  patternRows,
  patternStride,
  scrollOrder,
  slotAt,
  type PatternDefinition,
} from './pattern.js'

const honeycomb: PatternDefinition = {
  name: 'honeycomb',
  coords: honeycombCoords(3, 5),
  step: DEFAULT_STEP,
}

describe('honeycombCoords', () => {
  it('lays 3 rows as 4 / 5 / 4', () => {
    const rows = new Map<number, number>()
    for (const c of honeycomb.coords) rows.set(c.r, (rows.get(c.r) ?? 0) + 1)
    expect([...rows.entries()].sort((a, b) => a[0] - b[0])).toEqual([[-1, 4], [0, 5], [1, 4]])
    expect(patternCapacity(honeycomb)).toBe(13)
    expect(patternRows(honeycomb)).toBe(3)
  })

  it('interlocks the rows — outer rows sit half a hex off the middle', () => {
    const xs = (r: number) => honeycomb.coords.filter(c => c.r === r).map(c => patternPixel(c).x).sort((a, b) => a - b)
    const mid = xs(0)
    const top = xs(-1)
    // Every outer tile sits midway between two middle-row tiles.
    for (const x of top) {
      const nearest = mid.reduce((best, m) => Math.abs(m - x) < Math.abs(best - x) ? m : best, mid[0])
      expect(Math.abs(Math.abs(nearest - x) - Math.sqrt(3) / 2)).toBeLessThan(1e-9)
    }
  })

  it('forces an odd row count and produces a hexagon at 5 rows', () => {
    expect(patternRows({ name: '', coords: honeycombCoords(4, 5), step: DEFAULT_STEP })).toBe(3)
    expect(honeycombCoords(5, 5).length).toBe(19)
  })
})

describe('patternStride', () => {
  it('is the trailing edge — 3 tiles leave per step on the 4/5/4 block', () => {
    expect(patternStride(honeycomb)).toBe(3)
  })

  it('is one per step for a single row', () => {
    expect(patternStride({ name: '', coords: honeycombCoords(1, 5), step: DEFAULT_STEP })).toBe(1)
  })
})

describe('scrollOrder + slotAt', () => {
  const order = scrollOrder(honeycomb)
  const stride = patternStride(honeycomb)

  it('reads along the scroll axis, then across it', () => {
    const xs = order.map(c => patternPixel(c).x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9)
    expect(order.length).toBe(13)
  })

  it('shifts the whole arrangement one hex-width per step', () => {
    // Every tile still on-frame after one step has moved exactly -SQRT3 in x
    // and not at all in y: the arrangement translates rigidly.
    let stillShown = 0
    for (let k = 0; k < 13; k++) {
      const before = slotAt(order, stride, k, 0)
      const after = slotAt(order, stride, k, 1)
      if (!before || !after) continue
      stillShown++
      const a = patternPixel(before)
      const b = patternPixel(after)
      expect(b.x - a.x).toBeCloseTo(-Math.sqrt(3), 9)
      expect(b.y - a.y).toBeCloseTo(0, 9)
    }
    expect(stillShown).toBe(10)   // 13 shown, 3 leave
  })

  it('takes tiles off-frame at the trailing edge and brings the next ones in', () => {
    const shownAt = (offset: number, count: number): number[] => {
      const out: number[] = []
      for (let k = 0; k < count; k++) if (slotAt(order, stride, k, offset)) out.push(k)
      return out
    }
    expect(shownAt(0, 20)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(shownAt(1, 20)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(shownAt(2, 20)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('never caps the tile count — extra tiles are off-frame, not refused', () => {
    expect(slotAt(order, stride, 40, 0)).toBeNull()
    expect(slotAt(order, stride, 40, 10)).not.toBeNull()
  })
})

describe('maxOffset', () => {
  it('stops once the last tile is on-frame', () => {
    expect(maxOffset(13, 3, 13)).toBe(0)
    expect(maxOffset(13, 3, 14)).toBe(1)
    expect(maxOffset(13, 3, 19)).toBe(2)
    expect(maxOffset(13, 3, 5)).toBe(0)
  })
})

describe('patternBounds', () => {
  it('measures the block including the hexes at the rim', () => {
    const b = patternBounds(honeycomb)
    expect(b.height).toBeCloseTo(5, 9)                       // 3 rows: 1.5 * 2 + 2
    expect(b.width).toBeCloseTo(Math.sqrt(3) * 5, 9)         // 5 across the middle
    expect(b.cx).toBeCloseTo(0, 9)
    expect(b.cy).toBeCloseTo(0, 9)
  })
})

describe('parsePattern', () => {
  it('round-trips a record', () => {
    const parsed = parsePattern(patternRecord(honeycomb))
    expect(parsed?.coords.length).toBe(13)
    expect(parsed?.step).toEqual(DEFAULT_STEP)
    expect(parsed?.name).toBe('honeycomb')
  })

  it('rejects anything that is not a usable pattern', () => {
    expect(parsePattern(null)).toBeNull()
    expect(parsePattern({ kind: 'sequence', indexes: [1, 2] })).toBeNull()
    expect(parsePattern({ kind: 'pattern', coords: [] })).toBeNull()
    expect(parsePattern({ kind: 'pattern', coords: [{ q: 'x', r: 1 }] })).toBeNull()
  })

  it('drops duplicate slots and falls back to the horizontal step', () => {
    const p = parsePattern({ kind: 'pattern', coords: [{ q: 0, r: 0 }, { q: 0, r: 0 }], step: { q: 0, r: 0 } })
    expect(p?.coords.length).toBe(1)
    expect(p?.step).toEqual(DEFAULT_STEP)
  })
})
