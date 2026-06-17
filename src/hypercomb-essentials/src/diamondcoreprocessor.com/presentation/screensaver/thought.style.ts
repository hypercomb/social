// diamondcoreprocessor.com/presentation/screensaver/thought.style.ts
//
// Thought bubble — a clean cartoon cloud: a few big rounded ridges drawn as ONE
// continuous closed path (so the neon rim traces a single clean outline), the
// tile image clipped into the cloud, a glossy highlight, and the classic trail:
// one wider bubble underneath, then a small circle down to the right.
//
// The cloud is the only thing this style decides — image clip, neon edge and
// label all reuse the shared helpers, same as the hexagon/circle styles.

import { Container, Graphics } from 'pixi.js'
import { registerBubbleStyle, addClippedImage, addNeonEdge, addLabel } from './bubble-style.js'

const BUMPS = 5        // a few big cartoon ridges, not many tiny ones
const VALLEY = 0.82    // radius at the dimples where ridges meet (× r)
const PEAK = 1.32      // control-point reach that sets how far ridges bulge (× r)

/** Deterministic [0,1) from a seed — gentle per-cloud variation, kept tidy. */
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed * 0.013 + i * 12.9898) * 43758.5453
  return 0.94 + (x - Math.floor(x)) * 0.12 // ~0.94 … 1.06 — subtle, stays cartoon-clean
}

/** Trace the cloud outline (a closed scalloped path) onto `g` and return it,
 *  ready to .fill() or .stroke(). `seed` varies the ridges per bubble. */
function traceCloud(g: Graphics, r: number, seed: number): Graphics {
  const half = Math.PI / BUMPS
  const rv = r * VALLEY
  const at = (radius: number, ang: number): [number, number] => [Math.cos(ang) * radius, Math.sin(ang) * radius]
  const [sx, sy] = at(rv, -half) // start at the valley before ridge 0
  g.moveTo(sx, sy)
  for (let i = 0; i < BUMPS; i++) {
    const center = (2 * Math.PI / BUMPS) * i
    const [cx, cy] = at(r * PEAK * jitter(seed, i), center)  // control → ridge apex
    const [vx, vy] = at(rv, center + half)                  // next valley
    g.quadraticCurveTo(cx, cy, vx, vy)
  }
  g.closePath()
  return g
}

/** A filled + neon-rimmed puff (circle or ellipse), for the trailing bubbles.
 *  `makeShape` returns a fresh Graphics with the puff's path; `ref` sizes the
 *  glow stroke. */
function glowPuff(view: Container, color: number, ref: number, makeShape: () => Graphics): void {
  view.addChild(makeShape().fill({ color, alpha: 0.3 }))
  const bloom = makeShape().stroke({ color, width: Math.max(3, ref * 0.5), alpha: 0.12 })
  bloom.blendMode = 'add'
  view.addChild(bloom)
  view.addChild(makeShape().stroke({ color, width: 2, alpha: 0.9 }))
}

registerBubbleStyle({
  name: 'thought',
  description: 'A cartoon cloud thought bubble',
  build({ tex, color, r, label, hideText }) {
    const view = new Container()
    const seed = color // stable per bubble (colour is derived from the label)

    // body — image clipped into the cloud, or a soft cloud fill when imageless
    if (tex) addClippedImage(view, tex, () => traceCloud(new Graphics(), r, seed).fill(0xffffff), r)
    else view.addChild(traceCloud(new Graphics(), r, seed).fill({ color, alpha: 0.3 }))

    // neon edge tracing the single cloud outline
    addNeonEdge(view, r, (width, alpha) => traceCloud(new Graphics(), r, seed).stroke({ color, width, alpha }))

    // glossy highlight — a soft pale sheen toward the top-left, sells "bubble"
    const sheen = new Graphics().ellipse(-r * 0.3, -r * 0.42, r * 0.3, r * 0.16).fill({ color: 0xffffff, alpha: 0.16 })
    sheen.blendMode = 'add'
    view.addChild(sheen)

    addLabel(view, label, hideText, r)

    // the trail: one wider bubble directly underneath, then a small circle down
    // to the right — the classic "…" of a thought bubble.
    glowPuff(view, color, r * 0.4, () => new Graphics().ellipse(0, r * 1.12, r * 0.5, r * 0.4))
    glowPuff(view, color, r * 0.15, () => new Graphics().circle(r * 0.62, r * 1.74, r * 0.16))

    return view
  },
})
