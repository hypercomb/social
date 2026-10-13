import { describe, it, expect } from 'vitest'
import { openTraitWords, silhouetteSlots } from './trait-silhouette.js'

// A small spiral: slot i sits at (i, 0).
const line = (n: number) => (i: number) => (i < n ? { q: i, r: 0 } : null)

describe('openTraitWords', () => {
  it('a trait answered by a tile of that name is not open; spelling does not matter', () => {
    expect(openTraitWords(['portrait', 'tagline', 'logo'], ['Portrait', 'notes'])).toEqual(['tagline', 'logo'])
  })

  it('a level with no traits draws nothing', () => {
    expect(openTraitWords([], ['a', 'b'])).toEqual([])
  })
})

describe('silhouetteSlots', () => {
  it('takes the first free slots, skipping tiles, in the order the traits were opened', () => {
    const occupied = [{ q: 0, r: 0 }, { q: 2, r: 0 }]
    expect(silhouetteSlots(['tagline', 'logo'], occupied, line(10))).toEqual([
      { word: 'tagline', q: 1, r: 0, index: 1 },
      { word: 'logo', q: 3, r: 0, index: 3 },
    ])
  })

  it('an empty level seats the first trait in the middle slot', () => {
    expect(silhouetteSlots(['portrait'], [], line(10))).toEqual([{ word: 'portrait', q: 0, r: 0, index: 0 }])
  })

  it('stops quietly when the spiral runs out', () => {
    expect(silhouetteSlots(['a', 'b', 'c'], [{ q: 0, r: 0 }], line(2))).toEqual([{ word: 'a', q: 1, r: 0, index: 1 }])
  })

  it('ignores holes in the occupied list', () => {
    expect(silhouetteSlots(['a'], [null, undefined, { q: 0, r: 0 }], line(3))).toEqual([{ word: 'a', q: 1, r: 0, index: 1 }])
  })
})
