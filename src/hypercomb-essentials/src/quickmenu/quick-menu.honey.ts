// quickmenu/quick-menu.honey.ts
//
// The honey material of the quick menu, as numbers. Pure: no DOM, no clock, no
// randomness that is not a function of its inputs, so a tile looks the same on
// every open and every line here can be tested without a browser.
//
// ── One material, two renderers ───────────────────────────────────────
//
// Each option in the ring is a slab of dark, clear buckwheat honey set into the
// cold ink-and-steel chrome. This module carries the numbers for the ring's
// inline SVG; the hexagon shader that draws the Alt flower duplicates the same
// values as GLSL literals (HONEY_*) and points back here, so the two read as one
// object. Colours are plain constants, not theme tokens — honey is honey in
// every theme; the only thing that follows the theme is the contact edge
// (`--md-is-light`), which the overlay reads once at warm.
//
// ── The five cues, and nothing else ───────────────────────────────────
//
//   1. a depth ramp, near black at the rim and deep amber at the centre
//   2. a thick pour lip across the top whose wavy lower edge lets two small
//      teardrops hang beside the icon — never through it
//   3. a meniscus (dark rim, a thin light line inset 1.5 px, brightest toward
//      the light) and a warm transmitted line low-right
//   4. one tapered specular sliver and one glint, both on the lip
//   5. one very small warm bloom low-right
//
// Everything is calm and frozen at rest. Lit is unmistakable: the body lifts to
// bright amber, the rim turns pale gold, the ink flips from cream to near
// black, and the lit tile alone has ONE slow drip. The drip is a periodic
// function of time, so reduced motion, a stopped clock and a hidden tab all
// show a finished picture (u = 0 is the full static look).
//
// ── Units ─────────────────────────────────────────────────────────────
//
// R is the hexagon circumradius. The ring draws at R = 46 px, so 1 px is
// 0.0217 R. Hexagons are point-top, y grows downward, the top is negative.
// Light comes from the top-left: HONEY_LIGHT is the unit vector TOWARD the
// light, the outward normal of the top-left hexagon edge.

import { HEX_RADIUS, QUICK_MENU_RING, type QuickMenuDirection } from './quick-menu.types.js'
import { iconPath } from './quick-menu.icons.js'

const R = HEX_RADIUS
const SQRT3_2 = Math.sqrt(3) / 2
const TAU = Math.PI * 2

/** Unit vector toward the light, y down: the normal of the top-left edge. */
export const HONEY_LIGHT = { x: -0.5, y: -SQRT3_2 } as const

/** Inradius: the distance from the centre to the middle of a flat edge. */
export const HONEY_INRADIUS = R * SQRT3_2

// ── glyph names the injected cells wear ───────────────────────────────

/** The way-back cell in a nested ring. */
export const backIcon = 'arrow_back'
/** The armed centre. */
export const cancelIcon = 'close'
/** A slot with no label at all. */
export const emptyIcon = 'more_horiz'

/** The ring's drawing for a glyph name, or undefined when it has none (then the
 *  slot is text-only: the word itself is the identity, never a stand-in). */
export function slotGlyph(name: string | undefined): string | undefined {
  return iconPath(name)
}

// ── colour arithmetic ─────────────────────────────────────────────────

export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function rgbToHex(rgb: Rgb): string {
  return '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
}

/** Linear mix in sRGB, the way SVG gradients and the shader both interpolate. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b)
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const lin = hexToRgb(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ── ramps ─────────────────────────────────────────────────────────────

/** Radial depth `dd = 1 - |p| / R`: 0 at a corner, 0.134 at the middle of a
 *  flat edge, 1 at the centre. The same coordinate in both renderers. */
export type RampStop = readonly [dd: number, color: string]

/** BODY, REST: almost black at the rim, deep amber at the centre. */
export const BODY_REST: readonly RampStop[] = [
  [0, '#1d1204'], [0.134, '#1d1204'], [0.186, '#2b1a05'], [0.29, '#4a2d08'],
  [0.524, '#7d4d0c'], [0.783, '#86520e'], [1, '#8c5810'],
]

/** BODY, LIT: about 2.7x the luminance of rest, so lit survives greyscale. */
export const BODY_LIT: readonly RampStop[] = [
  [0, '#3a2406'], [0.134, '#3a2406'], [0.186, '#6b4309'], [0.29, '#a8700f'],
  [0.524, '#cf9322'], [0.783, '#e0a62f'], [1, '#e3a42e'],
]

/** BACK: crystallised honey. */
export const BODY_BACK: readonly RampStop[] = [[0, '#2a1c06'], [0.134, '#2a1c06'], [1, '#3b2809']]
export const BODY_BACK_LIT: readonly RampStop[] = [[0, '#2f200a'], [0.134, '#2f200a'], [1, '#4d3510']]

/** CANCEL: burnt honey. The one state that leaves amber; it stays warm brick. */
export const BODY_CANCEL: readonly RampStop[] = [[0, '#3a0f08'], [0.134, '#3a0f08'], [0.6, '#7a2412'], [1, '#7a2412']]

/** Colour of a ramp at depth `dd`, piecewise linear in sRGB. */
export function sampleRamp(ramp: readonly RampStop[], dd: number): string {
  if (dd <= ramp[0][0]) return ramp[0][1]
  for (let i = 1; i < ramp.length; i++) {
    if (dd <= ramp[i][0]) {
      const [d0, c0] = ramp[i - 1], [d1, c1] = ramp[i]
      return mixHex(c0, c1, (dd - d0) / (d1 - d0))
    }
  }
  return ramp[ramp.length - 1][1]
}

export type GradientStop = { readonly offset: number; readonly color: string; readonly opacity?: number }

const trim = (v: number): number => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** A radial gradient's stops (userSpaceOnUse, r = R) for a depth ramp: offset = 1 - dd. */
export function radialStops(ramp: readonly RampStop[]): GradientStop[] {
  return ramp.map(([dd, color]) => ({ offset: trim(1 - dd), color })).reverse()
}

// ── palette ───────────────────────────────────────────────────────────

export const HONEY = {
  /** Body is a touch see-through; the page's own tile alpha multiplies on top. */
  bodyAlpha: 0.92,
  backAlpha: 0.88,

  /** The warm bloom, low right, off the label. */
  bloom: {
    color: '#f0b445',
    cx: 0.3 * R, cy: 0.72 * R, r: 21,
    stops: [
      { offset: 0, alpha: 0.16 }, { offset: 0.35, alpha: 0.124 },
      { offset: 0.7, alpha: 0.058 }, { offset: 1, alpha: 0 },
    ],
  },

  /** The pour lip, top to the lip line; pads below, so neck and drips are the last stop. */
  lip: {
    y1: -R, y2: -0.5 * R,
    stops: [{ offset: 0, color: '#5a3809' }, { offset: 0.45, color: '#a8700f' }, { offset: 1, color: '#c28418' }] as GradientStop[],
    alpha: 0.92,
    neck: '#c28418',
    shadow: 'rgba(20,12,2,0.35)',
    shadowDy: 1.5,
  },
  bead: {
    top: '#c28418', bottom: '#a8700f', glint: '#fff3c9', glintAlpha: 0.6,
    /** A thin dark line hugging each bead's shadow side: it is what keeps a drip readable on the lit body. */
    shade: '#4a2d08', shadeAlpha: 0.8, shadeWidth: 0.016 * R,
  },

  /** Light line inset 1.5 px, brightest toward the light. */
  meniscus: {
    color: '#ffe2a0', width: 1, circumradius: 44.27,
    alphaMin: 0.1, alphaMax: 0.55,
    x2: HONEY_LIGHT.x * HONEY_INRADIUS, y2: HONEY_LIGHT.y * HONEY_INRADIUS,
  },
  /** Warm light coming through, bottom-right. */
  transmitted: {
    color: '#e8a22c', width: 1.2, circumradius: 43,
    alphaMax: 0.25,
    x2: -HONEY_LIGHT.x * HONEY_INRADIUS, y2: -HONEY_LIGHT.y * HONEY_INRADIUS,
  },

  /** One tapered sliver and one glint, both on the lip and clear of the glyphs. */
  sliver: {
    x1: -0.138 * R, y1: -0.839 * R, x2: -0.658 * R, y2: -0.539 * R,
    width: 0.048 * R, color: '#fff3c9', peakRest: 0.55, peakLit: 0.75,
  },
  glint: { x: -0.398 * R, y: -0.689 * R, rRest: 0.028 * R, rLit: 0.035 * R, color: '#fffaf0', alpha: 0.8 },

  /** The outermost hairline, and the contact edge on light themes. */
  steel: 'rgba(201,149,58,0.55)',
  steelLight: 'rgba(58,37,0,0.35)',
  contact: { color: 'rgba(20,12,2,0.28)', dy: 1.5 },

  lit: { rim: '#ffd98a', rimAlpha: 0.95, rimWidth: 1.6, haloWidth: 6, haloAlpha: 0.22 },
  back: { rim: 'rgba(255,217,138,0.45)', rimLit: 'rgba(255,217,138,0.85)', rimWidth: 1.25, dash: '4 4' },
  cancel: { rim: '#e0553a', rimWidth: 1.5 },

  ink: { rest: '#fff1cf', lit: '#1a1003', back: '#e6d4a8', cancel: '#ffe6dc' },
} as const

// ── geometry ──────────────────────────────────────────────────────────

/** Point-top hexagon outline at `circumradius`, centred on the origin. */
export function hexPoints(circumradius: number): string {
  return [30, 90, 150, 210, 270, 330]
    .map(deg => {
      const rad = (deg * Math.PI) / 180
      return `${(Math.cos(rad) * circumradius).toFixed(2)},${(Math.sin(rad) * circumradius).toFixed(2)}`
    })
    .join(' ')
}

const n2 = (v: number): string => {
  const r = Math.round(v * 100) / 100
  return String(Object.is(r, -0) ? 0 : r)
}

// ── seeds ─────────────────────────────────────────────────────────────

const fract = (v: number): number => v - Math.floor(v)

/** FNV-1a over the menu name. */
export function menuHash(name: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 0 for the centre, 1..6 around the ring in screen-angle order. */
export function slotIndexOf(direction: QuickMenuDirection): number {
  return direction === 'centre' ? 0 : QUICK_MENU_RING.indexOf(direction) + 1
}

/** The same slot looks the same on every open: a function of position and menu only. */
export function ringSeed(slotIndex: number, menuName: string): number {
  return fract((slotIndex * 7 + (menuHash(menuName) % 97)) * 0.6180339)
}

/** The lip line: -0.50 R with a 0.03 R wave. Tiles differ only by phase. */
export function lipY(x: number, seed: number): number {
  return -0.5 * R + 0.03 * R * Math.sin((2.1 * x) / R + TAU * seed)
}

/** Neck half-width where it leaves the lip, in px. */
const NECK = 1.4

export interface DripShape {
  /** Where the neck leaves the lip. */
  readonly x: number
  /** The lip line at x. */
  readonly y0: number
  /** Lip line to the bottom of the bead. */
  readonly length: number
  /** Bead radius. */
  readonly radius: number
  /** Lip line to the bead's centre: length - radius. */
  readonly h: number
}

export interface SlotHoney {
  readonly seed: number
  /** Drip A is part of the lip path and frozen; drip B is its own group and the animated one. */
  readonly a: DripShape
  readonly b: DripShape
  readonly mirrored: boolean
  /** Specular sliver alpha scale, 0.85 to 1. */
  readonly sliverScale: number
}

function dripAt(x: number, h: number, seed: number): DripShape {
  const length = 0.12 * R + 0.1 * R * h
  const radius = 0.056 * R + 0.02 * R * h
  return { x, y0: lipY(x, seed), length, radius, h: length - radius }
}

/** The two teardrops of a tile: A on the left, B on the right, swapped when seed > 0.5. */
export function slotHoney(seed: number): SlotHoney {
  const hA = fract(seed * 3.7 + 0.13)
  const hB = fract(seed * 6.0 + 0.57)
  const mirrored = seed > 0.5
  const side = mirrored ? 1 : -1
  const xA = side * 0.5 * R + 0.05 * R * (2 * hA - 1)
  const xB = -side * 0.5 * R + 0.05 * R * (2 * hB - 1)
  return {
    seed,
    a: dripAt(xA, hA, seed),
    b: dripAt(xB, hB, seed),
    mirrored,
    sliverScale: 0.85 + 0.15 * fract(seed * 9.7 + 0.31),
  }
}

// ── paths ─────────────────────────────────────────────────────────────

type Pt = readonly [number, number]

/** Catmull-Rom through `points`, as cubic segments after the first point. */
function smooth(points: readonly Pt[]): string {
  let d = ''
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    d += `C${n2(p1[0] + (p2[0] - p0[0]) / 6)} ${n2(p1[1] + (p2[1] - p0[1]) / 6)} ${n2(p2[0] - (p3[0] - p1[0]) / 6)} ${n2(p2[1] - (p3[1] - p1[1]) / 6)} ${n2(p2[0])} ${n2(p2[1])}`
  }
  return d
}

/**
 * A teardrop hanging from the lip, traced left to right with the neck flaring
 * into the bead and the bead round at the bottom. It starts where the caller is
 * already standing, (x - 2.2a, the lip line there), and ends at (x + 2.2a, yR).
 */
export function dripOutline(drip: DripShape, yR: number = drip.y0): string {
  const { x, y0, radius: r, h } = drip
  const a = NECK
  const y1 = y0 + h
  return (
    `Q${n2(x - a)} ${n2(y0 + 0.25 * h)} ${n2(x - a)} ${n2(y0 + 0.5 * h)}` +
    `C${n2(x - a)} ${n2(y0 + 0.8 * h)} ${n2(x - r)} ${n2(y1 - 0.4 * r)} ${n2(x - r)} ${n2(y1)}` +
    `A${n2(r)} ${n2(r)} 0 0 0 ${n2(x + r)} ${n2(y1)}` +
    `C${n2(x + r)} ${n2(y1 - 0.4 * r)} ${n2(x + a)} ${n2(y0 + 0.8 * h)} ${n2(x + a)} ${n2(y0 + 0.5 * h)}` +
    `Q${n2(x + a)} ${n2(y0 + 0.25 * h)} ${n2(x + 2.2 * a)} ${n2(yR)}`
  )
}

/**
 * The lip: everything above the wavy line, with drip A spliced into its lower
 * edge. Overshoots the hexagon on three sides; the caller clips it to the hex.
 */
export function lipPath(honey: SlotHoney): string {
  const seed = honey.seed
  const drip = honey.a
  const edge = 2.2 * NECK
  const xL = drip.x - edge, xR = drip.x + edge
  const reach = R + 1
  const step = 8
  const left: Pt[] = []
  for (let x = -reach; x < xL - 3; x += step) left.push([x, lipY(x, seed)])
  left.push([xL, lipY(xL, seed)])
  const right: Pt[] = [[xR, lipY(xR, seed)]]
  let x = -reach
  while (x <= xR + 3) x += step
  for (; x < reach; x += step) right.push([x, lipY(x, seed)])
  right.push([reach, lipY(reach, seed)])

  return (
    `M${n2(-reach)} ${n2(-reach)}L${n2(left[0][0])} ${n2(left[0][1])}` +
    smooth(left) +
    dripOutline(drip, right[0][1]) +
    smooth(right) +
    `L${n2(reach)} ${n2(-reach)}Z`
  )
}

/** The arc along a bead's shadow side, bottom and right, away from the light. */
export function beadShade(cx: number, cy: number, r: number): string {
  const from = (-10 * Math.PI) / 180, to = (150 * Math.PI) / 180
  return (
    `M${n2(cx + r * Math.cos(from))} ${n2(cy + r * Math.sin(from))}` +
    `A${n2(r)} ${n2(r)} 0 0 1 ${n2(cx + r * Math.cos(to))} ${n2(cy + r * Math.sin(to))}`
  )
}

/**
 * The animated teardrop's neck: a flared root that meets the lip's lower edge
 * (half a pixel of overlap, no more: above the edge the lip is a different
 * shade), a thread, and shoulders that disappear under the bead. Scales about
 * (x, y0).
 */
export function neckPath(drip: DripShape): string {
  const { x, y0, radius: r, h } = drip
  const a = NECK
  const y1 = y0 + h
  const s = 0.85 * r
  return (
    `M${n2(x - 2.2 * a)} ${n2(y0 - 0.5)}L${n2(x + 2.2 * a)} ${n2(y0 - 0.5)}L${n2(x + 2.2 * a)} ${n2(y0)}` +
    `Q${n2(x + a)} ${n2(y0 + 0.25 * h)} ${n2(x + a)} ${n2(y0 + 0.5 * h)}` +
    `C${n2(x + a)} ${n2(y0 + 0.8 * h)} ${n2(x + s)} ${n2(y1 - 0.5 * r)} ${n2(x + s)} ${n2(y1 - 0.2 * r)}` +
    `L${n2(x - s)} ${n2(y1 - 0.2 * r)}` +
    `C${n2(x - s)} ${n2(y1 - 0.5 * r)} ${n2(x - a)} ${n2(y0 + 0.8 * h)} ${n2(x - a)} ${n2(y0 + 0.5 * h)}` +
    `Q${n2(x - a)} ${n2(y0 + 0.25 * h)} ${n2(x - 2.2 * a)} ${n2(y0)}Z`
  )
}

// ── the drip, as a periodic function of time ──────────────────────────

/** One slow cycle. The shader reads u = fract(time / 11). */
export const DRIP_PERIOD_S = 11

/** How far the animated drip travels, in px (R fractions: 0.10, 0.14, 0.30). */
const SWELL_PX = 0.1 * R
const NECK_PX = 0.14 * R
const FALL_PX = 0.3 * R
const BEAD_GROW = 1.35

/** Timeline breakpoints as fractions of the period. */
export const DRIP_AT = { swellFrom: 0.1, swellTo: 0.38, neckTo: 0.52, pinchTo: 0.58, fallTo: 0.85 } as const

const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2
const easeInCubic = (t: number): number => t * t * t
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface DripPose {
  /** Neck scale: x narrows to a thread, y follows the bead down. */
  readonly neckSx: number
  readonly neckSy: number
  /** Bead (and its glint) drop and swell. */
  readonly beadDy: number
  readonly beadScale: number
  /** The whole neck+bead group regrowing from the lip. */
  readonly groupScale: number
  readonly groupOpacity: number
  /** The falling drop. */
  readonly blobOpacity: number
  readonly blobDy: number
  readonly blobSx: number
  readonly blobSy: number
}

/** Fall of the blob at `tau` in 0..1. */
export function blobFall(tau: number): { opacity: number; dy: number; sx: number; sy: number } {
  const sx = 1 - 0.3 * tau
  return {
    opacity: 1 - smoothstep(0.45, 0.85, tau),
    dy: FALL_PX * Math.pow(tau, 1.6),
    sx,
    sy: sx * (1 + 0.25 * Math.sin(Math.PI * tau)),
  }
}

/**
 * The animated teardrop at cycle position `u` (0..1). Rest holds for the first
 * tenth; the bead swells, the neck draws out and thins, pinches off at 0.58 and
 * the drop falls while the root regrows. u = 0 and u = 1 are the same picture.
 */
export function dripPose(u: number, h: number): DripPose {
  const t = fract(u)
  const rest: DripPose = {
    neckSx: 1, neckSy: 1, beadDy: 0, beadScale: 1, groupScale: 1, groupOpacity: 1,
    blobOpacity: 0, blobDy: 0, blobSx: 1, blobSy: 1,
  }
  if (t < DRIP_AT.swellFrom) return rest
  if (t < DRIP_AT.swellTo) {
    const e = easeInOutSine((t - DRIP_AT.swellFrom) / (DRIP_AT.swellTo - DRIP_AT.swellFrom))
    const dy = SWELL_PX * e
    return { ...rest, beadDy: dy, beadScale: 1 + (BEAD_GROW - 1) * e, neckSy: 1 + dy / h }
  }
  if (t < DRIP_AT.neckTo) {
    const e = easeInCubic((t - DRIP_AT.swellTo) / (DRIP_AT.neckTo - DRIP_AT.swellTo))
    const dy = SWELL_PX + (NECK_PX - SWELL_PX) * e
    return { ...rest, beadDy: dy, beadScale: BEAD_GROW, neckSy: 1 + dy / h, neckSx: 1 - 0.6 * e }
  }
  if (t < DRIP_AT.pinchTo) {
    const p = (t - DRIP_AT.neckTo) / (DRIP_AT.pinchTo - DRIP_AT.neckTo)
    return { ...rest, beadDy: NECK_PX, beadScale: BEAD_GROW, neckSy: 1 + NECK_PX / h, neckSx: 0.4 - 0.25 * p }
  }
  const g = easeOutCubic((t - DRIP_AT.pinchTo) / (1 - DRIP_AT.pinchTo))
  const tau = (t - DRIP_AT.pinchTo) / (DRIP_AT.fallTo - DRIP_AT.pinchTo)
  const fall = tau < 1 ? blobFall(tau) : { opacity: 0, dy: FALL_PX, sx: 0.7, sy: 0.7 }
  return {
    ...rest,
    groupScale: 0.35 + 0.65 * g,
    groupOpacity: g,
    blobOpacity: fall.opacity,
    blobDy: fall.dy,
    blobSx: fall.sx,
    blobSy: fall.sy,
  }
}

/** Per-slot custom properties for the neck's scale: (h + 4.6) / h and (h + 6.4) / h. */
export function neckScales(h: number): { swell: number; neck: number } {
  return { swell: (h + SWELL_PX) / h, neck: (h + NECK_PX) / h }
}

/** Where the falling drop starts: the bead's pinched position and size. */
export function blobStart(drip: DripShape): { cx: number; cy: number; r: number } {
  return { cx: drip.x, cy: drip.y0 + drip.h + NECK_PX, r: drip.radius * BEAD_GROW }
}

// ── the stylesheet ────────────────────────────────────────────────────

/** Id of the one document stylesheet, created once at warm. */
export const HONEY_STYLE_ID = 'hc-qm-drip-style'

const pct = (u: number): string => `${Math.round(u * 10000) / 100}%`

/**
 * Everything the ring needs from CSS: the lit-tile drip keyframes (transform and
 * opacity only), the lit crossfade, reduced motion, and forced colours. The
 * keyframes are generated from the same constants as dripPose, so the CSS cannot
 * drift from the shader's timeline.
 */
export function honeyStyleSheet(): string {
  const T = DRIP_AT
  const hold = pct(T.pinchTo - 0.0001)
  const swell = 'cubic-bezier(.37,0,.63,1)'
  const draw = 'cubic-bezier(.32,0,.67,0)'
  const regrow = 'cubic-bezier(.33,1,.68,1)'

  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map(tau => ({ u: T.pinchTo + (T.fallTo - T.pinchTo) * tau, ...blobFall(tau) }))
  const blob = samples
    .map(s => `${pct(s.u)}{opacity:${n2(s.opacity)};transform:translateY(${n2(s.dy)}px) scale(${n2(s.sx)},${n2(s.sy)})}`)
    .join('')

  const dur = `${DRIP_PERIOD_S}s linear infinite`
  const sel = '#hc-quick-menu'
  return [
    `${sel} .hc-qm-lit{transition:opacity 90ms linear}`,
    `${sel} .hc-qd-drip,${sel} .hc-qd-neck,${sel} .hc-qd-bead,${sel} .hc-qd-glint,${sel} .hc-qd-blob{transform-box:view-box}`,
    `${sel} .hc-qd-run .hc-qd-drip{animation:hc-qd-regrow ${dur}}`,
    `${sel} .hc-qd-run .hc-qd-neck{animation:hc-qd-neck ${dur}}`,
    `${sel} .hc-qd-run .hc-qd-bead,${sel} .hc-qd-run .hc-qd-glint{animation:hc-qd-bead ${dur}}`,
    `${sel} .hc-qd-run .hc-qd-blob{animation:hc-qd-blob ${dur}}`,

    `@keyframes hc-qd-regrow{0%,${hold}{transform:scale(1);opacity:1}` +
      `${pct(T.pinchTo)}{transform:scale(.35);opacity:0;animation-timing-function:${regrow}}100%{transform:scale(1);opacity:1}}`,

    `@keyframes hc-qd-neck{0%,${pct(T.swellFrom)}{transform:scale(1,1);animation-timing-function:${swell}}` +
      `${pct(T.swellTo)}{transform:scale(1,var(--sy-swell,1.5));animation-timing-function:${draw}}` +
      `${pct(T.neckTo)}{transform:scale(.4,var(--sy-neck,1.7));animation-timing-function:linear}` +
      `${hold}{transform:scale(.15,var(--sy-neck,1.7))}` +
      `${pct(T.pinchTo)},100%{transform:scale(1,1)}}`,

    `@keyframes hc-qd-bead{0%,${pct(T.swellFrom)}{transform:translateY(0) scale(1);animation-timing-function:${swell}}` +
      `${pct(T.swellTo)}{transform:translateY(${n2(SWELL_PX)}px) scale(${BEAD_GROW});animation-timing-function:${draw}}` +
      `${pct(T.neckTo)},${hold}{transform:translateY(${n2(NECK_PX)}px) scale(${BEAD_GROW})}` +
      `${pct(T.pinchTo)},100%{transform:translateY(0) scale(1)}}`,

    `@keyframes hc-qd-blob{0%,${hold}{opacity:0;transform:translateY(0) scale(1,1)}${blob}100%{opacity:0;transform:translateY(${n2(FALL_PX)}px) scale(.7,.7)}}`,

    // Meaning is never carried by motion alone: lit is rim, luminance and ink.
    `@media (prefers-reduced-motion: reduce){` +
      `${sel} .hc-qd-run .hc-qd-drip,${sel} .hc-qd-run .hc-qd-neck,${sel} .hc-qd-run .hc-qd-bead,` +
      `${sel} .hc-qd-run .hc-qd-glint,${sel} .hc-qd-run .hc-qd-blob{animation:none !important}` +
      `${sel} .hc-qm-lit{transition:none}}`,

    // Forced colours: no honey, a plain outline, system text.
    `@media (forced-colors: active){` +
      `${sel} .hc-hq,${sel} .hc-qm-lit,${sel} .hc-qm-shadow{display:none !important}` +
      `${sel} .hc-qd-run .hc-qd-drip,${sel} .hc-qd-run .hc-qd-neck,${sel} .hc-qd-run .hc-qd-bead,` +
      `${sel} .hc-qd-run .hc-qd-glint,${sel} .hc-qd-run .hc-qd-blob{animation:none !important}` +
      `${sel} .hc-qm-base{fill:Canvas !important}` +
      `${sel} .hc-qm-rim{stroke:CanvasText !important}` +
      `${sel} .hc-qm-ink{fill:CanvasText !important}}`,
  ].join('\n')
}

// ── labels ────────────────────────────────────────────────────────────

export const LAYOUT = {
  /** Ring cell: a 24 px icon above a label. */
  ring: { iconX: -12, iconY: -21, iconScale: 1, labelY: 19, labelSize: 11.5 },
  /** Centre cell: a 28 px icon, the same label size. */
  centre: { iconX: -14, iconY: -24, iconScale: 28 / 24, labelY: 21, labelSize: 11.5 },
  /** No glyph: the word alone, centred. */
  textOnly: { labelY: 4.5, labelSize: 13 },
  /** Width a label may take under an icon, and with no icon. */
  usableIcon: 65,
  usableText: 70,
  floorSize: 9,
  letterSpacing: 0.02,
} as const

export interface LabelFit {
  /** Font size in px. */
  readonly size: number
  /** Set only as the last resort: force the label to this width. */
  readonly textLength?: number
}

export type Measure = (text: string, size: number) => number

/** Width of `text` set at `size` from its glyph count and class. Used when no
 *  canvas is at hand and on the gesture, where nothing may be measured. */
export function estimateWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x2e80) em += 1
    else if ('ijltfI.,:;!| '.includes(ch)) em += 0.3
    else if ('mwMW'.includes(ch)) em += 0.85
    else if (code >= 65 && code <= 90) em += 0.62
    else em += 0.52
  }
  return em * size + LAYOUT.letterSpacing * size * [...text].length
}

/** Shrink `text` to `usable` px: first by font size to the floor, then by textLength.
 *  `stretch` false is for a measure that is only a guess (estimateWidth): a
 *  textLength set from a wrong width squeezes or stretches every glyph, so the
 *  guess may shrink the size and nothing more. */
export function fitLabel(
  text: string,
  base: number,
  usable: number,
  measure: Measure = estimateWidth,
  stretch = true,
): LabelFit {
  if (!text) return { size: base }
  const width = measure(text, base)
  if (width <= usable) return { size: base }
  const size = Math.max(LAYOUT.floorSize, Math.round(((base * usable) / width) * 100) / 100)
  if (measure(text, size) <= usable + 0.5) return { size }
  return stretch ? { size: LAYOUT.floorSize, textLength: usable } : { size: LAYOUT.floorSize }
}
