// presentation/tiles/view-spawn.spec.ts
//
// The way out of a stepped-into view. Pinned as a pure rule so the
// destination can be read without standing up a renderer.

import { describe, it, expect } from 'vitest'
import { HEXAGONS, sameSegments, spawnForView, viewReturnTarget } from './view-spawn.js'

describe('viewReturnTarget', () => {
  it('lands on the page the view was stepped into from, not the entrance', () => {
    // Clicked the tree icon on `behaviors` while standing in a deck three
    // rings away: the walk went to the branch root, coming out does not.
    const target = viewReturnTarget(
      { view: 'tree', mode: HEXAGONS, segments: ['family', 'susan'] },
      ['behaviors'],
    )
    expect(target.segments).toEqual(['family', 'susan'])
    expect(target.mode).toBe(HEXAGONS)
  })

  it('restores the surface that was up, not just the place', () => {
    const target = viewReturnTarget(
      { view: 'tree', mode: 'square', segments: ['family'] },
      ['behaviors', 'views'],
    )
    expect(target.mode).toBe('square')
    expect(target.segments).toEqual(['family'])
  })

  it('reads an empty spawn mode as the hexagons', () => {
    expect(viewReturnTarget({ view: 'tree', mode: '', segments: [] }, ['behaviors']).mode).toBe(HEXAGONS)
  })

  it('treats an empty spawn path as the hive root — a place, not a gap', () => {
    expect(viewReturnTarget({ view: 'tree', mode: '', segments: [] }, ['behaviors']).segments).toEqual([])
  })

  it('stays put with no spawn — nothing stepped in, so nothing to step back to', () => {
    const target = viewReturnTarget(null, ['behaviors', 'views'])
    expect(target.mode).toBe(HEXAGONS)
    expect(target.segments).toEqual(['behaviors', 'views'])
  })
})

describe('spawnForView', () => {
  it('honours only its own view', () => {
    const payload = { view: 'website', mode: '', segments: ['a'] }
    expect(spawnForView(payload, 'tree')).toBeNull()
    expect(spawnForView(payload, 'website')?.segments).toEqual(['a'])
  })

  it('survives a payload that is missing or malformed', () => {
    expect(spawnForView(null, 'tree')).toBeNull()
    expect(spawnForView(undefined, 'tree')).toBeNull()
    expect(spawnForView({ view: 'tree' }, 'tree')).toEqual({ view: 'tree', mode: '', segments: [] })
  })

  it('cleans the path the way navigation does', () => {
    expect(spawnForView({ view: 'tree', mode: ' square ', segments: [' a ', '', 'b'] }, 'tree'))
      .toEqual({ view: 'tree', mode: 'square', segments: ['a', 'b'] })
  })
})

describe('sameSegments', () => {
  it('is order-sensitive and length-sensitive', () => {
    expect(sameSegments(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameSegments(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameSegments(['a'], ['a', 'b'])).toBe(false)
  })
})
