// diamondcoreprocessor.com/presentation/tiles/launcher-cluster-layout.ts
//
// Clustered-island layout for an ORDERED launcher page (the /help page).
//
// A normal hive/launcher page lays its cells out as one continuous hex spiral
// (index → AxialService coordinate). The help page instead wants SEPARATED
// ISLANDS: one compact hex blob per category, each titled by a header tile,
// with blank space between the blobs so that — zoomed out — the page reads as
// labelled groups rather than one dense coil.
//
// This module is a pure function: given the page's cells split into groups
// (each a header label + its action labels, in page order), it returns an
// INTEGER axial coordinate per label. Integer axial is required — every
// downstream consumer (the mesh geometry AND tile-overlay's hit-test occupancy
// map) derives pixel position from `axialToPixel(q, r)`, so a cell must sit on
// the lattice or it can't be clicked.
//
// Everything is computed in "unit-spacing pixel" space (one axial step = √3 in
// x, 1.5 in y — the point-top hex metric). Because that mapping is LINEAR in
// (q, r), a cluster's tiles translate rigidly when its origin moves: we lay
// each blob out around a local origin, pack the blobs apart using their pixel
// bounding boxes, then convert each blob's chosen pixel origin back to the
// nearest integer axial and add the (already integer) local coordinates.
//
// Shell-agnostic and dependency-free — show-cell calls it during geometry
// build; the grouping (which cells are headers) comes from the per-cell
// `launch:target` role the decoration index exposes.

export interface ClusterGroup {
  /** Category-title tile that leads the island, or null for a headerless
   *  leading group (e.g. the Reference tile). */
  header: string | null
  /** Action tile labels in the island, in page order. */
  actions: string[]
}

const SQRT3 = Math.sqrt(3)

// ── tuning (unit-spacing pixels; 1 tile ≈ √3 wide, 1.5 tall) ──────────────
/** Horizontal blank space between adjacent islands in a meta-row (≈3 tile
 *  widths, so islands read as clearly separate against bright image tiles). */
const CLUSTER_GAP_X = 5.5
/** Vertical blank space between meta-rows of islands. */
const CLUSTER_GAP_Y = 6.5
/** How far a header tile floats above the top of its island. */
const HEADER_GAP = 2.4
/** An island whose left edge would push past this wraps to the next meta-row. */
const META_MAX_WIDTH = 48

/** Unit-spacing pixel of a point-top axial coordinate. Linear in (q, r). */
function toPixel(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r }
}

/** Nearest integer axial for a unit-spacing pixel, via cube rounding so the
 *  result is always a real lattice hex (plain round() can land off-lattice). */
function toAxialRounded(x: number, y: number): { q: number; r: number } {
  const rf = y / 1.5
  const qf = x / SQRT3 - rf / 2
  const sf = -qf - rf
  let rq = Math.round(qf)
  let rr = Math.round(rf)
  const rs = Math.round(sf)
  const dq = Math.abs(rq - qf)
  const dr = Math.abs(rr - rf)
  const ds = Math.abs(rs - sf)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: rq, r: rr }
}

/** First `count` axial coordinates of a hex spiral around (0,0) — a compact,
 *  roughly circular blob. Same ring walk as AxialService.createMatrix, kept
 *  local so the layout has no render-service dependency. */
function hexSpiral(count: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = []
  if (count <= 0) return out
  out.push({ q: 0, r: 0 })
  const dirs: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  for (let radius = 1; out.length < count; radius++) {
    // Start one ring out along direction 4, then walk the six sides.
    let q = dirs[4][0] * radius
    let r = dirs[4][1] * radius
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < radius; step++) {
        if (out.length >= count) return out
        out.push({ q, r })
        q += dirs[side][0]
        r += dirs[side][1]
      }
    }
  }
  return out
}

/** Lay the groups out as separated islands. Returns label → integer axial for
 *  every header and action label. Groups are placed left→right into meta-rows,
 *  wrapping past META_MAX_WIDTH; each island's header floats above its blob. */
export function launcherClusterLayout(groups: ClusterGroup[]): Map<string, { q: number; r: number }> {
  const coords = new Map<string, { q: number; r: number }>()
  let cursorX = 0        // left edge of the next island in the current meta-row
  let rowTop = 0         // top of the current meta-row's header band
  let rowBottom = 0      // lowest point reached so far (next row starts below it)

  for (const group of groups) {
    const local = hexSpiral(Math.max(group.actions.length, 1))

    // Bounding box of the blob in unit-pixel space.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const a of local) {
      const p = toPixel(a.q, a.r)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    const width = maxX - minX
    const headerReserve = group.header ? HEADER_GAP + 1.5 : 0
    const fullHeight = (maxY - minY) + headerReserve

    // Wrap to a new meta-row when this island would overflow the width.
    if (cursorX > 0 && cursorX + width > META_MAX_WIDTH) {
      cursorX = 0
      rowTop = rowBottom + CLUSTER_GAP_Y
    }

    // Pixel position of the blob's local origin (0,0) so its bbox-left sits at
    // cursorX and its content sits below the reserved header band.
    const originPX = cursorX - minX
    const originPY = rowTop + headerReserve - minY
    const origin = toAxialRounded(originPX, originPY)

    // Action tiles: integer local + integer origin ⇒ integer final.
    for (let i = 0; i < group.actions.length && i < local.length; i++) {
      const a = local[i]
      coords.set(group.actions[i], { q: origin.q + a.q, r: origin.r + a.r })
    }

    // Header floats centred above the blob.
    if (group.header) {
      const h = toAxialRounded((minX + maxX) / 2, minY - HEADER_GAP)
      coords.set(group.header, { q: origin.q + h.q, r: origin.r + h.r })
    }

    cursorX += width + CLUSTER_GAP_X
    rowBottom = Math.max(rowBottom, rowTop + fullHeight)
  }

  // Centre the whole field on the origin. The layout grows into the +x/+y
  // quadrant; the launcher camera looks at (0,0), so without this the islands
  // pile into the bottom-right. Shift by the pixel-bbox centre, rounded back to
  // the lattice so every coordinate stays integer.
  if (coords.size > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const c of coords.values()) {
      const p = toPixel(c.q, c.r)
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    const off = toAxialRounded((minX + maxX) / 2, (minY + maxY) / 2)
    for (const c of coords.values()) { c.q -= off.q; c.r -= off.r }
  }

  return coords
}
