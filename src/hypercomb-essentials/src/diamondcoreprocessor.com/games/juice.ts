// diamondcoreprocessor.com/games/juice.ts
//
// Shared "game feel" toolkit for the arcade overlays (arkanoid, bubble, solomon).
// Pure and framework-free — the only browser surface it touches is the 2D context
// handed to ParticleField.draw(). Keeping these three pieces in one place is what
// makes the games read as a single cohesive "modern vector arcade" suite instead
// of three unrelated experiments:
//
//   • Shaker        — trauma-based screen shake the overlay folds into its transform.
//   • ParticleField — a tiny additive spark/burst system for games whose engine
//                     has no particles of its own.
//   • easing + ARCADE palette — shared timing curves and accent colours.

// ── screen shake ───────────────────────────────────────────

/** Trauma-based screen shake (Vlambeer-style). Callers add trauma on impacts; the
 *  visible shake is trauma², so light hits barely nudge while big hits kick hard,
 *  and it always decays smoothly back to rest. The overlay folds offset() into the
 *  canvas transform each frame. */
export class Shaker {
  #trauma = 0
  #t = 0
  #max: number
  #decay: number

  constructor(maxPixels = 13, decayPerSec = 1.7) {
    this.#max = maxPixels
    this.#decay = decayPerSec
  }

  /** Add an impulse, amount 0..1 (clamped). Bigger = stronger kick. */
  add(amount: number): void {
    this.#trauma = Math.min(1, this.#trauma + amount)
  }

  /** Advance decay. Call once per frame with dt seconds. */
  update(dt: number): void {
    this.#t += dt
    if (this.#trauma > 0) this.#trauma = Math.max(0, this.#trauma - this.#decay * dt)
  }

  /** Current pixel offset to translate the world by (smooth, organic, non-looping). */
  offset(): { x: number; y: number } {
    const s = this.#trauma * this.#trauma
    if (s <= 0) return { x: 0, y: 0 }
    const t = this.#t, m = this.#max * s
    return {
      x: m * (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 91.7) * 0.4),
      y: m * (Math.sin(t * 53.1 + 1.7) * 0.6 + Math.sin(t * 103.3 + 0.5) * 0.4),
    }
  }

  get active(): boolean { return this.#trauma > 0 }
}

// ── particles ──────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; max: number; size: number; color: string
  gravity: number; drag: number
}

export interface BurstOpts {
  count?: number          // number of sparks (default 10)
  speed?: number          // base ejection speed px/s (default 95)
  size?: number           // base radius px (default 2.4)
  life?: number           // base lifetime s (default 0.5)
  gravity?: number        // downward accel px/s² (default 220; 0 = float)
  drag?: number           // velocity damping per s (default 1.6)
  color?: string | string[]
  angle?: number          // burst centre direction rad (default full circle)
  arc?: number            // spread around angle rad (default 2π)
}

/** A minimal additive particle field for the games whose engine carries no
 *  particles of its own. Drawn in world units, so the overlay's existing scale
 *  (and shake) transform applies to it for free. */
export class ParticleField {
  #ps: Particle[] = []

  burst(x: number, y: number, opts: BurstOpts = {}): void {
    const count = opts.count ?? 10
    const speed = opts.speed ?? 95
    const size = opts.size ?? 2.4
    const life = opts.life ?? 0.5
    const gravity = opts.gravity ?? 220
    const drag = opts.drag ?? 1.6
    const base = opts.angle ?? 0
    const arc = opts.arc ?? Math.PI * 2
    const colors = Array.isArray(opts.color) ? opts.color : [opts.color ?? '#ffffff']
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * arc
      const v = speed * (0.45 + Math.random() * 0.75)
      const l = life * (0.7 + Math.random() * 0.6)
      this.#ps.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: l, max: l,
        size: size * (0.65 + Math.random() * 0.85),
        color: colors[(Math.random() * colors.length) | 0],
        gravity, drag,
      })
    }
  }

  update(dt: number): void {
    const ps = this.#ps
    const damp = Math.max(0, 1 - dt) // cheap per-frame drag base
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]
      p.life -= dt
      if (p.life <= 0) { ps.splice(i, 1); continue }
      p.vy += p.gravity * dt
      const d = 1 - p.drag * dt
      p.vx *= d > 0 ? d : damp
      p.vy *= d > 0 ? d : damp
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const ps = this.#ps
    if (!ps.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of ps) {
      const k = p.life / p.max
      ctx.globalAlpha = Math.min(1, k * 1.5)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.35 + k * 0.85), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  clear(): void { this.#ps.length = 0 }
  get count(): number { return this.#ps.length }
}

// ── easing ─────────────────────────────────────────────────

export function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3) }
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
/** Overshoot-and-settle — good for things that pop in (banners, intros). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

// ── shared accent palette ──────────────────────────────────

/** The common "modern vector arcade" accents. Individual games keep their own
 *  body hues (Bubble greens, Solomon golds, Arkanoid cools) but pull HUD text,
 *  banners, and spark colours from here so the suite feels of-a-piece. */
export const ARCADE = {
  cyan: '#7ee0ff',
  cyanSoft: '#bfe9ff',
  gold: '#ffd76a',
  magenta: '#ff5d8f',
  violet: '#9b7cff',
  ink: '#060412',
  /** White-hot spark gradient used by most impact bursts. */
  spark: ['#ffffff', '#bfe9ff', '#7ee0ff'],
  /** Warm spark set for fire / gold / destruction. */
  ember: ['#fff3c0', '#ffd76a', '#ff8f4d'],
} as const
