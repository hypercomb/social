// hypercomb-shared/ui/docked-panel/dock-lanes.spec.ts
//
// Dock LANES: an edge holds more than one tool window, they stack inward from
// it in the order they were opened, and a window pushed out of a full lane is
// PARKED rather than closed. The chrome that drives this lives in
// hc-docked-panel.directive.ts — an Angular directive, so it can't be imported
// under JIT; this covers the model it drives, exactly as panel-groups.spec.ts
// does for the group text.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type LaneMember, type LaneSide,
  LANE_SLOTS, TWO_LANE_MIN_WIDTH,
  claimLane, laneHasRoom, laneOccupants, layoutLane, reflowLanes, releaseLane, resetLanes,
} from './dock-lanes'

/** A tool window as the lane sees one: a width, where it was placed, and
 *  whether it was pushed out — the directive's LaneMember, minus the DOM. */
class FakeWindow implements LaneMember {
  offset: number | null = null
  evicted = false
  constructor(
    readonly id: string,
    readonly laneSide: LaneSide = 'right',
    public width = 300,
  ) {}
  laneWidth(): number { return this.width }
  placeInLane(offset: number): void { this.offset = offset }
  evictFromLane(): void { this.evicted = true }
}

const setViewport = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

describe('dock lanes', () => {

  beforeEach(() => {
    resetLanes()
    setViewport(1600)
  })

  it('sits the first window flush against its edge', () => {
    const first = new FakeWindow('notes')
    claimLane(first)
    expect(first.offset).toBe(0)
    expect(first.evicted).toBe(false)
  })

  it('stacks the second window inboard by the first one\'s width', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)
    // BOTH on screen — this is the whole point: a pheromone can be dragged
    // from one onto a row of the other.
    expect(outer.offset).toBe(0)
    expect(inner.offset).toBe(340)
    expect(outer.evicted).toBe(false)
    expect(inner.evicted).toBe(false)
  })

  it('keeps the two edges independent', () => {
    const right = new FakeWindow('notes', 'right')
    const left = new FakeWindow('history', 'left')
    claimLane(right)
    claimLane(left)
    expect(right.offset).toBe(0)
    expect(left.offset).toBe(0)
    expect(laneOccupants('right')).toHaveLength(1)
    expect(laneOccupants('left')).toHaveLength(1)
  })

  it('pushes out the OLDEST when a third arrives, and only that one', () => {
    const first = new FakeWindow('notes', 'right', 340)
    const second = new FakeWindow('pheromones', 'right', 300)
    const third = new FakeWindow('views', 'right', 370)
    claimLane(first)
    claimLane(second)
    claimLane(third)

    expect(first.evicted).toBe(true)
    expect(second.evicted).toBe(false)
    expect(third.evicted).toBe(false)
    // The survivors close up: the second slides flush, the third sits inboard.
    expect(second.offset).toBe(0)
    expect(third.offset).toBe(300)
  })

  it('slides the survivor outward when the outer window leaves', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)
    expect(inner.offset).toBe(340)

    releaseLane(outer)
    // Flush to the edge, not a 340px gap where a window used to be.
    expect(inner.offset).toBe(0)
  })

  it('moves the inner window when the outer one is resized', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)

    outer.width = 500          // a grip drag
    layoutLane('right')
    expect(inner.offset).toBe(500)
  })

  it('re-claiming an occupant re-lays out rather than taking a second place', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)

    outer.width = 420
    claimLane(outer)
    expect(laneOccupants('right')).toHaveLength(2)
    expect(inner.offset).toBe(420)
    expect(outer.evicted).toBe(false)
  })

  it('releasing something that never joined changes nothing', () => {
    const held = new FakeWindow('notes')
    const stranger = new FakeWindow('ghost')
    claimLane(held)
    releaseLane(stranger)
    expect(laneOccupants('right')).toEqual([held])
  })

  it('holds ONE window per edge on a narrow viewport', () => {
    setViewport(TWO_LANE_MIN_WIDTH - 1)
    const first = new FakeWindow('notes')
    const second = new FakeWindow('pheromones')
    claimLane(first)
    claimLane(second)
    // Two panels side by side on a phone would be two slabs and no hive.
    expect(first.evicted).toBe(true)
    expect(second.offset).toBe(0)
    expect(laneOccupants('right')).toEqual([second])
  })

  it('parks the oldest when the viewport shrinks past the two-slot width', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)
    expect(outer.evicted).toBe(false)

    setViewport(TWO_LANE_MIN_WIDTH - 1)
    reflowLanes()
    expect(outer.evicted).toBe(true)
    expect(inner.offset).toBe(0)
    expect(laneOccupants('right')).toEqual([inner])
  })

  it('places the survivors BEFORE parking anyone', () => {
    // A parked window unmounts; the ones staying must already be sitting where
    // they belong when it goes, or the lane is briefly seen with a gap.
    const first = new FakeWindow('notes', 'right', 340)
    const second = new FakeWindow('pheromones', 'right', 300)
    const order: string[] = []
    first.evictFromLane = (): void => { order.push('evict') }
    second.placeInLane = (offset: number): void => {
      order.push(`place:${offset}`)
      second.offset = offset
    }
    claimLane(first)
    claimLane(second)
    order.length = 0

    setViewport(TWO_LANE_MIN_WIDTH - 1)
    reflowLanes()
    expect(order).toEqual(['place:0', 'evict'])
  })

  it('exposes two slots on a roomy viewport', () => {
    expect(LANE_SLOTS).toBe(2)
    const windows = Array.from({ length: LANE_SLOTS }, (_, i) => new FakeWindow(`w${i}`))
    for (const w of windows) claimLane(w)
    expect(windows.some(w => w.evicted)).toBe(false)
  })

  it('survives a member whose width is not measurable yet', () => {
    const unmeasured = new FakeWindow('notes', 'right', 0)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(unmeasured)
    claimLane(inner)
    // No NaN, no negative offset — the pair just overlaps until the first
    // window reports a width, and the ResizeObserver re-lays it out.
    expect(inner.offset).toBe(0)
    expect(Number.isFinite(inner.offset ?? NaN)).toBe(true)
  })

  // The pairing guard: a window may bring its pair into a FREE place, but must
  // never push out a third window somebody opened themselves.
  describe('room for a pairing', () => {

    it('reports room while a slot is free', () => {
      claimLane(new FakeWindow('notes'))
      expect(laneHasRoom('right')).toBe(true)
    })

    it('reports none once the lane is full', () => {
      claimLane(new FakeWindow('notes'))
      claimLane(new FakeWindow('pheromones'))
      expect(laneHasRoom('right')).toBe(false)
    })

    it('reports none on a narrow viewport holding one', () => {
      setViewport(TWO_LANE_MIN_WIDTH - 1)
      claimLane(new FakeWindow('notes'))
      expect(laneHasRoom('right')).toBe(false)
    })

    it('is per edge', () => {
      claimLane(new FakeWindow('notes', 'right'))
      claimLane(new FakeWindow('pheromones', 'right'))
      expect(laneHasRoom('right')).toBe(false)
      expect(laneHasRoom('left')).toBe(true)
    })
  })

  it('reflow is a no-op while everything already fits', () => {
    const outer = new FakeWindow('notes', 'right', 340)
    const inner = new FakeWindow('pheromones', 'right', 300)
    claimLane(outer)
    claimLane(inner)
    const spy = vi.spyOn(outer, 'evictFromLane')
    reflowLanes()
    expect(spy).not.toHaveBeenCalled()
    expect(inner.offset).toBe(340)
  })
})
