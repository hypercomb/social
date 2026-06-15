// diamondcoreprocessor.com/pixi/stage-centering.spec.ts
//
// Coverage of the resize/fullscreen centering policy:
//   - stage = roundedCenter + pan, for any screen size
//   - content's offset from the viewport center IS the pan — invariant
//     across arbitrary size changes (resize, rotation, fullscreen)
//   - the stage moves by exactly the center delta ("the fixed extra"),
//     independent of pan
//   - fullscreen round-trips land the stage back exactly where it was
//   - the fit-refit guard fires only on a KNOWN zero pan

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  computeStageCenter,
  computeCenterDelta,
  computeViewportOrigin,
  computePhysicalAnchor,
  computePinnedStage,
  shouldRefit,
  type ScreenSize,
  type Pan,
  type WindowMetrics,
} from './stage-centering.js'

// fast-check generators: realistic CSS-pixel viewport sizes (mobile
// portrait up to multi-monitor desktop) and integer pan offsets.
const arbSize = fc.record({
  width: fc.integer({ min: 320, max: 7680 }),
  height: fc.integer({ min: 320, max: 4320 }),
})
const arbPan = fc.record({
  dx: fc.integer({ min: -5000, max: 5000 }),
  dy: fc.integer({ min: -5000, max: 5000 }),
})

const roundedCenter = (s: ScreenSize) => ({
  x: Math.round(s.width * 0.5),
  y: Math.round(s.height * 0.5),
})

describe('computeStageCenter', () => {
  it('centers exactly on even dimensions with zero pan', () => {
    expect(computeStageCenter({ width: 1536, height: 864 }, { dx: 0, dy: 0 }))
      .toEqual({ x: 768, y: 432 })
  })

  it('rounds odd dimensions to whole pixels (no sub-pixel drift)', () => {
    const pos = computeStageCenter({ width: 1537, height: 695 }, { dx: 0, dy: 0 })
    expect(pos).toEqual({ x: 769, y: 348 })
    expect(Number.isInteger(pos.x)).toBe(true)
    expect(Number.isInteger(pos.y)).toBe(true)
  })

  it('applies pan additively as an offset from center', () => {
    expect(computeStageCenter({ width: 1200, height: 800 }, { dx: 120, dy: -45 }))
      .toEqual({ x: 720, y: 355 })
  })

  it('treats missing pan (VP read in flight) as centered', () => {
    expect(computeStageCenter({ width: 1000, height: 600 }))
      .toEqual({ x: 500, y: 300 })
    expect(computeStageCenter({ width: 1000, height: 600 }, null))
      .toEqual({ x: 500, y: 300 })
  })

  it('keeps fractional pans intact', () => {
    const pos = computeStageCenter({ width: 1000, height: 600 }, { dx: 10.25, dy: -3.5 })
    expect(pos.x).toBeCloseTo(510.25, 10)
    expect(pos.y).toBeCloseTo(296.5, 10)
  })

  it('PROPERTY: offset from the rounded center is exactly the pan, for any screen size', () => {
    fc.assert(
      fc.property(arbSize, arbPan, (size, pan) => {
        const pos = computeStageCenter(size, pan)
        const c = roundedCenter(size)
        expect(pos.x - c.x).toBe(pan.dx)
        expect(pos.y - c.y).toBe(pan.dy)
      }),
    )
  })
})

describe('resize keeps content centered on its current position', () => {
  it('PROPERTY: pan (offset from center) is invariant across any size change', () => {
    fc.assert(
      fc.property(arbSize, arbSize, arbPan, (before, after, pan) => {
        const posBefore = computeStageCenter(before, pan)
        const posAfter = computeStageCenter(after, pan)
        const offsetBefore = {
          x: posBefore.x - roundedCenter(before).x,
          y: posBefore.y - roundedCenter(before).y,
        }
        const offsetAfter = {
          x: posAfter.x - roundedCenter(after).x,
          y: posAfter.y - roundedCenter(after).y,
        }
        // content that was centered stays centered; panned content keeps
        // the same offset from the NEW center
        expect(offsetAfter).toEqual(offsetBefore)
      }),
    )
  })

  it('PROPERTY: the stage moves by exactly the fixed extra (center delta), independent of pan', () => {
    fc.assert(
      fc.property(arbSize, arbSize, arbPan, (before, after, pan) => {
        const posBefore = computeStageCenter(before, pan)
        const posAfter = computeStageCenter(after, pan)
        const extra = computeCenterDelta(before, after)
        expect(posAfter.x - posBefore.x).toBe(extra.dx)
        expect(posAfter.y - posBefore.y).toBe(extra.dy)
        // the extra is determined by the sizes alone — pan never leaks in
        const zeroPanDelta = {
          dx: computeStageCenter(after).x - computeStageCenter(before).x,
          dy: computeStageCenter(after).y - computeStageCenter(before).y,
        }
        expect(extra).toEqual(zeroPanDelta)
      }),
    )
  })

  it('PROPERTY: fullscreen round-trip restores the exact stage position', () => {
    fc.assert(
      fc.property(arbSize, fc.integer({ min: 1, max: 300 }), arbPan, (windowed, chrome, pan) => {
        // entering fullscreen reclaims the browser chrome height (and
        // possibly nothing horizontally); exiting gives it back
        const fullscreen: ScreenSize = { width: windowed.width, height: windowed.height + chrome }
        const start = computeStageCenter(windowed, pan)
        const inFull = computeStageCenter(fullscreen, pan)
        const back = computeStageCenter(windowed, pan)
        expect(back).toEqual(start)
        // and while fullscreen, content is still exactly pan from center
        const c = roundedCenter(fullscreen)
        expect(inFull.x - c.x).toBe(pan.dx)
        expect(inFull.y - c.y).toBe(pan.dy)
      }),
    )
  })

  it('regression: fullscreen toggle no longer pulls centered content off-center', () => {
    // 1536x695 maximized window (864 screen minus ~169px of chrome/taskbar)
    const windowed: ScreenSize = { width: 1536, height: 695 }
    const fullscreen: ScreenSize = { width: 1536, height: 864 }
    const pan: Pan = { dx: 0, dy: 0 }

    const before = computeStageCenter(windowed, pan)   // (768, 348)
    const after = computeStageCenter(fullscreen, pan)  // (768, 432)

    // the OLD behavior froze the stage at 348 — 84px above the new
    // center ("pulled up"). The stage must absorb the full delta.
    expect(after).toEqual({ x: 768, y: 432 })
    expect(after.y - before.y).toBe(computeCenterDelta(windowed, fullscreen).dy)
    // content sits dead-center in BOTH viewports
    expect(before).toEqual(roundedCenter(windowed))
    expect(after).toEqual(roundedCenter(fullscreen))
  })

  it('simulated session: pan, then maximize, fullscreen, and restore — offset never drifts', () => {
    // the worker recenters with the SAME pan on every size change; the
    // content's screen position is the stage position (content anchored
    // at the container origin)
    const pan: Pan = { dx: 220, dy: -80 }
    const sizes: ScreenSize[] = [
      { width: 1280, height: 720 },   // windowed
      { width: 1536, height: 695 },   // maximized (chrome visible)
      { width: 1536, height: 864 },   // fullscreen
      { width: 1536, height: 695 },   // exit fullscreen
      { width: 1280, height: 720 },   // un-maximize
    ]
    for (const size of sizes) {
      const stage = computeStageCenter(size, pan)
      const c = roundedCenter(size)
      expect({ dx: stage.x - c.x, dy: stage.y - c.y }).toEqual(pan)
    }
    // back at the starting size, the stage is exactly where it began
    expect(computeStageCenter(sizes[0], pan)).toEqual(computeStageCenter(sizes[4], pan))
  })
})

describe('fullscreen physical pinning', () => {
  // Real-world geometry: 1536×864 display, maximized Chrome window with
  // 129px of chrome above the viewport and a 40px taskbar below, going
  // to chrome-less fullscreen.
  const maximized: WindowMetrics = {
    screenX: 0, screenY: 0,
    outerWidth: 1536, outerHeight: 824,
    innerWidth: 1536, innerHeight: 695,
  }
  const fullscreen: WindowMetrics = {
    screenX: 0, screenY: 0,
    outerWidth: 1536, outerHeight: 864,
    innerWidth: 1536, innerHeight: 864,
  }

  const arbMetrics = fc.record({
    screenX: fc.integer({ min: -16, max: 3840 }),
    screenY: fc.integer({ min: -16, max: 2160 }),
    outerWidth: fc.integer({ min: 320, max: 7680 }),
    outerHeight: fc.integer({ min: 320, max: 4320 }),
    innerWidth: fc.integer({ min: 320, max: 7680 }),
    innerHeight: fc.integer({ min: 320, max: 4320 }),
  })
  const arbStage = fc.record({
    x: fc.integer({ min: -5000, max: 10000 }),
    y: fc.integer({ min: -5000, max: 10000 }),
  })

  it('viewport origin: chrome height attributed to the top, borders split horizontally', () => {
    expect(computeViewportOrigin(maximized)).toEqual({ left: 0, top: 129 })
    expect(computeViewportOrigin(fullscreen)).toEqual({ left: 0, top: 0 })
  })

  it('PROPERTY: pinning keeps the physical screen position exactly constant', () => {
    fc.assert(
      fc.property(arbMetrics, arbMetrics, arbStage, (fromW, toW, stage) => {
        const from = computeViewportOrigin(fromW)
        const to = computeViewportOrigin(toW)
        const anchor = computePhysicalAnchor(from, stage)
        const pinned = computePinnedStage(anchor, to)
        // physical position = origin + stage, before and after
        expect(to.left + pinned.x).toBeCloseTo(from.left + stage.x, 9)
        expect(to.top + pinned.y).toBeCloseTo(from.top + stage.y, 9)
      }),
    )
  })

  it('PROPERTY: enter→exit round-trip restores the stage exactly', () => {
    fc.assert(
      fc.property(arbMetrics, arbMetrics, arbStage, (fromW, toW, stage) => {
        const from = computeViewportOrigin(fromW)
        const to = computeViewportOrigin(toW)
        const entered = computePinnedStage(computePhysicalAnchor(from, stage), to)
        const exited = computePinnedStage(computePhysicalAnchor(to, entered), from)
        expect(exited).toEqual(stage)
      }),
    )
  })

  it('regression: the half-inch jump — recenter-only lifted content 45px; pinning lifts 0', () => {
    // centered, zero-pan stage in the maximized window
    const stage = computeStageCenter(
      { width: maximized.innerWidth, height: maximized.innerHeight },
    ) // (768, 348)
    const from = computeViewportOrigin(maximized)   // top 129
    const to = computeViewportOrigin(fullscreen)    // top 0

    // OLD policy (recenter): stage moves to the new center
    const recentered = computeStageCenter(
      { width: fullscreen.innerWidth, height: fullscreen.innerHeight },
    ) // (768, 432)
    const physicalBefore = from.top + stage.y          // 129 + 348 = 477
    const physicalRecentered = to.top + recentered.y   // 0 + 432 = 432
    expect(physicalRecentered - physicalBefore).toBe(-45)  // the jump UP

    // and that 45 decomposes exactly: origin delta + center delta
    const originDelta = to.top - from.top                                  // -129
    const centerDelta = computeCenterDelta(
      { width: maximized.innerWidth, height: maximized.innerHeight },
      { width: fullscreen.innerWidth, height: fullscreen.innerHeight },
    ).dy                                                                   // +84
    expect(originDelta + centerDelta).toBe(-45)

    // NEW policy (pin): zero physical movement; the 45px becomes pan
    const pinned = computePinnedStage(computePhysicalAnchor(from, stage), to)
    expect(to.top + pinned.y).toBe(physicalBefore)   // content does not move
    expect(pinned).toEqual({ x: 768, y: 477 })
    const pan = { dx: pinned.x - recentered.x, dy: pinned.y - recentered.y }
    expect(pan).toEqual({ dx: 0, dy: 45 })           // asymmetry absorbed by pan

    // exit restores everything: stage back to (768, 348), pan back to 0
    const exited = computePinnedStage(computePhysicalAnchor(to, pinned), from)
    expect(exited).toEqual({ x: 768, y: 348 })
    expect(exited).toEqual(stage)
  })

  it('keeps a user pan pinned too — the anchor includes it', () => {
    const stage = { x: 768 + 220, y: 348 - 80 }   // panned away from center
    const from = computeViewportOrigin(maximized)
    const to = computeViewportOrigin(fullscreen)
    const pinned = computePinnedStage(computePhysicalAnchor(from, stage), to)
    expect(to.left + pinned.x).toBe(from.left + stage.x)
    expect(to.top + pinned.y).toBe(from.top + stage.y)
  })
})

describe('shouldRefit', () => {
  it('refits a saved fit zoom only when pan is known zero', () => {
    expect(shouldRefit({ fit: true }, { dx: 0, dy: 0 })).toBe(true)
  })

  it('never refits when the user has panned away from the fit', () => {
    expect(shouldRefit({ fit: true }, { dx: 12, dy: 0 })).toBe(false)
    expect(shouldRefit({ fit: true }, { dx: 0, dy: -1 })).toBe(false)
  })

  it('never refits while the VP read is still in flight (undefined pan)', () => {
    expect(shouldRefit({ fit: true }, undefined)).toBe(false)
    expect(shouldRefit({ fit: true }, null)).toBe(false)
  })

  it('never refits a manual (non-fit) zoom', () => {
    expect(shouldRefit({}, { dx: 0, dy: 0 })).toBe(false)
    expect(shouldRefit({ fit: false }, { dx: 0, dy: 0 })).toBe(false)
    expect(shouldRefit(undefined, { dx: 0, dy: 0 })).toBe(false)
    expect(shouldRefit(null, { dx: 0, dy: 0 })).toBe(false)
  })
})
