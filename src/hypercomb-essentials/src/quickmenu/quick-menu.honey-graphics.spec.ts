// quick-menu.honey-graphics.spec.ts — the Pixi ring's honey: the clip that keeps
// the pour lip inside the hexagon, the colours it takes from the shared palette,
// and a drawing smoke test for every state in either orientation.

import { describe, expect, it } from 'vitest'
import { Texture } from 'pixi.js'
import {
  clipConvex, drawHexMask, drawHoney, drawHoneyRim, drawSheenBand, drawSheenZone, hexOutline, honeyArtFrames,
  honeyArtSprite, lipPolygon, paint, sheenZonePieces, type Pt,
} from './quick-menu.honey-graphics.js'
import { SHEEN, sheenZones } from './quick-menu.honey.js'
import { HEX_RADIUS } from './quick-menu.types.js'

/** Inside a convex polygon (either winding), allowing a hair of float slack. */
function inside(p: Pt, poly: readonly Pt[], eps = 1e-6): boolean {
  let positive = 0, negative = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cross > eps) positive++
    else if (cross < -eps) negative++
  }
  return positive === 0 || negative === 0
}

/** A recording stand-in for Pixi's Graphics: every call is chainable and noted. */
function recorder(): { g: never; calls: string[] } {
  const calls: string[] = []
  const g = new Proxy({}, {
    get: (_t, name: string) => (...args: unknown[]) => {
      calls.push(name)
      void args
      return g
    },
  })
  return { g: g as never, calls }
}

describe('hexOutline', () => {
  it('is point-top by default and flat-top when asked', () => {
    const pointy = hexOutline(46, false)
    expect(pointy[0][0]).toBeCloseTo(0, 6)
    expect(pointy[0][1]).toBeCloseTo(-46, 6)
    const flat = hexOutline(46, true)
    expect(flat[0][0]).toBeCloseTo(46, 6)
    expect(flat[0][1]).toBeCloseTo(0, 6)
  })

  it('scales about the centre', () => {
    const half = hexOutline(46, false, 0.5)
    expect(Math.hypot(half[1][0], half[1][1])).toBeCloseTo(23, 6)
  })
})

describe('clipConvex', () => {
  it('leaves a polygon that is already inside alone', () => {
    const hex = hexOutline(40, false)
    const square: Pt[] = [[-5, -5], [5, -5], [5, 5], [-5, 5]]
    expect(clipConvex(square, hex)).toEqual(square)
  })

  it('cuts a polygon that overshoots to the hexagon, in either winding', () => {
    for (const hex of [hexOutline(40, false), [...hexOutline(40, false)].reverse()]) {
      const big: Pt[] = [[-100, -100], [100, -100], [100, 100], [-100, 100]]
      const cut = clipConvex(big, hex)
      expect(cut.length).toBeGreaterThanOrEqual(6)
      for (const p of cut) expect(inside(p, hex, 1e-4)).toBe(true)
    }
  })

  it('returns nothing for a polygon wholly outside', () => {
    expect(clipConvex([[100, 100], [120, 100], [120, 120]], hexOutline(40, false))).toEqual([])
  })
})

describe('lipPolygon', () => {
  const radius = 46

  it('covers the top of the tile and none of the middle, so it can never reach a glyph', () => {
    for (const flat of [false, true]) {
      const lip = clipConvex(lipPolygon(radius, 0.3), hexOutline(radius, flat))
      expect(lip.length).toBeGreaterThan(3)
      // everything the lip covers lies above the lip line's lowest reach, -0.47 R
      for (const p of lip) {
        expect(inside(p, hexOutline(radius, flat), 1e-4)).toBe(true)
        expect(p[1]).toBeLessThan(-0.46 * radius)
      }
    }
  })

  it('is the same for the same seed and different for another', () => {
    expect(lipPolygon(radius, 0.4)).toEqual(lipPolygon(radius, 0.4))
    expect(lipPolygon(radius, 0.4)).not.toEqual(lipPolygon(radius, 0.9))
  })

  it('scales with the tile', () => {
    const small = lipPolygon(23, 0.4)
    const large = lipPolygon(46, 0.4)
    for (let i = 0; i < small.length; i++) {
      expect(small[i][0] * 2).toBeCloseTo(large[i][0], 6)
      expect(small[i][1] * 2).toBeCloseTo(large[i][1], 6)
    }
  })
})

describe('paint', () => {
  it('reads hex, rgb and rgba', () => {
    expect(paint('#ffd98a')).toEqual({ color: 0xffd98a, alpha: 1 })
    expect(paint('rgb(255, 0, 16)')).toEqual({ color: 0xff0010, alpha: 1 })
    expect(paint('rgba(126,182,214,0.20)')).toEqual({ color: 0x7eb6d6, alpha: 0.2 })
  })
})

describe('drawHoney', () => {
  const states = [
    { lit: false, back: false },
    { lit: true, back: false },
    { lit: false, back: true },
    { lit: true, back: true },
  ]

  it('draws every state in either orientation, clearing first', () => {
    for (const flat of [false, true]) {
      for (const state of states) {
        const { g, calls } = recorder()
        drawHoney(g, HEX_RADIUS, flat, state, 0.42)
        expect(calls[0]).toBe('clear')
        expect(calls.length).toBeGreaterThan(10)
      }
    }
  })

  it('pours the lip and its drips only on an option, never on the way back', () => {
    const rest = recorder()
    drawHoney(rest.g, HEX_RADIUS, false, { lit: false, back: false }, 0.42)
    const back = recorder()
    drawHoney(back.g, HEX_RADIUS, false, { lit: false, back: true }, 0.42)
    // the beads are circles and ellipses; the way back has neither
    expect(rest.calls).toContain('circle')
    expect(rest.calls).toContain('ellipse')
    expect(back.calls).not.toContain('circle')
    expect(back.calls).not.toContain('ellipse')
    // and the dashed rim is a path of separate strokes, not one closed polygon
    expect(back.calls).toContain('moveTo')
  })
})

describe('the crafted backgrounds in Pixi', () => {
  it('draws only the rim at rest, and the halo inside it when lit', () => {
    const rest = recorder()
    drawHoneyRim(rest.g, HEX_RADIUS, false, false)
    expect(rest.calls).toEqual(['clear', 'poly', 'stroke'])
    const lit = recorder()
    drawHoneyRim(lit.g, HEX_RADIUS, true, true)
    expect(lit.calls).toEqual(['clear', 'poly', 'stroke', 'poly', 'stroke'])
  })

  it('sizes the picture to the tile (2R tall) and turns it for a flat-top tile', () => {
    const texture = Texture.EMPTY
    const pointy = honeyArtSprite(texture, 92, false)
    expect(pointy.scale.x).toBeCloseTo((2 * 92) / 322, 9)
    expect(pointy.scale.y).toBeCloseTo((2 * 92) / 322, 9)
    expect(pointy.rotation).toBe(0)
    expect(pointy.anchor.x).toBe(0.5)
    expect(honeyArtSprite(texture, 46, true).rotation).toBeCloseTo(-Math.PI / 6, 9)
  })

  it('masks to the same hexagon the tile is', () => {
    const { g, calls } = recorder()
    drawHexMask(g, HEX_RADIUS, false)
    expect(calls).toEqual(['clear', 'poly', 'fill'])
  })

  it('cuts no frames when the atlas never became a texture', () => {
    expect(honeyArtFrames({
      count: 10, width: 280, height: 322, pad: 2, ready: new Array(10).fill(true),
      atlas: document.createElement('canvas'), rest: [], lit: [], texture: null,
    })).toBeNull()
  })
})

describe('the light that crosses a tile', () => {
  const area = (poly: readonly Pt[]): number => {
    let sum = 0
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]
      sum += x0 * y1 - x1 * y0
    }
    return Math.abs(sum) / 2
  }

  it('cuts its regions into pieces that tile the hexagon exactly once, in either orientation', () => {
    for (const flat of [false, true]) {
      for (const radius of [HEX_RADIUS, 30]) {
        const hex = hexOutline(radius, flat)
        let total = 0
        for (const zone of sheenZones()) {
          for (const piece of sheenZonePieces(radius, flat, zone)) {
            for (const p of piece) expect(inside(p, hex)).toBe(true)
            total += area(piece)
          }
        }
        expect(total).toBeCloseTo(area(hex), 6)
      }
    }
  })

  it('keeps the capped region on the icon and label band', () => {
    const [cap] = sheenZones()
    const pieces = sheenZonePieces(HEX_RADIUS, false, cap)
    const band = SHEEN.inkBand
    expect(pieces.reduce((sum, p) => sum + area(p), 0)).toBeCloseTo((band.x1 - band.x0) * (band.y1 - band.y0), 6)
  })

  it('draws the band once and each region as plain fills, no holes', () => {
    const band = recorder()
    drawSheenBand(band.g, HEX_RADIUS)
    expect(band.calls[0]).toBe('clear')
    expect(band.calls.filter(c => c === 'rect').length).toBeGreaterThan(6)
    for (const zone of sheenZones()) {
      const region = recorder()
      drawSheenZone(region.g, HEX_RADIUS, false, zone)
      expect(region.calls).not.toContain('cut')
      expect(region.calls.filter(c => c === 'fill')).toHaveLength(1)
      expect(region.calls.filter(c => c === 'poly').length).toBeGreaterThan(0)
    }
  })
})
