// quick-menu.motion.spec.ts — the ring's ambient motion as numbers.
//
//   · DRIFT: every picture has its own stable period (9..13 s), phase and
//     direction; neighbours never breathe together; and the picture covers its
//     hexagon at every instant of every drift
//   · SHEEN: one pass per tile per 8 s cycle, east first and clockwise, the
//     middle last, never two tiles lit at once; capped over the ink so the
//     label keeps 4.5:1, feathered so the cap has no edge
//   · BLOOM: the middle first, then 5 ms a tile clockwise, 0.92 → 1 and
//     nothing → whole on the stated bezier
//   · the stylesheet runs all three only while the ring says it may move, and
//     never under reduced motion

import { describe, expect, it } from 'vitest'
import { HONEY_ART_BOX } from './quick-menu.honey-art.js'
import {
  BLOOM,
  BODY_LIT,
  BODY_REST,
  DRIFT,
  HONEY,
  HONEY_BACKGROUND_COUNT,
  SHEEN,
  SHEEN_SLOTS,
  bloomDelayMs,
  bloomPose,
  contrastRatio,
  cubicBezier,
  driftPose,
  honeyStyleSheet,
  mixHex,
  motionFor,
  sampleRamp,
  sheenAlpha,
  sheenDelayS,
  sheenOffset,
  sheenZones,
  slotIndexOf,
} from './quick-menu.honey.js'
import { HEX_RADIUS, QUICK_MENU_RING } from './quick-menu.types.js'

const SLOTS = [0, 1, 2, 3, 4, 5, 6] as const
const VARIATIONS = Array.from({ length: HONEY_BACKGROUND_COUNT }, (_, v) => v)

/** The point-top hexagon's corners at R = 46. */
const CORNERS: readonly [number, number][] = [0, 1, 2, 3, 4, 5].map(i => {
  const a = -Math.PI / 2 + (Math.PI / 3) * i
  return [Math.cos(a) * HEX_RADIUS, Math.sin(a) * HEX_RADIUS]
})

/** Circular distance between two shares of a period. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1
  return Math.min(d, 1 - d)
}

describe('the drift', () => {
  it('is a pure function of picture and slot', () => {
    for (const v of VARIATIONS) for (const i of SLOTS) expect(motionFor(v, i)).toEqual(motionFor(v, i))
  })

  it('gives every tile a period of 9 to 13 s and travels exactly the stated distance', () => {
    const periods = new Set<number>()
    for (const v of VARIATIONS) {
      for (const i of SLOTS) {
        const m = motionFor(v, i)
        expect(m.periodS).toBeGreaterThanOrEqual(DRIFT.periodMin)
        expect(m.periodS).toBeLessThanOrEqual(DRIFT.periodMax)
        expect(m.phaseS).toBeGreaterThanOrEqual(0)
        expect(m.phaseS).toBeLessThan(m.periodS)
        expect(Math.hypot(m.dx, m.dy)).toBeCloseTo(DRIFT.travel, 2)
        periods.add(m.periodS)
      }
    }
    // not one period shared round: tiles drift apart over time
    expect(periods.size).toBeGreaterThan(30)
  })

  it('never lets two neighbours round the ring start together', () => {
    for (const v of VARIATIONS) {
      for (let k = 0; k < QUICK_MENU_RING.length; k++) {
        const here = slotIndexOf(QUICK_MENU_RING[k])
        const next = slotIndexOf(QUICK_MENU_RING[(k + 1) % QUICK_MENU_RING.length])
        const a = motionFor(v, here), b = motionFor(v, next)
        expect(apart(a.phaseS / a.periodS, b.phaseS / b.periodS)).toBeGreaterThanOrEqual(1 / 3 - 1e-3)
      }
    }
  })

  it('pushes in from 1 to 1.035 and back, once per period', () => {
    const m = motionFor(3, 2)
    const start = -m.phaseS
    expect(driftPose(start, m).scale).toBeCloseTo(1, 9)
    expect(driftPose(start + m.periodS / 2, m).scale).toBeCloseTo(DRIFT.scale, 9)
    expect(driftPose(start + m.periodS / 2, m).dx).toBeCloseTo(m.dx, 9)
    expect(driftPose(start + m.periodS, m).scale).toBeCloseTo(1, 9)
  })

  it('moves slowly: never more than 1.5 px a second at the tile edge', () => {
    for (const v of VARIATIONS) {
      for (const i of SLOTS) {
        const m = motionFor(v, i)
        for (let t = 0; t < m.periodS; t += 0.05) {
          const a = driftPose(t, m), b = driftPose(t + 0.05, m)
          // a corner moves by the push-in at the corner plus the travel
          const move = Math.abs(b.scale - a.scale) * HEX_RADIUS + Math.hypot(b.dx - a.dx, b.dy - a.dy)
          expect(move / 0.05).toBeLessThan(1.5)
        }
      }
    }
  })

  it('keeps the picture over every corner of its hexagon at every instant', () => {
    const halfW = HONEY_ART_BOX.width / 2, halfH = HONEY_ART_BOX.height / 2
    for (const v of VARIATIONS) {
      for (const i of SLOTS) {
        const m = motionFor(v, i)
        for (let t = 0; t <= m.periodS; t += m.periodS / 200) {
          const pose = driftPose(t, m)
          expect(pose.scale).toBeGreaterThanOrEqual(1)
          for (const [x, y] of CORNERS) {
            expect(halfW * pose.scale - Math.abs(x - pose.dx)).toBeGreaterThanOrEqual(-1e-9)
            expect(halfH * pose.scale - Math.abs(y - pose.dy)).toBeGreaterThanOrEqual(-1e-9)
          }
        }
      }
    }
  })
})

describe('the light', () => {
  it('reaches east first after the lead, then clockwise, the middle last, evenly', () => {
    const order = [...QUICK_MENU_RING.map(slotIndexOf), 0]
    const step = SHEEN.cycleS / SHEEN_SLOTS
    order.forEach((slot, k) => expect(sheenDelayS(slot)).toBeCloseTo(SHEEN.leadS + k * step, 3))
    expect(sheenDelayS(slotIndexOf('east'))).toBe(SHEEN.leadS)
  })

  it('lights one tile at a time, and each tile once a cycle', () => {
    const passes = new Map<number, number>()
    for (let t = 0; t < 3 * SHEEN.cycleS + SHEEN.leadS; t += 0.01) {
      const lit = SLOTS.filter(i => sheenOffset(t, i) !== null)
      expect(lit.length).toBeLessThanOrEqual(1)
      for (const i of lit) if (sheenOffset(t - 0.01, i) === null) passes.set(i, (passes.get(i) ?? 0) + 1)
    }
    for (const i of SLOTS) expect(passes.get(i)).toBe(3)
  })

  it('is nowhere before its first pass, and enters and leaves clear of the tile', () => {
    for (const i of SLOTS) expect(sheenOffset(sheenDelayS(i) - 0.01, i)).toBeNull()
    // the farthest a corner reaches along the band's direction, plus the band's half width
    const along = Math.max(...CORNERS.map(([x, y]) => Math.abs(x + y) / Math.SQRT2))
    const half = SHEEN.width / 2 + SHEEN.soft
    const first = sheenOffset(sheenDelayS(1), 1)!
    const last = sheenOffset(sheenDelayS(1) + SHEEN.passS - 1e-6, 1)!
    expect(first).toBeLessThanOrEqual(-(along + half))
    expect(last).toBeGreaterThanOrEqual(along + half - 0.01)
  })

  it('caps itself over the icon and label so the ink keeps 4.5:1, and is a touch stronger lit', () => {
    const [cap, ...rest] = sheenZones()
    expect(cap.outer).toEqual(SHEEN.inkBand)
    expect(cap.share).toBe(0)
    expect(rest.at(-1)!.share).toBe(1)
    expect(sheenAlpha(0, false)).toBe(SHEEN.inkRest)
    expect(sheenAlpha(1, false)).toBe(SHEEN.peakRest)
    expect(sheenAlpha(0, true)).toBe(SHEEN.inkLit)
    expect(sheenAlpha(1, true)).toBe(SHEEN.peakLit)
    expect(SHEEN.peakLit).toBeGreaterThan(SHEEN.peakRest)
    // cream ink over the rest body's heart with the capped light on it
    const restUnder = mixHex(sampleRamp(BODY_REST, 1), SHEEN.color, SHEEN.inkRest)
    expect(contrastRatio(HONEY.ink.rest, restUnder)).toBeGreaterThanOrEqual(4.5)
    // dark ink on the lit body: light only adds to the contrast
    const litUnder = mixHex(sampleRamp(BODY_LIT, 0.524), SHEEN.color, SHEEN.inkLit)
    expect(contrastRatio(HONEY.ink.lit, litUnder)).toBeGreaterThan(contrastRatio(HONEY.ink.lit, sampleRamp(BODY_LIT, 0.524)))
  })

  it('feathers the cap out in even steps, so no edge is a jump', () => {
    const shares = sheenZones().map(z => z.share)
    for (let k = 1; k < shares.length; k++) {
      expect(shares[k]).toBeGreaterThan(shares[k - 1])
      expect(sheenAlpha(shares[k], false) - sheenAlpha(shares[k - 1], false)).toBeLessThanOrEqual(0.04)
    }
  })
})

describe('the bloom', () => {
  it('starts with the middle, then 5 ms a tile clockwise from east', () => {
    expect(bloomDelayMs(0)).toBe(0)
    expect(QUICK_MENU_RING.map(d => bloomDelayMs(slotIndexOf(d)))).toEqual([5, 10, 15, 20, 25, 30])
  })

  it('eases from 0.92 and nothing to whole over 140 ms, and only gets fuller', () => {
    expect(bloomPose(0, 0)).toEqual({ scale: BLOOM.fromScale, opacity: 0 })
        expect(bloomPose(BLOOM.durationMs, 0)).toEqual({ scale: 1, opacity: 1 })
    let before = bloomPose(0, 3)
    for (let ms = 0; ms <= 600; ms += 5) {
      const pose = bloomPose(ms, 3)
      expect(pose.opacity).toBeGreaterThanOrEqual(before.opacity)
      expect(pose.scale).toBeGreaterThanOrEqual(before.scale)
      before = pose
    }
    expect(before).toEqual({ scale: 1, opacity: 1 })
  })

  it('follows cubic-bezier(0.2, 0.8, 0.2, 1): quick out of the gate, soft to land', () => {
    const ease = cubicBezier(...BLOOM.bezier)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.25)).toBeGreaterThan(0.6)
    expect(ease(0.5)).toBeGreaterThan(0.85)
    // the linear bezier is the identity
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75)
    for (const t of [0.1, 0.3, 0.7]) expect(linear(t)).toBeCloseTo(t, 4)
  })
})

describe('the motion in the stylesheet', () => {
  const css = honeyStyleSheet()

  it('runs the bloom, the drift and the light only where the ring says it may move', () => {
    for (const cls of ['hc-qm-slot', 'hc-qm-drift', 'hc-qm-sheen-band']) {
      expect(css).toMatch(new RegExp(`svg\\[data-motion="live"\\] \\.${cls}\\{animation:`))
    }
    expect(css).toContain(`svg:not([data-motion="live"]) .hc-qm-sheen{display:none}`)
    expect(css).toContain(`hc-qm-sheen ${SHEEN.cycleS}s linear`)
    expect(css).toContain(`scale(${DRIFT.scale})`)
    expect(css).toContain(`${BLOOM.durationMs}ms cubic-bezier(${BLOOM.bezier.join(',')})`)
  })

  it('stops all of it under reduced motion and hides the light', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\{[^@]*/)?.[0] ?? ''
    for (const cls of ['hc-qm-slot', 'hc-qm-drift', 'hc-qm-sheen-band']) expect(reduced).toContain(`.${cls}`)
    expect(reduced).toMatch(/\.hc-qm-sheen\{display:none !important\}/)
  })

  it('takes the light away under forced colours', () => {
    const forced = css.match(/@media \(forced-colors: active\)\{[^@]*/)?.[0] ?? ''
    expect(forced).toMatch(/\.hc-qm-sheen\{display:none !important\}/)
  })
})
