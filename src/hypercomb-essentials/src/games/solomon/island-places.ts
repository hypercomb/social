// The places people walk up to on the island — shrines, the pyramid, cavern
// mouths, empty plots, caches and signposts — drawn in the same cartoon
// language as the walkers in island-sprites.ts: flat colour, one shade, and a
// fat ink outline around the whole shape. Redrawn only when a place's state
// changes (a shrine lights up, a cache opens).

export type PlaceSprite = 'shrine' | 'pyramid' | 'cavern' | 'plot' | 'cache' | 'cache-open' | 'sign'
  // Inside the caverns.
  | 'tablet' | 'rune-door' | 'rune-door-open' | 'cave-exit' | 'crystal' | 'alcove'
export type PlaceGlow = 'ready' | 'open' | null

const INK = '#1c1230'
const SHADE = 'rgba(20, 16, 70, 0.28)'
const TAU = Math.PI * 2

/** Draws on a 24 × 24 unit grid scaled to the canvas; the base sits on the bottom edge. */
export function drawPlace(ctx: CanvasRenderingContext2D, sprite: PlaceSprite, glow: PlaceGlow): void {
  outlined(ctx, ground => {
    if (glow) {
      const light = ground.createRadialGradient(12, 13, 1, 12, 13, 12)
      light.addColorStop(0, glow === 'open' ? 'rgba(130, 255, 196, 0.55)' : 'rgba(255, 214, 120, 0.55)')
      light.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ground.fillStyle = light
      ground.fillRect(0, 0, 24, 24)
    }
    ground.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ground.beginPath()
    ground.ellipse(12, 22.4, sprite === 'sign' ? 4 : 9, 1.7, 0, 0, TAU)
    ground.fill()
  }, art => PLACES[sprite](art, glow))
}

const scratch = new Map<string, HTMLCanvasElement>()
function scratchContext(name: string, width: number, height: number): CanvasRenderingContext2D | null {
  let canvas = scratch.get(name)
  if (!canvas) { canvas = document.createElement('canvas'); scratch.set(name, canvas) }
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = canvas.getContext('2d') } catch { ctx = null }
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width, height)
  return ctx
}

/** Paints `art`, then stamps it onto `target` inside a solid ink outline. */
function outlined(target: CanvasRenderingContext2D, ground: (ctx: CanvasRenderingContext2D) => void, art: (ctx: CanvasRenderingContext2D) => void): void {
  const { width, height } = target.canvas
  const scale = width / 24
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.clearRect(0, 0, width, height)
  target.setTransform(scale, 0, 0, height / 24, 0, 0)
  ground(target)
  target.setTransform(1, 0, 0, 1, 0, 0)
  const figure = scratchContext('place', width, height), outline = scratchContext('place-outline', width, height)
  if (!figure || !outline) return
  figure.setTransform(scale, 0, 0, height / 24, 0, 0)
  figure.lineJoin = 'round'
  figure.lineCap = 'round'
  art(figure)
  figure.setTransform(1, 0, 0, 1, 0, 0)
  outline.drawImage(figure.canvas, 0, 0)
  outline.globalCompositeOperation = 'source-in'
  outline.fillStyle = INK
  outline.fillRect(0, 0, width, height)
  const px = Math.max(1, Math.round(width / 40))
  for (const [dx, dy] of [[-px, 0], [px, 0], [0, -px], [0, px], [-px, -px], [px, px], [-px, px], [px, -px]] as const) {
    target.drawImage(outline.canvas, dx, dy)
  }
  target.drawImage(figure.canvas, 0, 0)
}

function paint(ctx: CanvasRenderingContext2D, color: string, path: () => void): void {
  ctx.fillStyle = color
  ctx.beginPath()
  path()
  ctx.fill()
}

/** Fills a shape, shades its right-hand side, and inks its edge. */
function part(ctx: CanvasRenderingContext2D, color: string, path: () => void, shadeFrom?: number): void {
  paint(ctx, color, path)
  if (shadeFrom !== undefined) {
    ctx.save()
    ctx.beginPath()
    path()
    ctx.clip()
    ctx.fillStyle = SHADE
    ctx.fillRect(shadeFrom, 0, 24, 24)
    ctx.restore()
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 0.5
  ctx.beginPath()
  path()
  ctx.stroke()
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function hexagram(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  paint(ctx, color, () => {
    for (const start of [-Math.PI / 2, Math.PI / 2]) {
      for (let k = 0; k < 3; k++) {
        const angle = start + k * TAU / 3
        if (k === 0) ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
        else ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
      }
      ctx.closePath()
    }
  })
}

const PLACES: Readonly<Record<PlaceSprite, (ctx: CanvasRenderingContext2D, glow: PlaceGlow) => void>> = {
  shrine(ctx, glow) {
    part(ctx, '#b8b2a3', () => rounded(ctx, 3, 18.3, 18, 3.7, 0.6), 15)
    part(ctx, '#d3cdbe', () => rounded(ctx, 5, 15.5, 14, 3.1, 0.5), 15)
    part(ctx, '#2a3034', () => ctx.rect(8.4, 8.2, 7.2, 7.5))
    part(ctx, '#e9e3d5', () => ctx.rect(6, 7.4, 2.7, 8.4), 7.6)
    part(ctx, '#e9e3d5', () => ctx.rect(15.3, 7.4, 2.7, 8.4), 16.9)
    part(ctx, '#ddd6c6', () => { ctx.moveTo(3.4, 8.4); ctx.lineTo(12, 3.2); ctx.lineTo(20.6, 8.4); ctx.closePath() }, 12)
    hexagram(ctx, 12, 12, 2.7, glow === 'open' ? '#a9ffd6' : glow === 'ready' ? '#ffe08a' : '#7b8983')
  },
  pyramid(ctx, glow) {
    for (let tier = 0; tier < 5; tier++) {
      const top = 18.6 - tier * 3.3, half = 10.4 - tier * 2
      part(ctx, '#e8cf92', () => rounded(ctx, 12 - half, top, half * 2, 3.5, 0.3), 12.4)
    }
    part(ctx, '#2a2218', () => { ctx.moveTo(10.2, 22); ctx.lineTo(10.2, 19.4); ctx.quadraticCurveTo(12, 17.6, 13.8, 19.4); ctx.lineTo(13.8, 22); ctx.closePath() })
    hexagram(ctx, 12, 3.2, 2.1, glow === 'open' ? '#a9ffd6' : glow === 'ready' ? '#ffe08a' : '#c9b27a')
  },
  cavern(ctx) {
    part(ctx, '#9d9586', () => {
      ctx.moveTo(1.6, 22.2)
      ctx.bezierCurveTo(1.8, 13, 6, 5.2, 12, 5)
      ctx.bezierCurveTo(18, 5.2, 22.2, 13, 22.4, 22.2)
      ctx.closePath()
    }, 13)
    paint(ctx, 'rgba(255, 255, 255, 0.2)', () => ctx.ellipse(8.6, 9.6, 3, 1.3, -0.3, 0, TAU))
    paint(ctx, '#5f8a45', () => { ctx.ellipse(4.2, 19.6, 1.5, 0.8, 0, 0, TAU); ctx.moveTo(20.6, 18.4); ctx.ellipse(19.4, 18.4, 1.2, 0.6, 0, 0, TAU) })
    part(ctx, '#0d0f11', () => {
      ctx.moveTo(7.4, 22.2); ctx.lineTo(7.4, 16.2); ctx.quadraticCurveTo(12, 9.8, 16.6, 16.2); ctx.lineTo(16.6, 22.2); ctx.closePath()
    })
    for (const side of [5.2, 18.8]) {
      part(ctx, '#6a4a2c', () => rounded(ctx, side - 0.35, 14.2, 0.7, 4.6, 0.2))
      paint(ctx, '#ff9d3c', () => ctx.ellipse(side, 13.4, 0.95, 1.4, 0, 0, TAU))
      paint(ctx, '#fff1b0', () => ctx.ellipse(side, 13.8, 0.4, 0.7, 0, 0, TAU))
    }
  },
  plot(ctx) {
    paint(ctx, 'rgba(210, 222, 200, 0.3)', () => ctx.ellipse(12, 18.4, 9, 3.6, 0, 0, TAU))
    for (let k = 0; k < 6; k++) {
      const angle = k / 6 * TAU
      const x = 12 + Math.cos(angle) * 8, y = 18.4 + Math.sin(angle) * 3.3
      part(ctx, '#cfc8b8', () => rounded(ctx, x - 1.4, y - 2.1, 2.8, 2.9, 0.7), x + 0.2)
    }
    part(ctx, '#c7c0af', () => rounded(ctx, 9.2, 16.6, 5.6, 3, 0.8), 12.6)
    hexagram(ctx, 12, 18, 1.1, 'rgba(110, 122, 116, 0.8)')
  },
  cache(ctx) { chest(ctx, false) },
  'cache-open'(ctx) { chest(ctx, true) },
  sign(ctx) {
    part(ctx, '#7a5432', () => rounded(ctx, 11, 9.5, 2, 12.8, 0.4), 12.2)
    part(ctx, '#c08e56', () => rounded(ctx, 4, 4.4, 16, 7.2, 1), 15)
    ctx.strokeStyle = 'rgba(60, 38, 20, 0.6)'
    ctx.lineWidth = 0.55
    ctx.beginPath()
    ctx.moveTo(6, 6.6); ctx.lineTo(16.5, 6.6)
    ctx.moveTo(6, 8.4); ctx.lineTo(18, 8.4)
    ctx.moveTo(6, 10); ctx.lineTo(13, 10)
    ctx.stroke()
  },
  tablet(ctx) {
    part(ctx, '#8c8577', () => { ctx.moveTo(6, 22); ctx.lineTo(6, 8); ctx.quadraticCurveTo(12, 3.5, 18, 8); ctx.lineTo(18, 22); ctx.closePath() }, 14)
    ctx.strokeStyle = 'rgba(40, 34, 28, 0.7)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    for (const y of [10.5, 13, 15.5, 18]) { ctx.moveTo(8.5, y); ctx.lineTo(15.5, y) }
    ctx.stroke()
    paint(ctx, '#5f7d45', () => ctx.ellipse(7.5, 21, 2, 1, 0, 0, TAU))
  },
  'rune-door'(ctx) { doorway(ctx, false) },
  'rune-door-open'(ctx) { doorway(ctx, true) },
  'cave-exit'(ctx) {
    part(ctx, '#6d6255', () => { ctx.moveTo(2, 22.4); ctx.lineTo(2, 12); ctx.quadraticCurveTo(12, -1, 22, 12); ctx.lineTo(22, 22.4); ctx.closePath() }, 15)
    const day = ctx.createLinearGradient(0, 8, 0, 22)
    day.addColorStop(0, '#bfe6ff')
    day.addColorStop(0.6, '#eef8dc')
    day.addColorStop(1, '#8fc46a')
    ctx.fillStyle = day
    ctx.beginPath()
    ctx.moveTo(6.5, 22.4); ctx.lineTo(6.5, 14); ctx.quadraticCurveTo(12, 5.5, 17.5, 14); ctx.lineTo(17.5, 22.4); ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = 0.5
    ctx.stroke()
  },
  crystal(ctx) {
    part(ctx, '#7a7064', () => rounded(ctx, 6.5, 17, 11, 5, 1), 13)
    part(ctx, '#ffd36a', () => { ctx.moveTo(12, 3.5); ctx.lineTo(15, 10); ctx.lineTo(12, 17.5); ctx.lineTo(9, 10); ctx.closePath() }, 12)
    part(ctx, '#ffe9a8', () => { ctx.moveTo(8, 9); ctx.lineTo(9.6, 12.5); ctx.lineTo(8, 17); ctx.lineTo(6.4, 12.5); ctx.closePath() }, 8)
    part(ctx, '#f4bd4f', () => { ctx.moveTo(16, 8.5); ctx.lineTo(17.8, 12.6); ctx.lineTo(16, 17); ctx.lineTo(14.2, 12.6); ctx.closePath() }, 16)
    paint(ctx, 'rgba(255, 255, 255, 0.75)', () => { ctx.moveTo(11.2, 6); ctx.lineTo(12, 5); ctx.lineTo(12.4, 9); ctx.closePath() })
  },
  alcove(ctx) {
    part(ctx, '#6f665a', () => rounded(ctx, 5, 6, 14, 16.4, 1.2), 14)
    part(ctx, '#15171a', () => hexagonPath(ctx, 12, 13, 4.2))
    paint(ctx, '#c9b4ff', () => hexagonPath(ctx, 12, 13, 1.6))
  },
}

function hexagonPath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  for (let k = 0; k < 6; k++) {
    const angle = -Math.PI / 2 + k * Math.PI / 3
    if (k === 0) ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
    else ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  ctx.closePath()
}

/** A rune gate: two pillars and a lintel, sealed by a carved slab until it opens. */
function doorway(ctx: CanvasRenderingContext2D, open: boolean): void {
  part(ctx, '#6f665a', () => rounded(ctx, 3, 5, 4, 17.5, 0.6), 6)
  part(ctx, '#6f665a', () => rounded(ctx, 17, 5, 4, 17.5, 0.6), 20)
  if (open) {
    part(ctx, '#0b0c0e', () => ctx.rect(7, 6.4, 10, 16))
    paint(ctx, 'rgba(140, 200, 255, 0.28)', () => ctx.ellipse(12, 21, 4.5, 1, 0, 0, TAU))
  } else {
    part(ctx, '#57606a', () => ctx.rect(7, 6.4, 10, 16), 13)
    hexagram(ctx, 12, 12.5, 2.8, 'rgba(143, 227, 255, 0.92)')
    ctx.strokeStyle = 'rgba(143, 227, 255, 0.7)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(9, 17.5); ctx.lineTo(15, 17.5)
    ctx.moveTo(9, 19.5); ctx.lineTo(13.5, 19.5)
    ctx.stroke()
  }
  part(ctx, '#7d7466', () => rounded(ctx, 2, 3, 20, 3.4, 0.8), 16)
}

function chest(ctx: CanvasRenderingContext2D, open: boolean): void {
  part(ctx, '#9c6a3c', () => rounded(ctx, 5, 12, 14, 9.4, 0.8), 14.5)
  paint(ctx, '#f0cc62', () => { ctx.rect(7, 12, 1.4, 9.4); ctx.rect(15.6, 12, 1.4, 9.4) })
  if (open) {
    part(ctx, '#7c5230', () => rounded(ctx, 4.6, 4.8, 14.8, 4.4, 1), 14.5)
    part(ctx, '#1c120b', () => rounded(ctx, 5.6, 10.4, 12.8, 2.6, 0.5))
    paint(ctx, '#ffe7a0', () => { ctx.ellipse(10, 11.2, 0.8, 0.5, 0, 0, TAU); ctx.moveTo(14, 11); ctx.ellipse(13.4, 11, 0.6, 0.4, 0, 0, TAU) })
  } else {
    part(ctx, '#b98148', () => rounded(ctx, 4.6, 8.2, 14.8, 4.6, 1.6), 14.5)
    paint(ctx, '#f0cc62', () => { ctx.rect(7, 8.3, 1.4, 4.4); ctx.rect(15.6, 8.3, 1.4, 4.4) })
    part(ctx, '#f3d98a', () => rounded(ctx, 10.6, 11.4, 2.8, 3.2, 0.5))
    paint(ctx, '#3a2612', () => ctx.rect(11.75, 12.6, 0.5, 1.2))
  }
}
