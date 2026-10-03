// games/roper/rope.spec.ts
//
// The Roper rope is a rod: the worm is held exactly one rope-length from the
// anchor, and only up/down (or a wall that blocks the rope) changes the length.
// These pin that invariant, and the three sources of momentum: swing pumping,
// reeling in, gravity. They do NOT claim the constants match Worms 2 — those are
// unknown (see the Worms rope research hand-off); the structure is what is pinned.

import { describe, it, expect } from 'vitest'
import { RoperEngine, type Rope } from './engine.js'

const ANCHOR = { x: 450, y: 40 }

/** An open arena with a rock ceiling slab (the anchor sits in it) and one live worm. */
function arena(): RoperEngine {
  const e = new RoperEngine({ width: 900, wormsPerTeam: 1, seed: 7 })
  e.terrain.fill(0)
  for (let y = 0; y <= ANCHOR.y; y++) for (let x = 0; x < e.width; x++) e.terrain[y * e.width + x] = 1
  // park every other worm far from the swing
  e.worms.forEach((w, i) => { if (w !== e.active) { w.x = 60 + i * 10; w.y = 650; w.vx = 0; w.vy = 0 } })
  return e
}

function attach(e: RoperEngine, x: number, y: number, vx = 0, vy = 0): Rope {
  const w = e.active!
  w.x = x; w.y = y; w.vx = vx; w.vy = vy; w.onGround = false
  const length = Math.hypot(x - ANCHOR.x, y - ANCHOR.y)
  const rope: Rope = {
    phase: 'attached', ox: ANCHOR.x, oy: ANCHOR.y, dx: 0, dy: -1, reach: length,
    hx: ANCHOR.x, hy: ANCHOR.y, ax: ANCHOR.x, ay: ANCHOR.y, length,
  }
  e.rope = rope
  return rope
}

const gap = (e: RoperEngine): number => {
  const w = e.active!, r = e.rope!
  return Math.abs(Math.hypot(w.x - r.ax, w.y - r.ay) - r.length)
}
const speed = (e: RoperEngine): number => Math.hypot(e.active!.vx, e.active!.vy)
/** Mechanical energy per unit mass (y grows downward). */
const energy = (e: RoperEngine): number => 0.5 * speed(e) ** 2 - 1100 * e.active!.y

describe('roper rope: no slack', () => {
  it('stays exactly one rope-length from the anchor through a free swing', () => {
    const e = arena()
    attach(e, 450 + 150, 40 + 130)
    let worst = 0
    for (let i = 0; i < 600; i++) { e.update(1 / 60); worst = Math.max(worst, gap(e)) }
    expect(e.rope).not.toBeNull()
    expect(worst).toBeLessThan(0.02)
  })

  it('never goes slack while pumped hard, bouncing off the ceiling and walls', () => {
    const e = arena()
    attach(e, 450 + 120, 40 + 100)
    let worst = 0
    for (let i = 0; i < 1500; i++) {
      const w = e.active!
      e.input.right = w.vx > 0; e.input.left = w.vx <= 0           // pump in phase with the swing
      e.update(1 / 60)
      if (!e.rope) break
      worst = Math.max(worst, gap(e))
    }
    expect(worst).toBeLessThan(0.02)
  })

  it('has no slack at the top of a swing, where a one-sided rope used to go loose', () => {
    const e = arena()
    // an anchor in open air: a small rock block, worm resting just above-and-beside it
    for (let y = 296; y <= 304; y++) for (let x = 446; x <= 454; x++) e.terrain[y * e.width + x] = 1
    const w = e.active!
    const r = attach(e, 450 + 4, 300 - 120, 40, 0)
    r.ax = 450; r.ay = 300; r.length = Math.hypot(w.x - 450, w.y - 300)
    let worst = 0
    for (let i = 0; i < 480; i++) { e.update(1 / 60); if (!e.rope) break; worst = Math.max(worst, gap(e)) }
    expect(worst).toBeLessThan(0.02)
  })

  it('reeling in moves the worm in the same step, at the reel rate, down to the floor', () => {
    const e = arena()
    const r = attach(e, 450, 40 + 300)
    e.input.up = true
    const before = r.length
    e.update(1 / 60)
    expect(before - r.length).toBeCloseTo(200 / 60, 3)
    expect(gap(e)).toBeLessThan(0.02)
    for (let i = 0; i < 400; i++) e.update(1 / 60)
    expect(r.length).toBeCloseTo(24, 3)
    expect(gap(e)).toBeLessThan(0.02)
  })

  it('reeling out pays the worm out with the rope, with no gap opening up', () => {
    const e = arena()
    const r = attach(e, 450 + 60, 40 + 200)
    e.input.down = true
    let worst = 0
    for (let i = 0; i < 120; i++) { e.update(1 / 60); worst = Math.max(worst, gap(e)) }
    expect(r.length).toBeGreaterThan(Math.hypot(60, 200) + 30)
    expect(worst).toBeLessThan(0.02)
  })

  it('a close grab keeps its true length instead of being stretched to the reel floor', () => {
    const e = arena()
    const w = e.active!
    w.x = 450; w.y = 40 + 18; w.vx = 0; w.vy = 0; w.onGround = false
    e.aimAngle = -Math.PI / 2
    e.fireRope()
    let attached = false
    for (let i = 0; i < 60 && !attached; i++) { e.update(1 / 60); attached = e.attached }
    expect(attached).toBe(true)
    expect(e.rope!.length).toBeLessThan(24)
    expect(gap(e)).toBeLessThan(0.05)
  })

  it('is released when the rock the hook holds is blown away', () => {
    const e = arena()
    attach(e, 450 + 100, 40 + 100)
    e.update(1 / 60)
    expect(e.rope).not.toBeNull()
    for (let y = 0; y <= ANCHOR.y; y++) for (let x = 400; x <= 500; x++) e.terrain[y * e.width + x] = 0
    e.update(1 / 60)
    expect(e.rope).toBeNull()
  })
})

describe('roper rope: momentum', () => {
  const swing = (e: RoperEngine, dt: number, seconds: number, pump: boolean): { peak: number; e0: number; e1: number } => {
    let peak = 0
    const e0 = energy(e)
    const steps = Math.round(seconds / dt)
    for (let i = 0; i < steps; i++) {
      const w = e.active!
      if (pump) { e.input.right = w.vx > 0; e.input.left = w.vx <= 0 } else { e.input.right = false; e.input.left = false }
      e.update(dt)
      peak = Math.max(peak, speed(e))
    }
    return { peak, e0, e1: energy(e) }
  }

  it('swing input pumped in phase builds speed a free swing never reaches', () => {
    const free = arena(); attach(free, 450 + 100, 40 + 140)
    const pumped = arena(); attach(pumped, 450 + 100, 40 + 140)
    const a = swing(free, 1 / 60, 4, false)
    const b = swing(pumped, 1 / 60, 4, true)
    expect(b.peak).toBeGreaterThan(a.peak * 1.25)
  })

  it('shortening the rope during a swing speeds the worm up', () => {
    const plain = arena(); attach(plain, 450 + 120, 40 + 150)
    const reeled = arena(); attach(reeled, 450 + 120, 40 + 150)
    let peakPlain = 0, peakReeled = 0
    for (let i = 0; i < 90; i++) {
      reeled.input.up = i > 30                                   // start reeling once the swing is moving
      plain.update(1 / 60); reeled.update(1 / 60)
      peakPlain = Math.max(peakPlain, speed(plain)); peakReeled = Math.max(peakReeled, speed(reeled))
    }
    expect(peakReeled).toBeGreaterThan(peakPlain * 1.1)
  })

  it('does not lose energy to the frame rate: 60 fps and 30 fps swings agree', () => {
    const a = arena(); attach(a, 450 + 110, 40 + 150)
    const b = arena(); attach(b, 450 + 110, 40 + 150)
    const ra = swing(a, 1 / 60, 3, false)
    const rb = swing(b, 1 / 30, 3, false)
    expect(Math.abs(energy(a) - energy(b)) / Math.abs(ra.e0)).toBeLessThan(0.05)
    expect(Math.abs(ra.peak - rb.peak) / ra.peak).toBeLessThan(0.05)
  })
})

describe('roper rope: launch angle', () => {
  const elevationDeg = (e: RoperEngine): number => {
    const d = e.ropeLaunchDir()
    return (Math.atan2(-d.dy, Math.abs(d.dx)) * 180) / Math.PI
  }

  it('never fires flatter than 45 degrees, however low you aim', () => {
    for (const deg of [0, 5, 20, 44, 180, 175, -10, 200, 359]) {
      const e = arena()
      e.aimAngle = (deg * Math.PI) / 180
      expect(elevationDeg(e)).toBeGreaterThanOrEqual(45 - 1e-9)
    }
  })

  it('leaves a steeper aim alone', () => {
    const e = arena()
    e.aimAngle = (-70 * Math.PI) / 180
    expect(elevationDeg(e)).toBeCloseTo(70, 6)
    expect(Math.hypot(e.ropeLaunchDir().dx, e.ropeLaunchDir().dy)).toBeCloseTo(1, 9)
  })

  it('still flips to the other side on a re-rope, at the same 45 degree floor', () => {
    const e = arena()
    e.aimAngle = (-20 * Math.PI) / 180            // low, to the right
    const first = e.ropeLaunchDir()
    expect(first.sign).toBe(1)
    e.fireRope()
    e.releaseRope()
    const again = e.ropeLaunchDir()
    expect(again.sign).toBe(-1)
    expect(elevationDeg(e)).toBeGreaterThanOrEqual(45 - 1e-9)
  })
})

describe('roper rope: re-rope speed', () => {
  const framesToAttach = (e: RoperEngine): number => {
    for (let i = 1; i <= 30; i++) { e.update(1 / 60); if (e.attached) return i }
    return Infinity
  }

  it('a grab 500 units away attaches within 6 frames at 60 fps', () => {
    const e = arena()
    const w = e.active!
    w.x = 450; w.y = 40 + 500 - 20; w.vx = 0; w.vy = 0; w.onGround = false
    e.aimAngle = -Math.PI / 2
    e.fireRope()
    expect(framesToAttach(e)).toBeLessThanOrEqual(6)
  })

  it('re-roping right after a release has no gate and attaches just as fast', () => {
    const e = arena()
    attach(e, 450 + 100, 40 + 300)
    e.update(1 / 60)
    e.aimAngle = -Math.PI / 2
    e.toggleRope()                                   // release
    expect(e.rope).toBeNull()
    e.toggleRope()                                   // fire again, same instant
    expect(e.rope?.phase).toBe('extending')
    expect(framesToAttach(e)).toBeLessThanOrEqual(6)
  })

  it('a fast hook still stops at the first solid and cannot tunnel a thin wall', () => {
    const e = arena()
    for (let y = 296; y <= 297; y++) for (let x = 0; x < e.width; x++) e.terrain[y * e.width + x] = 1   // a 2-unit shelf
    const w = e.active!
    w.x = 450; w.y = 500; w.vx = 0; w.vy = 0; w.onGround = false
    e.aimAngle = -Math.PI / 2
    e.fireRope()
    framesToAttach(e)
    expect(e.attached).toBe(true)
    expect(e.rope!.ay).toBeGreaterThanOrEqual(296)
    expect(e.rope!.ay).toBeLessThan(300)
  })
})
