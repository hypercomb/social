// sequence/frame-lock.ts
//
// "Is the page I am looking at framed?" — the one question pan, zoom and the
// spacebar drag ask before deciding whether the viewport is theirs.
//
// A frame fixes the arrangement AND the framing: the slots sit where the
// pattern says, sized to fill the window, and they do not move. Free panning
// and free zooming would each break that within one gesture, so both go inert
// while a frame is bound and the travel gesture is re-pointed at the TILES
// instead — they walk through the frame, the camera does not walk over them.
//
// Deliberately NOT a mirrored module-scope boolean like lane-viewport-mode.
// That file pays for a switch it owns itself, which had to ride the bus
// because every bee inlines its own copy of module scope. Here the state lives
// in FrameService, and IoC — which IS shared across bundles — is the way to
// reach it. The functions below are pure lookups: a duplicated copy of this
// module in another bee resolves the same service and gets the same answer.

import { EffectBus } from '@hypercomb/core'
import { patternBounds, patternPixel, scrollOrder, slotAt, type PatternDefinition } from './pattern.js'

export interface FramedPage {
  readonly segments: string[]
  readonly name: string
  readonly pattern: PatternDefinition
  readonly stride: number
  readonly capacity: number
  readonly rows: number
}

type FrameServiceLike = {
  activeFrameFor?: (segs: readonly string[]) => {
    name: string
    pattern: PatternDefinition
    stride: number
    capacity: number
    rows: number
  } | null
  scrollBy?: (segs: readonly string[], steps: number, tileCount?: number) => number
  clampedOffsetFor?: (segs: readonly string[], tileCount?: number) => number
  tileCountFor?: (segs: readonly string[]) => number
}
type LineageLike = { explorerSegments?: () => readonly string[] }

const service = (): FrameServiceLike | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc
    ?.get?.('@FrameService') as FrameServiceLike | undefined

/** The lineage of the page on screen. */
export const currentSegments = (): string[] => {
  const lineage = (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc
    ?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined
  return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
}

/** The frame governing the page on screen, or null when it is free hexagons.
 *  Synchronous and cheap — safe on an input handler's hot path. */
export const framedHere = (): FramedPage | null => {
  const segments = currentSegments()
  const frame = service()?.activeFrameFor?.(segments)
  if (!frame) return null
  return {
    segments,
    name: frame.name,
    pattern: frame.pattern,
    stride: frame.stride,
    capacity: frame.capacity,
    rows: frame.rows,
  }
}

/** True while the viewport belongs to a frame — pan and zoom stand down. */
export const viewportIsFramed = (): boolean => framedHere() !== null

/**
 * How wide one scroll step is on screen, in CSS pixels.
 *
 * Derived from the frame itself rather than from the zoom: the frame is fit to
 * the window, so the pattern's width in hex units maps onto the canvas width,
 * and one step is one hex of that. Reading it this way means the drag stays
 * calibrated even while a fit is still settling, and it costs no coupling to
 * the zoom drone's internals.
 */
export const stepWidthOnScreen = (page: FramedPage, canvasWidth: number): number => {
  const bounds = patternBounds(page.pattern)
  if (!(bounds.width > 0) || !(canvasWidth > 0)) return 0
  const hexesAcross = bounds.width / Math.sqrt(3)
  return canvasWidth / hexesAcross
}

/** Walk the tiles through the frame by `steps`. Positive brings LATER tiles in
 *  at the leading edge; negative brings earlier ones back. */
export const scrollFramedBy = (page: FramedPage, steps: number): void => {
  service()?.scrollBy?.(page.segments, steps)
}

// ── mesh units ──────────────────────────────────────────────────────────
//
// The lattice the tiles are DRAWN on is not the one AxialService reports.
// `AxialCoordinate.getLocation` scales by `Settings.hexagonSide` (200), while
// the mesh lays hexes out on `HexGeometry.spacing` (circumradius + gap, 38 by
// default) and draws each one a little larger than its cell — by `padPx`. Two
// spaces, five times apart: measuring a frame in the wrong one shrinks the fit
// by that factor, which is exactly what it looks like.
//
// The geometry travels on the bus (`render:geometry-changed`, last-value
// replay), so a copy of this module in any bundle can read the live value
// without owning a subscription to anything else.

interface HexGeometryLike { circumRadiusPx: number; gapPx: number; padPx: number; spacing: number }

let meshGeometry: HexGeometryLike | null = null
try {
  EffectBus.on<HexGeometryLike>('render:geometry-changed', (geo) => {
    if (geo && Number.isFinite(geo.spacing) && geo.spacing > 0) meshGeometry = geo
  })
} catch {
  /* no bus (unit context) — bounds simply cannot be measured */
}

/**
 * Expand the rendered content's rectangle out to the FRAME's rectangle, or
 * null when the page is not framed.
 *
 * A fit normally measures the CONTENT, and for a frame that is the wrong
 * rectangle: a framed page holding four tiles would fit those four and blow
 * them up to fill the window, so the arrangement would resize every time a
 * tile was added. The frame is a fixed window onto the pattern, so the pattern
 * is what gets fitted — full or not, the slots stay the same size and the same
 * place, which is the entire promise being made.
 *
 * Why EXPAND rather than compute the rectangle outright: the mesh's local
 * origin is its own business, and its hexes are drawn a little larger than
 * their lattice cells. Anchoring to the bounds the renderer actually reports
 * means neither has to be guessed — only the DISTANCE from the occupied slots
 * out to the frame's edge is added, and that is pure lattice arithmetic at the
 * mesh's own `spacing`. When the frame is full the two rectangles coincide and
 * this returns the content bounds unchanged.
 */
export const expandToFrame = (
  content: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null => {
  const page = framedHere()
  if (!page) return null
  const geo = meshGeometry
  if (!geo) return null
  if (!(content.width > 0) || !(content.height > 0)) return null

  const svc = service()
  const count = svc?.tileCountFor?.(page.segments) ?? 0
  if (count <= 0) return null
  const offset = svc?.clampedOffsetFor?.(page.segments, count) ?? 0

  // Which slots are actually holding a tile right now — the rectangle the
  // renderer's bounds describe.
  const order = scrollOrder(page.pattern)
  let occMinX = Infinity, occMaxX = -Infinity, occMinY = Infinity, occMaxY = -Infinity
  let occupied = 0
  for (let k = 0; k < count; k++) {
    const coord = slotAt(order, page.stride, k, offset)
    if (!coord) continue
    occupied++
    const p = patternPixel(coord)
    if (p.x < occMinX) occMinX = p.x
    if (p.x > occMaxX) occMaxX = p.x
    if (p.y < occMinY) occMinY = p.y
    if (p.y > occMaxY) occMaxY = p.y
  }
  if (occupied === 0) return null

  // The full block, centre to centre — `patternBounds` carries a one-hex rim
  // that the content bounds already account for, so take it back off.
  const SQRT3 = Math.sqrt(3)
  const full = patternBounds(page.pattern)
  const fullHalfW = (full.width - SQRT3) / 2
  const fullHalfH = (full.height - 2) / 2

  const left = Math.max(0, (occMinX - (full.cx - fullHalfW))) * geo.spacing
  const right = Math.max(0, ((full.cx + fullHalfW) - occMaxX)) * geo.spacing
  const top = Math.max(0, (occMinY - (full.cy - fullHalfH))) * geo.spacing
  const bottom = Math.max(0, ((full.cy + fullHalfH) - occMaxY)) * geo.spacing

  return {
    x: content.x - left,
    y: content.y - top,
    width: content.width + left + right,
    height: content.height + top + bottom,
  }
}
