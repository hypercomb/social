// sequence/pattern.ts
//
// PATTERNS — the shape a frame holds, decoupled from the frame itself
// ===================================================================
// A PATTERN is a bare fact of geometry: an ordered set of axial slots plus
// the rigid translation one scroll step applies. It knows nothing about
// tiles, lineages, cameras or views. That decoupling is the point — a pattern
// is authored once, stored as a content-addressed resource, and APPLIED to as
// many locations as you like (`layout:frame`). Change the pattern and every
// frame bound to it changes with it; nothing is ever copied.
//
// Compare a SEQUENCE (`sequence.service.ts`): a sequence is an ordered list of
// ABSOLUTE spiral indexes that steers where the NEXT tile lands, and it stops
// mattering once the tile is placed. A pattern is RELATIVE and PERMANENT — it
// is the frame every tile at the location is read through, for as long as the
// frame is bound.
//
// ── The scroll model ────────────────────────────────────────────────────
// A frame does NOT cap how many tiles a layer may hold, and it does NOT move
// the camera. The slots stay exactly where they are; the TILES travel through
// them. The tile at order-position `k` occupies `scrollOrder[k - offset *
// stride]` — positions outside the slot list are off-frame and are not
// rendered. Scroll one step and the whole arrangement shifts by exactly one
// `step` translation: `stride` tiles leave the trailing edge and `stride`
// arrive at the leading one. That rigidity is DERIVED, never authored — see
// `patternStride`.

// ONE declaration of an axial pair, and it lives in `arrangements.ts` — the
// module that was here first. Declaring it in both made the generated barrel
// re-export two different symbols under one name, and the dts build refused the
// whole package (TS2308: "already exported a member named 'AxialLike'").
// Re-exporting the SAME symbol is not ambiguous; declaring it twice is. The
// dependency points at the older module on purpose, so nothing tracked ever
// needs this file to exist.
export type { AxialLike } from './arrangements.js'
import type { AxialLike } from './arrangements.js'

export interface PatternDefinition {
  /** Palette name. Discovery metadata; identity is the resource sig. */
  readonly name: string
  /** The slots, as axial coordinates around the pattern's own origin. */
  readonly coords: readonly AxialLike[]
  /** The rigid translation one scroll step applies. `{q:1,r:0}` is one
   *  hex-width to the right on a point-top grid — the horizontal default. */
  readonly step: AxialLike
}

const SQRT3 = Math.sqrt(3)

export const DEFAULT_STEP: AxialLike = { q: 1, r: 0 }

const key = (q: number, r: number): string => q + ',' + r

/** Unit-spacing pixel of a point-top axial coordinate. Linear in (q, r), so a
 *  translation in axial space is a rigid translation on screen. */
export const patternPixel = (c: AxialLike): { x: number; y: number } =>
  ({ x: SQRT3 * (c.q + c.r / 2), y: 1.5 * c.r })

// ── Honeycomb — the built-in block ──────────────────────────────────────
//
// `rows` rows deep (odd, so there is a true middle row), the middle row
// `width` tiles across, each row further out one tile narrower. rows=3,
// width=5 gives 4/5/4 = 13: three rows tall, the arrangement a hive page
// naturally settles into. rows=5, width=5 gives 3/4/5/4/3 — a hexagon.
//
// Each row is centred on the origin in SCREEN space, which is what makes the
// rows interlock: consecutive rows differ by half a hex-width because a row's
// pixel x is SQRT3 * (q + r/2).

export const honeycombCoords = (rows = 3, width = 5): readonly AxialLike[] => {
  const requested = Math.max(1, Math.floor(rows))
  const rowCount = requested % 2 === 0 ? requested - 1 : requested   // force odd
  const mid = Math.max(1, Math.floor(width))
  const reach = (rowCount - 1) / 2
  const coords: AxialLike[] = []
  for (let r = -reach; r <= reach; r++) {
    const n = mid - Math.abs(r)
    if (n <= 0) continue
    const q0 = Math.round(-(n - 1) / 2 - r / 2)
    for (let i = 0; i < n; i++) coords.push({ q: q0 + i, r })
  }
  return coords
}

/** How many tiles a frame holding this pattern shows at once. */
export const patternCapacity = (pattern: PatternDefinition): number =>
  pattern.coords.length

/**
 * How many tiles enter (and leave) per scroll step — the slots with no
 * neighbour one `step` further along, i.e. the trailing edge that empties
 * when everything shifts. DERIVED from the geometry, never authored: any
 * pattern scrolls rigidly by construction, whatever shape it is.
 */
export const patternStride = (pattern: PatternDefinition): number => {
  const { coords, step } = pattern
  if (coords.length === 0) return 0
  const present = new Set(coords.map(c => key(c.q, c.r)))
  let leaving = 0
  for (const c of coords) if (!present.has(key(c.q + step.q, c.r + step.r))) leaving++
  return Math.max(1, leaving)
}

/**
 * The order tiles fill and vacate the frame: along the scroll axis first,
 * then across it. Tile order-position `k` reads off this list, so scrolling
 * by `stride` is exactly a one-`step` translation of the whole arrangement.
 */
export const scrollOrder = (pattern: PatternDefinition): readonly AxialLike[] => {
  const along = patternPixel(pattern.step)
  const len = Math.hypot(along.x, along.y) || 1
  const ux = along.x / len
  const uy = along.y / len
  const project = (c: AxialLike): { a: number; b: number } => {
    const p = patternPixel(c)
    return { a: p.x * ux + p.y * uy, b: -p.x * uy + p.y * ux }
  }
  return [...pattern.coords].sort((l, r) => {
    const pl = project(l)
    const pr = project(r)
    // Group by position along the axis; ties (one column) read across.
    if (Math.abs(pl.a - pr.a) > 1e-6) return pl.a - pr.a
    return pl.b - pr.b
  })
}

/**
 * Where the tile at order-position `position` sits, given a scroll `offset`
 * measured in steps. Returns null when the tile is off-frame — before the
 * leading edge or past the trailing one.
 */
export const slotAt = (
  order: readonly AxialLike[],
  stride: number,
  position: number,
  offset: number,
): AxialLike | null => {
  const idx = position - offset * stride
  return idx >= 0 && idx < order.length ? order[idx] : null
}

/** Furthest scroll that still shows a tile, given `count` tiles in order.
 *  Scrolling stops here rather than running off into empty slots. */
export const maxOffset = (
  capacity: number,
  stride: number,
  count: number,
): number => stride <= 0 ? 0 : Math.max(0, Math.ceil((count - capacity) / stride))

/** Bounding box of the slots in unit-spacing pixels, hex extents included —
 *  what a fit computes against. One hex is SQRT3 wide and 2 tall. */
export const patternBounds = (
  pattern: PatternDefinition,
): { width: number; height: number; cx: number; cy: number } => {
  if (pattern.coords.length === 0) return { width: 0, height: 0, cx: 0, cy: 0 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of pattern.coords) {
    const p = patternPixel(c)
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return {
    width: (maxX - minX) + SQRT3,
    height: (maxY - minY) + 2,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  }
}

/** How many rows deep the pattern reads — the "three rows tall" of a frame. */
export const patternRows = (pattern: PatternDefinition): number => {
  if (pattern.coords.length === 0) return 0
  let min = Infinity, max = -Infinity
  for (const c of pattern.coords) {
    if (c.r < min) min = c.r
    if (c.r > max) max = c.r
  }
  return max - min + 1
}

// ── Built-ins ───────────────────────────────────────────────────────────
//
// Seeded into the palette so a frame can be bound before anyone has authored
// a pattern. They are ordinary patterns — saved as resources on first use and
// editable like any other; nothing in the frame path knows they are built in.

export interface BuiltinPattern {
  readonly id: string
  readonly label: string
  readonly labelKey: string
  readonly build: () => PatternDefinition
}

const of = (name: string, coords: readonly AxialLike[]): PatternDefinition =>
  ({ name, coords, step: DEFAULT_STEP })

export const BUILTIN_PATTERNS: readonly BuiltinPattern[] = [
  {
    id: 'honeycomb',
    label: 'Honeycomb (3 rows)',
    labelKey: 'pattern.honeycomb',
    build: () => of('honeycomb', honeycombCoords(3, 5)),
  },
  {
    id: 'honeycomb-wide',
    label: 'Honeycomb wide (3 rows)',
    labelKey: 'pattern.honeycombWide',
    build: () => of('honeycomb-wide', honeycombCoords(3, 7)),
  },
  {
    id: 'hexagon',
    label: 'Hexagon (5 rows)',
    labelKey: 'pattern.hexagon',
    build: () => of('hexagon', honeycombCoords(5, 5)),
  },
]

export const builtinPattern = (id: string): PatternDefinition | null =>
  BUILTIN_PATTERNS.find(p => p.id === id)?.build() ?? null

/** Serialize for the content-addressed resource a frame points at. */
export const patternRecord = (pattern: PatternDefinition): {
  kind: 'pattern'
  name: string
  coords: AxialLike[]
  step: AxialLike
} => ({
  kind: 'pattern',
  name: pattern.name,
  coords: pattern.coords.map(c => ({ q: c.q, r: c.r })),
  step: { q: pattern.step.q, r: pattern.step.r },
})

/** Parse a stored `{ kind:'pattern', … }` resource. Returns null for anything
 *  that is not a usable pattern — a frame with no pattern is simply not a
 *  frame, and every read path treats a miss as "no frame here". */
export const parsePattern = (raw: unknown): PatternDefinition | null => {
  const o = raw as { kind?: unknown; name?: unknown; coords?: unknown; step?: unknown }
  if (!o || o.kind !== 'pattern' || !Array.isArray(o.coords)) return null
  const coords: AxialLike[] = []
  const seen = new Set<string>()
  for (const c of o.coords as Array<{ q?: unknown; r?: unknown }>) {
    const q = Number(c?.q)
    const r = Number(c?.r)
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue
    const k = key(Math.round(q), Math.round(r))
    if (seen.has(k)) continue
    seen.add(k)
    coords.push({ q: Math.round(q), r: Math.round(r) })
  }
  if (coords.length === 0) return null
  const s = o.step as { q?: unknown; r?: unknown } | undefined
  const sq = Number(s?.q)
  const sr = Number(s?.r)
  const usable = Number.isFinite(sq) && Number.isFinite(sr) && !(sq === 0 && sr === 0)
  return {
    name: typeof o.name === 'string' ? o.name : '',
    coords,
    step: usable ? { q: Math.round(sq), r: Math.round(sr) } : DEFAULT_STEP,
  }
}
