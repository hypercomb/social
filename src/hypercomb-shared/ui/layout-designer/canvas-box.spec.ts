import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOX, MAX_FRACTION, MIN_FRACTION,
  boxStyle, parseBox, resizeCentred,
  type CanvasBox,
} from './canvas-box'

const VIEWPORT = { width: 1000, height: 800 }
const box = (w: number, h: number): CanvasBox => ({ w, h })

describe('the canvas stays in the middle', () => {
  it('grows on both axes when a corner is pulled outward', () => {
    // +100px right on a 1000px viewport is +10% of width — doubled, because
    // the opposite corner moves the same distance the other way.
    const out = resizeCentred(box(0.5, 0.5), 'se', 100, 80, VIEWPORT)
    expect(out.w).toBeCloseTo(0.7, 5)
    expect(out.h).toBeCloseTo(0.7, 5)
  })

  it('grows when the OPPOSITE corner is pulled the opposite way', () => {
    // The whole point of a centred box: nw and se are the same gesture
    // mirrored, and both mean "bigger" when dragged away from the middle.
    const se = resizeCentred(box(0.5, 0.5), 'se', 100, 80, VIEWPORT)
    const nw = resizeCentred(box(0.5, 0.5), 'nw', -100, -80, VIEWPORT)
    expect(nw).toEqual(se)
  })

  it('shrinks when a corner is pushed inward', () => {
    expect(resizeCentred(box(0.5, 0.5), 'se', -100, -80, VIEWPORT).w).toBeCloseTo(0.3, 5)
  })

  it('reads ne and sw on their own axes', () => {
    const out = resizeCentred(box(0.5, 0.5), 'ne', 100, -80, VIEWPORT)
    expect(out.w).toBeCloseTo(0.7, 5)
    expect(out.h).toBeCloseTo(0.7, 5)
  })

  it('never collapses, and fills its workspace when asked to', () => {
    expect(resizeCentred(box(0.5, 0.5), 'se', -9999, -9999, VIEWPORT))
      .toEqual({ w: MIN_FRACTION, h: MIN_FRACTION })
    expect(resizeCentred(box(0.5, 0.5), 'se', 9999, 9999, VIEWPORT))
      .toEqual({ w: MAX_FRACTION, h: MAX_FRACTION })
  })

  it('survives a zero-sized viewport rather than dividing by it', () => {
    const out = resizeCentred(box(0.5, 0.5), 'se', 10, 10, { width: 0, height: 0 })
    expect(Number.isFinite(out.w)).toBe(true)
    expect(Number.isFinite(out.h)).toBe(true)
  })
})

describe('the size is a proportion, not pixels', () => {
  it('is written as a percentage, so the browser does the centring', () => {
    expect(boxStyle(box(0.5, 0.25))).toEqual({ width: '50.00%', height: '25.00%' })
  })

  it('means the same box on a viewport of any size', () => {
    const wide = resizeCentred(box(0.5, 0.5), 'se', 100, 0, { width: 1000, height: 800 })
    const narrow = resizeCentred(box(0.5, 0.5), 'se', 40, 0, { width: 400, height: 800 })
    // Same fraction of the screen from the same fraction of a drag.
    expect(wide.w).toBeCloseTo(narrow.w, 5)
  })
})

describe('a stored box', () => {
  it('comes back as it was stored', () => {
    expect(parseBox(JSON.stringify({ w: 0.4, h: 0.8 }))).toEqual({ w: 0.4, h: 0.8 })
  })

  it('falls through to the default rather than leaving the canvas unusable', () => {
    expect(parseBox(null)).toEqual(DEFAULT_BOX)
    expect(parseBox('not json')).toEqual(DEFAULT_BOX)
    expect(parseBox('{"w":"wide"}')).toEqual(DEFAULT_BOX)
  })

  it('clamps a value written by an older build', () => {
    expect(parseBox('{"w":5,"h":0.001}')).toEqual({ w: MAX_FRACTION, h: MIN_FRACTION })
  })
})

describe('an edge moves one axis', () => {
  it('the east edge widens and leaves the height alone', () => {
    const out = resizeCentred(box(0.5, 0.5), 'e', 100, 999, VIEWPORT)
    expect(out.w).toBeCloseTo(0.7, 5)
    expect(out.h).toBeCloseTo(0.5, 5)
  })

  it('the north edge heightens and leaves the width alone', () => {
    const out = resizeCentred(box(0.5, 0.5), 'n', 999, -80, VIEWPORT)
    expect(out.w).toBeCloseTo(0.5, 5)
    expect(out.h).toBeCloseTo(0.7, 5)
  })

  it('west and east are the same gesture mirrored — both mean bigger', () => {
    expect(resizeCentred(box(0.5, 0.5), 'w', -100, 0, VIEWPORT))
      .toEqual(resizeCentred(box(0.5, 0.5), 'e', 100, 0, VIEWPORT))
  })
})
