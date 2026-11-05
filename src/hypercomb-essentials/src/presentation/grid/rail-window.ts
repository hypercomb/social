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
// THE UNIT OF A SHIFT IS ONE COLUMN where one column is an exact TRANSLATION
// of the tiles: everything that was in column k is in column k-1, nothing
// re-nests. That holds for every pairing whose columns are all alike — each
// lane just slides one cell along the strip (the half-cell offset between
// lanes is the same before and after). Only the NESTED pairing (flat-top,
// strip running sideways: 3-2-3 at three lanes) alternates full and tucked
// columns, so a one-column step would hand a full column's tiles to a tucked
// column's slots and reflow the whole window; there a step is the rhythm's
// period of two. `railStepColumns` says which, and `railStepTiles` is how
// many tiles one step carries (n for a column, 2n-1 for the nested pair).
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

/** The strip's rhythm repeats every two columns: the period the nested
 *  pairing alternates full and tucked columns by. Counting tiles in a run of
 *  columns reads it; a step is one column wherever the columns are all alike
 *  (`railStepColumns`). */
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

/** Columns one shift step carries: ONE, unless the pairing is nested — there
 *  a single column would re-nest, so the step is the rhythm's two. */
export const railStepColumns = (
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => (nested(lanes, flatTop, horizontal) ? RAIL_STEP_COLUMNS : 1)

/** Tiles one shift step carries. */
export const railStepTiles = (
  lanes: number,
  flatTop: boolean,
  horizontal: boolean = flatTop,
): number => railTilesBefore(railStepColumns(lanes, flatTop, horizontal), lanes, flatTop, horizontal)

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

// ── wheel → steps ──────────────────────────────────────────────────────
//
// ONE MOUSE INCREMENT IS ONE STEP. A plain mouse sends one event per detent,
// and what that event says it travelled varies — 100px, 120px, 166px, 50px
// at a zoomed page, three lines in Firefox — so a step is never counted in
// px for it: one detent is one column however far it reports. The devices
// that send MANY small events for one movement — a high-resolution wheel, a
// trackpad with its inertia tail — are told apart by their size (each too
// small to be a detent): a stream that BEGINS small, and keeps the cadence of
// a trackpad, is measured in DISTANCE however big its later events grow, so a
// nudge split into ten events is still one step. Either way a reverse blip at
// the tail of a flick starts the gesture over and pays nothing.

/** An event this big, on its own, is a whole detent: one step, whatever
 *  distance it reports. Smaller ones add up (a zoomed page's detent is ~50). */
export const RAIL_WHEEL_DETENT_PX = 40
/** Smooth travel that makes one step: what a mouse notch reports. */
export const RAIL_WHEEL_NOTCH_PX = 100
/** A smooth gesture's first step lands at this travel: a whole notch's worth
 *  split into ten events steps on the sixth. */
export const RAIL_WHEEL_FIRST_PX = 60
/** Events closer together than this, in one direction, that follow a SMALL
 *  event are a stream from a smooth device, however big they grow — they do
 *  not become detents of their own. */
export const RAIL_WHEEL_BURST_MS = 50
/** A pause longer than this starts a new gesture (the same gap
 *  navigation/zoom/wheel-gesture.ts reads a burst by). */
export const RAIL_WHEEL_GAP_MS = 150

/** The gesture so far: signed smooth travel, the steps it has already paid
 *  out, when its last event came, which way it went, and whether it was a
 *  small (smooth-device) event. */
export interface RailWheel { travel: number; stepped: number; at: number; dir: number; small: boolean }

export const RAIL_WHEEL_REST: RailWheel = { travel: 0, stepped: 0, at: Number.NEGATIVE_INFINITY, dir: 0, small: false }

/** A wheel event's travel in px: `deltaMode` 0 is px already, 1 counts lines
 *  (three to a notch), 2 counts pages. */
export const railWheelPx = (delta: number, deltaMode: number = 0): number =>
  delta * (deltaMode === 1 ? RAIL_WHEEL_NOTCH_PX / 3 : deltaMode === 2 ? RAIL_WHEEL_NOTCH_PX * 4 : 1)

/** Fold one wheel event into the gesture. `steps` is signed — positive brings
 *  LATER tiles — and is only what THIS event adds. */
export const foldRailWheel = (
  wheel: RailWheel,
  deltaPx: number,
  now: number,
): { wheel: RailWheel; steps: number } => {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) return { wheel, steps: 0 }
  const dir = Math.sign(deltaPx)
  const gap = now - wheel.at

  // A DETENT: big enough to be one, and not the growing tail of a smooth
  // stream. One step, whatever it says it travelled.
  const stream = wheel.small && gap < RAIL_WHEEL_BURST_MS && dir === wheel.dir
  if (Math.abs(deltaPx) >= RAIL_WHEEL_DETENT_PX && !stream) {
    return { wheel: { travel: 0, stepped: 0, at: now, dir, small: false }, steps: dir }
  }

  // SMOOTH: distance. A pause, or the wheel turning the other way, starts over.
  const again = gap <= RAIL_WHEEL_GAP_MS && dir === Math.sign(wheel.travel)
  const travel = (again ? wheel.travel : 0) + deltaPx
  const paid = again ? wheel.stepped : 0
  const due = Math.floor((Math.abs(travel) + (RAIL_WHEEL_NOTCH_PX - RAIL_WHEEL_FIRST_PX)) / RAIL_WHEEL_NOTCH_PX)
  return { wheel: { travel, stepped: due, at: now, dir, small: true }, steps: Math.sign(travel) * (due - paid) }
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
