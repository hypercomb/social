// diamondcoreprocessor.com/tutorial/tutorial-images.ts
//
// Cover images for the tiles the bee tutorial creates — drawn at runtime on
// a canvas so nothing ships as a bundled asset. One shared design system
// (deep slate gradient, hairline geometry, a single muted accent per tile)
// keeps the seeded tiles looking deliberate and professional instead of
// falling back to the substrate's default pool. No text is drawn — the grid
// superimposes the tile label, so the covers stay glyph-only.

const SIZE = 1024
const TAU = Math.PI * 2

// Muted seven-hue wheel, Monday-first — cool weekdays warming toward the
// weekend, violet Sunday. Low saturation keeps it professional on the dark
// slate base.
const DAY_HUES = [210, 188, 165, 142, 42, 18, 272] as const

const dayAccent = (day: number, alpha = 1): string =>
  `hsla(${DAY_HUES[day] ?? 210}, 46%, 64%, ${alpha})`

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), 'image/png'))

const makeCanvas = (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')
  return { canvas, ctx }
}

/** Shared base: diagonal slate gradient, faint off-centre rings, soft vignette. */
const drawBase = (ctx: CanvasRenderingContext2D, hue: number): void => {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  g.addColorStop(0, `hsl(${hue}, 24%, 14%)`)
  g.addColorStop(0.55, `hsl(${hue}, 22%, 10%)`)
  g.addColorStop(1, `hsl(${hue}, 26%, 6%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, SIZE, SIZE)

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 2
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.arc(SIZE * 0.78, SIZE * 0.22, 140 + i * 132, 0, TAU)
    ctx.stroke()
  }
  ctx.restore()

  const v = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.34, SIZE / 2, SIZE / 2, SIZE * 0.74)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.42)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, SIZE, SIZE)
}

const hexPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void => {
  ctx.beginPath()
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 6 // pointy-top
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (k === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/**
 * Parent cover ("Weekly Planner"): a honeycomb flower — one softly amber
 * centre hexagon ringed by six hairline hexagons.
 */
export const plannerCoverImage = async (): Promise<Blob> => {
  const { canvas, ctx } = makeCanvas()
  drawBase(ctx, 216)

  const cx = SIZE / 2
  const cy = SIZE / 2
  const r = 116
  const d = r * Math.sqrt(3) + 14 // pointy-top neighbour distance + hairline gap

  ctx.lineWidth = 3.5
  for (let k = 0; k < 6; k++) {
    const a = (k * TAU) / 6
    hexPath(ctx, cx + d * Math.cos(a), cy + d * Math.sin(a), r)
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.stroke()
  }

  hexPath(ctx, cx, cy, r)
  ctx.fillStyle = 'hsla(40, 62%, 56%, 0.14)'
  ctx.fill()
  ctx.strokeStyle = 'hsla(40, 62%, 62%, 0.75)'
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, 11, 0, TAU)
  ctx.fillStyle = 'hsla(40, 66%, 62%, 0.9)'
  ctx.fill()

  return toBlob(canvas)
}

/**
 * Day cover (0 = Monday … 6 = Sunday): a hairline heptagon of seven nodes;
 * the day's node is lit in its accent hue, with a thin arc sweeping from the
 * top of the ring to that node — the day's position in the week.
 */
export const dayCoverImage = async (day: number): Promise<Blob> => {
  const { canvas, ctx } = makeCanvas()
  const hue = DAY_HUES[day] ?? 210
  drawBase(ctx, hue)

  const cx = SIZE / 2
  const cy = SIZE / 2
  const R = 296
  const angleOf = (i: number): number => -Math.PI / 2 + (i * TAU) / 7

  // hairline heptagon
  ctx.beginPath()
  for (let i = 0; i < 7; i++) {
    const x = cx + R * Math.cos(angleOf(i))
    const y = cy + R * Math.sin(angleOf(i))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 3
  ctx.stroke()

  // progress arc along the circumscribed circle, top → the day's node
  if (day > 0) {
    ctx.beginPath()
    ctx.arc(cx, cy, R, angleOf(0), angleOf(day))
    ctx.strokeStyle = dayAccent(day, 0.5)
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.stroke()
  }

  // the seven nodes — quiet dots, except today
  for (let i = 0; i < 7; i++) {
    const x = cx + R * Math.cos(angleOf(i))
    const y = cy + R * Math.sin(angleOf(i))
    if (i === day) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 84)
      glow.addColorStop(0, dayAccent(i, 0.34))
      glow.addColorStop(1, dayAccent(i, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, 84, 0, TAU)
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, 26, 0, TAU)
      ctx.fillStyle = dayAccent(i, 0.95)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, 13, 0, TAU)
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.fill()
    }
  }

  return toBlob(canvas)
}
