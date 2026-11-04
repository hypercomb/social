// quickmenu/quick-menu.honey-graphics.ts
//
// The quick menu's honey, drawn with Pixi Graphics: the ring the layer draws in
// place when no tile is flying. The DOM ring wears it as inline SVG and the Alt
// flower as the hexagon shader; all three read the same numbers from
// quick-menu.honey.ts, so a tile looks the same wherever it is drawn.
//
// Graphics has no radial gradient that follows a hexagon, so the depth ramp is
// LAYERED: concentric hexagons stepping through the same ramp, outermost first.
// The pour lip is the hexagon clipped to the region above its wavy line, in
// bands that step through the lip's gradient; the two teardrops are frozen
// (the ring in Pixi never animates — only the shader's lit tile moves). The
// icon and the word above the honey are the layer's.
//
// Everything is drawn in the hexagon's own coordinates, centred on the origin,
// at `radius` (the true circumradius). The numbers in quick-menu.honey.ts are
// for R = 46, so lengths in px are scaled by `radius / HEX_RADIUS`.
//
// Once the crafted backgrounds are drawn (quick-menu.honey-art.ts) an option's
// body is instead a Sprite of its picture, a frame of the shared atlas texture,
// masked to the hexagon; lit swaps the frame for the pre-lit copy, and the
// Graphics then carries only the rim and the lit halo (drawHoneyRim). The
// layer moves that picture (the drift) and the band of light drawn here
// (drawSheenBand, masked to each region by drawSheenZone) by transform alone.

import { Rectangle, Sprite, Texture, type Graphics } from 'pixi.js'
import { HONEY_ART_TILE, atlasFrame, type HoneyArt } from './quick-menu.honey-art.js'
import {
  BODY_BACK,
  BODY_BACK_LIT,
  BODY_LIT,
  BODY_REST,
  HONEY,
  HONEY_LIGHT,
  SHEEN,
  lipY,
  mixHex,
  sampleRamp,
  slotHoney,
  type DripShape,
  type RampStop,
  type SheenRect,
  type SheenZone,
} from './quick-menu.honey.js'
import { HEX_RADIUS } from './quick-menu.types.js'

export type Pt = readonly [number, number]

/** Which honey a tile is poured as: the way back is crystallised, lit is bright. */
export type HoneyState = { readonly lit: boolean; readonly back: boolean }

/** Concentric hexagon scales for the depth ramp, outermost first, fine enough
 *  that the steps read as a gradient. A hexagon of circumradius ρR sits at a mean
 *  depth of about 1 - 0.93ρ. */
const LAYERS = Array.from({ length: 19 }, (_, i) => 1 - i * 0.05)
/** The back is a gentle ramp, so a few layers say it. */
const BACK_LAYERS = [1, 0.75, 0.5, 0.25] as const
/** The lip is stepped through its gradient in this many bands. */
const LIP_BANDS = 5
/** Where the light line and the transmitted line sit (and the lit halo's inner half,
 *  3 px thick against the wall), as a share of the circumradius. */
const MENISCUS_SCALE = HONEY.meniscus.circumradius / HEX_RADIUS
const TRANSMITTED_SCALE = HONEY.transmitted.circumradius / HEX_RADIUS
/** A dash and its gap on the way back, in px at R = 46. */
const DASH = 4

/** The six corners, clockwise on screen, point-top by default. */
export function hexOutline(radius: number, flat: boolean, scale = 1): Pt[] {
  const out: Pt[] = []
  const base = flat ? 0 : -Math.PI / 2
  for (let i = 0; i < 6; i++) {
    const a = base + (Math.PI / 3) * i
    out.push([Math.cos(a) * radius * scale, Math.sin(a) * radius * scale])
  }
  return out
}

/** `subject` cut to the inside of the convex polygon `clip` (Sutherland-Hodgman). */
export function clipConvex(subject: readonly Pt[], clip: readonly Pt[]): Pt[] {
  let area = 0
  for (let i = 0; i < clip.length; i++) {
    const [x0, y0] = clip[i], [x1, y1] = clip[(i + 1) % clip.length]
    area += x0 * y1 - x1 * y0
  }
  const sign = area >= 0 ? 1 : -1
  let out: Pt[] = [...subject]
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length]
    const side = (p: Pt): number => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length]
      const sp = side(p), sq = side(q)
      if (sp >= 0) out.push(p)
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq)
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
  }
  return out
}

/** Everything above the wavy lip line, overshooting the hexagon on three sides. */
export function lipPolygon(radius: number, seed: number): Pt[] {
  const s = radius / HEX_RADIUS
  const reach = 1.2 * radius
  const pts: Pt[] = [[-reach, -reach], [reach, -reach]]
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const x = reach - (2 * reach * i) / steps
    pts.push([x, lipY(x / s, seed) * s])
  }
  return pts
}

const flatten = (pts: readonly Pt[]): number[] => pts.flatMap(p => [p[0], p[1]])
const strip = (top: number, bottom: number, reach: number): Pt[] => [[-reach, top], [reach, top], [reach, bottom], [-reach, bottom]]

type Paint = { color: number; alpha: number }

/** `#rrggbb`, `rgb()` and `rgba()` as a Pixi colour and alpha (Graphics wants them apart). */
export function paint(css: string): Paint {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css)
  if (rgba) return { color: (Number(rgba[1]) << 16) | (Number(rgba[2]) << 8) | Number(rgba[3]), alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  return { color: parseInt(css.replace('#', ''), 16), alpha: 1 }
}

const fill = (g: Graphics, css: string, alpha = 1): void => {
  const p = paint(css)
  g.fill({ color: p.color, alpha: p.alpha * alpha })
}
const stroke = (g: Graphics, css: string, width: number, alpha = 1): void => {
  const p = paint(css)
  g.stroke({ color: p.color, alpha: p.alpha * alpha, width, cap: 'butt', join: 'round' })
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/**
 * Draw one tile of honey into `g` (cleared first). `seed` is the slot's
 * (`ringSeed`), so the same slot looks the same on every open.
 */
export function drawHoney(g: Graphics, radius: number, flat: boolean, state: HoneyState, seed: number): void {
  const s = radius / HEX_RADIUS
  const hex = hexOutline(radius, flat)
  const { lit, back } = state
  g.clear()

  // 1. the body: layered depth, outermost layer first
  const ramp: readonly RampStop[] = back ? (lit ? BODY_BACK_LIT : BODY_BACK) : (lit ? BODY_LIT : BODY_REST)
  for (const rho of back ? BACK_LAYERS : LAYERS) {
    g.poly(flatten(hexOutline(radius, flat, rho)), true)
    g.fill({ color: paint(sampleRamp(ramp, 1 - rho * 0.93)).color, alpha: 1 })
  }

  if (back) {
    // crystallised: no lip, no drips, no light — only the dashed rim
    dashed(g, hex, DASH * s, paint(lit ? HONEY.back.rimLit : HONEY.back.rim), HONEY.back.rimWidth * s)
    return
  }

  // 2. the lit halo, inside the wall
  if (lit) {
    g.poly(flatten(hexOutline(radius, flat, MENISCUS_SCALE)), true)
    stroke(g, HONEY.lit.rim, (HONEY.lit.haloWidth / 2) * s, HONEY.lit.haloAlpha)
  }

  // 3. the pour lip: its shadow on the body, then the lip in bands
  const lip = lipPolygon(radius, seed)
  const shadow = clipConvex(lip.map(p => [p[0], p[1] + HONEY.lip.shadowDy * s] as Pt), hex)
  if (shadow.length > 2) {
    g.poly(flatten(shadow), true)
    fill(g, HONEY.lip.shadow)
  }
  const lipInHex = clipConvex(lip, hex)
  const top = -radius, bottom = -0.5 * radius
  for (let i = 0; i < LIP_BANDS; i++) {
    const band = clipConvex(lipInHex, strip(top + ((bottom - top) * i) / LIP_BANDS, i === LIP_BANDS - 1 ? radius : top + ((bottom - top) * (i + 1)) / LIP_BANDS, 2 * radius))
    if (band.length < 3) continue
    g.poly(flatten(band), true)
    fill(g, lipColour((i + 0.5) / LIP_BANDS), HONEY.lip.alpha)
  }

  // 4. the two teardrops, frozen
  const honey = slotHoney(seed)
  drip(g, honey.a, s)
  drip(g, honey.b, s)

  // 5. the meniscus and the light coming through, edge by edge
  edgeLines(g, hexOutline(radius, flat, MENISCUS_SCALE), HONEY.meniscus.color, HONEY.meniscus.width * s,
    (mid) => HONEY.meniscus.alphaMin + (HONEY.meniscus.alphaMax - HONEY.meniscus.alphaMin) * clamp01(towardLight(mid, radius)))
  edgeLines(g, hexOutline(radius, flat, TRANSMITTED_SCALE), HONEY.transmitted.color, HONEY.transmitted.width * s,
    (mid) => HONEY.transmitted.alphaMax * clamp01((-towardLight(mid, radius) - 0.35) / 0.65))

  // 6. one tapered sliver and one glint, on the lip
  const peak = (lit ? HONEY.sliver.peakLit : HONEY.sliver.peakRest) * honey.sliverScale
  const { x1, y1, x2, y2 } = HONEY.sliver
  const taper = [0.25, 0.75, 0.75, 0.25]
  for (let i = 0; i < taper.length; i++) {
    const a = i / taper.length, b = (i + 1) / taper.length
    g.moveTo((x1 + (x2 - x1) * a) * s, (y1 + (y2 - y1) * a) * s)
    g.lineTo((x1 + (x2 - x1) * b) * s, (y1 + (y2 - y1) * b) * s)
    stroke(g, HONEY.sliver.color, HONEY.sliver.width * s, peak * taper[i])
  }
  g.circle(HONEY.glint.x * s, HONEY.glint.y * s, (lit ? HONEY.glint.rLit : HONEY.glint.rRest) * s)
  fill(g, HONEY.glint.color, HONEY.glint.alpha)

  // 7. the rim: a steel hairline at rest, pale gold when lit
  g.poly(flatten(hex), true)
  if (lit) stroke(g, HONEY.lit.rim, HONEY.lit.rimWidth * s, HONEY.lit.rimAlpha)
  else stroke(g, HONEY.steel, s)
}

// ── the crafted backgrounds ───────────────────────────────────────────

export type HoneyArtFrames = { readonly rest: readonly (Texture | null)[]; readonly lit: readonly (Texture | null)[] }

/** Each variation's rest and lit frame of the atlas, cut once per drawing.
 *  Null when the atlas never became a texture; a frame is null where its
 *  variation did not draw. */
const cut = new WeakMap<HoneyArt, HoneyArtFrames>()
export function honeyArtFrames(art: HoneyArt): HoneyArtFrames | null {
  const source = art.texture?.source
  if (!source) return null
  const known = cut.get(art)
  if (known) return known
  const frame = (i: number, lit: boolean): Texture | null => {
    if (!art.ready[i]) return null
    const f = atlasFrame(i, lit)
    return new Texture({ source, frame: new Rectangle(f.x, f.y, f.width, f.height) })
  }
  const frames: HoneyArtFrames = {
    rest: art.ready.map((_, i) => frame(i, false)),
    lit: art.ready.map((_, i) => frame(i, true)),
  }
  cut.set(art, frames)
  return frames
}

/** A tile's crafted background, centred on the origin at `radius`. The picture
 *  is a point-top tile, 2R tall; a flat-top tile wears it turned 30°. */
export function honeyArtSprite(texture: Texture, radius: number, flat: boolean): Sprite {
  const sprite = new Sprite(texture)
  sprite.anchor.set(0.5)
  sprite.scale.set((2 * radius) / HONEY_ART_TILE.height)
  sprite.rotation = flat ? -Math.PI / 6 : 0
  return sprite
}

/** The hexagon a crafted background is masked to. */
export function drawHexMask(g: Graphics, radius: number, flat: boolean): void {
  g.clear()
  g.poly(flatten(hexOutline(radius, flat)), true)
  g.fill({ color: 0xffffff, alpha: 1 })
}

/** The rim alone, and the lit halo inside it: everything a tile wearing a
 *  crafted background still draws itself. */
export function drawHoneyRim(g: Graphics, radius: number, flat: boolean, lit: boolean): void {
  const s = radius / HEX_RADIUS
  g.clear()
  if (lit) {
    g.poly(flatten(hexOutline(radius, flat, MENISCUS_SCALE)), true)
    stroke(g, HONEY.lit.rim, (HONEY.lit.haloWidth / 2) * s, HONEY.lit.haloAlpha)
  }
  g.poly(flatten(hexOutline(radius, flat)), true)
  if (lit) stroke(g, HONEY.lit.rim, HONEY.lit.rimWidth * s, HONEY.lit.rimAlpha)
  else stroke(g, HONEY.steel, s)
}

// ── the light that crosses a tile ─────────────────────────────────────

/** Strips each soft edge of the band is stepped in: Graphics has no gradient
 *  along a strip, so the falloff is stepped finely enough to read as one. */
const SHEEN_SOFT_STEPS = 6

/**
 * The band of light, at full strength (1), in its own coordinates: across x it
 * is `soft`, `width`, `soft` (the DOM ring's gradient), along y long enough to
 * cross the whole tile. Drawn once; it moves by its transform alone, and its
 * strength is the Graphics' alpha (sheenAlpha).
 */
export function drawSheenBand(g: Graphics, radius: number): void {
  const s = radius / HEX_RADIUS
  const soft = SHEEN.soft * s
  const half = (SHEEN.width / 2) * s
  const length = 100 * s
  const color = paint(SHEEN.color).color
  g.clear()
  g.rect(-half, -length / 2, 2 * half, length)
  g.fill({ color, alpha: 1 })
  const step = soft / SHEEN_SOFT_STEPS
  for (let i = 0; i < SHEEN_SOFT_STEPS; i++) {
    // the strip's mean strength on a linear falloff from the core outward
    const alpha = 1 - (i + 0.5) / SHEEN_SOFT_STEPS
    g.rect(half + i * step, -length / 2, step, length)
    g.rect(-half - (i + 1) * step, -length / 2, step, length)
    g.fill({ color, alpha })
  }
}

/**
 * One region of the light (sheenZones) at `radius`, as convex pieces inside
 * the hexagon: its outer box less its inner box is four strips, and each strip
 * (or the whole box) is cut to the tile. No holes, so a mask is plain fills.
 * The pieces of every region together tile the hexagon exactly once.
 */
export function sheenZonePieces(radius: number, flat: boolean, zone: SheenZone): Pt[][] {
  const s = radius / HEX_RADIUS
  const hex = hexOutline(radius, flat)
  const far = 2 * radius
  const scaled = (r: SheenRect | null): SheenRect =>
    r ? { x0: r.x0 * s, x1: r.x1 * s, y0: r.y0 * s, y1: r.y1 * s } : { x0: -far, x1: far, y0: -far, y1: far }
  const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const o = scaled(zone.outer)
  const pieces: Pt[][] = []
  if (!zone.inner) pieces.push(box(o.x0, o.y0, o.x1, o.y1))
  else {
    const i = scaled(zone.inner)
    pieces.push(
      box(o.x0, o.y0, o.x1, i.y0), // above
      box(o.x0, i.y1, o.x1, o.y1), // below
      box(o.x0, i.y0, i.x0, i.y1), // left
      box(i.x1, i.y0, o.x1, i.y1), // right
    )
  }
  return pieces.map(piece => clipConvex(piece, hex)).filter(piece => piece.length >= 3)
}

/** One region of the light as a mask, at `radius`. */
export function drawSheenZone(g: Graphics, radius: number, flat: boolean, zone: SheenZone): void {
  g.clear()
  for (const piece of sheenZonePieces(radius, flat, zone)) g.poly(flatten(piece), true)
  g.fill({ color: 0xffffff, alpha: 1 })
}

/** The lip's gradient at `t` (0 at the top of the tile, 1 at the lip line). */
function lipColour(t: number): string {
  const stops = HONEY.lip.stops
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].offset) return mixHex(stops[i - 1].color, stops[i].color, (t - stops[i - 1].offset) / (stops[i].offset - stops[i - 1].offset))
  }
  return stops[stops.length - 1].color
}

/** How far toward the light a point lies, 1 at the middle of the top-left edge. */
function towardLight(p: Pt, radius: number): number {
  return (p[0] * HONEY_LIGHT.x + p[1] * HONEY_LIGHT.y) / (radius * Math.sqrt(3) / 2)
}

/** One teardrop: a neck flaring into the lip, a bead with a darker foot, a dark
 *  line on its shadow side and a glint on the lit one. */
function drip(g: Graphics, d: DripShape, s: number): void {
  const x = d.x * s, y0 = d.y0 * s, r = d.radius * s
  const cy = (d.y0 + d.h) * s
  const a = 1.4 * s
  const reach = cy - y0
  g.poly([
    x - 2.2 * a, y0 - s, x + 2.2 * a, y0 - s, x + 2.2 * a, y0,
    x + a, y0 + 0.3 * reach, x + a, cy, x - a, cy, x - a, y0 + 0.3 * reach, x - 2.2 * a, y0,
  ], true)
  fill(g, HONEY.lip.neck, HONEY.lip.alpha)
  g.circle(x, cy, r)
  fill(g, HONEY.bead.top)
  g.circle(x, cy + 0.3 * r, 0.68 * r)
  fill(g, HONEY.bead.bottom, 0.9)
  // the shadow side faces away from the light: the lower right
  const away = Math.atan2(-HONEY_LIGHT.y, -HONEY_LIGHT.x)
  // (an arc continues from wherever the pen last was, so lift it onto the arc first)
  const line = r - 0.008 * HEX_RADIUS * s
  g.moveTo(x + Math.cos(away - 0.9) * line, cy + Math.sin(away - 0.9) * line)
  g.arc(x, cy, line, away - 0.9, away + 0.9)
  stroke(g, '#4a2d08', 0.016 * HEX_RADIUS * s, 0.8)
  g.ellipse(x - 0.3 * r, cy - 0.38 * r, 0.3 * r, 0.2 * r)
  fill(g, HONEY.bead.glint, HONEY.bead.glintAlpha)
}

/** The six sides of `corners`, each as a line whose alpha is read at its middle. */
function edgeLines(g: Graphics, corners: readonly Pt[], css: string, width: number, alphaAt: (mid: Pt) => number): void {
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length]
    // three pieces a side, so the light grades along an edge rather than stepping at the corners
    for (let k = 0; k < 3; k++) {
      const t0 = k / 3, t1 = (k + 1) / 3
      const p0: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]
      const p1: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]
      const alpha = alphaAt([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2])
      if (alpha < 0.01) continue
      g.moveTo(p0[0], p0[1])
      g.lineTo(p1[0], p1[1])
      stroke(g, css, width, alpha)
    }
  }
}

/** The perimeter in dashes, `dash` on and `dash` off, as one stroke. */
function dashed(g: Graphics, corners: readonly Pt[], dash: number, p: Paint, width: number): void {
  let on = true
  let left = dash
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    let at = 0
    while (at < length) {
      const run = Math.min(left, length - at)
      if (on) {
        g.moveTo(a[0] + ((b[0] - a[0]) * at) / length, a[1] + ((b[1] - a[1]) * at) / length)
        g.lineTo(a[0] + ((b[0] - a[0]) * (at + run)) / length, a[1] + ((b[1] - a[1]) * (at + run)) / length)
      }
      at += run
      left -= run
      if (left <= 1e-6) { on = !on; left = dash }
    }
  }
  g.stroke({ color: p.color, alpha: p.alpha, width })
}
