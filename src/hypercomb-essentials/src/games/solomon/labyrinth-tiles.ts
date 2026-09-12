// Puzzle-room tile bakes: carved stone walls, the amber conjured brick,
// a cracked brick, a shimmering gate (glass + frame + rune), and faceted
// relic gems. Baked once per (kind, variant, pixel-size) as a PNG data URL
// and set as `.sol-game-tile`'s CSS `background-image` — never a live canvas
// layer. Mirrors renderer.ts's own house rule: "Baked art is rendered above
// world resolution so the smoothed pipeline downscales it crisp" (TEX = 3
// there; the same ×3 oversample here). Same visual language as Dana and the
// island: flat colour, 2-3 tone cel steps, light from the upper-left, one
// ink outline — see the remaster art spec, Part 0 and Part 1.

/** A puzzle-room floor tile kind this module knows how to bake. */
export type RoomTileKind = 'wall' | 'brick' | 'cracked' | 'gate'
/** A relic gem kind this module knows how to bake. */
export type RoomRelicKind = 'hexagon' | 'star' | 'triangle'

// ── the shared language, copied and frozen from renderer.ts (Part 0) ──────
// (module-private — renderer.ts keeps its own copies unexported, so this
// file carries its own rather than reaching across the barrel.)

const INK = '#1c1230'
const TEX = 3 // oversample factor for the bake, matching renderer.ts's TEX

/** Lighten (t>0) / darken (t<0) a #rrggbb toward white / black. */
function sol_shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (t >= 0) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t }
  else { r *= 1 + t; g *= 1 + t; b *= 1 + t }
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

/** One deterministic 0..1 from an integer (bake-path safe — never Math.random). */
function sol_hash(n: number): number {
  let x = n | 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}
function sol_hash2(a: number, b: number, c: number): number { return sol_hash(a * 73856093 ^ b * 19349663 ^ c * 83492791) }

/** Rounded-rect path (does not stroke/fill — caller does). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function polyPath(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0]![0], pts[0]![1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
  ctx.closePath()
}

/** jsdom has no canvas (`getContext` throws or returns null) — every bake
 *  path must tolerate that, mirroring island-paint.ts's `canvasContext()`. */
function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return c.getContext('2d') } catch { return null }
}

// ── Part 1.5.1 — wall: carved stone block ──────────────────────────────────

function paintWall(ctx: CanvasRenderingContext2D, s: number, variant: number): void {
  const base = '#7b84a3'
  ctx.fillStyle = base
  ctx.fillRect(0, 0, s, s)
  // upper-left light face / lower-right dark wedge, split on a diagonal
  ctx.fillStyle = sol_shade(base, 0.22)
  polyPath(ctx, [[0, 0], [0.65 * s, 0], [0, 0.35 * s]])
  ctx.fill()
  ctx.fillStyle = sol_shade(base, -0.34)
  polyPath(ctx, [[0.55 * s, s], [s, s], [s, 0.45 * s]])
  ctx.fill()
  // mortar joints — 2×1 coursed pattern, x-offset varies by variant
  ctx.strokeStyle = 'rgba(28,18,48,0.55)'
  ctx.lineWidth = 0.9
  const vx = (variant === 1 ? 0.3 : variant === 2 ? 0.7 : 0.5) * s
  ctx.beginPath()
  ctx.moveTo(0, 0.5 * s); ctx.lineTo(s, 0.5 * s)
  ctx.moveTo(vx, 0); ctx.lineTo(vx, s)
  ctx.stroke()
  // chisel marks — texture, not structure
  ctx.strokeStyle = 'rgba(28,18,48,0.4)'
  ctx.lineWidth = 0.7
  const len = 0.08 * s
  for (let i = 0; i < 3; i++) {
    const hx = sol_hash2(variant, i, 11) * s
    const hy = sol_hash2(variant, i, 29) * s
    const angle = sol_hash2(variant, i, 47) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(hx, hy)
    ctx.lineTo(hx + Math.cos(angle) * len, hy + Math.sin(angle) * len)
    ctx.stroke()
  }
  // one highlight, upper-left
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1.1
  ctx.beginPath(); ctx.moveTo(0.08 * s, 0.04 * s); ctx.lineTo(0.6 * s, 0.04 * s); ctx.stroke()
  // ink outline, inset so neighbouring tiles' outlines don't double up
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  ctx.strokeRect(1, 1, s - 2, s - 2)
}

// ── Part 1.5.2/1.5.3 — brick: the amber conjured block (+ crack) ──────────

function paintBrick(ctx: CanvasRenderingContext2D, s: number, variant: number): void {
  const base = '#e8902c', lite = '#ffc56b', dark = '#8a4a12'
  const radius = 0.1 * s
  rr(ctx, 0.7, 0.7, s - 1.4, s - 1.4, radius)
  ctx.fillStyle = base
  ctx.fill()
  ctx.save()
  rr(ctx, 0.7, 0.7, s - 1.4, s - 1.4, radius)
  ctx.clip()
  ctx.fillStyle = lite
  polyPath(ctx, [[0, 0], [0.65 * s, 0], [0, 0.35 * s]])
  ctx.fill()
  ctx.fillStyle = dark
  polyPath(ctx, [[0.5 * s, s], [s, s], [s, 0.5 * s]])
  ctx.fill()
  ctx.restore()
  // bevel — proud top+left edges only
  const bevel = 0.06 * s
  ctx.strokeStyle = 'rgba(255,246,214,0.5)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(bevel + radius * 0.6, bevel); ctx.lineTo(s - bevel - radius * 0.6, bevel)
  ctx.moveTo(bevel, bevel + radius * 0.6); ctx.lineTo(bevel, s - bevel - radius * 0.6)
  ctx.stroke()
  // groove frame — the carved-panel frame, flattened to one stroke
  const groove = 0.14 * s
  ctx.strokeStyle = 'rgba(90,50,10,0.4)'
  ctx.lineWidth = 0.9
  rr(ctx, groove, groove, s - groove * 2, s - groove * 2, radius * 0.6)
  ctx.stroke()
  // rivets at the 4 corners of the groove frame
  const rv = 0.05 * s
  const off = (variant - 1) * 0.02 * s
  for (const [cx, cy] of [[groove, groove], [s - groove, groove], [groove, s - groove], [s - groove, s - groove]] as const) {
    ctx.fillStyle = '#ffd24d'
    ctx.beginPath(); ctx.arc(cx + off, cy + off, rv, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  // ink outline, rounded — softer/friendlier than the wall's hard corners
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  rr(ctx, 0.7, 0.7, s - 1.4, s - 1.4, radius)
  ctx.stroke()
}

/** A brick that took one hit — the same crack silhouette the island's
 *  `drawBlock('crack', …)` stamp uses (island-paint.ts), so the room and the
 *  ruins read as the same conjured block. */
function paintCrack(ctx: CanvasRenderingContext2D, s: number): void {
  const pts: readonly (readonly [number, number])[] = [[0.42, 0.06], [0.5, 0.32], [0.4, 0.5], [0.62, 0.68], [0.5, 0.94]]
  ctx.strokeStyle = 'rgba(28,18,48,0.85)'
  ctx.lineWidth = 1.1
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pts[0]![0] * s, pts[0]![1] * s)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0] * s, pts[i]![1] * s)
  ctx.moveTo(pts[1]![0] * s, pts[1]![1] * s)
  ctx.lineTo(0.74 * s, 0.24 * s)
  ctx.stroke()
  // chipped corner nearest the crack's lower endpoint
  const notch = 0.08 * s
  ctx.fillStyle = sol_shade('#8a4a12', -0.3)
  polyPath(ctx, [[s, s], [s - notch, s], [s, s - notch]])
  ctx.fill()
  // amber sliver along the crack's upper edge — light catching the break
  ctx.strokeStyle = '#ffe3a8'
  ctx.lineWidth = 0.6
  ctx.beginPath()
  ctx.moveTo(pts[0]![0] * s, pts[0]![1] * s)
  ctx.lineTo(pts[1]![0] * s, pts[1]![1] * s)
  ctx.stroke()
}

// ── Part 1.5.4 — gate: a shimmering barrier + rune ─────────────────────────

function paintGate(ctx: CanvasRenderingContext2D, s: number, variant: number): void {
  const inset = 0.06 * s
  const innerW = s - inset * 2
  const paneW = innerW / 3
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(140,210,235,0.28)'
    ctx.fillRect(inset + i * paneW, inset, paneW, innerW)
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.8
  ctx.beginPath()
  for (let i = 1; i < 3; i++) { ctx.moveTo(inset + i * paneW, inset); ctx.lineTo(inset + i * paneW, s - inset) }
  ctx.stroke()
  // one highlight, upper-left pane only
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(inset + paneW * 0.25, inset + innerW * 0.12)
  ctx.lineTo(inset + paneW * 0.75, inset + innerW * 0.5)
  ctx.stroke()
  // ink frame
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.4
  rr(ctx, inset, inset, innerW, innerW, inset * 0.6)
  ctx.stroke()
  // centred rune — a chevron + a crossbar, tinted fill behind the ink strokes
  // (shape reference: renderer.ts's fly_rune, kind 1), nudged per variant so
  // a run of gates doesn't read as one decal.
  const cx = s / 2 + (sol_hash2(variant, 1, 5) - 0.5) * 0.04 * s
  const cy = s / 2 + (sol_hash2(variant, 2, 7) - 0.5) * 0.04 * s
  const rs = s * 0.22
  ctx.fillStyle = 'rgba(191,224,255,0.55)'
  ctx.beginPath(); ctx.arc(cx, cy, rs * 1.3, 0, Math.PI * 2); ctx.fill()
  const seg: readonly (readonly [number, number, number, number])[] = [[-0.8, 0.8, 0, -0.9], [0, -0.9, 0.8, 0.8], [-0.45, 0.1, 0.45, 0.1]]
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2
  ctx.lineCap = 'round'
  for (const [x1, y1, x2, y2] of seg) {
    ctx.beginPath(); ctx.moveTo(cx + x1 * rs, cy + y1 * rs); ctx.lineTo(cx + x2 * rs, cy + y2 * rs); ctx.stroke()
  }
  ctx.lineCap = 'butt'
}

// ── the tile bake entry point ───────────────────────────────────────────────

/** How many crack/mortar/rivet layouts `variant` cycles through — breaks up
 *  the repeat across a run of same-terrain tiles. */
export const ROOM_TILE_VARIANTS = 3

/** Flat CSS colour a caller falls back to when `bakeRoomTile` returns null
 *  (no canvas — e.g. jsdom). */
export const ROOM_TILE_FALLBACK: Record<RoomTileKind, string> = {
  wall: '#7b84a3',
  brick: '#e8902c',
  cracked: '#e8902c',
  gate: '#3a5878',
}

const tileCache = new Map<string, string | null>()

/** Bakes one room-tile drawing at `px` CSS pixels (oversampled ×3 internally)
 *  and returns a PNG data URL, or null on a null context — callers must fall
 *  back to `ROOM_TILE_FALLBACK[kind]`. `variant` (0..2) breaks up the repeat
 *  (mortar offset / grain / rivet placement / rune nudge). */
export function bakeRoomTile(kind: RoomTileKind, variant: number, px: number): string | null {
  const key = `${kind}:${variant}:${px}`
  const cached = tileCache.get(key)
  if (cached !== undefined) return cached
  const size = Math.max(1, Math.round(px))
  const canvas = document.createElement('canvas')
  canvas.width = size * TEX
  canvas.height = size * TEX
  const ctx = ctx2d(canvas)
  if (!ctx) { tileCache.set(key, null); return null }
  ctx.scale(TEX, TEX)
  ctx.clearRect(0, 0, size, size)
  if (kind === 'wall') paintWall(ctx, size, variant)
  else if (kind === 'brick') paintBrick(ctx, size, variant)
  else if (kind === 'cracked') { paintBrick(ctx, size, variant); paintCrack(ctx, size) }
  else paintGate(ctx, size, variant)
  const url = canvas.toDataURL('image/png')
  tileCache.set(key, url)
  return url
}

// ── Part 1.5.5 — relics: faceted gems ──────────────────────────────────────

const RELIC_SIZE = 72 // relics are always small; one fixed bake covers every board

function hexPoints(cx: number, cy: number, r: number): readonly (readonly [number, number])[] {
  const pts: [number, number][] = []
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) }
  return pts
}

function starPoints(cx: number, cy: number, r: number): readonly (readonly [number, number])[] {
  const pts: [number, number][] = []
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i - Math.PI / 2
    const rad = i % 2 === 0 ? r : r * 0.5
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)])
  }
  return pts
}

/** Facet highlight (smaller shape, offset toward the light) + lower-right
 *  facet shade (a triangle from centre to the two lower-right vertices) —
 *  the one shared treatment for every relic kind. */
function facetShade(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, pts: readonly (readonly [number, number])[], smaller: readonly (readonly [number, number])[]): void {
  polyPath(ctx, smaller)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx, cy); ctx.lineTo(pts[0]![0], pts[0]![1]); ctx.lineTo(pts[1]![0], pts[1]![1]); ctx.closePath()
  ctx.fillStyle = 'rgba(20,70,60,0.28)'
  ctx.fill()
  void size
}

function paintHexagonRelic(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2, cy = size / 2, r = size * 0.4
  const pts = hexPoints(cx, cy, r)
  polyPath(ctx, pts); ctx.fillStyle = '#8af2db'; ctx.fill()
  facetShade(ctx, cx, cy, size, pts, hexPoints(cx - 0.15 * size, cy - 0.15 * size, r * 0.55))
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'
  polyPath(ctx, pts); ctx.stroke()
}

function paintStarRelic(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2, cy = size / 2, r = size * 0.42
  const pts = starPoints(cx, cy, r)
  polyPath(ctx, pts); ctx.fillStyle = '#ffc9ff'; ctx.fill()
  facetShade(ctx, cx, cy, size, pts, starPoints(cx - 0.15 * size, cy - 0.15 * size, r * 0.55))
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'
  polyPath(ctx, pts); ctx.stroke()
}

function paintTriangleRelic(ctx: CanvasRenderingContext2D, size: number): void {
  const cx = size / 2, cy = size / 2, r = size * 0.42
  const pts: readonly (readonly [number, number])[] = [0, 1, 2].map(i => {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 3)
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  })
  polyPath(ctx, pts); ctx.fillStyle = '#ffe599'; ctx.fill()
  // highlight sliver, upper-left edge (top vertex to lower-left vertex)
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]); ctx.lineTo(pts[2]![0], pts[2]![1]); ctx.stroke()
  // shade wedge, lower-right edge (top vertex to lower-right vertex), filled as a thin strip
  const inset = 0.12 * size
  const ix = (cx - (pts[0]![0] + pts[1]![0]) / 2), iy = (cy - (pts[0]![1] + pts[1]![1]) / 2)
  const n = Math.hypot(ix, iy) || 1
  const dx = ix / n * inset, dy = iy / n * inset
  polyPath(ctx, [pts[0]!, pts[1]!, [pts[1]![0] + dx, pts[1]![1] + dy], [pts[0]![0] + dx, pts[0]![1] + dy]])
  ctx.fillStyle = 'rgba(150,100,20,0.25)'; ctx.fill()
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.lineJoin = 'round'
  polyPath(ctx, pts); ctx.stroke()
}

/** Flat CSS colour a caller falls back to when `bakeRoomRelic` returns null. */
export const ROOM_RELIC_FALLBACK: Record<RoomRelicKind, string> = {
  hexagon: '#8af2db',
  star: '#ffc9ff',
  triangle: '#ffe599',
}

const relicCache = new Map<RoomRelicKind, string | null>()

/** Bakes one relic gem at a fixed 72×72 internal size (relics are always
 *  small and change far less than the floor, so re-baking on every resize
 *  tick would be wasted work) — `px` only documents the caller's current
 *  display size, it does not change the bake. Returns null on a null
 *  context — callers fall back to `ROOM_RELIC_FALLBACK[kind]`. Rotation for
 *  'triangle' is still applied by the caller via CSS transform, unchanged. */
export function bakeRoomRelic(kind: RoomRelicKind, px: number): string | null {
  void px
  const cached = relicCache.get(kind)
  if (cached !== undefined) return cached
  const canvas = document.createElement('canvas')
  canvas.width = RELIC_SIZE
  canvas.height = RELIC_SIZE
  const ctx = ctx2d(canvas)
  if (!ctx) { relicCache.set(kind, null); return null }
  if (kind === 'hexagon') paintHexagonRelic(ctx, RELIC_SIZE)
  else if (kind === 'star') paintStarRelic(ctx, RELIC_SIZE)
  else paintTriangleRelic(ctx, RELIC_SIZE)
  const url = canvas.toDataURL('image/png')
  relicCache.set(kind, url)
  return url
}

// ── the gate's animated shimmer — CSS keyframe only, never per-frame JS ────

/** `.is-gate`'s animated shimmer overlay: today's stripe recipe, unchanged,
 *  moved onto an `::before` layer and animated via `background-position` so
 *  it costs nothing per frame regardless of how many gates are on screen.
 *  Concatenated into `LABYRINTH_ROOM_CSS`. */
export const ROOM_GATE_SHIMMER_CSS = `
.sol-game-tile.is-gate::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,#739fd477 0 3px,#38638755 3px 8px);background-size:200% 100%;animation:sol-gate-shimmer 2.4s linear infinite}
@keyframes sol-gate-shimmer{from{background-position:0 0}to{background-position:200% 0}}
`
