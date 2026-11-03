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
    expect(shader).toContain(`u_time / ${DRIP_PERIOD_S}.0`)
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

describe('the flower paints honey only where it was asked', () => {
  it('the clock wraps on a whole number of drips', () => {
    const period = Number(/const FLOWER_CLOCK_PERIOD_S = (\d+)/.exec(showCell)?.[1])
    expect(period).toBeGreaterThan(0)
    expect(period % DRIP_PERIOD_S).toBe(0)
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
