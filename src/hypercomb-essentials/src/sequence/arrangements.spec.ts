import { afterEach, describe, expect, it } from 'vitest'
import { clampLanes, laneCoords, threeLaneCoords, threeLaneIndexes } from './arrangements.js'

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
    expect(clampLanes(Number.NaN)).toBe(3)
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
