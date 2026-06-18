// diamondcoreprocessor.com/presentation/screensaver/shooting-stars.motion.ts
//
// A meteor shower. Every tile becomes a comet that streaks from the top-left
// down across the screen, leaving a fading trail of little stars behind its
// head (the head is whatever style is active — hexagons by default). When a
// comet falls past the bottom or right edge it loops back up to the top-left,
// so the shower never stops. No collisions — meteors pass through one another.
//
// All the comet trails are drawn into ONE additive Graphics parented at the
// bottom of the run's layer (so the trails sit behind the heads). It lives in a
// WeakMap keyed by that layer, so it's discovered without per-bubble graphics
// and is garbage-collected with the layer when the screensaver tears down.

import { Container, Graphics } from 'pixi.js'
import { registerMotion } from './motion.js'
import type { Bubble, MotionContext } from './motion.js'

const MIN_SPEED = 280   // px/sec — comets move fast
const MAX_SPEED = 460
// Heading: down and to the right (top-left → bottom). Jittered slightly per
// comet so the shower has spread but stays roughly parallel, like real meteors.
const DIR_X = 0.5
const DIR_Y = 1
const SPREAD = 0.12     // ± radians of per-comet heading jitter

const TRAIL = 12        // recent head positions kept per comet
const SAMPLE = 2        // draw a sparkle every Nth trail point

// One shared trail canvas per run-layer — created lazily, dropped with the layer.
const trailLayers = new WeakMap<Container, Graphics>()
function trailFor(layer: Container): Graphics {
  let g = trailLayers.get(layer)
  if (!g) {
    g = new Graphics()
    g.blendMode = 'add'        // trails glow where they overlap
    layer.addChildAt(g, 0)     // behind every head
    trailLayers.set(layer, g)
  }
  return g
}

/** Park a comet off-screen toward the top-left with a staggered head-start, so
 *  the shower streams in over time instead of all entering in one rank. Used
 *  both at spawn and to recycle a comet that has fallen off the bottom/right. */
function park(b: Bubble, ctx: MotionContext): void {
  const ang = Math.atan2(DIR_Y, DIR_X) + (Math.random() - 0.5) * 2 * SPREAD
  const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)
  b.vx = Math.cos(ang) * speed
  b.vy = Math.sin(ang) * speed
  b.x = -b.r + Math.random() * ctx.W * 0.6   // across the left ~60% of the width
  b.y = -b.r - Math.random() * ctx.H          // somewhere above the top edge
  b.trail = []                                // no streak from the old path to the new
}

/** A 4-point sparkle (twinkling star) centred at (x,y). */
function star(g: Graphics, x: number, y: number, rr: number, color: number, alpha: number): void {
  const w = rr * 0.28 // waist of the star points
  g.poly([
    x, y - rr, x + w, y - w, x + rr, y, x + w, y + w,
    x, y + rr, x - w, y + w, x - rr, y, x - w, y - w,
  ]).fill({ color, alpha })
}

registerMotion({
  name: 'shooting-stars',
  description: 'Meteor shower — comets streak from the top-left with star trails',

  spawn(b: Bubble, ctx: MotionContext): void {
    park(b, ctx)
    b.trailGfx = trailFor(ctx.layer)   // shared; lets the drone hide trails on return
  },

  step(bubbles: Bubble[], dt: number, ctx: MotionContext): void {
    const { W, H } = ctx
    const g = trailFor(ctx.layer)
    g.visible = true
    g.clear()

    for (const b of bubbles) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      // recycle once the comet has fully left the bottom or right edge
      if (b.y - b.r > H || b.x - b.r > W) park(b, ctx)

      const trail = b.trail ?? (b.trail = [])
      trail.push({ x: b.x, y: b.y })
      if (trail.length > TRAIL) trail.shift()

      // redraw the trail: a faint thread + sparkles fading and shrinking from
      // the head (newest, f→1) back to the tail (oldest, f→0)
      const n = trail.length
      for (let k = 0; k < n; k++) {
        const f = k / Math.max(1, n - 1)
        const p = trail[k]
        if (k > 0) {
          const q = trail[k - 1]
          g.moveTo(q.x, q.y).lineTo(p.x, p.y)
            .stroke({ color: b.color, width: Math.max(1, b.r * 0.12 * f), alpha: 0.12 * f })
        }
        if (k % SAMPLE === 0) star(g, p.x, p.y, b.r * 0.18 * (0.3 + f), b.color, 0.5 * f)
      }
    }
  },
})
