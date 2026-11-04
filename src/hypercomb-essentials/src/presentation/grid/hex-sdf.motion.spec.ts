// The quick menu flower's motion is stated three times: as numbers for the DOM
// ring (quickmenu/quick-menu.honey.ts), as the hive's CPU copy
// (presentation/tiles/flower-motion.ts) and as GLSL in the hex shader. This spec
// pins the GLSL lines, mirrors them on the CPU line for line, and fails the
// moment any of the three disagree. It also proves the promises the motion makes:
// the art never shows its edge, one tile catches the light at a time, the ink
// keeps its contrast, and an ordinary tile never reads any of it.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as ring from '../../quickmenu/quick-menu.honey.js'
import { cellUnit } from '../../quickmenu/quick-menu.tile-menu.js'
import { QUICK_MENU_RING } from '../../quickmenu/quick-menu.types.js'
import {
  BLOOM,
  BLOOM_TOTAL_MS,
  DRIFT,
  FLOWER_CLOCK_PERIOD_S,
  FLOWER_INDEX_BASE,
  SHEEN,
  SHEEN_SLOTS,
  bloomAt,
  bloomDelayMs,
  bloomEase,
  driftPose,
  flowerRingKey,
  flowerSlots,
  motionFor,
  sheenAt,
  sheenDelayS,
  sheenOffset,
  sheenShare,
} from '../tiles/flower-motion.js'

const here = dirname(fileURLToPath(import.meta.url))
const shader = readFileSync(join(here, 'hex-sdf.shader.ts'), 'utf8')
const showCell = readFileSync(join(here, '..', 'tiles', 'show-cell.drone.ts'), 'utf8')
const tileName = readFileSync(join(here, '..', 'tiles', 'tile-name.drone.ts'), 'utf8')

// GLSL's own builtins, as the GPU computes them
const fract = (x: number): number => x - Math.floor(x)
const mod = (x: number, y: number): number => x - y * Math.floor(x / y)
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t
const glslR3 = (v: number): number => Math.floor(v * 1000 + 0.5) / 1000

const ARTS = Array.from({ length: 10 }, (_, i) => i)
const SLOTS = Array.from({ length: 7 }, (_, i) => i)
const TIMES = Array.from({ length: 400 }, (_, i) => i * 0.0731)

// ── the GLSL, line for line (each body is pinned in the source below) ──────

/** honeyCamera(q, art): the sample point for the tile point q (in R). */
function glslCamera(qx: number, qy: number, art: number, slot: number, time: number): { x: number; y: number } {
  const v = Math.max(Math.floor(art + 0.5), 0)
  const period = glslR3(9.0 + 4.0 * fract((v + 1.0) * 0.7548777 + slot * 0.5698403))
  const share = slot < 0.5 ? 0.5 : fract((slot - 1.0) / 3.0)
  const phase = glslR3(period * share)
  const angle = 6.2831853 * fract(v * 0.381966 + slot * 0.2763932)
  const tx = glslR3(1.2 * Math.cos(angle)) / 46.0
  const ty = glslR3(1.2 * Math.sin(angle)) / 46.0
  const e = 0.5 - 0.5 * Math.cos(6.2831853 * fract((time + phase) / period))
  return { x: (qx - tx * e) / (1.0 + 0.035 * e), y: (qy - ty * e) / (1.0 + 0.035 * e) }
}

/** honeySheen(p, lit): the light's alpha at the tile point p (in R). */
function glslSheen(px: number, py: number, lit: boolean, slot: number, time: number): number {
  const k = mod(slot - 1.0, 7.0)
  const local = time - glslR3(0.6 + 8.0 * k / 7.0)
  if (local < 0.0) return 0.0
  const x = mod(local, 8.0)
  if (x >= 1.0) return 0.0
  const at = -58.0 + 116.0 * (0.5 - 0.5 * Math.cos(3.14159265 * x))
  const ux = px * 46.0, uy = py * 46.0
  const profile = clamp((12.0 - Math.abs((ux + uy) * 0.7071068 - at)) / 6.0, 0.0, 1.0)
  const outside = Math.max(Math.abs(ux) - 32.0, Math.max(-24.0 - uy, uy - 27.0))
  const share = clamp(outside / 12.0, 0.0, 1.0)
  return profile * mix(lit ? 0.10 : 0.06, lit ? 0.22 : 0.16, share)
}

/** bloomEase(k) in the vertex stage. */
function glslBloomEase(k: number): number {
  k = clamp(k, 0.0, 1.0)
  let t = k
  for (let i = 0; i < 6; i++) {
    const u = 1.0 - t
    const x = 0.6 * u * u * t + 0.6 * u * t * t + t * t * t
    const dx = 0.6 * u * u + 2.4 * t * t
    t = clamp(t - (x - k) / dx, 0.0, 1.0)
  }
  const u = 1.0 - t
  return 2.4 * u * u * t + 3.0 * u * t * t + t * t * t
}

/** The vertex stage's bloom for a flower cell (k: scale is mix(0.92, 1, k), opacity k). */
function glslBloom(since: number, slot: number): number {
  return since < 0.0 || slot < 0.5 ? 1.0 : glslBloomEase((since * 1000.0 - slot * 5.0) / 140.0)
}

describe('the GLSL the mirror transcribes is the GLSL in the shader', () => {
  it('the camera', () => {
    for (const line of [
      'float v = max(floor(art + 0.5), 0.0);',
      'float period = honeyR3(9.0 + 4.0 * fract((v + 1.0) * 0.7548777 + slot * 0.5698403));',
      'float share = slot < 0.5 ? 0.5 : fract((slot - 1.0) / 3.0);',
      'float phase = honeyR3(period * share);',
      'float angle = 6.2831853 * fract(v * 0.381966 + slot * 0.2763932);',
      'vec2 travel = vec2(honeyR3(1.2 * cos(angle)), honeyR3(1.2 * sin(angle))) / 46.0;',
      'float e = 0.5 - 0.5 * cos(6.2831853 * fract((u_time + phase) / period));',
      'return (q - travel * e) / (1.0 + 0.035 * e);',
      'return floor(v * 1000.0 + 0.5) / 1000.0;',
    ]) expect(shader).toContain(line)
  })

  it('the sheen', () => {
    for (const line of [
      'float k = mod(flowerSlot() - 1.0, 7.0);',
      'float local = u_time - honeyR3(0.6 + 8.0 * k / 7.0);',
      'if (local < 0.0) return 0.0;',
      'float x = mod(local, 8.0);',
      'if (x >= 1.0) return 0.0;',
      'float at = -58.0 + 116.0 * (0.5 - 0.5 * cos(3.14159265 * x));',
      'float profile = clamp((12.0 - abs((u.x + u.y) * 0.7071068 - at)) / 6.0, 0.0, 1.0);',
      'float outside = max(abs(u.x) - 32.0, max(-24.0 - u.y, u.y - 27.0));',
      'float share = clamp(outside / 12.0, 0.0, 1.0);',
      'return profile * mix(lit ? 0.10 : 0.06, lit ? 0.22 : 0.16, share);',
      'c = mix(c, HEX(0xff, 0xf4, 0xd6), honeySheen(p, lit));',
    ]) expect(shader).toContain(line)
  })

  it('the bloom', () => {
    for (const line of [
      'float x = 0.6 * u * u * t + 0.6 * u * t * t + t * t * t;',
      'float dx = 0.6 * u * u + 2.4 * t * t;',
      'return 2.4 * u * u * t + 3.0 * u * t * t + t * t * t;',
      'float since = u_time - u_flowerBloomAt;',
      'float slot = floor(aCellIndex - 1000000.0 + 0.5);',
      'float k = since < 0.0 || slot < 0.5 ? 1.0 : bloomEase((since * 1000.0 - slot * 5.0) / 140.0);',
      'p = centre + (p - centre) * mix(0.92, 1.0, k);',
    ]) expect(shader).toContain(line)
  })
})

describe('the three statements agree', () => {
  it('the hive copy carries the ring\'s numbers', () => {
    expect(DRIFT).toEqual(ring.DRIFT)
    expect(BLOOM).toEqual(ring.BLOOM)
    expect(SHEEN_SLOTS).toBe(ring.SHEEN_SLOTS)
    for (const key of Object.keys(SHEEN) as (keyof typeof SHEEN)[]) {
      expect((ring.SHEEN as Record<string, unknown>)[key]).toEqual(SHEEN[key])
    }
  })

  it('the camera: every picture in every slot, the same period, phase and travel', () => {
    for (const art of ARTS) for (const slot of SLOTS) {
      expect(motionFor(art, slot)).toEqual(ring.motionFor(art, slot))
      for (const t of TIMES) expect(driftPose(t, motionFor(art, slot))).toEqual(ring.driftPose(t, ring.motionFor(art, slot)))
    }
  })

  it('the camera in the shader samples where the ring draws', () => {
    for (const art of ARTS) for (const slot of SLOTS) {
      const m = ring.motionFor(art, slot)
      for (const t of TIMES) {
        const pose = ring.driftPose(t, m)
        // the ring draws picture point q at q * scale + travel (px at R = 46)
        for (const [qx, qy] of [[0, 0], [0.5, -0.3], [-0.8, 0.9]]) {
          const drawnAt = { x: qx * pose.scale + pose.dx / 46, y: qy * pose.scale + pose.dy / 46 }
          const read = glslCamera(drawnAt.x, drawnAt.y, art, slot, t)
          expect(read.x).toBeCloseTo(qx, 4)
          expect(read.y).toBeCloseTo(qy, 4)
        }
      }
    }
  })

  it('the sheen: the same delays, the same band, the same strengths', () => {
    for (const slot of SLOTS) {
      expect(sheenDelayS(slot)).toBe(ring.sheenDelayS(slot))
      for (const t of TIMES) expect(sheenOffset(t, slot)).toBe(ring.sheenOffset(t, slot))
    }
    for (const lit of [false, true]) {
      expect(ring.sheenAlpha(0, lit)).toBe(lit ? SHEEN.inkLit : SHEEN.inkRest)
      expect(ring.sheenAlpha(1, lit)).toBe(lit ? SHEEN.peakLit : SHEEN.peakRest)
    }
  })

  it('the sheen in the shader is the hive copy\'s', () => {
    for (const slot of SLOTS) for (const t of TIMES) for (const lit of [false, true]) {
      for (const [x, y] of [[0, 0], [-20, -20], [10, 30], [36, 0], [-40, -10], [20, 40], [0, -44]]) {
        expect(glslSheen(x / 46, y / 46, lit, slot, t)).toBeCloseTo(sheenAt(t, slot, x, y, lit), 4)
      }
    }
  })

  it('the bloom: the same delays, and the shader\'s Newton is the ring\'s curve', () => {
    for (const slot of SLOTS) expect(bloomDelayMs(slot)).toBe(ring.bloomDelayMs(slot))
    for (let ms = -40; ms <= 520; ms += 3) for (const slot of SLOTS) {
      const pose = ring.bloomPose(ms, slot)
      const k = glslBloom(ms / 1000, slot)
      expect(k).toBeCloseTo(bloomAt(ms / 1000, slot), 6)
      // the hive's centre is the tile already showing; the ring's is a new one
      if (ms < 0 || slot === 0) continue
      expect(k).toBeCloseTo(pose.opacity, 4)
      expect(mix(0.92, 1, k)).toBeCloseTo(pose.scale, 4)
    }
  })
})

describe('the camera never shows the picture\'s edge', () => {
  // the picture's own box, in R: -40 -46 80 92 at R = 46
  const inBox = (q: { x: number; y: number }): boolean => Math.abs(q.x) <= 40 / 46 + 1e-9 && Math.abs(q.y) <= 1 + 1e-9

  it('every point of the hexagon reads inside the picture, at every frame', () => {
    const corners = Array.from({ length: 6 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3
      return { x: Math.cos(a), y: Math.sin(a) }
    })
    for (const art of ARTS) for (const slot of SLOTS) for (let t = 0; t < 26; t += 0.25) {
      for (let i = 0; i < 6; i++) {
        const a = corners[i], b = corners[(i + 1) % 6]
        for (let s = 0; s <= 4; s++) {
          const qx = a.x + (b.x - a.x) * (s / 4), qy = a.y + (b.y - a.y) * (s / 4)
          if (!inBox(glslCamera(qx, qy, art, slot, t))) expect.fail(`edge shows: art ${art} slot ${slot} t ${t}`)
        }
      }
    }
  })

  it('the push is 1.000 to 1.035 and the travel never more than 1.2 px', () => {
    for (const art of ARTS) for (const slot of SLOTS) {
      const m = motionFor(art, slot)
      expect(m.periodS).toBeGreaterThanOrEqual(9)
      expect(m.periodS).toBeLessThanOrEqual(13)
      expect(Math.hypot(m.dx, m.dy)).toBeLessThanOrEqual(1.2 + 0.002)
      for (const t of TIMES) {
        const pose = driftPose(t, m)
        expect(pose.scale).toBeGreaterThanOrEqual(1)
        expect(pose.scale).toBeLessThanOrEqual(1.035 + 1e-12)
      }
    }
  })

  it('neighbours round the ring never move in unison', () => {
    for (const art of ARTS) for (let slot = 1; slot <= 6; slot++) {
      const next = slot === 6 ? 1 : slot + 1
      const a = motionFor(art, slot), b = motionFor(art, next)
      expect(a.phaseS / a.periodS).not.toBeCloseTo(b.phaseS / b.periodS, 2)
    }
  })

  it('a stopped camera is the picture as drawn', () => {
    // reduced motion: u_flowerMotion 0 returns q untouched
    expect(shader).toContain('if (u_flowerMotion < 0.5) return q;')
    expect(shader).toContain('vec2 q = honeyCamera(u_flat > 0.5 ? rot30(p) : p, art);')
  })
})

describe('the light visits one tile at a time and spares the ink', () => {
  it('only one slot of seven is ever in its pass', () => {
    for (let t = 0; t < 40; t += 0.01) {
      const lit = SLOTS.filter(slot => sheenOffset(t, slot) !== null)
      expect(lit.length).toBeLessThanOrEqual(1)
    }
  })

  it('east first, clockwise, the middle last, after the lead', () => {
    const order = [1, 2, 3, 4, 5, 6, 0].map(slot => sheenDelayS(slot))
    expect(order[0]).toBe(SHEEN.leadS)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
    expect(order[6] + SHEEN.passS).toBeLessThanOrEqual(SHEEN.leadS + SHEEN.cycleS)
  })

  it('the band starts and ends off the tile, so it glides in rather than appearing', () => {
    // a point-top hex at R = 46 reaches 44.5 along the diagonal; the band is 12 + 2 x 6 wide
    expect(SHEEN.reach - (SHEEN.width / 2 + SHEEN.soft)).toBeGreaterThanOrEqual(44.5 - 1)
    for (const slot of SLOTS) {
      const start = sheenDelayS(slot)
      for (const [x, y] of [[40, 23], [-40, -23], [0, 46], [0, -46], [0, 0]]) {
        expect(sheenAt(start, slot, x, y, true)).toBeLessThan(0.02)
      }
    }
  })

  it('never above the cap over the glyph and the word, never above the peak elsewhere', () => {
    for (const slot of SLOTS) for (let t = sheenDelayS(slot); t < sheenDelayS(slot) + 1; t += 0.02) for (const lit of [false, true]) {
      for (let x = -46; x <= 46; x += 4) for (let y = -46; y <= 46; y += 4) {
        const a = glslSheen(x / 46, y / 46, lit, slot, t)
        const inInk = x >= -32 && x <= 32 && y >= -24 && y <= 27
        if (a > (inInk ? (lit ? 0.10 : 0.06) : (lit ? 0.22 : 0.16)) + 1e-9) expect.fail(`too bright at ${x},${y} slot ${slot} t ${t}`)
      }
    }
  })

  it('the cap eases out to the peak no brighter than the ring\'s feather rings', () => {
    const zones = ring.sheenZones()
    const contains = (r: { x0: number; x1: number; y0: number; y1: number } | null, x: number, y: number): boolean =>
      r === null || (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
    for (let x = -46; x <= 46; x += 0.5) for (let y = -46; y <= 46; y += 0.5) {
      const zone = zones.find(z => contains(z.outer, x, y) && !(z.inner && contains(z.inner, x, y)))!
      expect(sheenShare(x, y)).toBeLessThanOrEqual(zone.share + 1e-9)
      if (zone.share === 0) expect(sheenShare(x, y)).toBe(0)
    }
    // and reaches the peak where the rings do, 12 px out
    expect(sheenShare(32 + 12, 0)).toBe(1)
  })

  it('the capped light costs the cream ink little, and the lit ink nothing', () => {
    // On the brightest the procedural honey lets sit under the glyphs (#8f5c12,
    // where the cream reads 5:1) the cap at rest takes under 15% of the contrast,
    // and only for the moment the band crosses. Whether the cream holds 4.5:1 on a
    // crafted picture is the picture's own business, motion or not.
    const floor = '#8f5c12'
    const before = ring.contrastRatio(ring.HONEY.ink.rest, floor)
    const after = ring.contrastRatio(ring.HONEY.ink.rest, ring.mixHex(floor, SHEEN.color, SHEEN.inkRest))
    expect(before).toBeGreaterThanOrEqual(5)
    expect(after / before).toBeGreaterThan(0.85)
    // the lit ink is near black: light under it only adds contrast
    const lit = '#c2841a'
    expect(ring.contrastRatio(ring.HONEY.ink.lit, ring.mixHex(lit, SHEEN.color, SHEEN.inkLit)))
      .toBeGreaterThan(ring.contrastRatio(ring.HONEY.ink.lit, lit))
  })

  it('only a crafted background catches it, never the way back', () => {
    expect(shader.match(/honeySheen\(/g)).toHaveLength(2)   // the definition and the one use
    expect(shader).toContain('if (crafted) c = mix(c, HEX(0xff, 0xf4, 0xd6), honeySheen(p, lit));')
    expect(shader).toContain('bool crafted = !back && art > -0.5')
  })
})

describe('the bloom', () => {
  it('eases from 0.92 and nothing to whole in 140 ms, 5 ms a slot from east', () => {
    expect(glslBloom(0, 1)).toBe(0)
    expect(glslBloom(0.004, 1)).toBe(0)
    expect(glslBloom(0.005 + 0.14, 1)).toBeCloseTo(1, 6)
    expect(BLOOM_TOTAL_MS).toBe(140 + 6 * 5)
    for (const slot of SLOTS) expect(glslBloom(BLOOM_TOTAL_MS / 1000, slot)).toBeCloseTo(1, 6)
  })

  it('never blinks the centre: the tile the menu opened on is already showing', () => {
    for (const since of [0, 0.01, 0.1, 0.26]) expect(glslBloom(since, 0)).toBe(1)
    expect(bloomAt(0, 0)).toBe(1)
    expect(tileName).toContain('if (slots && !cell.subject) this.#bloomSpans(')
  })

  it('is monotone, and Newton lands on the curve', () => {
    let last = -1
    for (let k = 0; k <= 1.0001; k += 0.002) {
      const y = glslBloomEase(k)
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
      expect(y).toBeCloseTo(ring.cubicBezier(0.2, 0.8, 0.2, 1)(Math.min(k, 1)), 4)
      expect(y).toBeCloseTo(bloomEase(k), 9)
    }
  })

  it('a clock that went back under the opening reads as bloomed, never as invisible', () => {
    expect(glslBloom(-0.001, 3)).toBe(1)
    expect(glslBloom(-1e6, 0)).toBe(1)
    // and no bloom is a time so far back every tile reads as done
    expect(shader).toContain('export const FLOWER_BLOOM_DONE = -1e6')
    expect(glslBloom(0 - -1e6, 6)).toBeCloseTo(1, 9)
  })
})

describe('an ordinary tile never reads any of it', () => {
  it('the bloom is gated on the flower\'s cell index in both stages', () => {
    expect(FLOWER_INDEX_BASE).toBe(1000000)
    expect(shader).toContain('if (aCellIndex > 999999.5) {')
    expect(shader).toContain('if (vCellIndex > 999999.5) color.a *= vBloom;')
    // the quad is only moved while a bloom is under way
    expect(shader).toContain('if (k < 1.0) {')
    expect(shader.match(/vBloom/g)).toHaveLength(5)   // out, = 1.0, = k, in, the one read
  })

  it('the camera and the light live inside the honey alone', () => {
    const honeyStart = shader.indexOf('// ── HONEY: the quick menu\'s option tiles')
    const mainStart = shader.indexOf('void main() {\n      vec2 local')
    for (const name of ['honeyCamera(', 'honeySheen(', 'flowerSlot(', 'u_flowerMotion <']) {
      let at = shader.indexOf(name, shader.indexOf('fragmentSource'))
      while (at >= 0) {
        expect(at).toBeGreaterThan(honeyStart)
        expect(at).toBeLessThan(mainStart)
        at = shader.indexOf(name, at + 1)
      }
    }
  })

  it('the uniforms default to still and bloomed', () => {
    expect(shader).toContain("u_flowerMotion: { value: 0, type: 'f32' },")
    expect(shader).toContain("u_flowerBloomAt: { value: FLOWER_BLOOM_DONE, type: 'f32' },")
    expect(shader).toContain("u_dripAt: { value: 0, type: 'f32' },")
  })

  it('the flower counts a moving ring\'s tiles by slot; anything else by order, as before', () => {
    expect(showCell).toContain('const ix = (foreign?.slots?.[ci] ?? ci) + (foreign?.indexBase ?? 0)')
    expect(showCell).toContain('{ reveal: null, indexBase: FLOWER_INDEX_BASE, ...(slots ? { slots } : {}) },')
    // the dive and the page pass no slots
    expect(showCell.match(/slots \? \{ slots \}/g)).toHaveLength(1)
  })
})

describe('the hive flower drives it', () => {
  it('moves only a honey flower, and never under reduced motion', () => {
    expect(showCell).toContain('const moving = !still && cells.some(c => c.honeyMode !== undefined)')
    expect(showCell).toContain("this.#syncFlowerClock(moving ? flowerRingKey(input) : '', cells.find(c => c.honeyMode === 7) ?? null)")
    expect(showCell).toContain('shader?.setFlowerMotion(false)')
    expect(showCell).toContain('shader?.setFlowerBloomAt(FLOWER_BLOOM_DONE)')
  })

  it('blooms a ring it has not seen, from a clock rebased to 0; a highlight blooms nothing', () => {
    expect(showCell).toContain('const fresh = ring !== this.#flowerRingKey')
    expect(showCell).toContain('const t = fresh && !this.#driftActive ? 0 : this.#flowerNow()')
    expect(showCell).toContain('this.#flowerBloomAt = document.hidden ? FLOWER_BLOOM_DONE : t')
    // the bloom starts at exactly the u_time written with it, never a moment
    // ahead (that reads as bloomed, so a tile showed whole for a frame first)
    expect(showCell).toContain('shader?.setTime(t)')
    // and is pushed every paint, so a rebuilt shader never draws the open as done
    expect(showCell).toContain('shader?.setFlowerBloomAt(this.#flowerBloomUntil ? this.#flowerBloomAt : FLOWER_BLOOM_DONE)')
    const a = [{ q: 0, r: 0, label: 'sun', subject: true }, { q: 1, r: 0, label: 'tags', honey: true }]
    const lit = [a[0], { ...a[1], lit: true }]
    expect(flowerRingKey(lit)).toBe(flowerRingKey(a))
    expect(flowerRingKey([a[0], { ...a[1], label: 'history' }])).not.toBe(flowerRingKey(a))
  })

  it('a drip starts from rest when its tile lights, without moving the clock', () => {
    expect(showCell).toContain('if (dripStarts) this.#flowerDripAt = t')
    expect(shader).toContain('fract((u_time - u_dripAt) / 11.0)')
  })

  it('the clock wraps on whole drips and whole sheen cycles', () => {
    expect(FLOWER_CLOCK_PERIOD_S % ring.DRIP_PERIOD_S).toBe(0)
    expect(FLOWER_CLOCK_PERIOD_S % SHEEN.cycleS).toBe(0)
    expect(showCell).toContain('return this.#driftActive ? t : t % FLOWER_CLOCK_PERIOD_S')
  })

  it('stops with the flower and holds while the tab is hidden', () => {
    expect(showCell).toContain('if (this.#flowerClockRaf || document.hidden || this.#driftActive) return')
    expect(showCell).toContain("document.addEventListener('visibilitychange', this.#onFlowerVisibility)")
  })

  it('the names bloom with their tiles', () => {
    expect(tileName).toContain('@keyframes hc-flower-bloom{from{opacity:0;scale:${BLOOM.fromScale};')
    expect(tileName).toContain('@media (prefers-reduced-motion:reduce){.hc-tile-names-world>span.hc-flower-name.hc-bloom{animation:none}}')
  })
})

describe('slots', () => {
  for (const flat of [false, true]) {
    it(`the ring's directions are slots 1..6 in its own order, centre 0 (${flat ? 'flat' : 'point'}-top)`, () => {
      const reach = 70
      const cells = [
        { x: 10, y: 20, subject: true },
        ...QUICK_MENU_RING.map(d => { const u = cellUnit(d, flat); return { x: 10 + u.x * reach, y: 20 + u.y * reach } }),
      ]
      expect(flowerSlots(cells, flat)).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(QUICK_MENU_RING.map(d => ring.slotIndexOf(d))).toEqual([1, 2, 3, 4, 5, 6])
      // a ring with gaps keeps each tile's own slot
      const gappy = [cells[0], cells[2], cells[5]]
      expect(flowerSlots(gappy, flat)).toEqual([0, 2, 5])
    })
  }

  it('a ring with no subject finds its middle', () => {
    const cells = QUICK_MENU_RING.slice(0, 5).map(d => { const u = cellUnit(d, false); return { x: u.x * 70, y: u.y * 70 } })
    expect(flowerSlots(cells, false)).toEqual([1, 2, 3, 4, 5])
  })
})
