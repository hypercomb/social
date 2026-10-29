// editor/models/hexagon.model.ts
//
// THE FIRST MODEL: the hexagon. Every hexagon word in the tile editor lives
// here — vertices, apothem, the 30 degree turn, the hive lattice, the 346 x 400
// capture — so the shell, the lighting, the callouts and the lists can stay
// blind to the shape (a ratchet spec reads them and fails on a hexagon word).
//
// Two things are deliberately NOT restated:
//   · the picture frame (`box`) and the saved size (`capture`) come from
//     `crop-math.ts`, the one statement of what framing means, so what is framed
//     and what is shaped cannot drift;
//   · the rim, glow and band numbers come from `TILE_LOOK`, the numbers the hex
//     shader is pinned to, so the preview stays the tile.

import { TILE_LOOK, tileLookAa } from '../../presentation/grid/tile-look.js'
import { captureBox, hexBox, type HexOrientation } from '../crop-math.js'
import { HIT, K, LIT } from './model-kit.js'
import type { ModelGeometry, ModelPart, ModelVariant, Pt, TileModel } from './tile-model.js'

/** The hexagon's private extras: the vertices (v0 is the one at -90 degrees,
 *  turned 30 for flat-top) and the vertex that carries the link. */
export interface HexagonGeometry extends ModelGeometry {
  readonly vertices: readonly Pt[]
  readonly marker: Pt
}

const VARIANTS: readonly ModelVariant[] = [
  { id: 'point-top', labelKey: 'editor.point-top', label: 'point-top' },
  { id: 'flat-top', labelKey: 'editor.flat-top', label: 'flat-top' },
]

const orientationOf = (variant: string): HexOrientation => (variant === 'flat-top' ? 'flat-top' : 'point-top')

/** Six vertices on circumradius R, v_j at -90 + 30 t + 60 j degrees. */
const verticesOf = (c: Pt, R: number, turn: 0 | 1): Pt[] =>
  Array.from({ length: 6 }, (_, j) => {
    const phi = ((-90 + 30 * turn) + 60 * j) * Math.PI / 180
    return { x: c.x + R * Math.cos(phi), y: c.y + R * Math.sin(phi) }
  })

const geometry = (size: number, variant: string): HexagonGeometry => {
  const orientation = orientationOf(variant)
  const turn: 0 | 1 = orientation === 'flat-top' ? 1 : 0
  const R = size / 2
  const a = R * Math.sqrt(3) / 2
  const c: Pt = { x: size / 2, y: size / 2 }
  const v = verticesOf(c, R, turn)
  const other = verticesOf(c, R, turn ? 0 : 1)
  const aa = tileLookAa(a)
  // The frame is the hex box of circumradius R (the "side"), centred.
  const hb = hexBox(orientation, R)
  const box = { x: c.x - hb.width / 2, y: c.y - hb.height / 2, w: hb.width, h: hb.height, cx: c.x, cy: c.y }
  const cb = captureBox(orientation)
  const outline = K.polyD(v)
  const halfRow = TILE_LOOK.band.halfRowR * a

  return {
    size,
    variant: orientation,
    c,
    unit: a,
    reach: R,
    outline,
    mask: outline,
    fade: true,
    box,
    extent: { min: box.x, max: box.x + box.w },
    rimWidth: TILE_LOOK.rim.widthAa * aa,
    glowInset: TILE_LOOK.glow.insetAa * aa,
    glowWidth: TILE_LOOK.glow.widthAa * aa,
    band: { x: 0, y: c.y - halfRow, w: size, h: 2 * halfRow },
    nameBox: { cx: c.x, cy: c.y, w: 1.55 * a, h: 2 * halfRow },
    nameFont: Math.max(9, 0.175 * a),
    // The saved bytes, fixed: not scaled by the stage size.
    capture: `${cb.width} x ${cb.height}`,
    inside: p => K.inPoly(v, p),
    insideMask: p => K.inPoly(v, p),
    edgeDistance: p => K.distPoly(v, p),
    offset: by => K.polyD(K.offsetPoly(v, by)),
    ghostPath: K.polyD(other),
    ghostInside: p => K.inPoly(other, p),
    ghostEdgeDistance: p => K.distPoly(other, p),
    groundShows: (pic, group) => group || (!!pic && !K.covers(pic, box)),
    groundPath: pic => outline + (pic ? K.rectD(pic) : ''),
    vertices: v,
    marker: v[2],
  }
}

const rimSlop = (g: ModelGeometry): number => Math.max(12, g.rimWidth / 2 + 9)
const vertexReach = (g: ModelGeometry): number => Math.max(14, 0.05 * g.size)
const markerOf = (g: ModelGeometry): Pt => (g as HexagonGeometry).marker
const topOf = (g: ModelGeometry): Pt => (g as HexagonGeometry).vertices[0]

const parts: readonly ModelPart<HexagonGeometry>[] = [
  { id: 'name', labelKey: 'editor.name', label: 'Name', fields: ['title', 'hideText'], side: 'left', z: 6,
    // The left end of the band, a little inside the edge.
    anchor: g => ({ x: K.spanAtY(g.vertices, g.c.y)[0] + 0.045 * g.size, y: g.c.y }),
    hit: HIT.band, lit: g => LIT.band(g) },

  { id: 'rim', labelKey: 'editor.border', label: 'Border', fields: ['border.color'], side: 'right', z: 5,
    // The upper-right edge, v0 to v1, in both variants.
    anchor: g => K.mid(g.vertices[0], g.vertices[1]),
    hit: HIT.rim(rimSlop), lit: g => LIT.ring(g) },

  { id: 'fill', labelKey: 'editor.fill-behind', label: 'Fill behind', fields: ['background.color'], side: 'left', z: 2,
    // The middle of the larger exposed cap, so the leader ends on ground that shows.
    anchor: (g, c) => {
      const x = g.c.x - 0.07 * g.size
      const [yt, yb] = K.spanAtX(g.vertices, x)
      const p = c.picture
      if (!p) return { x, y: yb - 0.09 * g.size }
      const capB = yb - (p.y + p.h)
      const capT = p.y - yt
      if (capT + 2 >= capB && capT > 12) return { x, y: (yt + p.y) / 2 }
      if (capB > 12) return { x, y: (p.y + p.h + yb) / 2 }
      return { x, y: yb - 0.09 * g.size }
    },
    hit: HIT.fill, lit: LIT.fill },

  { id: 'picture', labelKey: 'editor.picture', label: 'Picture', fields: ['picture'], side: 'left', z: 1, showsCapture: true,
    anchor: g => {
      const y = g.c.y - 0.17 * g.size
      return { x: K.spanAtY(g.vertices, y)[0] + 0.17 * g.size, y }
    },
    hit: HIT.picture, lit: LIT.picture },

  { id: 'link', labelKey: 'editor.link', label: 'Link', fields: ['link'], side: 'right', z: 8,
    anchor: g => g.marker,
    hit: HIT.disc(markerOf, vertexReach), lit: LIT.disc(markerOf, vertexReach) },

  { id: 'shape', labelKey: 'editor.shape', label: 'Shape', fields: ['orientation'], side: 'right', z: 7, showsCapture: true,
    anchor: g => g.vertices[0],
    // The top vertex, or the ghost's ears: the other variant is clickable.
    hit: K.or(HIT.disc(topOf, vertexReach), HIT.ghost(rimSlop)),
    lit: g => LIT.ghost(g) },
]

export const HEXAGON: TileModel<HexagonGeometry> = {
  id: 'hexagon',
  labelKey: 'editor.model.hexagon',
  label: 'hexagon',
  variants: VARIANTS,
  defaultVariant: 'point-top',
  geometry,
  parts,
  /** The six cells around this one on the hive lattice, in stage px from the centre. */
  neighbours(g) {
    const D = Math.sqrt(3) * (g.unit * 1.1875)
    const turn = g.variant === 'flat-top' ? 1 : 0
    return Array.from({ length: 6 }, (_, j) => {
      const t = (-60 + 30 * turn + 60 * j) * Math.PI / 180
      return { x: D * Math.cos(t), y: D * Math.sin(t) }
    })
  },
}
