import { describe, expect, it } from 'vitest'
import { buildRailMatrix, railCoord, railDepth } from './rail-grid.js'

/** Point-top screen x, in half-hex units, for an axial coordinate. */
const pointTopX = (c: { q: number; r: number }): number => 2 * c.q + c.r
/** Flat-top screen y, in half-hex units, for an axial coordinate. */
const flatTopY = (c: { q: number; r: number }): number => 2 * c.r + c.q

describe('rail-grid — portrait (point-top, strip runs top→bottom)', () => {
  it('reads as a feed: rows of three, filled left→right, stacked top→bottom', () => {
    const coords = Array.from({ length: 20 }, (_, i) => railCoord(i, 3, false))
    // Row r holds slots 3r, 3r+1, 3r+2.
    for (let i = 0; i < 20; i++) expect(coords[i].r).toBe(Math.floor(i / 3))
    // Within a row the lanes are consecutive q's, left→right.
    for (let row = 0; row < 6; row++) {
      const [a, b, c] = coords.slice(row * 3, row * 3 + 3)
      expect(b.q - a.q).toBe(1)
      expect(c.q - b.q).toBe(1)
    }
    // Twenty tiles in three lanes are seven rows deep, 3-3-3-3-3-3-2.
    expect(new Set(coords.map(c => c.r)).size).toBe(7)
    expect(coords.filter(c => c.r === 6)).toHaveLength(2)
  })

  it('keeps the rows straight and centred across the screen', () => {
    // Every row's three lanes sit at the same three screen x's, shifted by
    // the honeycomb half-hex on odd rows — never drifting sideways.
    const xs = (row: number): number[] => [0, 1, 2].map(l => pointTopX(railCoord(row * 3 + l, 3, false)))
    expect(xs(0)).toEqual([-2, 0, 2])
    expect(xs(1)).toEqual([-1, 1, 3])
    expect(xs(2)).toEqual([-2, 0, 2])
    expect(xs(40)).toEqual([-2, 0, 2])
    expect(xs(41)).toEqual([-1, 1, 3])
  })

  it('starts at the top and grows downward only', () => {
    expect(railCoord(0, 3, false).r).toBe(0)
    for (let i = 0; i < 300; i++) expect(railCoord(i, 3, false).r).toBeGreaterThanOrEqual(0)
    // Slot 0 never moves however long the strip is.
    expect(buildRailMatrix(3, false, 10).get(0)).toEqual(buildRailMatrix(3, false, 5000).get(0))
  })

  it('two lanes and one lane are the same strip, narrower', () => {
    const two = Array.from({ length: 9 }, (_, i) => railCoord(i, 2, false))
    for (let i = 0; i < 9; i++) expect(two[i].r).toBe(Math.floor(i / 2))
    const one = Array.from({ length: 9 }, (_, i) => railCoord(i, 1, false))
    for (let i = 0; i < 9; i++) expect(one[i].r).toBe(i)
    // One lane: every tile straight below the last, honeycomb-shifted.
    expect(one.map(pointTopX)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0])
  })
})

describe('rail-grid — landscape (flat-top, strip runs left→right)', () => {
  it('walks columns left→right in the 3-2-3 rhythm, each column top→bottom', () => {
    const coords = Array.from({ length: 20 }, (_, i) => railCoord(i, 3, true))
    // Columns alternate 3 / 2 slots: q 0,0,0,1,1,2,2,2,3,3,...
    const qs = coords.map(c => c.q)
    expect(qs.slice(0, 10)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 3, 3])
    // Twenty tiles fill eight columns exactly (4 × (3 + 2)).
    expect(new Set(qs).size).toBe(8)
    expect(Math.max(...qs)).toBe(7)
    // A full column is straight: three consecutive screen y's centred on 0.
    expect(coords.slice(0, 3).map(flatTopY)).toEqual([-2, 0, 2])
    // The tucked column nests between them.
    expect(coords.slice(3, 5).map(flatTopY)).toEqual([-1, 1])
    // And the rhythm holds far along the strip.
    expect(coords.slice(15, 18).map(flatTopY)).toEqual([-2, 0, 2])
  })

  it('starts at the left and grows rightward only', () => {
    expect(railCoord(0, 3, true).q).toBe(0)
    for (let i = 0; i < 300; i++) expect(railCoord(i, 3, true).q).toBeGreaterThanOrEqual(0)
  })

  it('one lane is one straight row', () => {
    const one = Array.from({ length: 9 }, (_, i) => railCoord(i, 1, true))
    expect(one.map(c => c.q)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(one.map(flatTopY)).size).toBeLessThanOrEqual(2)
  })

  it('two lanes alternate 2 / 1', () => {
    const two = Array.from({ length: 9 }, (_, i) => railCoord(i, 2, true))
    expect(two.map(c => c.q)).toEqual([0, 0, 1, 2, 2, 3, 4, 4, 5])
  })
})

describe('rail-grid — the matrix', () => {
  it('has one distinct coordinate per slot', () => {
    for (const flat of [false, true]) {
      for (const lanes of [1, 2, 3]) {
        const m = buildRailMatrix(lanes, flat, 600)
        expect(m.size).toBe(600)
        const keys = new Set([...m.values()].map(c => `${c.q},${c.r}`))
        expect(keys.size).toBe(600)
      }
    }
  })

  it('reports how far along the strip a slot sits', () => {
    expect([0, 2, 3, 5, 6].map(s => railDepth(s, 3, false))).toEqual([0, 0, 1, 1, 2])
    expect([0, 2, 3, 4, 5, 9, 10].map(s => railDepth(s, 3, true))).toEqual([0, 0, 1, 1, 2, 3, 4])
    expect(railDepth(7, 1, true)).toBe(7)
  })

  it('clamps the rung to the ladder', () => {
    expect(railCoord(4, 9, false)).toEqual(railCoord(4, 3, false))
    expect(railCoord(4, 0, false)).toEqual(railCoord(4, 1, false))
  })
})
