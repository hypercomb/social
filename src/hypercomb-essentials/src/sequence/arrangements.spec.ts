import { afterEach, describe, expect, it } from 'vitest'
import { LANE_DEFAULT, clampLanes, laneCoords, threeLaneCoords, threeLaneIndexes, rectangleCoords, flowerCoords } from './arrangements.js'

describe('threeLaneCoords', () => {
  afterEach(() => localStorage.removeItem('hc:hex-orientation'))

  it('fills three point-top columns from top to bottom, then left to right', () => {
    const coords = threeLaneCoords(8, false)
    expect(coords).toHaveLength(8)

    // Three items per complete column; offset conversion keeps each column
    // visually straight on a point-top grid.
    const screenColumns = coords.map(({ q, r }) => q + Math.floor(r / 2))
    expect(screenColumns).toEqual([-1, -1, -1, 0, 0, 0, 1, 1])
  })

  it('packs flat-top columns in the 3-2-3-2-3 honeycomb rhythm', () => {
    const coords = threeLaneCoords(13, true)
    expect(coords).toHaveLength(13)

    const counts = new Map<number, number>()
    for (const { q } of coords) counts.set(q, (counts.get(q) ?? 0) + 1)
    expect([...counts.values()]).toEqual([3, 2, 3, 2, 3])

    const positionsByColumn = [...counts.keys()].map((q) =>
      coords.filter((coord) => coord.q === q).map(({ q: cq, r }) => r + cq / 2),
    )
    expect(positionsByColumn).toEqual([
      [-1, 0, 1],
      [-0.5, 0.5],
      [-1, 0, 1],
      [-0.5, 0.5],
      [-1, 0, 1],
    ])
  })

  it('does not invent empty cells', () => {
    expect(threeLaneCoords(0, false)).toEqual([])
    expect(threeLaneCoords(-4, true)).toEqual([])
  })

  it('defaults Three lanes to point-top until flat-top is explicitly selected', () => {
    const pointCoords = threeLaneCoords(8, false)
    const pointIndexes = new Map(
      pointCoords.map(({ q, r }, index) => [`${q},${r}`, index]),
    )

    expect(threeLaneIndexes(8, pointIndexes)).toEqual(
      pointCoords.map((_, index) => index),
    )
  })

  // ── the legibility ladder: 3 scan · 2 browse · 1 read ──────────────

  it('packs two vertical lanes into two straight columns', () => {
    const coords = laneCoords(9, 2, false)
    const screenColumns = coords.map(({ q, r }) => q + Math.floor(r / 2))
    expect(new Set(screenColumns).size).toBe(2)
    expect(coords).toHaveLength(9)
  })

  it('packs one vertical lane into a single column', () => {
    const coords = laneCoords(7, 1, false)
    const screenColumns = coords.map(({ q, r }) => q + Math.floor(r / 2))
    expect(new Set(screenColumns)).toEqual(new Set([0]))
  })

  it('packs one horizontal lane into a single honeycomb row', () => {
    const coords = laneCoords(7, 1, true)
    // Flat-top screen y is r + q/2; a run of touching hexes alternates by
    // half a hex, so the row spans exactly one hex of height.
    const ys = coords.map(({ q, r }) => r + q / 2)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(0.5)
    expect(new Set(coords.map(({ q }) => q)).size).toBe(7)
  })

  it('keeps the two-lane horizontal strip in a 2-1-2 rhythm', () => {
    const coords = laneCoords(9, 2, true)
    const counts = new Map<number, number>()
    for (const { q } of coords) counts.set(q, (counts.get(q) ?? 0) + 1)
    expect([...counts.values()]).toEqual([2, 1, 2, 1, 2, 1])
  })

  it('clamps the ladder to its rungs', () => {
    expect(clampLanes(0)).toBe(1)
    expect(clampLanes(9)).toBe(3)
    expect(clampLanes(Number.NaN)).toBe(2)
  })

  it('starts new phones on the readable browse rung', () => {
    expect(LANE_DEFAULT).toBe(2)
  })

  it('uses flat-top packing only for an explicit flat-top preference', () => {
    localStorage.setItem('hc:hex-orientation', 'flat-top')
    const flatCoords = threeLaneCoords(8, true)
    const flatIndexes = new Map(
      flatCoords.map(({ q, r }, index) => [`${q},${r}`, index]),
    )

    expect(threeLaneIndexes(8, flatIndexes)).toEqual(
      flatCoords.map((_, index) => index),
    )
  })
})

const hexDist = (a: { q: number; r: number }, b: { q: number; r: number }): number => {
  const dq = a.q - b.q, dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

describe('rectangleCoords fills the viewport', () => {
  const span = (n: number, aspect: number) => {
    const xs = rectangleCoords(n, aspect).map(({ q, r }) => (q + r / 2) * Math.sqrt(3))
    const ys = rectangleCoords(n, aspect).map(({ r }) => r * 1.5)
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }
  it('runs wide in landscape and tall in portrait', () => {
    const wide = span(40, 16 / 9), tall = span(40, 9 / 16)
    expect(wide.w).toBeGreaterThan(wide.h)
    expect(tall.h).toBeGreaterThan(tall.w)
  })
  it('places every tile on its own hex', () => {
    const c = rectangleCoords(37, 2)
    expect(c).toHaveLength(37)
    expect(new Set(c.map(({ q, r }) => `${q},${r}`)).size).toBe(37)
  })
})

describe('flowerCoords never touch', () => {
  it('keeps a free hex between neighbouring flowers', () => {
    const c = flowerCoords(7 * 19)
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        if (Math.floor(i / 7) === Math.floor(j / 7)) continue
        expect(hexDist(c[i], c[j])).toBeGreaterThan(1)
      }
    }
  })
  it('seats the centre first, then its six petals', () => {
    const c = flowerCoords(7)
    expect(c[0]).toEqual({ q: 0, r: 0 })
    expect(c.slice(1).every((p) => hexDist(p, c[0]) === 1)).toBe(true)
  })
})

describe('flowers grow around the first, ring by ring', () => {
  const centres = (flowers: number) =>
    flowerCoords(flowers * 7).filter((_, i) => i % 7 === 0)
  it('puts the next six flowers around the first before going further out', () => {
    const c = centres(19)
    expect(c[0]).toEqual({ q: 0, r: 0 })
    for (let i = 1; i <= 6; i++) expect(hexDist(c[i], c[0])).toBe(4)
    for (let i = 7; i < 19; i++) expect(hexDist(c[i], c[0])).toBeGreaterThanOrEqual(8)
  })
})
