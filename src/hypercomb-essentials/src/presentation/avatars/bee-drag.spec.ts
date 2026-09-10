// presentation/avatars/bee-drag.spec.ts
//
// A BEE CAN BE PUT SOMEWHERE ELSE. What this pins:
//
//   1. a press only becomes a drag once it has travelled — a click that
//      wobbles still opens the request
//   2. the threshold is in CSS px, so it is the same gesture at any zoom
//   3. the bee does not jump under the cursor: the grab offset is kept
//   4. what is remembered is a displacement from the bee's OWN anchor, so a
//      pan carries the nudge along instead of stranding the bee
//   5. dropped back where the work put it, the bee goes home — that is the
//      whole of "undo a nudge"
//   6. the snap-home test is measured on SCREEN, not in the world

import { describe, it, expect } from 'vitest'
import { DRAG_PX, SNAP_HOME_PX, isDrag, nudgeFrom, snapsHome } from './bee-drag.js'

describe('bee drag — a press that travels carries the bee', () => {

  it('does not call a still press a drag', () => {
    expect(isDrag(0, 0)).toBe(false)
    expect(isDrag(1, 1)).toBe(false)
    expect(isDrag(DRAG_PX - 1, 0)).toBe(false)
  })

  it('takes up the drag the moment the press has travelled', () => {
    expect(isDrag(DRAG_PX, 0)).toBe(true)
    expect(isDrag(0, -DRAG_PX)).toBe(true)
    expect(isDrag(40, 30)).toBe(true)
  })

  it('keeps the grab offset, so the bee does not jump under the cursor', () => {
    // Grabbed 10 to the right and 4 below the dance centre; the pointer has
    // moved to (200, 100). The centre must land at (190, 96), which — against
    // a home at (150, 60) — is a nudge of (40, 36).
    const nudge = nudgeFrom({ x: 200, y: 100 }, { x: 10, y: 4 }, { x: 150, y: 60 })
    expect(nudge).toEqual({ x: 40, y: 36 })
  })

  it('holds a displacement from the anchor, not a place on the map', () => {
    // The same pull, with the hive panned 500 to the right underneath it,
    // yields the SAME nudge: the bee travels with the tile it belongs to.
    const still = nudgeFrom({ x: 200, y: 100 }, { x: 0, y: 0 }, { x: 150, y: 60 })
    const panned = nudgeFrom({ x: 700, y: 100 }, { x: 0, y: 0 }, { x: 650, y: 60 })
    expect(panned).toEqual(still)
  })

  it('sends a bee home when it is dropped back where its work put it', () => {
    expect(snapsHome({ x: 0, y: 0 }, 1)).toBe(true)
    expect(snapsHome({ x: SNAP_HOME_PX - 1, y: 0 }, 1)).toBe(true)
    expect(snapsHome({ x: SNAP_HOME_PX + 1, y: 0 }, 1)).toBe(false)
  })

  it('measures the drop on screen, so zoom does not change the gesture', () => {
    // Zoomed out to a quarter, a world displacement of 40 is 10 on screen —
    // and 10px from home is home.
    expect(snapsHome({ x: 40, y: 0 }, 0.25)).toBe(true)
    // Zoomed in ×4, the same world displacement is 160px away — nowhere near.
    expect(snapsHome({ x: 40, y: 0 }, 4)).toBe(false)
  })

  it('survives a world with no scale rather than dividing the hive by zero', () => {
    expect(snapsHome({ x: 4, y: 0 }, 0)).toBe(true)
  })
})
