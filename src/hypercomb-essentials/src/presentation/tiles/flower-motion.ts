// presentation/tiles/flower-motion.ts
//
// The quick menu flower's motion, as the hive draws it. The numbers are the DOM
// ring's (quickmenu/quick-menu.honey.ts: DRIFT, SHEEN, BLOOM, motionFor,
// sheenDelayS, bloomDelayMs) restated here so the hive's flower never loads the
// ring's module (the same rule as HONEY_ART_EFFECT in show-cell); the hex shader
// (grid/hex-sdf.shader.ts) states them once more as GLSL, and
// grid/hex-sdf.motion.spec.ts fails the moment any of the three disagree.
// Pure: no DOM, no clock.
//
// Three motions, all subtle, none under reduced motion:
//   1. THE CAMERA: only the art moves inside a fixed hexagon. It pushes in to
//      1.035 and drifts up to 1.2 units (R = 46) along its own direction and back,
//      ease-in-out sine, each tile on its own 9-13 s period and phase.
//   2. THE SHEEN: a soft warm band glides top-left to bottom-right across one
//      tile at a time, east first and clockwise, the middle last, 8 s round.
//   3. THE BLOOM: when a ring opens its tiles ease in from 0.92 and nothing,
//      30 ms a tile clockwise from east. The hive's centre is the tile the
//      menu opened on, already showing, so it (and its name) stays as it is.
//
// Times are seconds since the ring opened: the flower clock is rebased to 0 then.

/** The flower's tiles are counted from here in the shader's cell index; a honey
 *  flower's cell index is this plus its slot. */
export const FLOWER_INDEX_BASE = 1000000

/** The flower clock wraps here (seconds): a whole number of drips (11 s) and of
 *  sheen cycles (8 s), so both loop seamlessly; the camera's periods are the
 *  ring's (9-13 s, not divisors), so a flower held open 22 minutes may see its
 *  pictures step by up to a pixel or two once. Keeps u_time small. */
export const FLOWER_CLOCK_PERIOD_S = 1320

/** THE CAMERA, in px at R = 46 (quick-menu.honey.ts DRIFT). */
export const DRIFT = { scale: 1.035, travel: 1.2, periodMin: 9, periodMax: 13 } as const
/** Where in its own period each slot starts, as a share of it (centre, then east clockwise). */
export const DRIFT_PHASE = [0.5, 0, 1 / 3, 2 / 3, 0, 1 / 3, 2 / 3] as const

/** THE SHEEN, in px at R = 46 (quick-menu.honey.ts SHEEN): the band is `width`
 *  at full strength with `soft` either side, crosses from -reach to +reach in
 *  `passS`, and over the glyph and the word (`inkBand`) is held to `ink*`. */
export const SHEEN = {
  cycleS: 8,
  passS: 1,
  leadS: 0.6,
  width: 12,
  soft: 6,
  reach: 58,
  angleDeg: 45,
  color: '#fff4d6',
  peakRest: 0.16,
  peakLit: 0.22,
  inkRest: 0.06,
  inkLit: 0.1,
  inkBand: { x0: -32, x1: 32, y0: -24, y1: 27 },
  feather: 4,
  featherSteps: 2,
} as const
/** The centre and the six round it: the slots the light visits in one cycle. */
export const SHEEN_SLOTS = 7

/** THE BLOOM (quick-menu.honey.ts BLOOM). */
export const BLOOM = { fromScale: 0.92, durationMs: 260, staggerMs: 30, bezier: [0.2, 0.8, 0.2, 1] } as const
export const BLOOM_EASE_CSS = `cubic-bezier(${BLOOM.bezier.join(',')})`
/** Every slot of a ring has bloomed this many ms after it opened. */
export const BLOOM_TOTAL_MS = BLOOM.durationMs + 6 * BLOOM.staggerMs

const TAU = Math.PI * 2
const fract = (v: number): number => v - Math.floor(v)
const r3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

export interface TileMotion {
  readonly periodS: number
  readonly phaseS: number
  /** Where the picture travels at the top of the push, px at R = 46 (y down). */
  readonly dx: number
  readonly dy: number
}

/** The camera of the picture `variation` (0..9) worn in slot `slot` (0 the
 *  centre, 1..6 east clockwise): the same picture in the same slot moves the
 *  same way on every open. */
export function motionFor(variation: number, slot: number): TileMotion {
  const v = Math.max(0, Math.floor(variation))
  const i = Math.max(0, Math.floor(slot))
  const periodS = DRIFT.periodMin + (DRIFT.periodMax - DRIFT.periodMin) * fract((v + 1) * 0.7548777 + i * 0.5698403)
  const phaseS = periodS * (DRIFT_PHASE[i % DRIFT_PHASE.length] ?? 0)
  const angle = TAU * fract(v * 0.381966 + i * 0.2763932)
  return {
    periodS: r3(periodS),
    phaseS: r3(phaseS),
    dx: r3(DRIFT.travel * Math.cos(angle)),
    dy: r3(DRIFT.travel * Math.sin(angle)),
  }
}

/** The push at `timeS`: e runs 0 -> 1 -> 0 once a period, a sine there and back;
 *  the push-in and the travel share it, so the picture covers the hexagon at
 *  every frame (at 1.035 there is 1.6 px past every corner, the travel is 1.2). */
export function driftPose(timeS: number, m: TileMotion): { scale: number; dx: number; dy: number } {
  const u = m.periodS > 0 ? fract((timeS + m.phaseS) / m.periodS) : 0
  const e = (1 - Math.cos(TAU * u)) / 2
  return { scale: 1 + (DRIFT.scale - 1) * e, dx: m.dx * e, dy: m.dy * e }
}

/** When the light first reaches slot `slot`: east first, clockwise, the middle
 *  last, each its own seventh of the cycle, after a lead that lets the bloom end. */
export function sheenDelayS(slot: number, slotCount: number = SHEEN_SLOTS): number {
  const n = Math.max(1, Math.floor(slotCount))
  const k = (((Math.floor(slot) - 1) % n) + n) % n
  return r3(SHEEN.leadS + (SHEEN.cycleS * k) / n)
}

/** The band's centre along the top-left -> bottom-right diagonal on slot `slot`
 *  at `timeS`, px at R = 46, or null between its passes. */
export function sheenOffset(timeS: number, slot: number, slotCount: number = SHEEN_SLOTS): number | null {
  const local = timeS - sheenDelayS(slot, slotCount)
  if (local < 0) return null
  const u = local % SHEEN.cycleS
  if (u >= SHEEN.passS) return null
  const x = u / SHEEN.passS
  return -SHEEN.reach + 2 * SHEEN.reach * (-(Math.cos(Math.PI * x) - 1) / 2)
}

/** How far from the ink cap (0) to the peak (1) the light may be at (x, y): 0
 *  over the glyph and the word, easing out to 1 across the span the ring's
 *  feather rings cover (`feather` x (`featherSteps` + 1) px). The ring steps
 *  where this ramps, and the ramp is never above its steps. */
export function sheenShare(x: number, y: number): number {
  const b = SHEEN.inkBand
  const outside = Math.max(b.x0 - x, x - b.x1, b.y0 - y, y - b.y1)
  return Math.max(0, Math.min(1, outside / (SHEEN.feather * (SHEEN.featherSteps + 1))))
}

/** The sheen's strength at tile point (x, y) at `timeS`, px at R = 46 in the
 *  tile's screen frame (y down): full across the band's `width`, fading over
 *  `soft` either side, from the ink cap to the peak by sheenShare. */
export function sheenAt(timeS: number, slot: number, x: number, y: number, lit: boolean): number {
  const at = sheenOffset(timeS, slot)
  if (at === null) return 0
  const d = Math.abs((x + y) * Math.SQRT1_2 - at)
  const profile = Math.max(0, Math.min(1, (SHEEN.width / 2 + SHEEN.soft - d) / SHEEN.soft))
  const cap = lit ? SHEEN.inkLit : SHEEN.inkRest
  const peak = lit ? SHEEN.peakLit : SHEEN.peakRest
  return profile * (cap + (peak - cap) * sheenShare(x, y))
}

/** How long after the ring opens slot `slot` starts to bloom: the middle first,
 *  then east clockwise, 30 ms apart. */
export function bloomDelayMs(slot: number): number {
  return Math.max(0, Math.floor(slot)) * BLOOM.staggerMs
}

/** CSS's cubic-bezier(0.2, 0.8, 0.2, 1) at progress k, solved the way the shader
 *  solves it: Newton on x(t) = k from t = k, six steps (x' never falls under 0.48). */
export function bloomEase(k: number): number {
  const [x1, y1, x2, y2] = BLOOM.bezier
  k = Math.max(0, Math.min(1, k))
  let t = k
  for (let i = 0; i < 6; i++) {
    const u = 1 - t
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t
    const dx = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2)
    t = Math.max(0, Math.min(1, t - (x - k) / dx))
  }
  const u = 1 - t
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t
}

/** Slot `slot`'s bloom `sinceS` seconds after the ring opened, as the vertex
 *  stage reads it: 0..1, where the scale is mix(fromScale, 1, k) and the
 *  opacity k. A negative time (the clock went back under it) reads as done.
 *  The hive's centre (slot 0) is the tile the menu opened on, already on
 *  screen: it never blooms (the DOM ring's centre is a new tile, and does). */
export function bloomAt(sinceS: number, slot: number): number {
  if (sinceS < 0 || slot < 0.5) return 1
  return bloomEase((sinceS * 1000 - bloomDelayMs(slot)) / BLOOM.durationMs)
}

/** Each flower cell's slot: 0 for the centre (the subject, else the middle of
 *  the ring), 1..6 round it clockwise from east (screen y grows down). A flat-top
 *  hive turns the ring 30°, so its east cell sits at 30°. */
export function flowerSlots(cells: readonly { x: number; y: number; subject?: boolean }[], flat: boolean): number[] {
  if (cells.length === 0) return []
  const subject = cells.find(c => c.subject)
  const centre = subject ?? {
    x: cells.reduce((s, c) => s + c.x, 0) / cells.length,
    y: cells.reduce((s, c) => s + c.y, 0) / cells.length,
  }
  const reach = Math.max(...cells.map(c => Math.hypot(c.x - centre.x, c.y - centre.y)))
  const step = Math.PI / 3
  return cells.map((c) => {
    const dx = c.x - centre.x
    const dy = c.y - centre.y
    if (c === subject || Math.hypot(dx, dy) < reach * 0.5) return 0
    const a = Math.atan2(dy, dx) - (flat ? Math.PI / 6 : 0)
    return ((Math.round(a / step) % 6) + 6) % 6 + 1
  })
}

/** What makes two paints the same ring: where its tiles are and what they are,
 *  never which one is lit (a highlight never blooms again). */
export function flowerRingKey(cells: readonly { q: number; r: number; label: string; subject?: boolean; back?: boolean; honey?: boolean }[]): string {
  return cells.map(c => `${c.q},${c.r},${c.subject ? 's' : ''}${c.back ? 'b' : ''}${c.honey ? 'h' : ''},${c.label}`).join('|')
}
