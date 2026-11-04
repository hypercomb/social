// The quick menu's honey is stated twice — as numbers in quickmenu/quick-menu.honey.ts
// (the SVG ring and the Pixi ring read them) and as GLSL literals in the hex shader
// (the Alt flower). This reads the shader source and fails the moment the two
// disagree, and pins how the honey is gated so an ordinary tile never wears it.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BODY_BACK,
  BODY_BACK_LIT,
  BODY_LIT,
  BODY_REST,
  DRIP_PERIOD_S,
  HONEY,
  HONEY_LIGHT,
  hexToRgb,
} from '../../quickmenu/quick-menu.honey.js'
import { HONEY_ART_EFFECT } from '../../quickmenu/quick-menu.honey-art.js'
import { FLOWER_CLOCK_PERIOD_S } from '../tiles/flower-motion.js'

const here = dirname(fileURLToPath(import.meta.url))
const shader = readFileSync(join(here, 'hex-sdf.shader.ts'), 'utf8')
const showCell = readFileSync(join(here, '..', 'tiles', 'show-cell.drone.ts'), 'utf8')

/** The shader's colour macro, the way it is written: `HEX(0x1d, 0x12, 0x04)`. */
const literal = (hex: string): string => {
  const [r, g, b] = hexToRgb(hex).map(c => '0x' + c.toString(16).padStart(2, '0'))
  return `HEX(${r}, ${g}, ${b})`
}

describe('hex shader honey — palette matches quick-menu.honey.ts', () => {
  it('the depth ramps', () => {
    for (const ramp of [BODY_REST, BODY_LIT]) {
      for (const [, colour] of ramp) expect(shader).toContain(literal(colour))
    }
    // the back is two ends of one linear ramp
    for (const ramp of [BODY_BACK, BODY_BACK_LIT]) {
      expect(shader).toContain(literal(ramp[0][1]))
      expect(shader).toContain(literal(ramp[ramp.length - 1][1]))
    }
  })

  it('the ramp stops sit at the same depths', () => {
    // dd stops 0.134 / 0.186 / 0.290 / 0.524 / 0.783 → the divisors the ramp mixes by
    const dd = BODY_REST.map(([d]) => d).filter(d => d > 0.134 && d < 1)
    expect(dd).toEqual([0.186, 0.29, 0.524, 0.783])
    for (const text of ['(dd - 0.134) / 0.052', '(dd - 0.186) / 0.104', '(dd - 0.290) / 0.234', '(dd - 0.524) / 0.259', '(dd - 0.783) / 0.217']) {
      expect(shader).toContain(text)
    }
  })

  it('the lip, the beads, the meniscus, the bloom and the rims', () => {
    for (const stop of HONEY.lip.stops) expect(shader).toContain(literal(stop.color))
    expect(shader).toContain(literal(HONEY.bead.top))
    expect(shader).toContain(literal(HONEY.bead.bottom))
    expect(shader).toContain(literal(HONEY.bead.glint))
    expect(shader).toContain(literal(HONEY.meniscus.color))
    expect(shader).toContain(literal(HONEY.transmitted.color))
    expect(shader).toContain(literal(HONEY.bloom.color))
    expect(shader).toContain(literal(HONEY.sliver.color))
    expect(shader).toContain(literal(HONEY.glint.color))
    expect(shader).toContain(literal(HONEY.lit.rim))
    expect(shader).toContain(literal(HONEY.steel.replace(/^rgba\((\d+),(\d+),(\d+).*$/, (_m, r, g, b) => '#' + [r, g, b].map(c => Number(c).toString(16).padStart(2, '0')).join(''))))
  })

  it('the ink', () => {
    expect(shader).toContain(literal(HONEY.ink.rest))
    expect(shader).toContain(literal(HONEY.ink.lit))
    expect(shader).toContain(literal(HONEY.ink.back))
  })

  it('the light and the drip period', () => {
    expect(HONEY_LIGHT.x).toBe(-0.5)
    expect(HONEY_LIGHT.y).toBeCloseTo(-0.8660254, 7)
    expect(shader).toContain('const vec2 HONEY_LIGHT = vec2(-0.5, -0.8660254);')
    // the drip starts from rest when its tile lights (u_dripAt), on the flower clock
    expect(shader).toContain(`fract((u_time - u_dripAt) / ${DRIP_PERIOD_S}.0)`)
  })
})

describe('hex shader honey — who wears it', () => {
  it('only a cell whose mode is past the shapes does', () => {
    expect(shader).toContain('bool honey = vShapeMode > 2.5;')
    expect(shader).toContain('if (honey) {')
  })

  it('the space invader gate stops at 2, in both stages', () => {
    expect(shader).toContain('if (u_driftAmp > 0.0 && aShapeMode > 1.5 && aShapeMode < 2.5) {')
    expect(shader).toContain('if (vShapeMode > 1.5 && vShapeMode < 2.5) {')
  })

  it('an ordinary tile keeps its bevel, inside the branch honey leaves', () => {
    expect(shader).toMatch(/\} else \{\s*\/\/ bevel highlight[\s\S]*?base\.rgb -= vec3\(1\.0\) \* shadowStrength;\s*\}/)
  })
})

describe('hex shader honey — the lit drip never divides by zero', () => {
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

  /** The widths the timeline hands honeySmin, as the shader writes them (honeyTile). */
  const widths = (u: number) => {
    const fell = u >= 0.58
    const pinch = clamp01((u - 0.52) / 0.06)
    const neckBead = fell ? 0.035 : Math.max(0.035 * (1 - pinch), 0.004)
    const gs = fell ? 0.35 + (1 - 0.35) * (1 - Math.pow(1 - clamp01((u - 0.58) / 0.42), 3)) : 1
    const fillet = (fell ? 0.05 : 0.05 * (1 - pinch)) * gs
    return { neckBead, fillet }
  }

  /** honeySmin as the shader writes it, k floored the way it is. */
  const smin = (a: number, b: number, k: number): number => {
    k = Math.max(k, 1e-4)
    const h = Math.max(k - Math.abs(a - b), 0) / k
    return Math.min(a, b) - h * h * k * 0.25
  }

  it('the shader states the same widths the mirror uses', () => {
    expect(shader).toContain('float neckBead = fell ? 0.035 : max(0.035 * (1.0 - pinch), 0.004);')
    expect(shader).toContain('ws, neckBead, fillet, gs, visB);')
    expect(shader).toContain('k = max(k, 1e-4);')
    // the old spelling went to exactly 0 for the whole fall and regrow
    expect(shader).not.toContain('0.035 * (1.0 - pinch), fillet')
  })

  it('no blend width reaches 0 anywhere on the 11 s loop, and every blend is finite', () => {
    for (let i = 0; i < 1000; i++) {
      const u = i / 1000
      const { neckBead, fillet } = widths(u)
      expect(neckBead).toBeGreaterThan(0)
      // the fillet may sharpen toward the pinch, the helper floors it
      for (const k of [neckBead, fillet]) {
        for (const [a, b] of [[0, 0], [0.01, -0.01], [-0.2, 0.3], [0.5, 0.5]]) {
          expect(Number.isFinite(smin(a, b, k))).toBe(true)
        }
      }
    }
  })

  it('the instants the verifier looked at: 0, the pinch, the fall, the regrow', () => {
    for (const u of [0, 0.52, 0.5799, 0.58, 0.6, 0.7, 0.85, 0.9, 0.95, 0.999]) {
      const { neckBead, fillet } = widths(u)
      expect(neckBead).toBeGreaterThan(0)
      expect(Number.isFinite(smin(0.02, 0.02, neckBead))).toBe(true)
      expect(Number.isFinite(smin(0.02, 0.02, fillet))).toBe(true)
    }
    // once it has fallen the neck is whole again
    expect(widths(0.6).neckBead).toBe(0.035)
    expect(widths(0.95).neckBead).toBe(0.035)
  })
})

describe('hex shader honey — the crafted backgrounds', () => {
  it('binds one atlas and a grid that says how many columns it has (0: none yet)', () => {
    expect(shader).toContain('uniform sampler2D u_honeyArt;')
    expect(shader).toContain('uniform vec2 u_honeyArtGrid;')
    expect(shader).toContain("u_honeyArtGrid: { value: [0, 0], type: 'vec2<f32>' },")
    expect(shader).toContain('u_honeyArt: this.toSource(Texture.WHITE),')
  })

  it('reads the variation only inside the honey branch, from the heat channel', () => {
    const honeyBranch = shader.indexOf('if (honey) {')
    const bevel = shader.indexOf('// bevel highlight (top-left light)')
    const read = shader.indexOf('float honeyArtIndex = floor(vHeat + 0.5) - 1.0;')
    expect(read).toBeGreaterThan(honeyBranch)
    expect(read).toBeLessThan(bevel)
    expect(shader).toContain('honeyTile(local, d, aa, vShapeMode, vBorderColor, honeySeed, honeyArtIndex)')
    // honey never wears the heat ring, which is what frees the channel
    expect(shader).toContain('heatRing * heatAlpha * (honey ? 0.0 : 1.0)')
  })

  it('wears a picture only on a non-back option with a drawn variation', () => {
    expect(shader).toContain('bool crafted = !back && art > -0.5 && art < u_honeyArtGrid.x - 0.5;')
    // the lip, bloom, meniscus and sliver are the procedural tile's alone
    expect(shader).toContain('if (!back && !crafted) {\n        // one small warm bloom')
    expect(shader).toContain('if (!back && !crafted) {\n        // the meniscus')
    // a crafted tile draws a drip only when lit, hung from the wall
    expect(shader).toContain('if (!back && p.y < 0.12 && (!crafted || lit)) {')
    expect(shader).toContain('float yB = crafted ? honeyWall(xB) : honeyLip(xB, seed);')
  })

  it('samples the pre-lit row when lit and turns the picture for a flat-top tile', () => {
    // the camera moves the picture inside the turned frame (hex-sdf.motion.spec)
    expect(shader).toContain('vec2 q = honeyCamera(u_flat > 0.5 ? rot30(p) : p, art);')
    expect(shader).toContain('vec2 at = vec2(art * cell.x, lit ? cell.y : 0.0)')
    expect(shader).toContain('c = honeyArt(p, art, lit);')
  })
})

describe('the flower paints honey only where it was asked', () => {
  it('an ordinary tile\'s heat is written as before; only a honey option carries a picture', () => {
    // The slot plan (single-paint.md, V4) reads a page tile's heat live so a
    // fade step is one dirty label; a foreign cell still carries its own heat.
    expect(showCell).toContain(
      'const h = c.honeyArt !== undefined\n'
      + '      ? c.honeyArt + 1\n'
      + '      : foreign\n'
      + '        ? (c.heat ?? 0)',
    )
    // honeyArt is set in exactly one place: the flower's honey opt-in, never on the subject or the way back
    expect(showCell.match(/honeyArt: f\.art/g)).toHaveLength(1)
    expect(showCell).toContain('...(f.honey && !f.subject && !f.back && this.#honeyArtReady(f.art) ? { honeyArt: f.art } : {}),')
  })

  it('listens on the effect the pictures are announced on', () => {
    expect(showCell).toContain(`const HONEY_ART_EFFECT = '${HONEY_ART_EFFECT}'`)
  })

  it('the variation index survives the heat channel round trip', () => {
    // as written by show-cell (index + 1) and read by the shader (floor(v + 0.5) - 1)
    for (let art = 0; art < 10; art++) expect(Math.floor(art + 1 + 0.5) - 1).toBe(art)
    // a plain honey cell (no picture) reads as -1: the procedural honey
    expect(Math.floor(0 + 0.5) - 1).toBe(-1)
  })

  it('the clock wraps on a whole number of drips', () => {
    expect(showCell).toContain('% FLOWER_CLOCK_PERIOD_S')
    expect(FLOWER_CLOCK_PERIOD_S).toBeGreaterThan(0)
    expect(FLOWER_CLOCK_PERIOD_S % DRIP_PERIOD_S).toBe(0)
  })

  it('a foreign cell never writes the page\'s own shape table', () => {
    expect(showCell).toContain('if (!foreign) this.#shapeModeByLabel.set(c.label, sm)')
  })

  it('honey is an explicit opt-in that never reaches the subject', () => {
    expect(showCell).toContain('...(f.honey && !f.subject ? { honeyMode: honeyModeOf(f, still) } : {})')
  })

  it('reduced motion takes the drip off the lit tile', () => {
    expect(showCell).toContain('f.back ? (f.lit ? 6 : 4) : f.lit ? (still ? 5 : 7) : 3')
    expect(showCell).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
  })
})
