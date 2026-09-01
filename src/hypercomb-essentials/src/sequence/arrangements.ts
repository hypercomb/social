// sequence/arrangements.ts
//
// Built-in tile arrangements + the apply-to-existing mapper
// ========================================================
// A *tile target sequence* is an ordered list of hex-spiral indexes — the
// same shape SequenceService stores (`{ kind:'sequence', indexes }`) and
// the SequenceEditorBee authors by clicking hexes. Until now a sequence
// only steered where NEW tiles land. These helpers add the missing verb:
// repack the tiles that ALREADY exist onto a sequence's indexes.
//
//   • generators  — produce an index list of a given length for the two
//     built-in algorithmic arrangements (rectangle, flower). They are
//     computed live from the current tile count, so they always fit.
//   • applyToExisting — assigns the current tiles (already sorted into
//     their relative order) onto an index list, position by position.
//
// The renderer places a tile at `AxialService.items.get(index)`, so an
// arrangement only changes WHICH spiral slot each tile occupies — never
// the tiles' relative order. If two tiles ever resolve to the same slot
// the pinned-layout collision heal in show-cell demotes the duplicate to
// the next free slot, so an imperfect packing degrades gracefully rather
// than dropping a tile.

export interface AxialLike { q: number; r: number }

const coordKey = (q: number, r: number): string => `${q},${r}`

/** Reverse map "q,r" → spiral index, built from AxialService.items
 *  (`Map<index, {q,r}>`). One pass per apply; cheap. */
export const buildCoordToIndex = (
  items: Map<number, AxialLike>,
): Map<string, number> => {
  const out = new Map<string, number>()
  for (const [index, coord] of items) out.set(coordKey(coord.q, coord.r), index)
  return out
}

/** Resolve axial coords → spiral indexes in order. Coords with no slot
 *  (outside the grid) are skipped; the corresponding tile then overflows
 *  to a free slot in `applyToExisting`, never lost. */
const coordsToIndexes = (
  coords: readonly AxialLike[],
  coordToIndex: Map<string, number>,
): number[] => {
  const out: number[] = []
  for (const c of coords) {
    const idx = coordToIndex.get(coordKey(c.q, c.r))
    if (idx !== undefined) out.push(idx)
  }
  return out
}

// ── Rectangle ────────────────────────────────────────────────────────
//
// Rows left→right, top→bottom, into the closest-to-square block that fits
// `count` tiles. Odd-r offset rows keep the block reading as a true
// rectangle on the point-top hex grid (each row shifts by half a hex, the
// natural brick layout), centred on the origin hex.

export const rectangleCoords = (count: number): AxialLike[] => {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const r0 = -Math.floor(rows / 2)
  const c0 = -Math.floor(cols / 2)
  const coords: AxialLike[] = []
  for (let row = 0; row < rows; row++) {
    const r = r0 + row
    for (let col = 0; col < cols; col++) {
      // odd-r offset → axial: q = col - floor(r / 2)
      const q = c0 + col - Math.floor(r / 2)
      coords.push({ q, r })
    }
  }
  return coords
}

export const rectangleIndexes = (
  count: number,
  coordToIndex: Map<string, number>,
): number[] => coordsToIndexes(rectangleCoords(count), coordToIndex)

// ── Flower (clusters of 7) ───────────────────────────────────────────
//
// Tiles fill flowers of 7 — a centre hex plus its 6 neighbours — in
// spiral order (centre, then NE, E, SE, SW, W, NW, matching
// AxialService.getAdjacentCoordinates so a flower's ring reads the same
// way the grid's own first ring does). Flower CENTRES are themselves laid
// out on a rectangle, then spread by FLOWER_SPACING so neighbouring
// flowers stay visually distinct (radius-1 flowers, ≥1 hex gap between).

const NEIGHBOURS: readonly AxialLike[] = [
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
]

const FLOWER_SPACING = 3

export const flowerCoords = (count: number): AxialLike[] => {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const flowers = Math.ceil(n / 7)
  const centres = rectangleCoords(flowers)
  const coords: AxialLike[] = []
  for (let f = 0; f < flowers; f++) {
    const c = centres[f] ?? { q: 0, r: 0 }
    const cq = c.q * FLOWER_SPACING
    const cr = c.r * FLOWER_SPACING
    coords.push({ q: cq, r: cr })                                  // centre
    for (const d of NEIGHBOURS) coords.push({ q: cq + d.q, r: cr + d.r }) // ring
  }
  return coords.slice(0, n) // trim the last partial flower's empty petals
}

export const flowerIndexes = (
  count: number,
  coordToIndex: Map<string, number>,
): number[] => coordsToIndexes(flowerCoords(count), coordToIndex)

// ── Lanes (the mobile legibility ladder) ────────────────────────────
//
// A readable, scrollable strip rather than a block which gets smaller as it
// grows. Lanes always run ACROSS the short axis of the screen and the strip
// scrolls along the LONG one — portrait gives `lanes` point-top columns
// filled top→bottom and scrolls up/down; landscape gives the same lanes
// turned on their side (flat-top, nested `lanes` / `lanes - 1` columns) and
// scrolls left→right. Same reading, rotated with the device: the tile width
// is always a known fraction of the SHORT dimension, so text size is a
// choice rather than an accident of where the last pinch landed.
//
// `flatTop` therefore means "the strip runs left↔right" — the two are one
// decision, because only flat-top hexes pack into straight horizontal lanes
// and only point-top hexes pack into straight vertical ones.
//
// The lane COUNT is the phone's zoom control: fewer lanes ⇒ wider hexes ⇒
// bigger label, bigger picture, readable notes. Three is the scan step, one
// is the read step. The count is bounded here so no caller can mint a lane
// arrangement the ladder cannot walk back.

export const LANE_MIN = 1
export const LANE_MAX = 3
export const LANE_DEFAULT = 3

export const clampLanes = (lanes: number): number =>
  Math.min(LANE_MAX, Math.max(LANE_MIN, Math.round(Number.isFinite(lanes) ? lanes : LANE_DEFAULT)))

export const laneCoords = (count: number, lanes: number, flatTop: boolean): AxialLike[] => {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const lanesN = clampLanes(lanes)

  const coords: AxialLike[] = []
  if (flatTop) {
    // A single lane is a straight line — the nested/tucked column has no
    // meaning there, and `lanes - 1 === 0` would produce empty columns.
    if (lanesN === 1) {
      const q0 = -Math.floor((n - 1) / 2)
      for (let col = 0; col < n; col++) {
        const q = q0 + col
        coords.push({ q, r: -Math.floor(q / 2) })
      }
      return coords
    }
    // Number of alternating columns needed: pairs hold `lanes` + `lanes - 1`.
    const per = lanesN + (lanesN - 1)
    const pairs = Math.floor(n / per)
    const remainder = n % per
    const cols = pairs * 2 + (remainder > lanesN ? 2 : remainder > 0 ? 1 : 0)
    // Begin on an even q so the first column is the full one. Pick the
    // even origin nearest the centred position; zoom-to-lanes performs the
    // final exact screen centring.
    const q0 = Math.round((-Math.max(0, cols - 1) / 2) / 2) * 2
    let placed = 0
    for (let col = 0; col < cols && placed < n; col++) {
      const q = q0 + col
      const full = col % 2 === 0
      const capacity = full ? lanesN : lanesN - 1
      for (let slot = 0; slot < capacity && placed < n; slot++) {
        // Flat-top screen y is r + q/2. Full columns are centred on the
        // strip; tucked columns land halfway between their neighbours.
        const r = slot - Math.floor(lanesN / 2) - Math.floor(q / 2)
        coords.push({ q, r })
        placed++
      }
    }
  } else {
    const rows = Math.ceil(n / lanesN)
    const r0 = -Math.floor(rows / 2)
    const c0 = -Math.floor((lanesN - 1) / 2)
    for (let col = 0; col < lanesN; col++) {
      for (let row = 0; row < rows; row++) {
        const ordinal = col * rows + row
        if (ordinal >= n) break
        const r = r0 + row
        // odd-r offset → axial; visually straight vertical columns.
        const q = c0 + col - Math.floor(r / 2)
        coords.push({ q, r })
      }
    }
  }
  return coords
}

/** Back-compat name for the three-lane case; the ladder generalises it. */
export const threeLaneCoords = (count: number, flatTop: boolean): AxialLike[] =>
  laneCoords(count, 3, flatTop)

const flatTopPreferred = (): boolean =>
  typeof window !== 'undefined'
  && window.localStorage?.getItem('hc:hex-orientation') === 'flat-top'

/** `horizontal` — the strip runs left↔right (flat-top hexes, the landscape
 *  reading direction). Omitted, it follows the participant's standing hex
 *  orientation, which is what the desktop palette entry wants. */
export const laneIndexes = (
  count: number,
  coordToIndex: Map<string, number>,
  lanes: number,
  horizontal?: boolean,
): number[] =>
  coordsToIndexes(
    laneCoords(count, lanes, horizontal ?? flatTopPreferred()),
    coordToIndex,
  )

export const threeLaneIndexes = (
  count: number,
  coordToIndex: Map<string, number>,
): number[] => laneIndexes(count, coordToIndex, LANE_DEFAULT)

// ── Apply to existing tiles ──────────────────────────────────────────
//
// `orderedNames` is the current tiles already sorted into their relative
// order (by existing index). Each is assigned the next slot from
// `indexes`. Tiles beyond the sequence's length overflow to the first
// still-free spiral slot, scanning from 0 — so a sequence shorter than
// the tile count never strands a tile.

export const applyToExisting = (
  orderedNames: readonly string[],
  indexes: readonly number[],
): Map<string, number> => {
  const out = new Map<string, number>()
  const used = new Set<number>()
  const seqLen = Math.min(orderedNames.length, indexes.length)
  for (let k = 0; k < seqLen; k++) {
    const idx = indexes[k]
    out.set(orderedNames[k], idx)
    used.add(idx)
  }
  let scan = 0
  for (let k = seqLen; k < orderedNames.length; k++) {
    while (used.has(scan)) scan++
    out.set(orderedNames[k], scan)
    used.add(scan)
    scan++
  }
  return out
}

// ── Built-in arrangement descriptors ─────────────────────────────────
//
// The two algorithmic arrangements always lead the cycle. Each generates
// its index list from the live tile count. `labelKey` resolves through
// i18n for the toast; `label` is the English fallback.

export interface BuiltinArrangement {
  readonly id: string
  readonly label: string
  readonly labelKey: string
  readonly generate: (count: number, coordToIndex: Map<string, number>) => number[]
}

export const BUILTIN_ARRANGEMENTS: readonly BuiltinArrangement[] = [
  { id: 'three-lanes', label: 'Three lanes', labelKey: 'arrange.threeLanes', generate: threeLaneIndexes },
  { id: 'rectangle', label: 'Rectangle', labelKey: 'arrange.rectangle', generate: rectangleIndexes },
  { id: 'flower', label: 'Flowers', labelKey: 'arrange.flower', generate: flowerIndexes },
]
