// presentation/grid/rail-window.ts
//
// THE WINDOW OVER THE RAIL STRIP. Pure geometry, no pixi, no IoC.
//
// Lanes read the layer as a strip (rail-grid.ts) but only SHOW the part of it
// that fits the screen: `capacity` slots, a fixed block of columns × lanes at
// the current tile size. The slots never move — slot `s` is always the same
// place on the screen — and a pan does not move the camera, it moves the
// WINDOW: slot `s` shows tile `s + offset(shift)`. Tiles change position,
// the layout holds.
//
// THE UNIT OF A SHIFT IS THE RHYTHM'S PERIOD (two columns). A honeycomb
// repeats every two columns (the 3-2-3 nesting at three lanes; the half-cell
// alternation of the cross pairings), so only a two-column step is an exact
// TRANSLATION of the tiles: everything that was in column k is in column k-2,
// nothing re-nests. A one-column step would hand a full column's tiles to a
// tucked column's slots and reflow the whole window. `railStepTiles` is how
// many tiles one step carries (2n-1 for the nested pairing, 2n otherwise).
//
// Everything here is a pure function of (lanes, orientation, size, tile
// count, shift). Nothing is written anywhere; see documentation/
// mobile-rails-projection.md.

import { clampLanes } from '../../sequence/arrangements.js'

/** The hex geometry the mesh draws with (a structural subset of HexGeometry,
 *  so this file imports nothing from the renderer). */
export interface RailHexSize { circumRadiusPx: number; gapPx: number; padPx: number }

const SQRT3 = Math.sqrt(3)
const APOTHEM_RATIO = 0.8660254

/** A step is one rhythm period: two columns along the strip. */
export const RAIL_STEP_COLUMNS = 2

// ── the strip's rhythm ─────────────────────────────────────────────────

const nested = (lanes: number, flatTop: boolean, horizontal: boolean): boolean =>
  flatTop && horizontal && clampLanes(lanes) > 1

/** How many slots column `col` (0-based along the strip) holds. Full and
 *  tucked columns alternate only in the nested pairing (flat-top, strip
 *  running sideways): n, n-1, n, n-1… Every other pairing is n per column. */
export const railColumnCount = (
  col: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => {
  const n = clampLanes(lanes)
  if (!nested(n, flatTop, horizontal)) return n
  return Math.max(0, Math.floor(col)) % 2 === 0 ? n : n - 1
}

/** Slots in the first `columns` columns — also the tile offset of a window
 *  that starts `columns` columns in. */
export const railTilesBefore = (
  columns: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => {
  const c = Math.max(0, Math.floor(columns))
  const n = clampLanes(lanes)
  const per = nested(n, flatTop, horizontal) ? 2 * n - 1 : 2 * n
  const full = Math.floor(c / RAIL_STEP_COLUMNS)
  return full * per + (c % RAIL_STEP_COLUMNS === 1 ? n : 0)
}

/** Tiles one shift step carries (one rhythm period). */
export const railStepTiles = (
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => railTilesBefore(RAIL_STEP_COLUMNS, lanes, flatTop, horizontal)

// ── how big the window is ──────────────────────────────────────────────

export interface RailPitch {
  /** Centre-to-centre distance between consecutive columns, mesh px. */
  longPitch: number
  /** Centre-to-centre distance between lanes, mesh px. */
  acrossPitch: number
  /** A tile's drawn extent along the strip, mesh px (pad included). */
  longSpan: number
  /** A tile's drawn extent across the strip, mesh px (pad included). */
  acrossSpan: number
  /** Extra extent along the strip from the honeycomb's half-cell alternation
   *  (the cross pairings: every other lane-row sits half a column along). */
  longOffset: number
  /** Extra extent across the strip from the same alternation (point-top
   *  rows running down: every other row sits half a lane across). */
  acrossOffset: number
}

/** The mesh's own spacing (`axialToPixel` in show-cell): flat-top steps
 *  1.5·s per column and √3·s per row; point-top the transpose. Drawn size
 *  follows the quad show-cell sizes: apothem = circumRadiusPx, point reach =
 *  circumRadiusPx / cos30, plus the pad on each side. */
export const railPitch = (
  geo: RailHexSize,
  flatTop: boolean,
  horizontal: boolean = flatTop,
  lanes: number = 3,
): RailPitch => {
  const s = geo.circumRadiusPx + geo.gapPx
  const reach = geo.circumRadiusPx / APOTHEM_RATIO
  const w = (flatTop ? 2 * reach : 2 * geo.circumRadiusPx) + 2 * geo.padPx
  const h = (flatTop ? 2 * geo.circumRadiusPx : 2 * reach) + 2 * geo.padPx
  const matched = flatTop === horizontal
  const longPitch = matched ? 1.5 * s : SQRT3 * s
  const acrossPitch = matched ? SQRT3 * s : 1.5 * s
  const many = clampLanes(lanes) > 1
  return {
    longPitch,
    acrossPitch,
    longSpan: horizontal ? w : h,
    acrossSpan: horizontal ? h : w,
    longOffset: many && !matched ? longPitch / 2 : 0,
    acrossOffset: many && matched && !flatTop ? acrossPitch / 2 : 0,
  }
}

/** The scale the lane fit settles on, from first principles: the lanes fill
 *  the short axis. Only a SEED — the real scale is measured after the fit —
 *  so the first projection is already close and renders nothing it will have
 *  to throw away. Half an `acrossPitch` is reserved for the nested/offset
 *  alternation of the rows. */
export const railSeedScale = (
  availAcross: number,
  geo: RailHexSize,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => {
  const p = railPitch(geo, flatTop, horizontal, lanes)
  const n = clampLanes(lanes)
  const extent = (n - 1) * p.acrossPitch + p.acrossSpan + p.acrossOffset
  return extent > 0 && availAcross > 0 ? availAcross / extent : 1
}

/** How many whole columns fit in `availLong` screen px at `scale` (screen px
 *  per mesh px). Only columns that fit ENTIRELY count; always at least one. */
export const railColumnsThatFit = (availLong: number, scale: number, pitch: RailPitch): number => {
  const step = pitch.longPitch * scale
  const span = (pitch.longSpan + pitch.longOffset) * scale
  if (!(step > 0) || !(availLong > span)) return 1
  return Math.max(1, Math.floor((availLong - span) / step + 1e-9) + 1)
}

export interface RailWindowSize {
  /** Columns along the strip that fit. */
  columns: number
  /** Slots those columns hold — the window's capacity. */
  capacity: number
}

/** The window for a safe area: `availLong` screen px along the strip at
 *  `scale`. Capacity is the slot count of the fitting columns. */
export const railWindowSize = (
  availLong: number,
  scale: number,
  geo: RailHexSize,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): RailWindowSize => {
  const columns = railColumnsThatFit(availLong, scale, railPitch(geo, flatTop, horizontal, lanes))
  return { columns, capacity: railTilesBefore(columns, lanes, flatTop, horizontal) }
}

// ── shift ↔ tile index ─────────────────────────────────────────────────

/** Tile index of the window's first slot after `shift` steps. */
export const railShiftOffset = (
  shift: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => Math.max(0, Math.floor(shift)) * railStepTiles(lanes, flatTop, horizontal)

/** Which tile slot `slot` shows at `shift` (the window's mapping). */
export const railTileIndex = (
  slot: number,
  shift: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => slot + railShiftOffset(shift, lanes, flatTop, horizontal)

/** The last shift worth having: the first one whose window reaches the final
 *  tile. A strip that fits (count ≤ capacity) never shifts. */
export const railMaxShift = (
  count: number,
  capacity: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => {
  const total = Math.max(0, Math.floor(count))
  const cap = Math.max(1, Math.floor(capacity))
  if (total <= cap) return 0
  const per = railStepTiles(lanes, flatTop, horizontal)
  return Math.max(0, Math.ceil((total - cap) / per))
}

/** Keep a shift inside [0, last]: never before the first tile, never past the
 *  one that shows the last. */
export const clampRailShift = (
  shift: number,
  count: number,
  capacity: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => {
  const s = Number.isFinite(shift) ? Math.round(shift) : 0
  return Math.max(0, Math.min(railMaxShift(count, capacity, lanes, flatTop, horizontal), s))
}

/** The tiles the window shows, in slot order. Only these are handed on to be
 *  placed, loaded and drawn. */
export const railWindowOf = <T>(
  tiles: readonly T[],
  shift: number,
  capacity: number,
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): T[] => {
  const s = clampRailShift(shift, tiles.length, capacity, lanes, flatTop, horizontal)
  const from = railShiftOffset(s, lanes, flatTop, horizontal)
  return tiles.slice(from, from + Math.max(0, Math.floor(capacity)))
}

// ── pan → shift ────────────────────────────────────────────────────────

/** Fold a pan distance (screen px along the strip, hand direction: positive =
 *  hand moved toward the end of the strip's axis) into whole steps. Content
 *  follows the hand, so dragging toward + brings EARLIER tiles back: steps =
 *  -trunc(total / stepPx). The remainder is carried, so a slow drag adds up
 *  rather than being rounded away on every move. */
export const accumulateRailPan = (
  carry: number,
  delta: number,
  stepPx: number,
): { steps: number; carry: number } => {
  if (!(stepPx > 0) || !Number.isFinite(delta)) return { steps: 0, carry }
  const total = carry + delta
  const whole = Math.trunc(total / stepPx)
  return { steps: whole === 0 ? 0 : -whole, carry: total - whole * stepPx }
}
