import { describe, expect, it } from 'vitest'
import {
  captureBox,
  clampFraming,
  clientToFrame,
  constraintBox,
  containScale,
  coverScale,
  defaultFraming,
  drawRect,
  hexBox,
  leavesGaps,
  pinchFraming,
  readFraming,
  rubberBand,
  scaleLimits,
  scaleOfSlider,
  sliderOf,
  zoomAbout,
  zoomPercent,
  zoomToward,
  MAX_ZOOM,
  type Framing,
  type Point,
  type Size,
} from './crop-math.js'

const photo: Size = { width: 1920, height: 1080 }
const portrait: Size = { width: 600, height: 900 }

/** The source pixel under a frame point — what "stays under the cursor" means. */
const sourceAt = (framing: Framing, at: Point): Point => ({
  x: (at.x - framing.x) / framing.scale,
  y: (at.y - framing.y) / framing.scale,
})

describe('crop-math — boxes', () => {
  it('keeps the exact hex box in frame units and rounds only the capture box', () => {
    expect(hexBox('point-top').width).toBeCloseTo(346.41, 2)
    expect(hexBox('point-top').height).toBe(400)
    expect(hexBox('flat-top').height).toBeCloseTo(346.41, 2)
    expect(captureBox('point-top')).toEqual({ width: 346, height: 400 })
    expect(captureBox('flat-top')).toEqual({ width: 400, height: 346 })
  })

  it('constrains linked orientations to the frame square, which holds both boxes', () => {
    expect(constraintBox('point-top', true)).toEqual({ width: 400, height: 400 })
    expect(constraintBox('flat-top', false)).toEqual(hexBox('flat-top'))
  })

  it('scales with the hex side', () => {
    expect(captureBox('point-top', 100)).toEqual({ width: 173, height: 200 })
  })
})

describe('crop-math — cover, contain and limits', () => {
  it('computes cover and contain', () => {
    const box = { width: 400, height: 400 }
    expect(coverScale(photo, box)).toBeCloseTo(400 / 1080)
    expect(containScale(photo, box)).toBeCloseTo(400 / 1920)
  })

  it('defaults to centred cover of the square, filling BOTH orientations with no gaps', () => {
    const framing = defaultFraming(photo)
    expect(framing).toEqual({ x: 0, y: 0, scale: 400 / 1080 })
    expect(leavesGaps(framing, photo, hexBox('point-top'))).toBe(false)
    expect(leavesGaps(framing, photo, hexBox('flat-top'))).toBe(false)
  })

  it('FILL never lets a gap open: scale is raised to cover and travel stops at the edge', () => {
    const box = hexBox('point-top')
    const pushed = clampFraming({ x: 5000, y: -5000, scale: 0.01 }, portrait, box, 'fill')
    expect(pushed.scale).toBeCloseTo(coverScale(portrait, box))
    expect(leavesGaps(pushed, portrait, box)).toBe(false)
    const slightly = clampFraming({ x: 0, y: 0, scale: coverScale(portrait, box) * 1.5 }, portrait, box, 'fill')
    expect(slightly.scale).toBeCloseTo(coverScale(portrait, box) * 1.5)
  })

  it('FIT allows the whole picture inside the box and keeps it inside', () => {
    const box = hexBox('flat-top')
    const limits = scaleLimits(portrait, box, 'fit')
    expect(limits.min).toBeCloseTo(containScale(portrait, box))
    const inside = clampFraming({ x: 900, y: 900, scale: limits.min }, portrait, box, 'fit')
    const rect = drawRect(portrait, inside, box)
    expect(rect.x).toBeGreaterThanOrEqual(-1e-9)
    expect(rect.x + rect.width).toBeLessThanOrEqual(box.width + 1e-9)
    expect(rect.y).toBeGreaterThanOrEqual(-1e-9)
    expect(rect.y + rect.height).toBeLessThanOrEqual(box.height + 1e-9)
  })

  it('caps enlargement at MAX_ZOOM times cover', () => {
    const box = hexBox('point-top')
    expect(clampFraming({ x: 0, y: 0, scale: 999 }, photo, box, 'fill').scale)
      .toBeCloseTo(coverScale(photo, box) * MAX_ZOOM)
  })
})

describe('crop-math — gestures', () => {
  it('zooms about a point: the source pixel under it stays under it', () => {
    const start: Framing = { x: 12, y: -30, scale: 0.5 }
    const at = { x: 80, y: 44 }
    const next = zoomAbout(start, 1.25, at)
    const before = sourceAt(start, at)
    const after = sourceAt(next, at)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('zooming out a picture that just fills its box leaves it exactly where it is', () => {
    const box = hexBox('point-top')
    const atCover: Framing = { x: 12, y: 0, scale: coverScale(photo, box) }
    const next = zoomToward(atCover, atCover.scale * 0.5, { x: 150, y: -120 }, photo, box, 'fill')
    expect(next.scale).toBeCloseTo(atCover.scale)
    expect(next.x).toBeCloseTo(12)
    expect(next.y).toBeCloseTo(0)
    const zoomed = zoomToward(atCover, atCover.scale * 2, { x: 0, y: 0 }, photo, box, 'fill')
    expect(zoomed.scale).toBeCloseTo(atCover.scale * 2)
    expect(zoomed.x).toBeCloseTo(24)
  })

  it('pinches about the centroid and carries the picture with it', () => {
    const start: Framing = { x: 0, y: 0, scale: 0.4 }
    const c0 = { x: -20, y: 10 }
    const c1 = { x: 30, y: -15 }
    const next = pinchFraming(start, c0, c1, 1.8)
    const before = sourceAt(start, c0)
    const after = sourceAt(next, c1)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(next.scale).toBeCloseTo(0.72)
  })

  it('shows only a share of an overshoot while a gesture pushes past a limit', () => {
    const shown = rubberBand({ x: 100, y: 0, scale: 1 }, { x: 60, y: 0, scale: 1 })
    expect(shown.x).toBeCloseTo(74)
    expect(rubberBand({ x: 0, y: 0, scale: 4 }, { x: 0, y: 0, scale: 1 }).scale).toBeGreaterThan(1)
    expect(rubberBand({ x: 0, y: 0, scale: 4 }, { x: 0, y: 0, scale: 1 }).scale).toBeLessThan(4)
  })

  it('maps a client point in a scaled stage to frame units about the centre', () => {
    const rect = { left: 100, top: 50, width: 200 }
    expect(clientToFrame({ x: 200, y: 150 }, rect)).toEqual({ x: 0, y: 0 })
    expect(clientToFrame({ x: 100, y: 50 }, rect)).toEqual({ x: -200, y: -200 })
  })

  it('round-trips the logarithmic zoom slider', () => {
    const limits = { min: 0.2, max: 1.6 }
    for (const scale of [0.2, 0.5, 1, 1.6]) {
      expect(scaleOfSlider(sliderOf(scale, limits), limits)).toBeCloseTo(scale)
    }
  })

  it('reads 100% when the picture exactly fills', () => {
    const box = hexBox('point-top')
    expect(zoomPercent(coverScale(photo, box), photo, box)).toBe(100)
  })
})

describe('crop-math — the stored mapping', () => {
  it('draws the picture centre at box/2 + offset — the mapping every stored framing was written in', () => {
    const framing: Framing = { x: 20, y: -10, scale: 0.25 }
    const box = { width: 346, height: 400 }
    const rect = drawRect(photo, framing, box)
    expect(rect.x + rect.width / 2).toBeCloseTo(173 + 20)
    expect(rect.y + rect.height / 2).toBeCloseTo(200 - 10)
    expect(rect.width).toBeCloseTo(480)
  })

  it('reads a real framing, and treats the attach placeholder {0,0,1} as never framed', () => {
    expect(readFraming({ x: 3.5, y: -2, scale: 0.41 })).toEqual({ x: 3.5, y: -2, scale: 0.41 })
    expect(readFraming({ scale: 0.41 })).toEqual({ x: 0, y: 0, scale: 0.41 })
    expect(readFraming({ x: 0, y: 0, scale: 1 })).toBeUndefined()
    expect(readFraming({ x: 0, y: 0 })).toBeUndefined()
    expect(readFraming({ x: 0, y: 0, scale: 0 })).toBeUndefined()
    expect(readFraming({ x: 0, y: 0, scale: Number.NaN })).toBeUndefined()
    expect(readFraming(undefined)).toBeUndefined()
  })
})
