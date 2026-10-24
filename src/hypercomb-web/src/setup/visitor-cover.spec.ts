// A HEXAGON DOOR'S COVER LIFTS ON ITS OWN PASS (setup/visitor-cover.ts).
//
// The cover subscribes to `render:cell-count` when the arrival verdict lands,
// and EffectBus replays the last pass into it at once. Every visit starts with
// a run of settled-empty passes at '/', the hive root, before any pass at the
// door (measured on business-card.hypercomb.com, 2026-10-24, where the door's
// own pass happened to come first). A door with no pass of its own yet when
// the verdict lands — show-cell held its paint, or the verdict was simply
// early — gets one of the root's, and the cover lifted over an unpainted grid.

import { describe, expect, it } from 'vitest'
import { locationKeyOf, passShowsArrival } from './visitor-cover'

describe('which pass lifts a hexagon door\'s cover', () => {
  const door = ['business-card']

  it('the hive root settled empty never lifts a door\'s cover', () => {
    expect(passShowsArrival(door, { locationKey: '/', count: 0, settled: true })).toBe(false)
  })

  it('tiles painted somewhere else do not lift it either', () => {
    expect(passShowsArrival(door, { locationKey: '/', count: 3 })).toBe(false)
  })

  it('the door\'s own tiles lift it, settled or not', () => {
    expect(passShowsArrival(door, { locationKey: '/business-card', count: 7 })).toBe(true)
  })

  it('the door\'s own place settled empty lifts it: the splash contract', () => {
    expect(passShowsArrival(door, { locationKey: '/business-card', count: 0, settled: true })).toBe(true)
  })

  it('an unsettled empty pass at the door is a transient, not an answer', () => {
    expect(passShowsArrival(door, { locationKey: '/business-card', count: 0 })).toBe(false)
  })

  it('a nested lineage matches its whole path, never a prefix', () => {
    const nested = ['games', 'arkanoid']
    expect(passShowsArrival(nested, { locationKey: '/games', count: 0, settled: true })).toBe(false)
    expect(passShowsArrival(nested, { locationKey: '/games/arkanoid', count: 0, settled: true })).toBe(true)
  })

  it('an engine that stamps no place, or a verdict that names none, is taken as before', () => {
    expect(passShowsArrival(door, { count: 0, settled: true })).toBe(true)
    expect(passShowsArrival(null, { locationKey: '/', count: 0, settled: true })).toBe(true)
    expect(passShowsArrival(door, undefined)).toBe(false)
  })

  it('the key is the Lineage label show-cell stamps', () => {
    expect(locationKeyOf([])).toBe('/')
    expect(locationKeyOf(['games', 'arkanoid'])).toBe('/games/arkanoid')
  })
})
// That the cover consults it is arrival-cover.spec.ts's replay case.
