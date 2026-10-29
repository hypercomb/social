// editor/models/model-contract.spec.ts
//
// THE CONTRACT EVERY MODEL KEEPS, run on every registered model and on a house
// that is NOT registered (a fixture, here, to prove the contract and the shell
// never needed a hexagon). A model that passes this can be drawn, lit, hit and
// labelled by the editor with no change to a shell file.

import { describe, expect, it } from 'vitest'
import { captureBox, hexBox } from '../crop-math.js'
import { HEXAGON } from './hexagon.model.js'
import { allModels, modelFor } from './models.js'
import { HIT, K, LIT } from './model-kit.js'
import type { FieldKey, LitItem, ModelGeometry, ModelPart, PartContext, Pt, Rect, TileModel } from './tile-model.js'

const FIELD_KEYS: readonly FieldKey[] = [
  'border.color', 'background.color', 'picture', 'title', 'hideText', 'link', 'orientation',
]

// ── the fixture: a house (the mock's second descriptor) ─────────────────────

interface HouseGeometry extends ModelGeometry {
  readonly vertices: readonly Pt[]
  readonly marker: Pt
}

const houseGeometry = (S: number): HouseGeometry => {
  const P = ([[.04, .44], [.50, .05], [.70, .2196], [.70, .08], [.82, .08], [.82, .3213], [.96, .44], [.96, .98], [.04, .98]] as const)
    .map(([x, y]) => ({ x: x * S, y: y * S }))
  const c = { x: S / 2, y: S / 2 }
  const unit = S * 0.46
  const aa = Math.max(0.04 * unit, 1.5)
  const win = { x: .26 * S, y: .40 * S, w: .48 * S, h: .30 * S }
  const box = { ...win, cx: win.x + win.w / 2, cy: win.y + win.h / 2 }
  const wp = [
    { x: win.x, y: win.y }, { x: win.x + win.w, y: win.y },
    { x: win.x + win.w, y: win.y + win.h }, { x: win.x, y: win.y + win.h },
  ]
  const outline = K.polyD(P)
  const mask = K.rectD(win)
  const bb = K.bbox(P)
  return {
    size: S, variant: '', c, unit,
    reach: Math.max(...P.map(q => Math.hypot(q.x - c.x, q.y - c.y))),
    outline, mask, fade: false, box,
    extent: { min: bb.x, max: bb.x + bb.w },
    rimWidth: 1.2 * aa, glowInset: 1.5 * aa, glowWidth: 3.5 * aa,
    band: { x: 0, y: .76 * S, w: S, h: .14 * S },
    nameBox: { cx: c.x, cy: .83 * S, w: .6 * S, h: .14 * S },
    nameFont: Math.max(9, 0.15 * unit),
    capture: '',
    inside: p => K.inPoly(P, p),
    insideMask: p => K.inRect(win, p),
    edgeDistance: p => K.distPoly(P, p),
    offset: (by, which) => K.polyD(K.offsetPoly(which === 'mask' ? wp : P, by)),
    ghostPath: null, ghostInside: () => false, ghostEdgeDistance: () => Infinity,
    groundShows: () => true,
    groundPath: pic => {
      const inter = pic ? K.inter(pic, win) : null
      return outline + (inter ? K.rectD(inter) : mask)
    },
    vertices: P,
    marker: { x: .76 * S, y: .08 * S },
  }
}

const chimney = (g: ModelGeometry): Pt => (g as HouseGeometry).marker
const chimneyReach = (g: ModelGeometry): number => Math.max(14, 0.05 * g.size)
const slop = (g: ModelGeometry): number => Math.max(12, g.rimWidth / 2 + 9)

const houseParts: readonly ModelPart<HouseGeometry>[] = [
  { id: 'name', labelKey: 'editor.model.house.name', label: 'Name plate', fields: ['title', 'hideText'], side: 'left', z: 6,
    anchor: g => ({ x: .09 * g.size, y: .83 * g.size }), hit: HIT.band, lit: g => LIT.band(g) },
  { id: 'rim', labelKey: 'editor.model.house.rim', label: 'Outline', fields: ['border.color'], side: 'right', z: 5,
    anchor: g => ({ x: .96 * g.size, y: .62 * g.size }), hit: HIT.rim(slop), lit: g => LIT.ring(g) },
  { id: 'fill', labelKey: 'editor.model.house.fill', label: 'Walls', fields: ['background.color'], side: 'left', z: 2,
    anchor: g => ({ x: .12 * g.size, y: .62 * g.size }), hit: HIT.fill, lit: LIT.fill },
  { id: 'picture', labelKey: 'editor.model.house.picture', label: 'Window', fields: ['picture'], side: 'left', z: 1,
    anchor: g => ({ x: .31 * g.size, y: .47 * g.size }), hit: HIT.picture, lit: LIT.picture },
  { id: 'link', labelKey: 'editor.model.house.link', label: 'Chimney link', fields: ['link'], side: 'right', z: 8,
    anchor: g => g.marker, hit: HIT.disc(chimney, chimneyReach), lit: LIT.disc(chimney, chimneyReach) },
]

const HOUSE: TileModel<HouseGeometry> = {
  id: 'house', labelKey: 'editor.model.house', label: 'house',
  variants: [], defaultVariant: '',
  geometry: houseGeometry,
  parts: houseParts,
  neighbours: g => [{ x: -g.size * 1.08, y: 0 }, { x: g.size * 1.08, y: 0 }],
}

// ── a small reader for the paths a model draws (polygons, rects, circles) ───

type Shape = { kind: 'poly'; pts: Pt[] } | { kind: 'circle'; c: Pt; r: number }

const num = (s: string): number[] => s.split(/[\s,]+/).filter(Boolean).map(Number)

const shapesOf = (d: string): Shape[] => {
  const out: Shape[] = []
  let pts: Pt[] = []
  let cur: Pt = { x: 0, y: 0 }
  const close = (): void => { if (pts.length > 2) out.push({ kind: 'poly', pts }); pts = [] }
  for (const m of d.matchAll(/([MLHVZa])([^MLHVZa]*)/g)) {
    const n = num(m[2])
    switch (m[1]) {
      case 'M': close(); cur = { x: n[0], y: n[1] }; pts = [cur]; break
      case 'L': for (let i = 0; i < n.length; i += 2) { cur = { x: n[i], y: n[i + 1] }; pts.push(cur) } break
      case 'H': cur = { x: n[0], y: cur.y }; pts.push(cur); break
      case 'V': cur = { x: cur.x, y: n[0] }; pts.push(cur); break
      case 'Z': close(); break
      case 'a': {
        // circleD: two arcs of radius r from the leftmost point; one circle.
        if (!out.some(s => s.kind === 'circle' && s.c.x === cur.x + n[0] && s.c.y === cur.y)) {
          out.push({ kind: 'circle', c: { x: cur.x + n[0], y: cur.y }, r: n[0] })
        }
        pts = []
        break
      }
    }
  }
  close()
  return out
}

/** Even-odd membership: a point is in the region when an odd number of the
 *  subpaths hold it. */
const inRegion = (d: string, p: Pt): boolean =>
  shapesOf(d).filter(s => s.kind === 'poly' ? K.inPoly(s.pts, p) : Math.hypot(p.x - s.c.x, p.y - s.c.y) <= s.r).length % 2 === 1

const allPoints = (d: string): Pt[] => shapesOf(d).flatMap(s => s.kind === 'poly' ? s.pts : [s.c])

const SIZE = 616
const variantsOf = (m: TileModel): string[] => (m.variants.length ? m.variants.map(v => v.id) : [m.defaultVariant])

const centred = (box: Rect, k: number): Rect => ({
  x: box.x + box.w * (1 - k) / 2, y: box.y + box.h * (1 - k) / 2, w: box.w * k, h: box.h * k,
})

/** The pictures a session can be in: none, covering, inset, and half. */
const pictures = (g: ModelGeometry): (Rect | null)[] => [
  null,
  { x: g.box.x, y: g.box.y, w: g.box.w, h: g.box.h },
  centred(g.box, 0.6),
  { x: g.box.x, y: g.box.y, w: g.box.w / 2, h: g.box.h },
]

const contextOf = (g: ModelGeometry, picture: Rect | null, group: boolean): PartContext => {
  const pic = group ? null : picture
  return { picture: pic, fillLive: g.groundShows(pic, group), showName: true, group }
}

const MODELS: readonly TileModel[] = [...allModels(), HOUSE as unknown as TileModel]

describe.each(MODELS.map(m => [m.id, m] as const))('model contract: %s', (_id, model) => {
  const cases = variantsOf(model).map(v => [v, model.geometry(SIZE, v)] as const)

  it('has a label key and a label, and a default variant it lists', () => {
    expect(model.labelKey).toMatch(/\S/)
    expect(model.label).toMatch(/\S/)
    if (model.variants.length) expect(model.variants.map(v => v.id)).toContain(model.defaultVariant)
    for (const v of model.variants) {
      expect(v.labelKey).toMatch(/\S/)
      expect(v.label).toMatch(/\S/)
    }
  })

  it('has unique part ids, label keys and labels, each with a primary field', () => {
    const ids = model.parts.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of model.parts) {
      expect(p.labelKey).toMatch(/\S/)
      expect(p.label).toMatch(/\S/)
      expect(p.fields.length).toBeGreaterThan(0)
    }
    // Distinct z, or hit priority would be a coin toss.
    const zs = model.parts.map(p => p.z)
    expect(new Set(zs).size).toBe(zs.length)
  })

  it('edits only known tile fields, with valid sides', () => {
    for (const p of model.parts) {
      for (const k of p.fields) expect(FIELD_KEYS).toContain(k)
      expect(['left', 'right']).toContain(p.side)
    }
  })

  it('builds a geometry for every variant, with a stage that is the size asked for', () => {
    for (const [v, g] of cases) {
      expect(g.size).toBe(SIZE)
      expect(g.variant).toBe(v)
      expect(g.outline).toMatch(/^M/)
      expect(g.mask).toMatch(/^M/)
      expect(g.extent.max).toBeGreaterThan(g.extent.min)
      expect(g.rimWidth).toBeGreaterThan(0)
    }
  })

  it('offset(0) is the outline and the mask', () => {
    for (const [, g] of cases) {
      for (const [which, d] of [['outline', g.outline], ['mask', g.mask]] as const) {
        const want = allPoints(d)
        const got = allPoints(g.offset(0, which))
        expect(got.length).toBe(want.length)
        got.forEach((p, i) => {
          expect(p.x).toBeCloseTo(want[i].x, 1)
          expect(p.y).toBeCloseTo(want[i].y, 1)
        })
      }
    }
  })

  it('offsets outward and inward', () => {
    for (const [, g] of cases) {
      const area = (d: string): number => {
        const s = shapesOf(d)[0]
        if (s.kind !== 'poly') throw new Error('expected a polygon')
        return Math.abs(s.pts.reduce((sum, p, k) => { const q = s.pts[(k + 1) % s.pts.length]; return sum + p.x * q.y - q.x * p.y }, 0)) / 2
      }
      expect(area(g.offset(10))).toBeGreaterThan(area(g.outline))
      expect(area(g.offset(-10))).toBeLessThan(area(g.outline))
    }
  })

  it('puts every anchor inside the outline box grown by one gutter, in every context', () => {
    for (const [, g] of cases) {
      const bb = K.bbox(allPoints(g.outline))
      const gutter = 0.1 * g.size
      for (const pic of pictures(g)) for (const group of [false, true]) {
        const ctx = contextOf(g, pic, group)
        for (const part of model.parts) {
          const a = part.anchor(g as never, ctx)
          expect(a.x, `${part.id} x`).toBeGreaterThanOrEqual(bb.x - gutter)
          expect(a.x, `${part.id} x`).toBeLessThanOrEqual(bb.x + bb.w + gutter)
          expect(a.y, `${part.id} y`).toBeGreaterThanOrEqual(bb.y - gutter)
          expect(a.y, `${part.id} y`).toBeLessThanOrEqual(bb.y + bb.h + gutter)
        }
      }
    }
  })

  it('hit agrees with lit: a point inside a part\'s lit fill or hatch is a hit for that part', () => {
    let checked = 0
    for (const [v, g] of cases) {
      for (const pic of pictures(g)) for (const group of [false, true]) {
        const ctx = contextOf(g, pic, group)
        for (const part of model.parts) {
          const items: LitItem[] = part.lit(g as never, ctx)
          for (const item of items.filter(i => i.kind === 'fill' || i.kind === 'hatch')) {
            for (let x = 2; x < g.size; x += 15.4) {
              for (let y = 2; y < g.size; y += 15.4) {
                const p = { x, y }
                if (!inRegion(item.d, p)) continue
                if (item.clip === 'in' && !g.inside(p)) continue
                if (item.clip === 'mask' && !g.insideMask(p)) continue
                // The other variant's ears: only beyond the rim's own slop.
                if (item.clip === 'out' && (g.inside(p) || g.edgeDistance(p) <= 20)) continue
                checked++
                expect(part.hit(p, g as never, ctx), `${model.id}/${v}/${part.id} at ${x.toFixed(0)},${y.toFixed(0)}`).toBe(true)
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('keeps the ground silent when it is covered: no hatch, no fill hit', () => {
    for (const [, g] of cases) {
      const ctx = contextOf(g, g.box, false)
      const fill = model.parts.find(p => p.fields[0] === 'background.color')!
      if (!ctx.fillLive) {
        expect(fill.lit(g as never, ctx)).toEqual([])
        expect(fill.hit(g.c, g as never, ctx)).toBe(false)
      }
    }
  })

  it('shows the ground in a group, whatever the picture', () => {
    for (const [, g] of cases) {
      for (const pic of pictures(g)) expect(g.groundShows(pic, true)).toBe(true)
    }
  })

  it('lights without throwing in every context, with drawable paths', () => {
    for (const [, g] of cases) {
      for (const pic of pictures(g)) for (const group of [false, true]) {
        const ctx = contextOf(g, pic, group)
        for (const part of model.parts) {
          for (const item of part.lit(g as never, ctx)) {
            expect(item.d).toMatch(/^M/)
            expect(['band', 'edge', 'halo', 'fill', 'hatch']).toContain(item.kind)
          }
        }
      }
    }
  })

  it('keeps its neighbours as points, when it has any', () => {
    for (const [, g] of cases) {
      for (const p of model.neighbours?.(g as never) ?? []) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
      }
    }
  })
})

describe('model lookup', () => {
  it('does not register the fixture house', () => {
    expect(allModels().map(m => m.id)).toEqual(['hexagon'])
    expect(modelFor('house').id).toBe('hexagon')
  })

  it('falls back to the hexagon for no id or an unknown one', () => {
    expect(modelFor().id).toBe('hexagon')
    expect(modelFor('nope').id).toBe('hexagon')
    expect(modelFor('hexagon')).toBe(HEXAGON)
  })
})

describe('the hexagon frame cannot drift from the framing maths', () => {
  it('derives its box and capture from hexBox and captureBox', () => {
    for (const v of ['point-top', 'flat-top'] as const) {
      const g = HEXAGON.geometry(SIZE, v)
      const hb = hexBox(v, SIZE / 2)
      expect(g.box.w).toBeCloseTo(hb.width, 6)
      expect(g.box.h).toBeCloseTo(hb.height, 6)
      expect(g.box.cx).toBe(SIZE / 2)
      expect(g.box.x + g.box.w / 2).toBeCloseTo(SIZE / 2, 6)
      expect(g.box.y + g.box.h / 2).toBeCloseTo(SIZE / 2, 6)
      const cb = captureBox(v)
      expect(g.capture).toBe(`${cb.width} x ${cb.height}`)
      // The silhouette fills exactly that box.
      const bb = K.bbox(allPoints(g.outline))
      expect(bb.x).toBeCloseTo(g.box.x, 1)
      expect(bb.y).toBeCloseTo(g.box.y, 1)
      expect(bb.w).toBeCloseTo(g.box.w, 1)
      expect(bb.h).toBeCloseTo(g.box.h, 1)
    }
  })

  it('scales the box with the stage and keeps the capture fixed', () => {
    const a = HEXAGON.geometry(400, 'point-top')
    const b = HEXAGON.geometry(800, 'point-top')
    expect(b.box.w / a.box.w).toBeCloseTo(2, 6)
    expect(b.capture).toBe(a.capture)
  })
})
