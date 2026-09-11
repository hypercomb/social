// A chest opening, played on a small stage in the chest's dialog: the chest
// shakes, the lid swings back in a burst of light, and what was inside rises
// out and settles above it, gently bobbing. A chest opened before skips
// straight to that settled scene. Flat colour, one shade and a fat ink
// outline — the same cartoon language as the walkers.

export type TreasureKind = 'note' | 'gem' | 'coins' | 'feather'

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
  } else {
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
  }
}
