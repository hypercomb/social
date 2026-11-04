import { describe, expect, it } from 'vitest'
import { railCoord } from './rail-grid.js'
import {
  accumulateRailPan,
  clampRailShift,
  railColumnCount,
  railColumnsThatFit,
  railMaxShift,
  railPitch,
  railSeedScale,
  railShiftOffset,
  railStepTiles,
  railTileIndex,
  railTilesBefore,
  railWindowOf,
  railWindowSize,
} from './rail-window.js'

const GEO = { circumRadiusPx: 32, gapPx: 6, padPx: 10 }

describe('rail rhythm', () => {
  it('nests 3-2-3 at three lanes flat-top running sideways', () => {
    const counts = [0, 1, 2, 3, 4].map(c => railColumnCount(c, 3, true, true))
    expect(counts).toEqual([3, 2, 3, 2, 3])
    expect(railTilesBefore(1, 3, true, true)).toBe(3)
    expect(railTilesBefore(2, 3, true, true)).toBe(5)
    expect(railTilesBefore(5, 3, true, true)).toBe(13)
  })

  it('agrees with rail-grid: the first N columns hold exactly railTilesBefore(N) slots', () => {
    for (const [flat, horizontal] of [[true, true], [false, false], [true, false], [false, true]] as const) {
      for (const lanes of [1, 2, 3]) {
        for (let cols = 0; cols <= 7; cols++) {
          const slots = railTilesBefore(cols, lanes, flat, horizontal)
          // a column is a set of slots sharing one depth along the strip
          const depths = new Set<number>()
          for (let s = 0; s < slots; s++) {
            const c = railCoord(s, lanes, flat, horizontal)
            depths.add(flat && horizontal ? c.q : flat ? c.r + Math.floor(c.q / 2) : horizontal ? c.q + Math.floor(c.r / 2) : c.r)
          }
          expect(depths.size, `${flat}/${horizontal}/${lanes}/${cols}`).toBe(slots === 0 ? 0 : cols)
        }
      }
    }
  })

  it('a step is one rhythm period of two columns', () => {
    expect(railStepTiles(3, true, true)).toBe(5)
    expect(railStepTiles(2, true, true)).toBe(3)
    expect(railStepTiles(3, false, false)).toBe(6)
    expect(railStepTiles(1, true, true)).toBe(2)
  })

  it('a shift is an exact translation: tiles keep their relative slots', () => {
    // the tile at slot s after a step sits where the tile at s+step sat before
    const lanes = 3
    const step = railStepTiles(lanes, true, true)
    for (let s = 0; s < 8; s++) {
      const here = railCoord(s + step, lanes, true, true)
      const there = railCoord(s, lanes, true, true)
      expect(here.q - there.q).toBe(2)
      // flat-top screen y ∝ r + q/2: unchanged by a two-column translation
      expect(here.r + here.q / 2).toBeCloseTo(there.r + there.q / 2)
    }
  })
})

describe('window size', () => {
  it('lays hex pitch the way the mesh does', () => {
    const s = 38
    const flatH = railPitch(GEO, true, true)
    expect(flatH.longPitch).toBeCloseTo(1.5 * s)
    expect(flatH.acrossPitch).toBeCloseTo(Math.sqrt(3) * s)
    const pointV = railPitch(GEO, false, false)
    expect(pointV.longPitch).toBeCloseTo(1.5 * s)
    const pointH = railPitch(GEO, false, true)
    expect(pointH.longPitch).toBeCloseTo(Math.sqrt(3) * s)
  })

  it('reserves the half-cell the cross pairings sit along, so no column is clipped', () => {
    const cross = railPitch(GEO, false, true, 3)
    expect(cross.longOffset).toBeCloseTo(cross.longPitch / 2)
    expect(railPitch(GEO, false, true, 1).longOffset).toBe(0)
    expect(railPitch(GEO, true, true, 3).longOffset).toBe(0)
    // exactly the room for 4 columns plus the offset: 4 fit, a pixel less: 3
    const room = cross.longSpan + cross.longOffset + 3 * cross.longPitch
    expect(railColumnsThatFit(room, 1, cross)).toBe(4)
    expect(railColumnsThatFit(room - 1, 1, cross)).toBe(3)
  })

  it('counts only whole columns that fit, and at least one', () => {
    const p = railPitch(GEO, true, true)
    expect(railColumnsThatFit(10, 1, p)).toBe(1)
    expect(railColumnsThatFit(p.longSpan, 1, p)).toBe(1)
    expect(railColumnsThatFit(p.longSpan + p.longPitch - 0.01, 1, p)).toBe(1)
    expect(railColumnsThatFit(p.longSpan + p.longPitch, 1, p)).toBe(2)
    expect(railColumnsThatFit(p.longSpan + 4 * p.longPitch + 1, 1, p)).toBe(5)
  })

  it('capacity is the slot count of the fitting columns', () => {
    const p = railPitch(GEO, true, true)
    const w = railWindowSize(p.longSpan + 4 * p.longPitch + 1, 1, GEO, 3, true, true)
    expect(w.columns).toBe(5)
    expect(w.capacity).toBe(13)
  })

  it('shrinks with zoom and grows with room', () => {
    const big = railWindowSize(1200, 1, GEO, 3, true, true).capacity
    const small = railWindowSize(1200, 2, GEO, 3, true, true).capacity
    const wide = railWindowSize(2400, 1, GEO, 3, true, true).capacity
    expect(small).toBeLessThan(big)
    expect(wide).toBeGreaterThan(big)
  })

  it('seeds a scale that puts the lanes across the short axis', () => {
    const scale = railSeedScale(600, GEO, 3, true, true)
    const p = railPitch(GEO, true, true)
    const acrossPx = (2 * p.acrossPitch + p.acrossSpan) * scale
    expect(acrossPx).toBeLessThanOrEqual(600)
    expect(acrossPx).toBeGreaterThan(400)
  })
})

describe('shift ↔ tile index', () => {
  it('slot s shows tile s + shift * step', () => {
    expect(railTileIndex(0, 0, 3, true, true)).toBe(0)
    expect(railTileIndex(4, 2, 3, true, true)).toBe(14)
    expect(railShiftOffset(3, 3, false, false)).toBe(18)
  })

  it('reaches the last tile and never goes past it', () => {
    const cap = 13
    expect(railMaxShift(10, cap, 3, true, true)).toBe(0)
    expect(railMaxShift(13, cap, 3, true, true)).toBe(0)
    expect(railMaxShift(14, cap, 3, true, true)).toBe(1)
    expect(railMaxShift(18, cap, 3, true, true)).toBe(1)
    expect(railMaxShift(19, cap, 3, true, true)).toBe(2)
    for (const count of [14, 30, 101]) {
      const last = railMaxShift(count, cap, 3, true, true)
      expect(railShiftOffset(last, 3, true, true) + cap).toBeGreaterThanOrEqual(count)
      if (last > 0) expect(railShiftOffset(last - 1, 3, true, true) + cap).toBeLessThan(count)
    }
  })

  it('clamps to [0, last] and ignores junk', () => {
    expect(clampRailShift(-4, 40, 13, 3, true, true)).toBe(0)
    expect(clampRailShift(99, 40, 13, 3, true, true)).toBe(railMaxShift(40, 13, 3, true, true))
    expect(clampRailShift(Number.NaN, 40, 13, 3, true, true)).toBe(0)
    expect(clampRailShift(3, 5, 13, 3, true, true)).toBe(0)
  })

  it('hands on only the tiles inside the window', () => {
    const tiles = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const first = railWindowOf(tiles, 0, 13, 3, true, true)
    expect(first).toEqual(tiles.slice(0, 13))
    const next = railWindowOf(tiles, 1, 13, 3, true, true)
    expect(next[0]).toBe('t5')
    expect(next).toHaveLength(13)
    // a shift past the end is clamped, and the last tile is still in view
    const end = railWindowOf(tiles, 50, 13, 3, true, true)
    expect(end).toContain('t39')
    // a strip that fits is never trimmed
    expect(railWindowOf(tiles.slice(0, 6), 3, 13, 3, true, true)).toEqual(tiles.slice(0, 6))
  })

  it('is a pure function of its inputs', () => {
    const tiles = Array.from({ length: 25 }, (_, i) => i)
    expect(railWindowOf(tiles, 2, 12, 3, false, false)).toEqual(railWindowOf(tiles, 2, 12, 3, false, false))
    expect(railWindowOf(tiles, 2, 12, 3, false, false)).toEqual(tiles.slice(12, 24))
  })
})

describe('pan → shift accumulator', () => {
  it('does nothing until a whole step is travelled, then carries the rest', () => {
    let r = accumulateRailPan(0, -30, 100)
    expect(r).toEqual({ steps: 0, carry: -30 })
    r = accumulateRailPan(r.carry, -30, 100)
    r = accumulateRailPan(r.carry, -50, 100)
    expect(r.steps).toBe(1)
    expect(r.carry).toBeCloseTo(-10)
  })

  it('content follows the hand: dragging toward + brings earlier tiles back', () => {
    expect(accumulateRailPan(0, 250, 100).steps).toBe(-2)
    expect(accumulateRailPan(0, -250, 100).steps).toBe(2)
  })

  it('a slow drag adds up rather than being rounded away', () => {
    let carry = 0
    let total = 0
    for (let i = 0; i < 40; i++) {
      const r = accumulateRailPan(carry, -10, 100)
      carry = r.carry
      total += r.steps
    }
    expect(total).toBe(4)
  })

  it('ignores a step size that is not usable', () => {
    expect(accumulateRailPan(5, 100, 0)).toEqual({ steps: 0, carry: 5 })
    expect(accumulateRailPan(5, Number.NaN, 100)).toEqual({ steps: 0, carry: 5 })
  })
})
