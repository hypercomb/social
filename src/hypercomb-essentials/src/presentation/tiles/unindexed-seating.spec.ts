// presentation/tiles/unindexed-seating.spec.ts
//
// A TILE KEEPS ITS SEAT (SCALE-1). Tiles without a slot of their own — at a
// meeting, most of a big page: every peer index that collides with another
// peer's — are seated by the session and keep that seat across passes. Seated
// in one alphabetical sweep, the first tile that had lost its seat (an own tile
// claimed its index, or a peer's new tile) took the best free slot, which was
// the next tile's remembered seat, and the displacement ran down the whole
// pile: every peer's new tile reshuffled the page and paid one whole-grid
// score per displaced tile. Remembered seats are now taken back first.

import { describe, expect, it } from 'vitest'
import { seatUnindexed } from './unindexed-seating.js'

/** The scorer's shape: the best free slot is the first free one at or after
 *  `from` — like the viewport score, it prefers the same region every time,
 *  which is exactly what made the sweep cascade. Counts its calls. */
const scorer = (from: number) => {
  const calls = { n: 0 }
  const pick = (sparse: readonly string[]): number => {
    calls.n++
    for (let i = from; i < sparse.length; i++) if (!sparse[i]) return i
    return -1
  }
  return { pick, calls }
}

const grid = (size: number): string[] => new Array(size).fill('')

describe('seatUnindexed — a tile keeps the seat this session gave it', () => {
  it('a displaced tile never pushes the rest of the pile out of their seats', () => {
    // A thousand-tile meeting in miniature: four pile tiles seated last pass at
    // 10..13; an own tile now claims 10 (its persisted index).
    const remembered = new Map([['a', 10], ['b', 11], ['c', 12], ['d', 13]])
    const sparse = grid(32)
    sparse[10] = 'own'
    const { pick, calls } = scorer(10)
    seatUnindexed(sparse, ['a', 'b', 'c', 'd'], 31, remembered, pick)
    expect(sparse.slice(10, 15)).toEqual(['own', 'b', 'c', 'd', 'a'])
    // Only the tile that truly lost its seat was scored, and only it moved.
    expect(calls.n).toBe(1)
    expect([...remembered]).toEqual([['a', 14], ['b', 11], ['c', 12], ['d', 13]])
  })

  it('a peer\'s new tile is seated without moving anyone', () => {
    // 'aa' sorts first: in one sweep it took 'b's remembered seat, and so on.
    const remembered = new Map([['b', 5], ['c', 6], ['d', 7]])
    const sparse = grid(16)
    const { pick, calls } = scorer(5)
    seatUnindexed(sparse, ['aa', 'b', 'c', 'd'], 15, remembered, pick)
    expect(sparse.slice(5, 9)).toEqual(['b', 'c', 'd', 'aa'])
    expect(calls.n).toBe(1)
  })

  it('a hundred-tile pile with one tile displaced costs one score, not a hundred', () => {
    const names = Array.from({ length: 100 }, (_, i) => `p${String(i).padStart(3, '0')}`)
    const remembered = new Map(names.map((name, i) => [name, 100 + i] as [string, number]))
    const sparse = grid(400)
    sparse[100] = 'own'
    const { pick, calls } = scorer(100)
    seatUnindexed(sparse, names, 399, remembered, pick)
    expect(calls.n).toBe(1)
    const moved = names.filter((name, i) => sparse[100 + i] !== name)
    expect(moved).toEqual(['p000'])
    expect(sparse.indexOf('p000')).toBe(200)
  })

  it('a tile with no remembered seat, or one out of range, is scored and remembered', () => {
    const remembered = new Map([['far', 99]])
    const sparse = grid(8)
    const { pick, calls } = scorer(0)
    const seated = seatUnindexed(sparse, ['far', 'new'], 7, remembered, pick)
    expect(calls.n).toBe(2)
    expect(seated).toEqual(['far→0', 'new→1'])
    expect(remembered.get('far')).toBe(0)
    expect(remembered.get('new')).toBe(1)
  })

  it('a full grid seats nothing more and remembers nothing for the unseated', () => {
    const remembered = new Map<string, number>()
    const sparse = ['x', 'y']
    const seated = seatUnindexed(sparse, ['z'], 1, remembered, () => -1)
    expect(seated).toEqual([])
    expect(sparse).toEqual(['x', 'y'])
    expect(remembered.has('z')).toBe(false)
  })

  it('two tiles remembering one seat: the first in pile order keeps it', () => {
    const remembered = new Map([['a', 3], ['b', 3]])
    const sparse = grid(8)
    const { pick } = scorer(0)
    seatUnindexed(sparse, ['a', 'b'], 7, remembered, pick)
    expect(sparse[3]).toBe('a')
    expect(sparse[0]).toBe('b')
  })
})
