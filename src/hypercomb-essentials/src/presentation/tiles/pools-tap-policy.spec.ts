// presentation/tiles/pools-tap-policy.spec.ts : what a press lights in pools
// mode, with no pointer, no canvas and no clock. The overlay hands these
// functions what its press did; every combination is asked here.

import { describe, expect, it } from 'vitest'
import {
  BRANCH_HOLD_MS, offBandActions, poolsGateHeld, poolsHoldArms, poolsHoldLight, poolsTapLight,
  type PoolsPress,
} from './pools-tap-policy.js'

/** A clean press on one of your own tiles: one pointer, still, nothing begun under it. */
const press = (over: Partial<PoolsPress> = {}): PoolsPress => ({
  lighting: true, own: true, pointerType: 'mouse', moved: false, dragged: false, pointers: 1,
  gateHeld: false, shiftKey: false, ctrlKey: false, metaKey: false, heldMs: 0, ...over,
})

const KINDS = ['mouse', 'touch', 'pen'] as const
const BOTH = [false, true] as const

describe('the tap', () => {
  it('lights the tile, and Shift lights its whole branch', () => {
    for (const pointerType of KINDS) {
      expect(poolsTapLight(press({ pointerType })), pointerType).toBe('light')
      expect(poolsTapLight(press({ pointerType, shiftKey: true })), pointerType).toBe('light-branch')
    }
  })

  it('lights nothing when the release ends a reorder: the drag that moved the tile is not a tap on it', () => {
    expect(poolsTapLight(press({ dragged: true }))).toBe('none')
    expect(poolsTapLight(press({ dragged: true, shiftKey: true }))).toBe('none')
    expect(poolsTapLight(press({ pointerType: 'touch', dragged: true }))).toBe('none')
  })

  it('lights nothing when the pointer travelled, whether or not a drag began under it', () => {
    expect(poolsTapLight(press({ moved: true }))).toBe('none')
    expect(poolsTapLight(press({ moved: true, dragged: true }))).toBe('none')
  })

  it('lights nothing when a second pointer joined the press', () => {
    expect(poolsTapLight(press({ pointerType: 'touch', pointers: 2 }))).toBe('none')
    expect(poolsTapLight(press({ pointerType: 'touch', pointers: 3 }))).toBe('none')
  })

  it('lights nothing outside pools mode, on a peer\'s tile, or under the selection keys', () => {
    expect(poolsTapLight(press({ lighting: false }))).toBe('none')
    expect(poolsTapLight(press({ own: false }))).toBe('none')
    expect(poolsTapLight(press({ ctrlKey: true }))).toBe('none')
    expect(poolsTapLight(press({ metaKey: true }))).toBe('none')
  })

  it('does not ask the gate: a pinned page or an open window beside the hive leaves the tap its light', () => {
    expect(poolsTapLight(press({ gateHeld: true }))).toBe('light')
  })

  it('is a light exactly when the press was clean, across every combination', () => {
    for (const lighting of BOTH) for (const own of BOTH) for (const moved of BOTH) for (const dragged of BOTH)
      for (const pointers of [1, 2]) for (const shiftKey of BOTH) for (const ctrlKey of BOTH) for (const metaKey of BOTH)
        for (const pointerType of KINDS) {
          const asked = press({ lighting, own, moved, dragged, pointers, shiftKey, ctrlKey, metaKey, pointerType })
          const clean = lighting && own && !moved && !dragged && pointers === 1 && !ctrlKey && !metaKey
          expect(poolsTapLight(asked), JSON.stringify(asked)).toBe(clean ? (shiftKey ? 'light-branch' : 'light') : 'none')
        }
  })
})

describe('the branch hold', () => {
  const held = (over: Partial<PoolsPress> = {}): PoolsPress => press({ pointerType: 'touch', heldMs: BRANCH_HOLD_MS, ...over })

  it('lights the whole branch for a finger or a pen that stayed', () => {
    expect(poolsHoldLight(held())).toBe('light-branch')
    expect(poolsHoldLight(held({ pointerType: 'pen' }))).toBe('light-branch')
  })

  it('is never a mouse\'s: a mouse has Shift', () => {
    expect(poolsHoldArms(press({ pointerType: 'mouse' }))).toBe(false)
    expect(poolsHoldLight(held({ pointerType: 'mouse' }))).toBe('none')
  })

  it('lights nothing for the resting finger of a pinch', () => {
    // Two fingers down, the first one still: the gesture is the pinch's.
    expect(poolsHoldLight(held({ pointers: 2 }))).toBe('none')
    // And the finger that joins one already down arms no hold of its own.
    expect(poolsHoldArms(press({ pointerType: 'touch', pointers: 2 }))).toBe(false)
    expect(poolsHoldArms(press({ pointerType: 'touch', pointers: 1 }))).toBe(true)
  })

  it('lights nothing while a gesture or a modal holds the input', () => {
    expect(poolsHoldLight(held({ gateHeld: true }))).toBe('none')
  })

  it('lights nothing for a press that travelled or that a drag took', () => {
    expect(poolsHoldLight(held({ moved: true }))).toBe('none')
    expect(poolsHoldLight(held({ dragged: true }))).toBe('none')
  })

  it('lights nothing before the hold has matured', () => {
    expect(poolsHoldLight(held({ heldMs: BRANCH_HOLD_MS - 1 }))).toBe('none')
    expect(poolsHoldLight(held({ heldMs: 0 }))).toBe('none')
    expect(poolsHoldLight(held({ heldMs: BRANCH_HOLD_MS + 500 }))).toBe('light-branch')
  })

  it('arms only in pools mode, on one of your own tiles', () => {
    expect(poolsHoldArms(press({ pointerType: 'touch', lighting: false }))).toBe(false)
    expect(poolsHoldArms(press({ pointerType: 'touch', own: false }))).toBe(false)
    expect(poolsHoldLight(held({ lighting: false }))).toBe('none')
    expect(poolsHoldLight(held({ own: false }))).toBe('none')
  })

  it('never lights one tile alone, and lights the branch exactly when the hold was clean, across every combination', () => {
    for (const lighting of BOTH) for (const own of BOTH) for (const moved of BOTH) for (const dragged of BOTH)
      for (const pointers of [1, 2]) for (const gateHeld of BOTH) for (const pointerType of KINDS)
        for (const heldMs of [0, BRANCH_HOLD_MS - 1, BRANCH_HOLD_MS]) {
          const asked = press({ lighting, own, moved, dragged, pointers, gateHeld, pointerType, heldMs })
          const clean = lighting && own && !moved && !dragged && pointers === 1 && !gateHeld
            && pointerType !== 'mouse' && heldMs >= BRANCH_HOLD_MS
          expect(poolsHoldLight(asked), JSON.stringify(asked)).toBe(clean ? 'light-branch' : 'none')
        }
  })

  it('matures before the quick-menu ring\'s 380 ms, and after drag-to-move\'s 300 ms reservation', () => {
    expect(BRANCH_HOLD_MS).toBeLessThan(380)
    expect(BRANCH_HOLD_MS).toBeGreaterThan(300)
  })
})

describe('whether the input gate is held', () => {
  it('is not, with no gate or a free one', () => {
    expect(poolsGateHeld(null)).toBe(false)
    expect(poolsGateHeld(undefined)).toBe(false)
    expect(poolsGateHeld({ locked: false, pinOnly: false, owner: null })).toBe(false)
  })

  it('is, while a pinch or a pan has claimed it', () => {
    expect(poolsGateHeld({ locked: false, pinOnly: false, owner: 'touch-coordinator' })).toBe(true)
    expect(poolsGateHeld({ locked: false, pinOnly: false, owner: 'spacebar-pan' })).toBe(true)
  })

  it('is not, for drag-to-move\'s reservation on a finger that has not travelled', () => {
    expect(poolsGateHeld({ locked: false, pinOnly: false, owner: 'touch-move' })).toBe(false)
  })

  it('is, while the quick-menu ring or a modal has locked it', () => {
    expect(poolsGateHeld({ locked: true, pinOnly: false, owner: null })).toBe(true)
    expect(poolsGateHeld({ locked: true, pinOnly: false, owner: 'touch-move' })).toBe(true)
  })

  it('is not, for a pinned page: the pin freezes the viewport and nothing else', () => {
    expect(poolsGateHeld({ locked: true, pinOnly: true, owner: null })).toBe(false)
  })
})

describe('the light, off the hexagons', () => {
  const light = { name: 'make-public', profile: 'world' }
  const other = { name: 'files', profile: 'private' }

  it('is carried in the profile it was registered for, beside what the band gave', () => {
    expect(offBandActions([light, other], 'world', new Set(['pools-enter']))).toEqual([light])
  })

  it('is not carried twice when the band already has it', () => {
    expect(offBandActions([light], 'world', new Set(['make-public']))).toEqual([])
    expect(offBandActions([light, light], 'world', new Set())).toEqual([light])
  })

  it('is not carried into another profile', () => {
    expect(offBandActions([light], 'private', new Set())).toEqual([])
    expect(offBandActions([light], 'public-own', new Set())).toEqual([])
  })

  it('is nothing where nothing was registered off the band', () => {
    expect(offBandActions([], 'world', new Set())).toEqual([])
  })
})
