// presentation/grid/rail-grid.ts
//
// THE PHONE'S SLOT GRID. On a phone the hive is read as a strip of rails —
// three lanes across the SHORT side of the screen, the strip running along
// the LONG one — and this module is the pure geometry of that strip: slot
// number in, hex coordinate out. It is the rail counterpart of the spiral
// matrix `AxialService.createMatrix` builds for the desktop, and the two are
// interchangeable behind `AxialService.items`: the renderer places slot i at
// `items.get(i)` and never asks which matrix answered.
//
// A rail is a PROJECTION, never an arrangement. Nothing here is written to a
// layer; the layer's `index` order is read into rail slots the way the
// desktop reads it into spiral slots. See documentation/mobile-rails-projection.md.
//
// FEED ORDER. Consecutive slots are neighbours ALONG THE STRIP, so the tile
// after this one is beside it, never a strip-length away:
//   portrait (point-top)  — rows of `lanes` across the screen, filled
//                           left→right, rows stacked top→bottom;
//   landscape (flat-top)  — columns walked left→right, each filled
//                           top→bottom, alternating `lanes` / `lanes-1`
//                           slots so the tucked column nests between its
//                           neighbours (the 3-2-3 rhythm at three lanes).
// Slot 0 is the strip's START (top in portrait, left in landscape) and the
// strip grows in the +long direction only, so the camera's start edge never
// moves as tiles arrive.
//
// Point-top rows are straight and stack with the honeycomb half-shift;
// flat-top columns are straight and nest the same way. Only those two
// pairings pack a strip without gaps, which is why the rail owns the hex
// orientation while it is active.

import { clampLanes, LANE_DEFAULT, LANE_MAX, LANE_MIN } from '../../sequence/arrangements.js'

export interface RailCoord { q: number; r: number }

export { LANE_DEFAULT as RAIL_DEFAULT, LANE_MAX as RAIL_MAX, LANE_MIN as RAIL_MIN, clampLanes as clampRails }

/** Where rail slot `slot` sits. `flatTop` = the strip runs left↔right. */
export const railCoord = (slot: number, lanes: number, flatTop: boolean): RailCoord => {
  const i = Math.max(0, Math.floor(slot))
  const n = clampLanes(lanes)

  if (!flatTop) {
    // Point-top: row r holds lanes c0..c0+n-1. odd-r offset → axial keeps the
    // rows straight; the half-shift between rows is the honeycomb itself.
    const row = Math.floor(i / n)
    const lane = i % n
    const c0 = -Math.floor((n - 1) / 2)
    return { q: c0 + lane - Math.floor(row / 2), r: row }
  }

  // Flat-top. One lane is a straight line along q; `n - 1 === 0` would
  // otherwise mint empty tucked columns.
  if (n === 1) return { q: i, r: -Math.floor(i / 2) }

  // Columns alternate full (n) and tucked (n - 1). A pair holds `per` slots.
  const per = n + (n - 1)
  const pair = Math.floor(i / per)
  const within = i % per
  const tucked = within >= n
  const q = pair * 2 + (tucked ? 1 : 0)
  const pos = tucked ? within - n : within
  // Flat-top screen y ∝ r + q/2. Full columns centre on the strip's axis;
  // tucked columns land halfway between their neighbours' slots.
  return { q, r: pos - Math.floor(n / 2) - Math.floor(q / 2) }
}

/** Slot → coordinate for the whole strip, `capacity` slots long. */
export const buildRailMatrix = (lanes: number, flatTop: boolean, capacity: number): Map<number, RailCoord> => {
  const out = new Map<number, RailCoord>()
  const cap = Math.max(0, Math.floor(capacity))
  for (let slot = 0; slot < cap; slot++) out.set(slot, railCoord(slot, lanes, flatTop))
  return out
}

/** The strip's long-axis position of a slot, in hex rows/columns — what a
 *  reader would call "how far down (or along) the strip". */
export const railDepth = (slot: number, lanes: number, flatTop: boolean): number => {
  const n = clampLanes(lanes)
  if (!flatTop) return Math.floor(Math.max(0, slot) / n)
  if (n === 1) return Math.max(0, slot)
  const per = n + (n - 1)
  const within = Math.max(0, slot) % per
  return Math.floor(Math.max(0, slot) / per) * 2 + (within >= n ? 1 : 0)
}
