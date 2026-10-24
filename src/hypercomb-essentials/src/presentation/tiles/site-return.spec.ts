// Leaving a website goes back to WHERE IT WAS SPAWNED FROM — the page the
// reader was on, in the view they were looking at. The rule replaced an
// "entrance tile" walk that answered a different question ("where does this
// site begin?") and always landed on the hexagons: stepping into a site from
// a deck and coming back out dropped the reader onto the site's own cell,
// staring at the raw grid.

import { describe, expect, it } from 'vitest'
import { HEXAGONS_SURFACE, sameSiteSegments, siteFlipTarget, siteFloorFor, siteReturnTarget } from './site-return.js'

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

describe('sameSiteSegments', () => {
  it('is order-sensitive and length-sensitive', () => {
    expect(sameSiteSegments(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameSiteSegments(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameSiteSegments(['a'], ['a', 'b'])).toBe(false)
    expect(sameSiteSegments([], [])).toBe(true)
  })
})

describe('siteFloorFor', () => {
  // A shared link opens minutes.hypercomb.com/2026-10-14 cold: the reader
  // stands on the page, the published creation is /minutes, and `..` must
  // reach the list (2026-10-15).
  it('a cold arrival inside a published creation has the creation root as its floor', () => {
    expect(siteFloorFor(['minutes', '2026-10-14'], ['minutes'])).toEqual(['minutes'])
  })
  it('arriving at the root itself keeps the root', () => {
    expect(siteFloorFor(['minutes'], ['minutes'])).toEqual(['minutes'])
  })
  it('with no published root the floor is where the reader stood', () => {
    expect(siteFloorFor(['a', 'b'], null)).toEqual(['a', 'b'])
    expect(siteFloorFor(['a', 'b'], [])).toEqual(['a', 'b'])
  })
  it('a published root that is not above the reader says nothing about this site', () => {
    expect(siteFloorFor(['games', 'arkanoid'], ['minutes'])).toEqual(['games', 'arkanoid'])
    expect(siteFloorFor(['minutes'], ['minutes', '2026-10-14'])).toEqual(['minutes'])
  })
})

describe('siteFlipTarget', () => {
  const spawnAtRoot = { mode: '', segments: [] as string[] }

  it('a WALK-OUT ends where the reader stands — go /colony from a site opened at the root stays on /colony', () => {
    expect(siteFlipTarget(spawnAtRoot, ['colony'], true)).toEqual({ mode: HEXAGONS_SURFACE, segments: ['colony'] })
  })

  it('a walk-out into a child that opts out of the site stays on that child too', () => {
    expect(siteFlipTarget(spawnAtRoot, ['hyperdex', 'x'], true).segments).toEqual(['hyperdex', 'x'])
  })

  it('an EXIT goes back the way in — wherever the site\'s own links took the reader', () => {
    expect(siteFlipTarget(spawnAtRoot, ['hyperdex'], false).segments).toEqual([])
    // toggled on at /dolphin, an in-site link replaced the place with /whales, then Escape
    expect(siteFlipTarget({ mode: '', segments: ['dolphin'] }, ['whales'], false).segments).toEqual(['dolphin'])
    expect(siteFlipTarget({ mode: 'square-tile-view', segments: ['family'] }, ['family', 'susan'], false))
      .toEqual({ mode: 'square-tile-view', segments: ['family'] })
  })

  it('an exit from a session with no spawn stays put, as before', () => {
    expect(siteFlipTarget(null, ['x'], false)).toEqual({ mode: HEXAGONS_SURFACE, segments: ['x'] })
  })
})
