// diamondcoreprocessor.com/presentation/screensaver/motion.ts
//
// The screensaver's pluggable MOTION contract + registry — the sibling of
// bubble-style. A "bubble style" decides what one bubble LOOKS like (hexagon,
// circle, thought cloud); a "motion" decides how the whole field MOVES
// (bounce around like a DVD logo, streak across as a meteor shower, …).
//
// The drone still owns everything universal: the lifecycle, the screen-space
// counter-transform, and the return-home glide on dismiss. A motion owns only
// two things — where each bubble STARTS and how every bubble ADVANCES each
// frame (plus any trail it chooses to leave behind).
//
// Adding a new motion is a one-file change, exactly like adding a style:
//   1. create `<name>.motion.ts` that calls `registerMotion({ name, description, spawn, step })`
//   2. add one `import './<name>.motion.js'` line to `motions.ts`

import type { Container } from 'pixi.js'

/** One free-floating tile. The drone builds these (image + label + home), the
 *  active motion positions and advances them. `homeX/homeY` is the tile's
 *  on-screen spot — the universal return-home target, set whatever the motion. */
export interface Bubble {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  mass: number      // ∝ r² — heavier bubbles shove lighter ones (bounce motion)
  color: number     // this bubble's neon colour — trails match the head
  view: Container
  homeX: number     // the tile's on-screen position — eased back to on dismiss
  homeY: number
  rsx: number       // position captured when the return-home glide begins
  rsy: number
  // Motion-local scratch — owned by the active motion, ignored by everything
  // else. e.g. the comet trail's recent-position ring buffer + its Graphics.
  trail?: { x: number; y: number }[]
  trailGfx?: Container
}

/** What a motion needs from the drone each frame: the screen box and the layer
 *  it may parent trail graphics into (torn down with the run, so no leaks). */
export interface MotionContext {
  W: number
  H: number
  layer: Container
}

export interface BubbleMotion {
  /** machine name typed after `/screensaver` (e.g. 'shooting-stars') */
  readonly name: string
  /** one-line human description for autocomplete / help */
  readonly description: string
  /** Position a freshly-built bubble: set x,y,vx,vy (+ any trail state). The
   *  bubble's homeX/homeY are already its tile spot — bounce lifts off from
   *  there, comets ignore it and stream in from off-screen. */
  spawn(b: Bubble, ctx: MotionContext): void
  /** Advance every bubble one frame and update any trails. The drone paints
   *  the head views from x/y afterwards, so a motion need only update the
   *  numbers (and draw its own trails). */
  step(bubbles: Bubble[], dt: number, ctx: MotionContext): void
}

// ───────────────────────────── registry ─────────────────────────────

const REGISTRY = new Map<string, BubbleMotion>()

export function registerMotion(motion: BubbleMotion): void {
  REGISTRY.set(motion.name, motion)
}
export function getMotion(name: string): BubbleMotion | undefined {
  return REGISTRY.get(name)
}
export function motions(): BubbleMotion[] {
  return [...REGISTRY.values()]
}
export function motionNames(): string[] {
  return [...REGISTRY.keys()]
}
