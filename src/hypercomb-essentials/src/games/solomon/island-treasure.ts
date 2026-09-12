// A chest opening, played on a small stage in the chest's dialog: the chest
// shakes, the lid swings back in a burst of light, and what was inside rises
// out and settles above it, gently bobbing. A chest opened before skips
// straight to that settled scene. Flat colour, one shade and a fat ink
// outline — the same cartoon language as the walkers.
//
// `playGainReveal` is the same idea generalised to every kind of reveal, not
// only a chest: one item, a relic piece, a place, or a glyph rising and
// settling alone, no chest prop beneath it. `GainArt`'s cases are additive —
// a future case (the labyrinth's combat skills) rides the same union and the
// same dispatch, unchanged here.

import { drawPlace, type PlaceSprite } from './island-places.js'
import type { CombatSkillId } from './engine.js'

export type TreasureKind = 'note' | 'gem' | 'coins' | 'feather' | 'key' | 'great-key' | 'map' | 'lodestone' | 'lantern'

const INK = '#1c1230'
const TAU = Math.PI * 2
const WIDE = 240, HIGH = 130
const SETTLED = 3

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)
const easeBack = (t: number): number => 1 + 2.9 * Math.pow(t - 1, 3) + 1.9 * Math.pow(t - 1, 2)

/** Starts the reveal on a canvas of any size (drawn on a 240 × 130 stage); returns a stop function. */
export function playChestReveal(ctx: CanvasRenderingContext2D, items: readonly TreasureKind[], animate: boolean): () => void {
  const skip = animate ? 0 : SETTLED
  if (typeof requestAnimationFrame !== 'function') {
    paintReveal(ctx, items, SETTLED)
    return () => undefined
  }
  let frame = 0, start = -1, stopped = false
  const tick = (now: number): void => {
    if (stopped) return
    if (start < 0) start = now
    paintReveal(ctx, items, (now - start) / 1000 + skip)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => {
    stopped = true
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  }
}

function paintReveal(ctx: CanvasRenderingContext2D, items: readonly TreasureKind[], t: number): void {
  const { width, height } = ctx.canvas
  ctx.setTransform(width / WIDE, 0, 0, height / HIGH, 0, 0)
  ctx.clearRect(0, 0, WIDE, HIGH)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const cx = WIDE / 2, floor = 118
  const open = easeOut(clamp01((t - 0.5) / 0.3))
  if (open > 0) {
    const glow = ctx.createRadialGradient(cx, floor - 36, 4, cx, floor - 36, 115)
    glow.addColorStop(0, `rgba(255, 226, 140, ${0.55 * open})`)
    glow.addColorStop(1, 'rgba(255, 226, 140, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, WIDE, HIGH)
    ctx.save()
    ctx.translate(cx, floor - 40)
    ctx.rotate(t * 0.25)
    ctx.fillStyle = `rgba(255, 236, 170, ${0.2 * open})`
    for (let k = 0; k < 12; k++) {
      ctx.rotate(TAU / 12)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-7, -125)
      ctx.lineTo(7, -125)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.beginPath()
  ctx.ellipse(cx, floor + 3, 46, 6, 0, 0, TAU)
  ctx.fill()
  ctx.save()
  ctx.translate(t < 0.5 ? Math.sin(t * 70) * (0.5 - t) * 5 : 0, 0)
  chest(ctx, cx, floor, open)
  ctx.restore()
  items.forEach((kind, index) => {
    const progress = clamp01((t - (0.85 + index * 0.22)) / 0.55)
    if (progress <= 0) return
    const targetX = cx + (index - (items.length - 1) / 2) * 52
    const x = cx + (targetX - cx) * easeOut(progress)
    const y = (floor - 42) + (36 - (floor - 42)) * easeBack(progress) + (progress >= 1 ? Math.sin(t * 2.2 + index) * 2 : 0)
    ctx.fillStyle = `rgba(255, 244, 200, ${0.8 * (1 - progress)})`
    for (let s = 0; s < 4; s++) ctx.fillRect(x + Math.sin(index * 3 + s * 1.7) * 10, y + 12 + s * 7, 2, 2)
    ctx.save()
    ctx.translate(x, y)
    const scale = 0.35 + 0.65 * easeOut(progress)
    ctx.scale(scale, scale)
    drawItem(ctx, kind)
    ctx.restore()
  })
  if (t > 1.6) {
    ctx.fillStyle = 'rgba(255, 250, 220, 0.9)'
    for (let k = 0; k < 6; k++) {
      const phase = (t * 0.8 + k * 0.37) % 1
      const size = Math.sin(phase * Math.PI) * 2.4
      const gx = cx - 95 + ((k * 53) % 190), gy = 14 + ((k * 29) % 44)
      ctx.fillRect(gx - size, gy - 0.4, size * 2, 0.8)
      ctx.fillRect(gx - 0.4, gy - size, 0.8, size * 2)
    }
  }
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function ink(ctx: CanvasRenderingContext2D, width = 2): void {
  ctx.strokeStyle = INK
  ctx.lineWidth = width
  ctx.stroke()
}

/** Closed, the lid is a dome on the chest; opening, it swings back and
 *  stands behind the body, foreshortened, showing the lit inside. */
function chest(ctx: CanvasRenderingContext2D, cx: number, floor: number, open: number): void {
  const w = 72, h = 36, left = cx - w / 2, top = floor - h
  const lid = (): void => {
    const upper = top - 16 - 26 * open, lower = top - 2 * open, inset = 2 + 6 * open
    ctx.beginPath()
    ctx.moveTo(left + inset, lower)
    ctx.lineTo(left + inset, upper + 8)
    ctx.quadraticCurveTo(cx, upper - 6 * (1 - open), left + w - inset, upper + 8)
    ctx.lineTo(left + w - inset, lower)
    ctx.closePath()
    ctx.fillStyle = open > 0.5 ? '#7c5230' : '#b98148'
    ctx.fill()
    ink(ctx)
    for (const bx of [left + inset + 8, left + w - inset - 16]) {
      ctx.beginPath()
      ctx.rect(bx, upper + 4, 8, lower - upper - 4)
      ctx.fillStyle = '#f0cc62'
      ctx.fill()
      ink(ctx, 1.5)
    }
  }
  if (open >= 0.5) lid()
  if (open > 0) {
    ctx.fillStyle = '#2a1a0e'
    ctx.fillRect(left + 4, top - 8 * open, w - 8, 10 * open + 2)
    ctx.fillStyle = `rgba(255, 214, 110, ${open})`
    ctx.beginPath()
    ctx.ellipse(cx, top + 1, w / 2 - 10, 3.5 * open, 0, 0, TAU)
    ctx.fill()
  }
  rounded(ctx, left, top, w, h, 5)
  ctx.fillStyle = '#9c6a3c'
  ctx.fill()
  ctx.save()
  rounded(ctx, left, top, w, h, 5)
  ctx.clip()
  ctx.fillStyle = 'rgba(20, 16, 70, 0.28)'
  ctx.fillRect(cx + 12, top, w, h)
  ctx.fillStyle = 'rgba(40, 24, 12, 0.35)'
  ctx.fillRect(left, top + 12, w, 1.5)
  ctx.fillRect(left, top + 24, w, 1.5)
  ctx.restore()
  rounded(ctx, left, top, w, h, 5)
  ink(ctx)
  for (const bx of [left + 10, left + w - 18]) {
    ctx.beginPath()
    ctx.rect(bx, top, 8, h)
    ctx.fillStyle = '#f0cc62'
    ctx.fill()
    ink(ctx, 1.5)
  }
  if (open < 0.5) {
    lid()
    rounded(ctx, cx - 7, top - 3, 14, 14, 3)
    ctx.fillStyle = '#f3d98a'
    ctx.fill()
    ink(ctx, 1.5)
    ctx.fillStyle = INK
    ctx.fillRect(cx - 1.2, top + 2, 2.4, 5)
  }
}

export function drawItem(ctx: CanvasRenderingContext2D, kind: TreasureKind): void {
  if (kind === 'note') {
    rounded(ctx, -14, -10, 28, 20, 2)
    ctx.fillStyle = '#f1e2b8'
    ctx.fill()
    ink(ctx)
    for (const side of [-14, 14]) {
      ctx.beginPath()
      ctx.ellipse(side, 0, 3.2, 10.5, 0, 0, TAU)
      ctx.fillStyle = '#d8c28c'
      ctx.fill()
      ink(ctx, 1.5)
    }
    ctx.strokeStyle = 'rgba(90, 64, 30, 0.6)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (const y of [-5, -1, 3]) { ctx.moveTo(-8, y); ctx.lineTo(7, y) }
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(5, 6, 3.2, 0, TAU)
    ctx.fillStyle = '#c0392b'
    ctx.fill()
    ink(ctx, 1.2)
  } else if (kind === 'gem') {
    ctx.beginPath()
    ctx.moveTo(0, -13); ctx.lineTo(11, -3); ctx.lineTo(0, 13); ctx.lineTo(-11, -3); ctx.closePath()
    ctx.fillStyle = '#b58cff'
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(20, 16, 70, 0.3)'
    ctx.fillRect(1, -14, 12, 28)
    ctx.restore()
    ctx.beginPath()
    ctx.moveTo(0, -13); ctx.lineTo(11, -3); ctx.lineTo(0, 13); ctx.lineTo(-11, -3); ctx.closePath()
    ink(ctx)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(-11, -3); ctx.lineTo(11, -3)
    ctx.moveTo(-4, -3); ctx.lineTo(0, 13); ctx.lineTo(4, -3)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.beginPath()
    ctx.moveTo(-4, -8); ctx.lineTo(-1, -11); ctx.lineTo(-2, -5); ctx.closePath()
    ctx.fill()
  } else if (kind === 'coins') {
    for (let k = 0; k < 3; k++) {
      ctx.beginPath()
      ctx.ellipse(-7 + k * 7, 8 - k * 5, 9, 5, 0, 0, TAU)
      ctx.fillStyle = k === 2 ? '#ffd966' : '#f2c94c'
      ctx.fill()
      ink(ctx, 1.5)
      ctx.beginPath()
      ctx.ellipse(-7 + k * 7, 8 - k * 5, 5, 2.6, 0, 0, TAU)
      ctx.strokeStyle = 'rgba(160, 110, 20, 0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.fillRect(3, -5, 4, 1.5)
  } else if (kind === 'feather') {
    ctx.beginPath()
    ctx.moveTo(-10, 12)
    ctx.quadraticCurveTo(-10, -8, 9, -14)
    ctx.quadraticCurveTo(6, 4, -10, 12)
    ctx.closePath()
    ctx.fillStyle = '#e3ecf4'
    ctx.fill()
    ink(ctx)
    ctx.strokeStyle = '#8a9bb0'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-12, 14); ctx.lineTo(8, -13)
    for (let k = 0; k < 4; k++) { const px = -7 + k * 4, py = 8 - k * 5.5; ctx.moveTo(px, py); ctx.lineTo(px - 3.5, py - 4) }
    ctx.stroke()
  } else if (kind === 'key' || kind === 'great-key') {
    const great = kind === 'great-key'
    const metal = great ? '#e8c24a' : '#9aa0a8'
    if (great) {
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const angle = k / 6 * TAU
        const px = Math.cos(angle) * 5, py = -9 + Math.sin(angle) * 5
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = metal
      ctx.fill()
      ink(ctx, 1.4)
      ctx.beginPath()
      ctx.arc(0, -9, 1.8, 0, TAU)
      ctx.fillStyle = '#7a4fae'
      ctx.fill()
      ink(ctx, 1)
    } else {
      ctx.beginPath()
      ctx.arc(0, -8, 4, 0, TAU)
      ctx.fillStyle = metal
      ctx.fill()
      ink(ctx, 1.3)
      ctx.beginPath()
      ctx.arc(0, -8, 1.8, 0, TAU)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.fill()
    }
    ctx.beginPath()
    ctx.rect(-1.5, -4.5, 3, 14)
    ctx.fillStyle = metal
    ctx.fill()
    ink(ctx, 1.3)
    ctx.beginPath()
    for (const [ty, tw] of great ? [[6, 3], [9, 4], [12.5, 3]] as const : [[6, 2.6], [9, 3.4]] as const) {
      ctx.rect(1.5, ty, tw, 1.8)
    }
    ctx.fillStyle = metal
    ctx.fill()
    ink(ctx, 1.3)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.fillRect(-1, -3.5, 0.9, 12)
  } else if (kind === 'map') {
    ctx.save()
    ctx.rotate(-0.1)
    ctx.beginPath()
    ctx.moveTo(-11, -8)
    ctx.lineTo(10, -8)
    ctx.quadraticCurveTo(13, -8, 13, -5)
    ctx.lineTo(13, 6)
    ctx.quadraticCurveTo(13, 9, 10, 9)
    ctx.lineTo(-11, 9)
    ctx.quadraticCurveTo(-13, 9, -13, 6)
    ctx.lineTo(-13, -5)
    ctx.quadraticCurveTo(-13, -8, -11, -8)
    ctx.closePath()
    ctx.fillStyle = '#e7d3a0'
    ctx.fill()
    ink(ctx, 1.3)
    for (const [ex, ey, er] of [[-8, -2, 1.6], [1, 2, 1.3], [7, -3, 1.1]] as const) {
      ctx.beginPath()
      ctx.ellipse(ex, ey, er, er * 0.7, 0.3, 0, TAU)
      ctx.strokeStyle = 'rgba(120, 90, 40, 0.55)'
      ctx.lineWidth = 0.7
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(120, 90, 40, 0.6)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(-8, -2); ctx.lineTo(1, 2); ctx.lineTo(7, -3)
    ctx.stroke()
    ctx.fillStyle = '#c0392b'
    ctx.beginPath()
    ctx.arc(7, -3, 1, 0, TAU)
    ctx.fill()
    ctx.restore()
  } else if (kind === 'lodestone') {
    ctx.beginPath()
    ctx.moveTo(0, -13)
    ctx.quadraticCurveTo(9, -2, 6, 8)
    ctx.quadraticCurveTo(3, 13, 0, 13)
    ctx.quadraticCurveTo(-3, 13, -6, 8)
    ctx.quadraticCurveTo(-9, -2, 0, -13)
    ctx.closePath()
    ctx.fillStyle = '#2c2a33'
    ctx.fill()
    ink(ctx, 1.4)
    ctx.strokeStyle = 'rgba(150, 170, 255, 0.5)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    for (const a of [-0.6, 0, 0.6]) { ctx.moveTo(Math.sin(a) * 6, -3); ctx.lineTo(Math.sin(a) * 3.5, 8) }
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
    ctx.beginPath()
    ctx.ellipse(-3, -7, 1.6, 3, -0.3, 0, TAU)
    ctx.fill()
  } else {
    // lantern
    ctx.beginPath()
    ctx.rect(-4.5, -8.4, 9, 13)
    ctx.fillStyle = '#3a3226'
    ctx.fill()
    ink(ctx, 1.3)
    ctx.beginPath()
    ctx.rect(-4.5, -8.4, 0.9, 13)
    ctx.rect(3.6, -8.4, 0.9, 13)
    ctx.fillStyle = '#241f18'
    ctx.fill()
    const glow = ctx.createRadialGradient(0, -2, 1, 0, -2, 6)
    glow.addColorStop(0, 'rgba(255, 214, 120, 0.95)')
    glow.addColorStop(1, 'rgba(255, 214, 120, 0.1)')
    ctx.fillStyle = glow
    ctx.fillRect(-3.6, -7.6, 7.2, 11.6)
    ctx.fillStyle = '#ffdf8a'
    ctx.beginPath()
    ctx.moveTo(0, -5); ctx.quadraticCurveTo(2, -1.5, 0, 1.5); ctx.quadraticCurveTo(-2, -1.5, 0, -5); ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-6, -10.6); ctx.lineTo(6, -10.6); ctx.lineTo(4.5, -8.4); ctx.lineTo(-4.5, -8.4); ctx.closePath()
    ctx.fillStyle = '#6a5a3c'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.beginPath()
    ctx.rect(-1.2, -13, 2.4, 2.4)
    ctx.fillStyle = '#6a5a3c'
    ctx.fill()
    ink(ctx, 1)
    ctx.beginPath()
    ctx.moveTo(-4.7, 4.6); ctx.lineTo(4.7, 4.6); ctx.lineTo(3.4, 6.6); ctx.lineTo(-3.4, 6.6); ctx.closePath()
    ctx.fillStyle = '#6a5a3c'
    ctx.fill()
    ink(ctx, 1.2)
  }
}

/** Draws one relic piece: a whole star, a hexagon, or one of the six
 *  triangle points (rotated by `point`, matching the shrine's own wedge
 *  angles) — a smaller cousin of `drawItem`, at the same scale. */
export function drawPiece(ctx: CanvasRenderingContext2D, piece: 'triangle' | 'hexagon' | 'star', point = 0): void {
  ctx.save()
  if (piece === 'star') {
    ctx.beginPath()
    for (const start of [-Math.PI / 2, Math.PI / 2]) {
      for (let k = 0; k < 3; k++) {
        const angle = start + k * TAU / 3
        const px = Math.cos(angle) * 13, py = Math.sin(angle) * 13
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }
    ctx.fillStyle = '#ffe08a'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.beginPath()
    ctx.moveTo(-2.5, -10); ctx.lineTo(0.5, -12); ctx.lineTo(-1, -4); ctx.closePath()
    ctx.fill()
  } else if (piece === 'hexagon') {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const angle = -Math.PI / 2 + k * Math.PI / 3
      const px = Math.cos(angle) * 12, py = Math.sin(angle) * 12
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = '#a9ffd6'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.beginPath()
    ctx.moveTo(-2, -9); ctx.lineTo(1, -10.5); ctx.lineTo(-0.5, -3); ctx.closePath()
    ctx.fill()
  } else {
    ctx.rotate(point * (TAU / 6))
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(-Math.PI / 2 - Math.PI / 6) * 14, Math.sin(-Math.PI / 2 - Math.PI / 6) * 14)
    ctx.lineTo(Math.cos(-Math.PI / 2 + Math.PI / 6) * 14, Math.sin(-Math.PI / 2 + Math.PI / 6) * 14)
    ctx.closePath()
    ctx.fillStyle = '#ffd36a'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.beginPath()
    ctx.moveTo(-1, -3); ctx.lineTo(1, -11); ctx.lineTo(0.2, -3); ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Every kind of reveal the gain screen shows, one art union for all of
 *  them. Additive: a future case rides this same union and `playGainReveal`'s
 *  same dispatch, unchanged here. */
export type GainArt =
  | { readonly kind: 'chest'; readonly items: readonly TreasureKind[] }
  | { readonly kind: 'item'; readonly item: TreasureKind }
  | { readonly kind: 'piece'; readonly piece: 'triangle' | 'hexagon' | 'star'; readonly point?: number }
  | { readonly kind: 'place'; readonly sprite: PlaceSprite }
  | { readonly kind: 'glyph'; readonly glyph: string }
  | { readonly kind: 'skill'; readonly skill: CombatSkillId }

/** Full settle time (seconds) for every reveal but the chest, which keeps its
 *  own longer, multi-item pacing (`SETTLED`) — a chest has a lid to open and
 *  more than one thing to fly out; everything else is one thing alone. */
const SETTLED_GAIN = 1.4

const gainScratch = new Map<string, HTMLCanvasElement>()
function gainScratchContext(name: string, size: number): CanvasRenderingContext2D | null {
  let canvas = gainScratch.get(name)
  if (!canvas) { canvas = document.createElement('canvas'); gainScratch.set(name, canvas) }
  if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size }
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, size, size) }
  return ctx
}

/** A place's own icon, stamped onto a scratch canvas (it paints its own
 *  ground and outline over the whole surface) and composited in — its
 *  bottom edge lands at the local origin, matching `drawItem`'s icons. */
function drawPlaceArt(ctx: CanvasRenderingContext2D, sprite: PlaceSprite): void {
  const size = 84
  const scratch = gainScratchContext('gain-place', size)
  if (!scratch) return
  drawPlace(scratch, sprite, null)
  ctx.drawImage(scratch.canvas, -size / 2, -size, size, size)
}

/** A single glyph in a small ink medallion — knowledge and abilities that
 *  carry no other art. */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: string): void {
  ctx.beginPath()
  ctx.arc(0, 0, 15, 0, TAU)
  ctx.fillStyle = '#2a2144'
  ctx.fill()
  ink(ctx, 1.4)
  ctx.fillStyle = '#f0cc62'
  ctx.font = '700 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, 0, 1)
}

/** One of the stance/weapons/spells the labyrinth's Hush teaches — the same
 *  flat-colour, one-shade, ink-outline language as `drawItem`/`drawPiece`,
 *  drawn in the same roughly ±14-unit local box so it drops into
 *  `paintGain`'s existing translate/scale unchanged. `t` (seconds since the
 *  reveal began, or 0 for a static row icon) drives a small idle motion only
 *  — the pose reads fine at `t = 0` too, since `items-table.ts` calls this
 *  for a still row icon, never running its own animation loop. */
export function drawSkill(ctx: CanvasRenderingContext2D, skill: CombatSkillId, t: number): void {
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.2)
  if (skill === 'stand') {
    // A wand planted upright, and beside it the hourglass silhouette of the
    // moment it holds still for.
    ctx.save()
    ctx.translate(-4, 0)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.beginPath()
    ctx.ellipse(0, 9.5, 5, 1.6, 0, 0, TAU)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-1.4, 9)
    ctx.lineTo(-1.1, -10)
    ctx.lineTo(1.1, -10)
    ctx.lineTo(1.4, 9)
    ctx.closePath()
    ctx.fillStyle = '#8a6a42'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.beginPath()
    ctx.arc(0, -12, 2.6, 0, TAU)
    ctx.fillStyle = '#e8d38a'
    ctx.fill()
    ink(ctx, 1.1)
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = 0.55 * pulse
    ctx.translate(7, -1)
    hourglass(ctx, 6, '#f0e6c8', '#c7aa63')
    ctx.restore()
  } else if (skill === 'ward') {
    // A pale-blue glass disc with a six-point star inside.
    glassDisc(ctx, 'rgba(150, 205, 255, 0.85)', 'rgba(210, 235, 255, 0.9)')
    ctx.save()
    ctx.rotate(t * 0.15)
    sixPointStar(ctx, 8.5)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fill()
    ink(ctx, 1)
    ctx.restore()
  } else if (skill === 'sickle') {
    // A gold crescent, swift in close.
    ctx.beginPath()
    ctx.arc(1.5, 0, 12.5, Math.PI * 0.62, Math.PI * 1.62)
    ctx.arc(-3.5, 0, 8.5, Math.PI * 1.62, Math.PI * 0.62, true)
    ctx.closePath()
    ctx.fillStyle = '#e8c24a'
    ctx.fill()
    ink(ctx, 1.2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.beginPath()
    ctx.arc(3, -6, 1.6, 0, TAU)
    ctx.fill()
  } else if (skill === 'ember') {
    // An ink circle sigil at the feet, flame two-tone above it.
    ctx.beginPath()
    ctx.ellipse(0, 8.5, 10, 3.2, 0, 0, TAU)
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, 8.5, 6, 1.9, 0, 0, TAU)
    ctx.stroke()
    ctx.save()
    ctx.translate(0, 5.5 - 1.5 * pulse)
    ctx.beginPath()
    ctx.moveTo(0, -13)
    ctx.quadraticCurveTo(7, -3, 4, 5)
    ctx.quadraticCurveTo(2, 8, 0, 8)
    ctx.quadraticCurveTo(-2, 8, -4, 5)
    ctx.quadraticCurveTo(-7, -3, 0, -13)
    ctx.closePath()
    ctx.fillStyle = '#d9531e'
    ctx.fill()
    ink(ctx, 1.1)
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.quadraticCurveTo(3.6, -1, 2, 4)
    ctx.quadraticCurveTo(1, 5.6, 0, 5.6)
    ctx.quadraticCurveTo(-1, 5.6, -2, 4)
    ctx.quadraticCurveTo(-3.6, -1, 0, -7)
    ctx.closePath()
    ctx.fillStyle = '#ffce55'
    ctx.fill()
    ctx.restore()
  } else if (skill === 'sling') {
    // A teal glass disc, thrown and caught.
    glassDisc(ctx, 'rgba(110, 220, 205, 0.85)', 'rgba(200, 250, 240, 0.9)')
    ctx.save()
    ctx.rotate(-0.3 + t * 0.4)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(-9, -2)
    ctx.lineTo(9, 2)
    ctx.stroke()
    ctx.restore()
  } else {
    // hold — a paper-and-gold hourglass, ghostly (the room, stopped cold).
    ctx.save()
    ctx.globalAlpha = 0.75
    hourglass(ctx, 12.5, 'rgba(241, 226, 184, 0.9)', 'rgba(199, 170, 99, 0.9)')
    ctx.restore()
  }
}

/** A round glass disc, the shared base for the Ward's and Sling's art. */
function glassDisc(ctx: CanvasRenderingContext2D, glass: string, rim: string): void {
  ctx.beginPath()
  ctx.arc(0, 0, 13, 0, TAU)
  ctx.fillStyle = glass
  ctx.fill()
  ink(ctx, 1.3)
  ctx.beginPath()
  ctx.arc(0, 0, 13, -Math.PI * 0.75, -Math.PI * 0.15)
  ctx.strokeStyle = rim
  ctx.lineWidth = 1.6
  ctx.stroke()
}

/** Two overlaid triangles — a six-point star, path only (caller fills/strokes). */
function sixPointStar(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath()
  for (const start of [-Math.PI / 2, Math.PI / 2]) {
    for (let k = 0; k < 3; k++) {
      const angle = start + k * TAU / 3
      const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath()
  }
}

/** A paper-and-metal hourglass at the given half-height, its two named colours
 *  for the frame/sand — shared between the Stand's small silhouette and
 *  Hold's own, larger, ghostly one. */
function hourglass(ctx: CanvasRenderingContext2D, half: number, paper: string, frame: string): void {
  const w = half * 0.7
  ctx.beginPath()
  ctx.moveTo(-w, -half); ctx.lineTo(w, -half); ctx.lineTo(1.5, 0); ctx.lineTo(w, half); ctx.lineTo(-w, half)
  ctx.lineTo(-1.5, 0); ctx.closePath()
  ctx.fillStyle = paper
  ctx.fill()
  ctx.strokeStyle = frame
  ctx.lineWidth = 1.4
  ctx.stroke()
  ctx.fillStyle = frame
  ctx.beginPath()
  ctx.moveTo(-w * 0.7, -half * 0.75); ctx.lineTo(w * 0.7, -half * 0.75); ctx.lineTo(0, -half * 0.15); ctx.closePath()
  ctx.fill()
}

/** Starts a reveal on a canvas of any size (drawn on the same 240 × 130
 *  stage as a chest); returns a stop function. Every kind but `'chest'`
 *  (which keeps its own longer scene, unchanged) settles by `SETTLED_GAIN`. */
export function playGainReveal(ctx: CanvasRenderingContext2D, art: GainArt, animate: boolean): () => void {
  const settle = art.kind === 'chest' ? SETTLED : SETTLED_GAIN
  const skip = animate ? 0 : settle
  if (typeof requestAnimationFrame !== 'function') {
    paintGain(ctx, art, settle)
    return () => undefined
  }
  let frame = 0, start = -1, stopped = false
  const tick = (now: number): void => {
    if (stopped) return
    if (start < 0) start = now
    paintGain(ctx, art, (now - start) / 1000 + skip)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  return () => {
    stopped = true
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  }
}

function paintGain(ctx: CanvasRenderingContext2D, art: GainArt, t: number): void {
  if (art.kind === 'chest') { paintReveal(ctx, art.items, t); return }
  const { width, height } = ctx.canvas
  ctx.setTransform(width / WIDE, 0, 0, height / HIGH, 0, 0)
  ctx.clearRect(0, 0, WIDE, HIGH)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const cx = WIDE / 2, cy = HIGH / 2 + 6
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 34, 28, 6, 0, 0, TAU)
  ctx.fill()
  const open = easeOut(clamp01(t / 0.4))
  if (open > 0) {
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 100)
    glow.addColorStop(0, `rgba(255, 226, 140, ${0.5 * open})`)
    glow.addColorStop(1, 'rgba(255, 226, 140, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, WIDE, HIGH)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(t * 0.2)
    ctx.fillStyle = `rgba(255, 236, 170, ${0.18 * open})`
    for (let k = 0; k < 10; k++) {
      ctx.rotate(TAU / 10)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-6, -100)
      ctx.lineTo(6, -100)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }
  const rise = clamp01((t - 0.15) / 0.55)
  if (rise > 0) {
    const bob = rise >= 1 ? Math.sin(t * 2.4) * 1.6 : 0
    const y = (cy + 38) + (cy - 12 - (cy + 38)) * easeBack(rise) + bob
    const scale = 0.35 + 0.65 * easeOut(rise)
    ctx.save()
    ctx.translate(cx, y)
    ctx.scale(scale, scale)
    if (art.kind === 'item') drawItem(ctx, art.item)
    else if (art.kind === 'piece') drawPiece(ctx, art.piece, art.point ?? 0)
    else if (art.kind === 'place') drawPlaceArt(ctx, art.sprite)
    else if (art.kind === 'skill') drawSkill(ctx, art.skill, t)
    else drawGlyph(ctx, art.glyph)
    ctx.restore()
  }
  if (t > 1) {
    ctx.fillStyle = 'rgba(255, 250, 220, 0.9)'
    for (let k = 0; k < 5; k++) {
      const phase = (t * 0.8 + k * 0.41) % 1
      const size = Math.sin(phase * Math.PI) * 2.2
      const gx = cx - 70 + ((k * 41) % 140), gy = cy - 46 + ((k * 23) % 60)
      ctx.fillRect(gx - size, gy - 0.4, size * 2, 0.8)
      ctx.fillRect(gx - 0.4, gy - size, 0.8, size * 2)
    }
  }
}
