// Leaving a website goes back to WHERE IT WAS SPAWNED FROM — the page the
// reader was on, in the view they were looking at. The rule replaced an
// "entrance tile" walk that answered a different question ("where does this
// site begin?") and always landed on the hexagons: stepping into a site from
// a deck and coming back out dropped the reader onto the site's own cell,
// staring at the raw grid.

import { describe, expect, it } from 'vitest'
import { HEXAGONS_SURFACE, sameSegments, siteReturnTarget } from './site-return.js'

describe('siteReturnTarget', () => {

  it('returns to the VIEW that spawned the site, not the default surface', () => {
    const target = siteReturnTarget(
      { mode: 'square-tile-view', segments: ['family'] },
      ['family', 'susan', 'about'],
    )
    expect(target.mode).toBe('square-tile-view')
  })

  it('returns to the PAGE that spawned the site, not the page being read', () => {
    const target = siteReturnTarget(
      { mode: 'square-tile-view', segments: ['family'] },
      ['family', 'susan', 'about'],
    )
    expect([...target.segments]).toEqual(['family'])
  })

  it('a site toggled on while standing still comes back to the same cell', () => {
    // No arrival corrected the spawn, so the place it was spawned from IS
    // the cell the site is on — the reader never went anywhere.
    const target = siteReturnTarget(
      { mode: HEXAGONS_SURFACE, segments: ['family', 'susan'] },
      ['family', 'susan', 'about'],
    )
    expect(target.mode).toBe(HEXAGONS_SURFACE)
    expect([...target.segments]).toEqual(['family', 'susan'])
  })

  it('an empty spawn mode is the hexagons', () => {
    expect(siteReturnTarget({ mode: '', segments: [] }, ['susan']).mode).toBe(HEXAGONS_SURFACE)
  })

  it('an empty spawn PATH is the hive root, a real place — not a missing one', () => {
    const target = siteReturnTarget({ mode: '', segments: [] }, ['susan', 'about'])
    expect([...target.segments]).toEqual([])
  })

  it('an INDIRECT session (booted into website mode) stays where it stands', () => {
    // Nobody chose to be anywhere else — never teleport them.
    const target = siteReturnTarget(null, ['susan', 'about'])
    expect(target.mode).toBe(HEXAGONS_SURFACE)
    expect([...target.segments]).toEqual(['susan', 'about'])
  })
})

describe('sameSegments', () => {
  it('is order-sensitive and length-sensitive', () => {
    expect(sameSegments(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameSegments(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameSegments(['a'], ['a', 'b'])).toBe(false)
    expect(sameSegments([], [])).toBe(true)
  })
})
