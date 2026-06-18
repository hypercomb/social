// diamondcoreprocessor.com/presentation/screensaver/bounce.motion.ts
//
// The original DVD-style drift, now a pluggable motion: every bubble lifts off
// its tile heading a random way, bounces off the screen edges, and collides
// elastically with the other bubbles. This is the default motion.

import { registerMotion } from './motion.js'
import type { Bubble, MotionContext } from './motion.js'

const MIN_SPEED = 70   // px/sec
const MAX_SPEED = 170

registerMotion({
  name: 'bounce',
  description: 'Bounce around the screen like a DVD logo',

  spawn(b: Bubble): void {
    // lift off from the tile's actual on-screen spot, heading a random way
    const angle = Math.random() * Math.PI * 2
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)
    b.x = b.homeX
    b.y = b.homeY
    b.vx = Math.cos(angle) * speed
    b.vy = Math.sin(angle) * speed
  },

  step(bubbles: Bubble[], dt: number, ctx: MotionContext): void {
    const { W, H } = ctx

    // integrate + bounce off the screen edges
    for (const b of bubbles) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) }
      else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) }
      if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) }
      else if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy) }
    }

    // pairwise elastic collisions
    for (let i = 0; i < bubbles.length; i++) {
      const a = bubbles[i]
      for (let j = i + 1; j < bubbles.length; j++) {
        const c = bubbles[j]
        const dx = c.x - a.x
        const dy = c.y - a.y
        const minDist = a.r + c.r
        const distSq = dx * dx + dy * dy
        if (distSq >= minDist * minDist || distSq === 0) continue

        const dist = Math.sqrt(distSq)
        const nx = dx / dist
        const ny = dy / dist

        // push them apart so they don't overlap-lock
        const overlap = minDist - dist
        const total = a.mass + c.mass
        a.x -= nx * overlap * (c.mass / total)
        a.y -= ny * overlap * (c.mass / total)
        c.x += nx * overlap * (a.mass / total)
        c.y += ny * overlap * (a.mass / total)

        // exchange velocity along the collision normal (1D elastic on the axis)
        const va = a.vx * nx + a.vy * ny
        const vc = c.vx * nx + c.vy * ny
        if (va - vc <= 0) continue // already separating
        const newVa = (va * (a.mass - c.mass) + 2 * c.mass * vc) / total
        const newVc = (vc * (c.mass - a.mass) + 2 * a.mass * va) / total
        a.vx += (newVa - va) * nx
        a.vy += (newVa - va) * ny
        c.vx += (newVc - vc) * nx
        c.vy += (newVc - vc) * ny
      }
    }
  },
})
