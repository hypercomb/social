// editor/crop-math.ts
//
// THE FRAMING, AS NUMBERS.
//
// A tile's picture is stored as the untouched original (`large.image`) plus a
// FRAMING per orientation (`large.{x,y,scale}` for point-top,
// `flat.large.{x,y,scale}` for flat-top). The two small pictures the hive
// renders are derived from exactly those. This file is the one statement of
// what the numbers mean, shared by the crop stage the participant drags and
// the capture that writes the smalls — so what is framed on screen is, by
// construction, what is saved.
//
// THE UNITS (unchanged from every framing already stored):
//   · the FRAME is a square of `side × 2` units (400 for the default side);
//   · `x`, `y` are the picture centre's offset from the frame centre;
//   · `scale` is how many frame units one pixel of the ORIGINAL covers.
// Each orientation's hex box sits centred in the frame, so inside a capture
// box the picture centre lands at (box/2 + x, box/2 + y) — the frame size
// cancels, which is why a capture never needs to know it.
//
// Pure: no DOM, no canvas, no IoC. Every function here is exercised by
// crop-math.spec.ts.

import type { HexOrientation } from '../preferences/settings.js'

export type { HexOrientation }
export type Framing = { x: number; y: number; scale: number }
export type Size = { width: number; height: number }
export type Point = { x: number; y: number }

/** FILL keeps the hexagon covered — no background can ever show at an edge.
 *  FIT lets the whole picture sit inside it, letterboxed. */
export type CropMode = 'fill' | 'fit'

export const DEFAULT_HEX_SIDE = 200

/** How far past cover a picture may be enlarged. */
export const MAX_ZOOM = 8

/** The share of an overshoot a gesture still shows past a limit. */
export const RUBBER_BAND = 0.35

const SQRT3 = Math.sqrt(3)

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** The square every framing is expressed in. */
export const frameSize = (side = DEFAULT_HEX_SIDE): number => side * 2

/** One orientation's hex bounding box, exact, in frame units. */
export const hexBox = (orientation: HexOrientation, side = DEFAULT_HEX_SIDE): Size =>
  orientation === 'flat-top'
    ? { width: side * 2, height: side * SQRT3 }
    : { width: side * SQRT3, height: side * 2 }

/** The box a small picture is written into: the hex box in WHOLE pixels.
 *  A fractional box (346.41) is how a one-pixel strip of whatever sat behind
 *  the picture came to be baked along one edge of every capture. */
export const captureBox = (orientation: HexOrientation, side = DEFAULT_HEX_SIDE): Size => {
  const box = hexBox(orientation, side)
  return { width: Math.round(box.width), height: Math.round(box.height) }
}

/** The box a framing has to satisfy. While the two orientations share one
 *  framing it is the frame square, which holds both hex boxes — the point-top
 *  box is the narrower in x, the flat-top box the shorter in y, and the square
 *  is the tighter of each. */
export const constraintBox = (
  orientation: HexOrientation,
  linked: boolean,
  side = DEFAULT_HEX_SIDE,
): Size => {
  if (!linked) return hexBox(orientation, side)
  const frame = frameSize(side)
  return { width: frame, height: frame }
}

export const coverScale = (source: Size, box: Size): number =>
  Math.max(box.width / source.width, box.height / source.height)

export const containScale = (source: Size, box: Size): number =>
  Math.min(box.width / source.width, box.height / source.height)

/** The framing a picture gets when nobody has framed it: centred, covering
 *  the whole frame square, so it fills both orientations at once. */
export const defaultFraming = (source: Size, side = DEFAULT_HEX_SIDE): Framing => {
  const frame = frameSize(side)
  return { x: 0, y: 0, scale: coverScale(source, { width: frame, height: frame }) }
}

export type ScaleLimits = { min: number; max: number }

export const scaleLimits = (source: Size, box: Size, mode: CropMode): ScaleLimits => {
  const cover = coverScale(source, box)
  const min = mode === 'fit' ? Math.min(containScale(source, box), cover) : cover
  return { min, max: cover * MAX_ZOOM }
}

/** How far the picture centre may travel on each axis. An axis the picture
 *  overflows may travel until an edge reaches the box; an axis it does not
 *  fill (FIT only) may travel until an edge reaches the box from inside. */
export const offsetLimits = (source: Size, box: Size, scale: number): Point => ({
  x: Math.abs(source.width * scale - box.width) / 2,
  y: Math.abs(source.height * scale - box.height) / 2,
})

export const clampFraming = (framing: Framing, source: Size, box: Size, mode: CropMode): Framing => {
  const limits = scaleLimits(source, box, mode)
  const scale = clamp(framing.scale, limits.min, limits.max)
  const travel = offsetLimits(source, box, scale)
  return {
    x: clamp(framing.x, -travel.x, travel.x),
    y: clamp(framing.y, -travel.y, travel.y),
    scale,
  }
}

/** Does this framing leave any of the box uncovered? */
export const leavesGaps = (framing: Framing, source: Size, box: Size): boolean => {
  const w = source.width * framing.scale
  const h = source.height * framing.scale
  const eps = 1e-6
  return w + eps < box.width
    || h + eps < box.height
    || Math.abs(framing.x) > (w - box.width) / 2 + eps
    || Math.abs(framing.y) > (h - box.height) / 2 + eps
}

/** What a gesture shows while it is being pushed past a limit: the limit plus
 *  a share of the overshoot. Scale overshoots multiplicatively, so zooming
 *  past either end feels the same. The STORED framing is always the clamped
 *  one — this is display only. */
export const rubberBand = (raw: Framing, clamped: Framing): Framing => ({
  x: clamped.x + (raw.x - clamped.x) * RUBBER_BAND,
  y: clamped.y + (raw.y - clamped.y) * RUBBER_BAND,
  scale: clamped.scale * Math.pow(raw.scale / clamped.scale, RUBBER_BAND),
})

/** Zoom about a frame point: whatever is under it stays under it. */
export const zoomAbout = (framing: Framing, nextScale: number, at: Point): Framing => {
  const ratio = nextScale / framing.scale
  return {
    x: at.x - (at.x - framing.x) * ratio,
    y: at.y - (at.y - framing.y) * ratio,
    scale: nextScale,
  }
}

/** Zoom about a point WITHIN the limits. The scale is clamped BEFORE the
 *  offset is worked out: zooming out a picture that already just fills its
 *  box must leave it exactly where it is, not slide it toward the cursor by
 *  the zoom that was refused. */
export const zoomToward = (
  framing: Framing,
  requestedScale: number,
  at: Point,
  source: Size,
  box: Size,
  mode: CropMode,
): Framing => {
  const limits = scaleLimits(source, box, mode)
  const scale = clamp(requestedScale, limits.min, limits.max)
  if (Math.abs(scale - framing.scale) < 1e-12) return clampFraming(framing, source, box, mode)
  return clampFraming(zoomAbout(framing, scale, at), source, box, mode)
}

/** Two fingers: scale by the change in their spread, and carry the picture
 *  with their centroid, in one step — the point under the fingers stays under
 *  the fingers. `start` is the framing when the second finger landed. */
export const pinchFraming = (start: Framing, startCentroid: Point, centroid: Point, ratio: number): Framing => ({
  x: centroid.x - (startCentroid.x - start.x) * ratio,
  y: centroid.y - (startCentroid.y - start.y) * ratio,
  scale: start.scale * ratio,
})

/** A client (CSS px) point inside the stage, in frame units about its centre. */
export const clientToFrame = (
  client: Point,
  rect: { left: number; top: number; width: number },
  side = DEFAULT_HEX_SIDE,
): Point => {
  const frame = frameSize(side)
  const k = rect.width / frame
  return {
    x: (client.x - rect.left) / k - frame / 2,
    y: (client.y - rect.top) / k - frame / 2,
  }
}

/** Where the picture is drawn inside a box of the given size. */
export const drawRect = (source: Size, framing: Framing, box: Size): { x: number; y: number; width: number; height: number } => {
  const width = source.width * framing.scale
  const height = source.height * framing.scale
  return {
    x: box.width / 2 + framing.x - width / 2,
    y: box.height / 2 + framing.y - height / 2,
    width,
    height,
  }
}

/** Zoom slider position (0..1) for a scale — logarithmic, so each step of
 *  the slider is the same multiple wherever it sits. */
export const sliderOf = (scale: number, limits: ScaleLimits): number =>
  limits.max <= limits.min ? 0 : clamp(Math.log(scale / limits.min) / Math.log(limits.max / limits.min), 0, 1)

export const scaleOfSlider = (t: number, limits: ScaleLimits): number =>
  limits.min * Math.pow(limits.max / limits.min, clamp(t, 0, 1))

/** A stored framing, or undefined meaning "never framed — use the default".
 *
 *  The attach doors (a dropped or pasted picture, a link's thumbnail) wrote
 *  `{ x: 0, y: 0, scale: 1 }` as a placeholder while their smalls were cover
 *  crops. Read literally that is the picture at NATIVE pixel size — a 480px
 *  thumbnail letterboxed, a 1920px photo cropped to a corner — and the first
 *  save from the editor baked exactly that. No hand ever produces the exact
 *  triple (drags and zooms land on fractions; the one picture whose cover is
 *  exactly 1 is a 400px square, which the default reproduces identically), so
 *  it reads as what it always meant: nothing. */
export const readFraming = (saved: unknown): Framing | undefined => {
  const t = saved as { x?: unknown; y?: unknown; scale?: unknown } | null | undefined
  if (!t || !finite(t.scale) || !(t.scale > 0)) return undefined
  const x = finite(t.x) ? t.x : 0
  const y = finite(t.y) ? t.y : 0
  if (x === 0 && y === 0 && t.scale === 1) return undefined
  return { x, y, scale: t.scale }
}

/** The zoom readout: 100% means "exactly fills the box". */
export const zoomPercent = (scale: number, source: Size, box: Size): number =>
  Math.round((scale / coverScale(source, box)) * 100)
