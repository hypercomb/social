// editor/models/model-kit.ts
//
// THE PARTS EVERY MODEL IS BUILT FROM. Plain geometry (paths, polygons, rects,
// discs) and the hit and lit regions that read only an outline, a mask, a band
// and a picture rect — so a model file states WHERE its parts are and borrows
// HOW they are tested and lit. Nothing here names a shape: a model that cannot
// be composed from these brings its own function for the one part that needs it.
//
// Pure: no DOM, no IoC, stage pixels in and out.

import type { LitItem, ModelGeometry, PartContext, Pt, Rect } from './tile-model.js'

type Hit = (p: Pt, g: ModelGeometry, c: PartContext) => boolean

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const f = (n: number): string => (+n).toFixed(2)

const distSeg = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export const K = {
  f,

  /** A closed polygon as an SVG path. */
  polyD: (pts: readonly Pt[]): string => 'M' + pts.map(p => f(p.x) + ' ' + f(p.y)).join('L') + 'Z',

  rectD: (r: Rect): string =>
    `M${f(r.x)} ${f(r.y)}H${f(r.x + r.w)}V${f(r.y + r.h)}H${f(r.x)}Z`,

  /** A full circle as two arcs (a single arc of 360 degrees draws nothing). */
  circleD: (c: Pt, r: number): string =>
    `M${f(c.x - r)} ${f(c.y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`,

  inRect: (r: Rect | null | undefined, p: Pt): boolean =>
    !!r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,

  /** The overlap of two rects, or null when they only touch or miss. */
  inter(a: Rect, b: Rect): Rect | null {
    const x = Math.max(a.x, b.x)
    const y = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.w, b.x + b.w)
    const y2 = Math.min(a.y + a.h, b.y + b.h)
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null
  },

  /** Does `a` cover `b`, within a half pixel (a picture is never pixel-exact)? */
  covers: (a: Rect | null | undefined, b: Rect, tol = 0.5): boolean =>
    !!a && a.x <= b.x + tol && a.y <= b.y + tol && a.x + a.w >= b.x + b.w - tol && a.y + a.h >= b.y + b.h - tol,

  inPoly(pts: readonly Pt[], p: Pt): boolean {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]
      const b = pts[j]
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  },

  distSeg,

  /** Unsigned distance from a point to a closed polygon's edge. */
  distPoly(pts: readonly Pt[], p: Pt): number {
    let m = Infinity
    for (let i = 0; i < pts.length; i++) m = Math.min(m, distSeg(p, pts[i], pts[(i + 1) % pts.length]))
    return m
  },

  /** [min, max] x of a polygon along the horizontal line `y`. */
  spanAtY(pts: readonly Pt[], y: number): [number, number] {
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y))
    }
    return [Math.min(...xs), Math.max(...xs)]
  },

  /** [min, max] y of a polygon along the vertical line `x`. */
  spanAtX(pts: readonly Pt[], x: number): [number, number] {
    const ys: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if ((a.x > x) !== (b.x > x)) ys.push(a.y + (x - a.x) * (b.y - a.y) / (b.x - a.x))
    }
    return [Math.min(...ys), Math.max(...ys)]
  },

  /** A polygon moved outward by `d` (negative = inward), corners mitred; exact
   *  for any convex polygon. Zero returns the same points. */
  offsetPoly(pts: readonly Pt[], d: number): Pt[] {
    let area = 0
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]
      area += p.x * q.y - q.x * p.y
    })
    const s = area > 0 ? 1 : -1
    const normal = (a: Pt, b: Pt): Pt => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l = Math.hypot(dx, dy) || 1
      return { x: s * dy / l, y: -s * dx / l }
    }
    return pts.map((c, i) => {
      const p = pts[(i + pts.length - 1) % pts.length]
      const n = pts[(i + 1) % pts.length]
      const n1 = normal(p, c)
      const n2 = normal(c, n)
      const k = d / (1 + n1.x * n2.x + n1.y * n2.y)
      return { x: c.x + (n1.x + n2.x) * k, y: c.y + (n1.y + n2.y) * k }
    })
  },

  bbox(pts: readonly Pt[]): Rect {
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  },

  mid: (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),

  /** A hit that is true when any of the given hits is. */
  or: (...fs: Hit[]): Hit => (p, g, c) => fs.some(fn => fn(p, g, c)),
}

/** Hit predicates every model can share: they know outlines, masks, rects and
 *  discs, never a particular shape. */
export const HIT = {
  /** Within `slop` of the outline, on either side of it. */
  rim: (slop: (g: ModelGeometry) => number): Hit => (p, g) => g.edgeDistance(p) <= slop(g),

  band: ((p, g) => !!g.band && g.inside(p) && K.inRect(g.band, p)) as Hit,

  picture: ((p, g, c) => !!c.picture && g.insideMask(p) && K.inRect(c.picture, p)) as Hit,

  /** The ground: only while it shows, inside the silhouette, and not over the picture. */
  fill: ((p, g, c) => c.fillLive && g.inside(p) && !(c.picture && g.insideMask(p) && K.inRect(c.picture, p))) as Hit,

  disc: (at: (g: ModelGeometry) => Pt, r: (g: ModelGeometry) => number): Hit => (p, g) => {
    const q = at(g)
    return Math.hypot(p.x - q.x, p.y - q.y) <= r(g)
  },

  /** The other variant: outside this silhouette (and its rim slop) but inside
   *  the other one, or hugging its edge. */
  ghost: (slop: (g: ModelGeometry) => number): Hit => (p, g) =>
    !!g.ghostPath && !g.inside(p) && g.edgeDistance(p) > slop(g) && (g.ghostInside(p) || g.ghostEdgeDistance(p) <= 8),
}

/** Lit regions every model can share, as data (see LitItem). */
export const LIT = {
  /** A wash band centred on the edge and two edge lines, one each side. */
  ring: (g: ModelGeometry): LitItem[] => {
    const pad = g.rimWidth / 2 + 9
    return [
      { d: g.outline, kind: 'band', w: 2 * pad },
      { d: g.offset(pad), kind: 'halo', w: 4 },
      { d: g.offset(pad), kind: 'edge', w: 1.5 },
      { d: g.offset(-pad), kind: 'halo', w: 4, clip: 'in' },
      { d: g.offset(-pad), kind: 'edge', w: 1.5, clip: 'in' },
    ]
  },

  /** The name band tinted between two hairlines. */
  band: (g: ModelGeometry): LitItem[] => {
    const b = g.band
    if (!b) return []
    const lines = `M${f(b.x)} ${f(b.y)}H${f(b.x + b.w)}M${f(b.x)} ${f(b.y + b.h)}H${f(b.x + b.w)}`
    return [
      { d: K.rectD(b), kind: 'fill', clip: 'in' },
      { d: lines, kind: 'halo', w: 4, clip: 'in' },
      { d: lines, kind: 'edge', w: 1.5, clip: 'in' },
    ]
  },

  picture: (g: ModelGeometry, c: PartContext): LitItem[] => {
    const pic = c.picture
    if (!pic) return []
    return [
      { d: K.rectD(pic), kind: 'fill', faint: true, clip: 'mask' },
      { d: g.offset(-11, 'mask'), kind: 'halo', w: 4.5, clip: 'mask+pic' },
      { d: g.offset(-11, 'mask'), kind: 'edge', w: 2.25, clip: 'mask+pic' },
      { d: K.rectD(pic), kind: 'edge', w: 1.5, dash: true, clip: 'mask' },
    ]
  },

  /** Hatch exactly where the ground shows; nothing at all when it is covered,
   *  because hatching a covered ground would lie. */
  fill: (g: ModelGeometry, c: PartContext): LitItem[] => {
    if (!c.fillLive) return []
    const items: LitItem[] = [{ d: g.groundPath(c.picture), kind: 'hatch', rule: 'evenodd', clip: 'in' }]
    if (c.picture) items.push({ d: K.rectD(c.picture), kind: 'edge', w: 1.5, dash: true, clip: 'in' })
    return items
  },

  disc: (at: (g: ModelGeometry) => Pt, r: (g: ModelGeometry) => number) => (g: ModelGeometry): LitItem[] => {
    const q = at(g)
    return [
      { d: K.circleD(q, r(g) + 3), kind: 'halo', w: 3 },
      { d: K.circleD(q, r(g)), kind: 'fill' },
      { d: K.circleD(q, r(g)), kind: 'edge', w: 1.75 },
    ]
  },

  /** The other variant's whole outline, dashed on a halo, its outside washed. */
  ghost: (g: ModelGeometry): LitItem[] => {
    if (!g.ghostPath) return []
    return [
      { d: g.ghostPath, kind: 'fill', clip: 'out' },
      { d: g.ghostPath, kind: 'halo', w: 3, dash: true },
      { d: g.ghostPath, kind: 'edge', w: 1.5, dash: true },
    ]
  },
}
