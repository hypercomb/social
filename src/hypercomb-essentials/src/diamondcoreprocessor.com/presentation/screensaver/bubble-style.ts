// diamondcoreprocessor.com/presentation/screensaver/bubble-style.ts
//
// The screensaver's pluggable visual contract + registry.
//
// A "bubble style" is one way of drawing a single floating tile — a hexagon, a
// circle, a thought bubble, … The screensaver drone owns the physics (where
// each bubble is); a style owns only the LOOK (what one bubble renders as).
//
// Adding a new visual is a one-file change:
//   1. create `<name>.style.ts` that calls `registerBubbleStyle({ name, description, build })`
//   2. add one `import './<name>.style.js'` line to `styles.ts`
// The shared helpers below (image clip, neon edge, label) keep each style to a
// few lines, so the only thing a new style decides is its OUTLINE.

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'

/** Everything a style needs to draw one bubble. The physics (position) is the
 *  drone's job — a style returns a Container drawn around its own origin. */
export interface BubbleContext {
  tex: Texture | null   // the tile's decoded image, or null (text-only tile)
  color: number         // this bubble's neon colour (0xRRGGBB)
  r: number             // radius / circumradius in px
  label: string         // the tile's text
  hideText: boolean     // tile asked for no text
  flat: boolean         // hex orientation (point-top vs flat-top) — used by shape styles
}

export interface BubbleStyle {
  /** machine name typed after `/screensaver` (e.g. 'hexagon') */
  readonly name: string
  /** one-line human description for autocomplete / help */
  readonly description: string
  /** draw one bubble centred on (0,0); the drone positions the returned view */
  build(ctx: BubbleContext): Container
}

// ───────────────────────────── registry ─────────────────────────────

const REGISTRY = new Map<string, BubbleStyle>()

export function registerBubbleStyle(style: BubbleStyle): void {
  REGISTRY.set(style.name, style)
}
export function getBubbleStyle(name: string): BubbleStyle | undefined {
  return REGISTRY.get(name)
}
export function bubbleStyles(): BubbleStyle[] {
  return [...REGISTRY.values()]
}
export function bubbleStyleNames(): string[] {
  return [...REGISTRY.keys()]
}

// ───────────────────── shared draw helpers ─────────────────────
//
// A style picks an OUTLINE (a function that draws its shape's path onto a fresh
// Graphics) and reuses these for the parts every style shares.

/** Vertices of a regular hexagon of circumradius r as a flat [x0,y0,…] list.
 *  point-top puts a vertex at top/bottom (flat=false); flat-top flat edges. */
export function hexPoints(r: number, flat: boolean): number[] {
  const out: number[] = []
  const base = flat ? 0 : -Math.PI / 2
  for (let i = 0; i < 6; i++) {
    const a = base + (Math.PI / 3) * i
    out.push(Math.cos(a) * r, Math.sin(a) * r)
  }
  return out
}

/** Clip `tex` into the shape and add image (+ its mask) to `view`. */
export function addClippedImage(view: Container, tex: Texture, makeShape: () => Graphics, r: number): void {
  const img = new Sprite(tex)
  img.anchor.set(0.5)
  // cover: scale so the smaller image dimension spans the bubble's diameter
  img.scale.set((r * 2) / Math.max(1, Math.min(tex.width, tex.height)))
  const mask = makeShape()
  img.mask = mask
  view.addChild(mask)
  view.addChild(img)
}

/** Neon edge: two soft additive strokes hugging the outline (outward bloom +
 *  edge brighten) then a crisp core rim. `stroke(width, alpha)` returns a fresh
 *  Graphics with the style's outline stroked. Restrained alphas by design. */
export function addNeonEdge(view: Container, r: number, stroke: (width: number, alpha: number) => Graphics): void {
  const wide = stroke(Math.max(8, r * 0.34), 0.08); wide.blendMode = 'add'; view.addChild(wide)
  const mid = stroke(Math.max(4, r * 0.16), 0.16); mid.blendMode = 'add'; view.addChild(mid)
  view.addChild(stroke(2.5, 0.95))
}

// Margin the text keeps from the reference circle's perimeter (5%).
const TEXT_PERIMETER_MARGIN = 0.05
// The reference circle is the hexagon's INSCRIBED circle (apothem = r·√3/2) —
// the largest circle that fits inside a hexagon of circumradius r, so text held
// inside it never crosses the hexagon's edges (and sits well inside circle /
// cloud bubbles too).
const HEX_APOTHEM = Math.sqrt(3) / 2

/** The tile's text, centred and shrunk so it stays inside the bubble.
 *
 *  Mathematical padding: the text's bounding box must fit within a circle held
 *  `TEXT_PERIMETER_MARGIN` (5%) in from the hexagon's inscribed-circle
 *  perimeter. The box's farthest point from centre is a corner at distance
 *  `hypot(width/2, height/2)`; we shrink the text until that half-diagonal is
 *  ≤ the safe radius, so no corner ever reaches within 5% of the perimeter. */
export function addLabel(view: Container, label: string, hideText: boolean, r: number): void {
  const text = (label ?? '').trim()
  if (!text || hideText) return
  const safeR = r * HEX_APOTHEM * (1 - TEXT_PERIMETER_MARGIN)
  // Labels render at 75% of the bubble-derived size — smaller, less crowded.
  const LABEL_SCALE = 0.75
  const fontSize = Math.round(Math.max(9, Math.min(26, r * 0.34)) * LABEL_SCALE)
  const t = new Text({
    text,
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize,
      fontWeight: '700',
      fill: 0xffffff,
      align: 'center',
      stroke: { color: 0x05010a, width: 4 },
      wordWrap: true,
      wordWrapWidth: safeR * 1.6, // encourage wrapping within the safe circle
    },
  })
  t.anchor.set(0.5)
  // Shrink so the text box's corner sits within the safe circle. Pixi folds the
  // stroke into the measured bounds, so the outline is covered too.
  const halfDiag = Math.hypot(t.width / 2, t.height / 2)
  if (halfDiag > safeR) t.scale.set(safeR / halfDiag)
  view.addChild(t)
}
