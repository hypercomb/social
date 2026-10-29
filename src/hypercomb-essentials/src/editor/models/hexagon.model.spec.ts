// editor/models/hexagon.model.spec.ts
//
// THE HEXAGON'S OWN NUMBERS, pinned: where its vertices are, how big the band
// and the name are, what a save writes, and which part wins a click where parts
// overlap. The generic contract is in model-contract.spec.ts; this is what only
// the hexagon promises.

import { describe, expect, it } from 'vitest'
import { TILE_LOOK, tileLookAa } from '../../presentation/grid/tile-look.js'
import { HEXAGON, type HexagonGeometry } from './hexagon.model.js'
import type { PartContext, Pt, Rect } from './tile-model.js'

const S = 616
const R = S / 2
const A = R * Math.sqrt(3) / 2
const C = { x: S / 2, y: S / 2 }

const geo = (variant: string): HexagonGeometry => HEXAGON.geometry(S, variant)

const ctxOf = (g: HexagonGeometry, picture: Rect | null, group = false): PartContext => {
  const pic = group ? null : picture
  return { picture: pic, fillLive: g.groundShows(pic, group), showName: true, group }
}

/** The topmost part under a point: highest z whose hit is true. */
const partAt = (g: HexagonGeometry, ctx: PartContext, p: Pt): string | null => {
  const hits = HEXAGON.parts.filter(part => part.hit(p, g, ctx)).sort((a, b) => b.z - a.z)
  return hits.length ? hits[0].id : null
}

describe('hexagon geometry', () => {
  it('puts point-top vertices at -90 + 60j degrees on the circumradius', () => {
    const g = geo('point-top')
    g.vertices.forEach((v, j) => {
      const phi = (-90 + 60 * j) * Math.PI / 180
      expect(v.x).toBeCloseTo(C.x + R * Math.cos(phi), 6)
      expect(v.y).toBeCloseTo(C.y + R * Math.sin(phi), 6)
    })
    expect(g.vertices[0].x).toBeCloseTo(C.x, 6)
    expect(g.vertices[0].y).toBeCloseTo(0, 6)
  })

  it('turns flat-top by 30 degrees', () => {
    const g = geo('flat-top')
    g.vertices.forEach((v, j) => {
      const phi = (-60 + 60 * j) * Math.PI / 180
      expect(v.x).toBeCloseTo(C.x + R * Math.cos(phi), 6)
      expect(v.y).toBeCloseTo(C.y + R * Math.sin(phi), 6)
    })
    // v1 sits on the right-hand point.
    expect(g.vertices[1].x).toBeCloseTo(S, 6)
    expect(g.vertices[1].y).toBeCloseTo(C.y, 6)
  })

  it('has apothem a = R sqrt(3) / 2 as its unit, and R as its reach', () => {
    for (const v of ['point-top', 'flat-top']) {
      const g = geo(v)
      expect(g.unit).toBeCloseTo(A, 9)
      expect(g.reach).toBe(R)
      expect(g.c).toEqual(C)
      // Every edge lies a from the centre.
      expect(g.edgeDistance(C)).toBeCloseTo(A, 6)
    }
  })

  it('draws the rim, glow and band from TILE_LOOK', () => {
    const g = geo('point-top')
    const aa = tileLookAa(A)
    expect(g.rimWidth).toBeCloseTo(TILE_LOOK.rim.widthAa * aa, 9)
    expect(g.glowInset).toBeCloseTo(TILE_LOOK.glow.insetAa * aa, 9)
    expect(g.glowWidth).toBeCloseTo(TILE_LOOK.glow.widthAa * aa, 9)
    // 1.2 aa, as the shader's rim.
    expect(g.rimWidth).toBeCloseTo(1.2 * Math.max(0.04 * A, 1.5), 9)
  })

  it('keeps the aa floor on a small stage', () => {
    const g = HEXAGON.geometry(60, 'point-top')
    expect(g.rimWidth).toBeCloseTo(1.2 * 1.5, 9)
  })

  it('has a full-width band 0.3 a tall about the centre', () => {
    const g = geo('point-top')
    expect(g.band).not.toBeNull()
    expect(g.band!.x).toBe(0)
    expect(g.band!.w).toBe(S)
    expect(g.band!.h).toBeCloseTo(0.3 * A, 6)
    expect(g.band!.y + g.band!.h / 2).toBeCloseTo(C.y, 6)
  })

  it('sizes the name box 1.55 a wide with a font of 0.175 a', () => {
    const g = geo('flat-top')
    expect(g.nameBox!.w).toBeCloseTo(1.55 * A, 6)
    expect(g.nameBox!.h).toBeCloseTo(0.3 * A, 6)
    expect(g.nameBox!.cx).toBe(C.x)
    expect(g.nameBox!.cy).toBe(C.y)
    expect(g.nameFont).toBeCloseTo(0.175 * A, 6)
    expect(HEXAGON.geometry(40, 'point-top').nameFont).toBe(9)
  })

  it('names the bytes a save writes, whatever the stage size', () => {
    expect(geo('point-top').capture).toBe('346 x 400')
    expect(geo('flat-top').capture).toBe('400 x 346')
    expect(HEXAGON.geometry(300, 'flat-top').capture).toBe('400 x 346')
  })

  it('has the x-extent of its box, so the gutters turn with the variant', () => {
    const p = geo('point-top')
    expect(p.extent.min).toBeCloseTo(C.x - A, 6)
    expect(p.extent.max).toBeCloseTo(C.x + A, 6)
    const f = geo('flat-top')
    expect(f.extent.min).toBeCloseTo(0, 6)
    expect(f.extent.max).toBeCloseTo(S, 6)
  })

  it('masks the picture with its outline and lets it fade', () => {
    const g = geo('point-top')
    expect(g.mask).toBe(g.outline)
    expect(g.fade).toBe(true)
  })

  it('offers the other variant as its ghost', () => {
    expect(geo('point-top').ghostPath).toBe(geo('flat-top').outline)
    expect(geo('flat-top').ghostPath).toBe(geo('point-top').outline)
    const g = geo('point-top')
    expect(g.ghostInside({ x: 600, y: C.y })).toBe(true)
    expect(g.inside({ x: 600, y: C.y })).toBe(false)
    expect(g.ghostEdgeDistance({ x: S, y: C.y })).toBeCloseTo(0, 6)
  })

  it('shows the ground only in a group or when the picture leaves the box bare', () => {
    const g = geo('point-top')
    expect(g.groundShows(null, false)).toBe(false)
    expect(g.groundShows({ ...g.box }, false)).toBe(false)
    expect(g.groundShows({ x: g.box.x - 20, y: g.box.y - 20, w: g.box.w + 40, h: g.box.h + 40 }, false)).toBe(false)
    expect(g.groundShows({ x: g.box.x + 30, y: g.box.y, w: g.box.w - 30, h: g.box.h }, false)).toBe(true)
    expect(g.groundShows(null, true)).toBe(true)
    expect(g.groundPath(null)).toBe(g.outline)
  })

  it('places six neighbours one cell apart on the hive lattice, turning with the variant', () => {
    const D = Math.sqrt(3) * (A * 1.1875)
    for (const v of ['point-top', 'flat-top']) {
      const ns = HEXAGON.neighbours!(geo(v))
      expect(ns).toHaveLength(6)
      for (const n of ns) expect(Math.hypot(n.x, n.y)).toBeCloseTo(D, 6)
    }
    const point = HEXAGON.neighbours!(geo('point-top'))[0]
    const flat = HEXAGON.neighbours!(geo('flat-top'))[0]
    expect(point.x).toBeCloseTo(D * Math.cos(-Math.PI / 3), 6)
    expect(flat.x).toBeCloseTo(D * Math.cos(-Math.PI / 6), 6)
  })
})

describe('hexagon parts', () => {
  it('has the seven-part table in tab order, with the table\'s priority', () => {
    expect(HEXAGON.parts.map(p => p.id)).toEqual(['name', 'rim', 'fill', 'picture', 'link', 'shape'])
    const z = Object.fromEntries(HEXAGON.parts.map(p => [p.id, p.z]))
    expect(z).toEqual({ name: 6, rim: 5, fill: 2, picture: 1, link: 8, shape: 7 })
    expect(HEXAGON.parts.map(p => p.fields[0])).toEqual([
      'title', 'border.color', 'background.color', 'picture', 'link', 'orientation',
    ])
    expect(HEXAGON.parts.find(p => p.id === 'name')!.fields).toEqual(['title', 'hideText'])
  })

  it('reuses the existing label keys', () => {
    expect(HEXAGON.parts.map(p => p.labelKey)).toEqual([
      'editor.name', 'editor.border', 'editor.fill-behind', 'editor.picture', 'editor.link', 'editor.shape',
    ])
    expect(HEXAGON.variants.map(v => v.labelKey)).toEqual(['editor.point-top', 'editor.flat-top'])
    expect(HEXAGON.defaultVariant).toBe('point-top')
  })

  it('shows the capture box for the picture and the shape only', () => {
    expect(HEXAGON.parts.filter(p => p.showsCapture).map(p => p.id)).toEqual(['picture', 'shape'])
  })

  it('anchors the right column strictly top to bottom in both variants: shape, border, link', () => {
    for (const v of ['point-top', 'flat-top']) {
      const g = geo(v)
      const y = (id: string): number => HEXAGON.parts.find(p => p.id === id)!.anchor(g, ctxOf(g, null)).y
      expect(y('shape')).toBeLessThan(y('rim'))
      expect(y('rim')).toBeLessThan(y('link'))
      for (const id of ['shape', 'rim', 'link']) expect(HEXAGON.parts.find(p => p.id === id)!.side).toBe('right')
    }
  })

  it('anchors the left column strictly top to bottom with a cap above the picture: fill, picture, name', () => {
    for (const v of ['point-top', 'flat-top']) {
      const g = geo(v)
      // A picture that runs off the bottom leaves only the top cap of ground.
      const pic = { x: g.box.x, y: C.y - 0.3 * S, w: g.box.w, h: S }
      const ctx = ctxOf(g, pic)
      const y = (id: string): number => HEXAGON.parts.find(p => p.id === id)!.anchor(g, ctx).y
      expect(y('fill')).toBeLessThan(y('picture'))
      expect(y('picture')).toBeLessThan(y('name'))
      for (const id of ['fill', 'picture', 'name']) expect(HEXAGON.parts.find(p => p.id === id)!.side).toBe('left')
    }
  })

  it('ends the leaders on the vertices and the edge the table names', () => {
    for (const v of ['point-top', 'flat-top']) {
      const g = geo(v)
      const at = (id: string): Pt => HEXAGON.parts.find(p => p.id === id)!.anchor(g, ctxOf(g, null))
      expect(at('link')).toEqual(g.vertices[2])
      expect(at('shape')).toEqual(g.vertices[0])
      expect(at('rim').x).toBeCloseTo((g.vertices[0].x + g.vertices[1].x) / 2, 9)
      expect(g.edgeDistance(at('rim'))).toBeCloseTo(0, 6)
      expect(at('name').y).toBe(C.y)
    }
  })

  it('resolves clicks by priority at hand-picked points (point-top, 616)', () => {
    const g = geo('point-top')
    const full = ctxOf(g, g.box)
    const bare = ctxOf(g, null, true) // a group: the ground shows, no picture
    const inset: Rect = { x: g.box.x + 70, y: g.box.y + 70, w: g.box.w - 140, h: g.box.h - 140 }

    // The band wins in the middle, over the picture or the ground.
    expect(partAt(g, full, C)).toBe('name')
    expect(partAt(g, bare, C)).toBe('name')
    // Below the band the interior falls through: picture, then fill.
    expect(partAt(g, full, { x: C.x, y: C.y + 100 })).toBe('picture')
    expect(partAt(g, bare, { x: C.x, y: C.y + 100 })).toBe('fill')
    // A covered ground is never hit.
    expect(partAt(g, ctxOf(g, g.box), { x: C.x, y: C.y + 100 })).toBe('picture')
    // An inset picture leaves a ground cap to hit above it.
    expect(partAt(g, ctxOf(g, inset), { x: C.x, y: g.box.y + 55 })).toBe('fill')
    // The edge is the border.
    expect(partAt(g, full, { x: C.x + A, y: C.y + 100 })).toBe('rim')
    expect(partAt(g, full, { x: C.x + A - 10, y: C.y + 100 })).toBe('rim')
    // The vertices beat the border: link at v2, shape at v0.
    expect(partAt(g, full, g.vertices[2])).toBe('link')
    expect(partAt(g, full, g.vertices[0])).toBe('shape')
    // The band beats the border at its ends (the left edge at the centre line).
    expect(partAt(g, full, { x: C.x - A + 4, y: C.y })).toBe('name')
    // The ghost's ear (outside, past the rim slop) is the shape.
    expect(partAt(g, full, { x: 600, y: C.y })).toBe('shape')
    // Far outside is nothing.
    expect(partAt(g, full, { x: 4, y: 4 })).toBeNull()
  })

  it('resolves clicks by priority at hand-picked points (flat-top, 616)', () => {
    const g = geo('flat-top')
    const full = ctxOf(g, g.box)
    expect(partAt(g, full, C)).toBe('name')
    expect(partAt(g, full, g.vertices[2])).toBe('link')
    expect(partAt(g, full, g.vertices[0])).toBe('shape')
    expect(partAt(g, full, { x: C.x, y: C.y - A + 1 })).toBe('rim')
    // The other variant (point-top) pokes out above and below the flat edges.
    expect(partAt(g, full, { x: C.x, y: 4 })).toBe('shape')
  })

  it('lights the ring of the border at the offsets the table gives', () => {
    const g = geo('point-top')
    const items = HEXAGON.parts.find(p => p.id === 'rim')!.lit(g, ctxOf(g, null))
    expect(items[0]).toMatchObject({ kind: 'band', w: 2 * (g.rimWidth / 2 + 9) })
    expect(items.filter(i => i.kind === 'edge')).toHaveLength(2)
  })

  it('hatches nothing when the ground is covered, and hatches the ground when it shows', () => {
    const g = geo('point-top')
    const fill = HEXAGON.parts.find(p => p.id === 'fill')!
    expect(fill.lit(g, ctxOf(g, g.box))).toEqual([])
    const shown = fill.lit(g, ctxOf(g, null, true))
    expect(shown[0]).toMatchObject({ kind: 'hatch', rule: 'evenodd', clip: 'in', d: g.outline })
  })
})
