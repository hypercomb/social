// Paints a cavern the way Dragon Warrior lit its dungeons: rock walls seen
// from the front in three-quarter view, worn flagstones and underground pools
// — and darkness everywhere your torch does not reach. Passages you have
// walked stay faintly remembered. The rock is baked once; per frame only the
// light, the torch flames and the pool glints move.
//
// One look besides the cavern: `'wood'`, for the daylight chambers where the
// map's own `#`/`.`/`~` mean trunk, grass and still pool instead of rock,
// flagstone and dark water — same source characters, same bake-once
// mechanism, a different palette and no darkness pass (torch reach is 0
// outdoors; the look tells `paintLight` to skip the hole-punch entirely and
// wash the scene in daylight instead).

import { islandHash } from './island.js'
import { canvasContext } from './island-paint.js'

/** `#` rock (wood: trunk), `.` floor (wood: grass), `~` water (wood: still
 *  pool) — one string per row. `look` defaults to `'cavern'`, so every
 *  existing caller (no `look` field) renders exactly as before. */
export interface CavernMap { cols: number; rows: number; tiles: readonly string[]; look?: 'cavern' | 'wood' }
/** The visible window in CSS pixels; `tile` is the size of one cell. */
export interface CavernCamera { x: number; y: number; width: number; height: number; tile: number; dpr: number }
export interface CavernLight { x: number; y: number; radius: number }

const TAU = Math.PI * 2
const TORCH_REACH = 3.6

export class CavernPainter {
  readonly #map: CavernMap
  readonly #wood: boolean
  /** Cells the torch has shown; they stay dimly visible afterwards. Unused
   *  in the wood look, which skips the darkness pass entirely. */
  readonly seen: Uint8Array
  readonly torches: readonly { x: number; y: number }[]
  #rock: { key: string; canvas: HTMLCanvasElement | null } = { key: '', canvas: null }
  #hole: HTMLCanvasElement | null | undefined
  #glow: HTMLCanvasElement | null | undefined

  constructor(map: CavernMap) {
    this.#map = map
    this.#wood = map.look === 'wood'
    this.seen = new Uint8Array(map.cols * map.rows)
    const torches: { x: number; y: number }[] = []
    // Daylight chambers carry no torches — the sun does the work.
    if (!this.#wood) {
      for (let row = 0; row < map.rows - 1; row++) for (let col = 1; col < map.cols - 1; col++) {
        if (this.#at(col, row) === '#' && this.#at(col, row + 1) === '.' && (col * 7 + row * 3) % 9 === 0) torches.push({ x: col + 0.5, y: row + 0.66 })
      }
    }
    this.torches = torches
  }

  reveal(x: number, y: number): void {
    const reach = Math.ceil(TORCH_REACH)
    for (let row = Math.floor(y) - reach; row <= Math.floor(y) + reach; row++) {
      for (let col = Math.floor(x) - reach; col <= Math.floor(x) + reach; col++) {
        if (col < 0 || row < 0 || col >= this.#map.cols || row >= this.#map.rows) continue
        // Reach past the soft rim of the light, so no unseen square shows through it.
        if (Math.hypot(col + 0.5 - x, row + 0.5 - y) <= TORCH_REACH + 0.8) this.seen[row * this.#map.cols + col] = 1
      }
    }
  }

  paintRock(ctx: CanvasRenderingContext2D, camera: CavernCamera, time: number): void {
    const { tile, dpr, width, height } = camera
    const key = `${tile}:${dpr}:${this.#wood ? 1 : 0}`
    if (this.#rock.key !== key) this.#rock = { key, canvas: this.#bake(tile, dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = this.#wood ? '#bfe0a0' : '#060709'
    ctx.fillRect(0, 0, width, height)
    if (this.#rock.canvas) ctx.drawImage(this.#rock.canvas, -camera.x, -camera.y, this.#map.cols * tile, this.#map.rows * tile)
    this.#glints(ctx, camera, time)
  }

  paintLight(ctx: CanvasRenderingContext2D, camera: CavernCamera, player: { x: number; y: number }, time: number, lights: readonly CavernLight[]): void {
    const { tile, dpr, width, height } = camera
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, width, height)
    if (this.#wood) { this.#daylight(ctx, camera, time); return }
    ctx.fillStyle = 'rgba(4, 5, 9, 0.8)'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#040509'
    const c0 = Math.max(0, Math.floor(camera.x / tile)), c1 = Math.min(this.#map.cols - 1, Math.floor((camera.x + width) / tile))
    const r0 = Math.max(0, Math.floor(camera.y / tile)), r1 = Math.min(this.#map.rows - 1, Math.floor((camera.y + height) / tile))
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      if (!this.seen[row * this.#map.cols + col]) ctx.fillRect(col * tile - camera.x - 0.5, row * tile - camera.y - 0.5, tile + 1, tile + 1)
    }
    this.#hole ??= radialSprite('0, 0, 0', [[0, 1], [0.45, 0.92], [1, 0]])
    this.#glow ??= radialSprite('255, 170, 80', [[0, 1], [1, 0]])
    const sources: [number, number, number][] = [[player.x, player.y, TORCH_REACH * (1 + Math.sin(time * 9.3) * 0.02 + Math.sin(time * 5.1) * 0.025)]]
    for (const torch of this.torches) sources.push([torch.x, torch.y + 0.3, 2.3 * (1 + Math.sin(time * 11 + torch.x) * 0.04)])
    for (const light of lights) sources.push([light.x, light.y, light.radius])
    const visible = sources.filter(([x, y, radius]) => {
      const sx = x * tile - camera.x, sy = y * tile - camera.y, r = radius * tile
      return sx + r > 0 && sx - r < width && sy + r > 0 && sy - r < height
    })
    if (this.#hole) {
      ctx.globalCompositeOperation = 'destination-out'
      for (const [x, y, radius] of visible) ctx.drawImage(this.#hole, x * tile - camera.x - radius * tile, y * tile - camera.y - radius * tile, radius * tile * 2, radius * tile * 2)
      ctx.globalCompositeOperation = 'source-over'
    }
    if (this.#glow) {
      ctx.globalAlpha = 0.14
      for (const [x, y, radius] of visible) ctx.drawImage(this.#glow, x * tile - camera.x - radius * tile, y * tile - camera.y - radius * tile, radius * tile * 2, radius * tile * 2)
      ctx.globalAlpha = 1
    }
    for (const torch of this.torches) flame(ctx, torch.x * tile - camera.x, torch.y * tile - camera.y, tile, time + torch.x)
  }

  /** The wood look's whole "light" pass: no torch, no darkness, no memory of
   *  what has been seen — outdoors, everything in view is simply lit. A soft
   *  warm wash plus a slow drift of dappled shade, so it never reads as flat. */
  #daylight(ctx: CanvasRenderingContext2D, camera: CavernCamera, time: number): void {
    const { tile, width, height } = camera
    const grade = ctx.createRadialGradient(width / 2, height * 0.35, tile, width / 2, height * 0.35, Math.max(width, height) * 0.8)
    grade.addColorStop(0, 'rgba(255, 250, 214, 0.08)')
    grade.addColorStop(1, 'rgba(60, 90, 40, 0.16)')
    ctx.fillStyle = grade
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(20, 40, 16, 0.14)'
    const drift = time * 6
    for (let row = 0; row < this.#map.rows; row++) for (let col = 0; col < this.#map.cols; col++) {
      if (this.#at(col, row) === '#') continue
      const g = islandHash(col, row, 231)
      if (g > 0.22) continue
      const x = col * tile - camera.x + tile * (0.2 + ((g * 340 + drift) % (tile * 1.4)) / tile * 0.3)
      const y = row * tile - camera.y + tile * (0.3 + g * 0.4)
      if (x < -tile || x > width + tile || y < -tile || y > height + tile) continue
      ctx.beginPath()
      ctx.ellipse(x, y, tile * 0.22, tile * 0.11, 0.4, 0, TAU)
      ctx.fill()
    }
  }

  #at(col: number, row: number): string { return this.#map.tiles[row]?.[col] ?? '#' }

  #bake(tile: number, dpr: number): HTMLCanvasElement | null {
    const scale = Math.min(dpr, 1.5)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(this.#map.cols * tile * scale)
    canvas.height = Math.ceil(this.#map.rows * tile * scale)
    const ctx = canvasContext(canvas)
    if (!ctx) return null
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    const wood = this.#wood
    for (let row = 0; row < this.#map.rows; row++) for (let col = 0; col < this.#map.cols; col++) {
      const cell = this.#at(col, row)
      if (cell === '~') pool(ctx, col * tile, row * tile, tile, col, row, this.#at(col, row - 1) !== '~', wood)
      else floor(ctx, col * tile, row * tile, tile, col, row, this.#at(col, row - 1) === '#', wood)
    }
    for (let row = 0; row < this.#map.rows; row++) for (let col = 0; col < this.#map.cols; col++) {
      if (this.#at(col, row) !== '#') continue
      wall(ctx, col * tile, row * tile, tile, col, row, this.#at(col, row + 1), this.#at(col, row - 1), this.#at(col - 1, row), this.#at(col + 1, row), wood)
    }
    if (!wood) for (const torch of this.torches) {
      ctx.fillStyle = '#1a1512'
      ctx.fillRect((torch.x - 0.09) * tile, (torch.y + 0.02) * tile, 0.18 * tile, 0.08 * tile)
      ctx.fillStyle = '#5a3d24'
      ctx.fillRect((torch.x - 0.04) * tile, (torch.y - 0.12) * tile, 0.08 * tile, 0.22 * tile)
    }
    return canvas
  }

  #glints(ctx: CanvasRenderingContext2D, camera: CavernCamera, time: number): void {
    const { tile } = camera
    ctx.strokeStyle = 'rgba(160, 225, 235, 0.35)'
    ctx.lineWidth = Math.max(1, tile * 0.03)
    ctx.lineCap = 'round'
    for (let row = 0; row < this.#map.rows; row++) for (let col = 0; col < this.#map.cols; col++) {
      if (this.#at(col, row) !== '~') continue
      const grain = islandHash(col, row, 221)
      if (grain > 0.3) continue
      const phase = (time * 0.25 + grain * 11) % 1
      const x = col * tile - camera.x + tile * (0.15 + phase * 0.5), y = row * tile - camera.y + tile * (0.3 + grain * 1.6)
      if (x < -tile || x > camera.width + tile || y < -tile || y > camera.height + tile) continue
      ctx.globalAlpha = Math.sin(phase * Math.PI)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + tile * 0.12, y - tile * 0.04, x + tile * 0.26, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}

function radialSprite(rgb: string, stops: readonly (readonly [number, number])[]): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvasContext(canvas)
  if (!ctx) return null
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(${rgb}, ${alpha})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  return canvas
}

function floor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, wallAbove: boolean, wood: boolean): void {
  if (wood) { floorWood(ctx, x, y, s, col, row, wallAbove); return }
  const g = islandHash(col, row, 201), h = islandHash(col, row, 203)
  const tone = 50 + Math.floor(g * 12)
  ctx.fillStyle = `rgb(${tone + 8}, ${tone + 1}, ${tone - 8})`
  ctx.fillRect(x, y, s, s)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.fillRect(x, y + s * 0.5 - 0.5, s, Math.max(1, s * 0.025))
  ctx.fillRect(x + s * (row % 2 ? 0.3 : 0.7), y, Math.max(1, s * 0.025), s * 0.5)
  ctx.fillRect(x + s * (row % 2 ? 0.7 : 0.3), y + s * 0.5, Math.max(1, s * 0.025), s * 0.5)
  ctx.fillStyle = 'rgba(255, 236, 200, 0.06)'
  ctx.fillRect(x + s * 0.04, y + s * 0.04, s * 0.4, Math.max(1, s * 0.04))
  ctx.fillRect(x + s * 0.54, y + s * 0.54, s * 0.4, Math.max(1, s * 0.04))
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = k % 2 ? 'rgba(18, 14, 10, 0.4)' : 'rgba(170, 150, 118, 0.18)'
    ctx.fillRect(x + islandHash(col + k, row, 205) * s, y + islandHash(col, row + k, 207) * s, Math.max(1, s * 0.035), Math.max(1, s * 0.035))
  }
  if (h < 0.08) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath(); ctx.ellipse(x + s * 0.62, y + s * 0.7, s * 0.1, s * 0.05, 0, 0, TAU); ctx.fill()
    ctx.fillStyle = '#7b7163'
    ctx.beginPath(); ctx.ellipse(x + s * 0.6, y + s * 0.66, s * 0.09, s * 0.06, 0, 0, TAU); ctx.fill()
  } else if (h > 0.93) {
    ctx.fillStyle = 'rgba(70, 104, 58, 0.45)'
    ctx.beginPath(); ctx.ellipse(x + s * 0.4, y + s * 0.6, s * 0.2, s * 0.09, 0, 0, TAU); ctx.fill()
  }
  if (wallAbove) {
    const shade = ctx.createLinearGradient(0, y, 0, y + s * 0.4)
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.6)')
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = shade
    ctx.fillRect(x, y, s, s * 0.4)
    if (h > 0.82) {
      ctx.fillStyle = '#4d4236'
      ctx.beginPath(); ctx.moveTo(x + s * 0.7, y + s * 0.62); ctx.lineTo(x + s * 0.8, y + s * 0.2); ctx.lineTo(x + s * 0.9, y + s * 0.62); ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(255, 230, 190, 0.18)'
      ctx.beginPath(); ctx.moveTo(x + s * 0.73, y + s * 0.6); ctx.lineTo(x + s * 0.8, y + s * 0.24); ctx.lineTo(x + s * 0.8, y + s * 0.6); ctx.closePath(); ctx.fill()
    }
  }
}

/** Grass instead of flagstone: angled blade strokes in two greens, the same
 *  sparse leaf-litter/pale-patch accents, and — under a canopy cell — a soft
 *  green-black shade rather than the cavern's cold black. */
function floorWood(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, wallAbove: boolean): void {
  const g = islandHash(col, row, 201), h = islandHash(col, row, 203)
  const tone = 96 + Math.floor(g * 22)
  ctx.fillStyle = `rgb(${tone - 30}, ${tone + 18}, ${tone - 46})`
  ctx.fillRect(x, y, s, s)
  for (let k = 0; k < 5; k++) {
    const bx = x + islandHash(col + k, row, 205) * s, by = y + islandHash(col, row + k, 207) * s
    ctx.strokeStyle = k % 2 ? 'rgba(46, 84, 32, 0.5)' : 'rgba(150, 196, 96, 0.35)'
    ctx.lineWidth = Math.max(1, s * 0.03)
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + s * 0.05, by - s * 0.14)
    ctx.stroke()
  }
  if (h < 0.1) {
    ctx.fillStyle = 'rgba(60, 44, 22, 0.5)'
    ctx.beginPath(); ctx.ellipse(x + s * 0.6, y + s * 0.68, s * 0.11, s * 0.05, 0.3, 0, TAU); ctx.fill()
  } else if (h > 0.9) {
    ctx.fillStyle = 'rgba(220, 210, 150, 0.3)'
    ctx.beginPath(); ctx.ellipse(x + s * 0.35, y + s * 0.4, s * 0.16, s * 0.08, -0.2, 0, TAU); ctx.fill()
  }
  if (wallAbove) {
    const shade = ctx.createLinearGradient(0, y, 0, y + s * 0.5)
    shade.addColorStop(0, 'rgba(10, 26, 8, 0.5)')
    shade.addColorStop(1, 'rgba(10, 26, 8, 0)')
    ctx.fillStyle = shade
    ctx.fillRect(x, y, s, s * 0.5)
  }
}

function pool(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, bankAbove: boolean, wood: boolean): void {
  if (wood) { poolWood(ctx, x, y, s, col, row, bankAbove); return }
  const g = islandHash(col, row, 213)
  ctx.fillStyle = g < 0.5 ? '#0f262b' : '#11292f'
  ctx.fillRect(x, y, s, s)
  ctx.strokeStyle = 'rgba(110, 190, 200, 0.12)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  ctx.beginPath()
  ctx.arc(x + s * (0.3 + g * 0.4), y + s * 0.8, s * 0.22, Math.PI * 1.2, Math.PI * 1.8)
  ctx.stroke()
  if (bankAbove) {
    ctx.fillStyle = '#261e17'
    ctx.fillRect(x, y, s, s * 0.18)
    ctx.fillStyle = 'rgba(160, 220, 225, 0.25)'
    ctx.fillRect(x, y + s * 0.18, s, Math.max(1, s * 0.04))
  }
}

/** A still pond instead of a dark cavern pool: warmer, greener water, a bank
 *  of grass instead of stone. */
function poolWood(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, bankAbove: boolean): void {
  const g = islandHash(col, row, 213)
  ctx.fillStyle = g < 0.5 ? '#2e6a5c' : '#357a68'
  ctx.fillRect(x, y, s, s)
  ctx.strokeStyle = 'rgba(220, 240, 200, 0.18)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  ctx.beginPath()
  ctx.arc(x + s * (0.3 + g * 0.4), y + s * 0.75, s * 0.2, Math.PI * 1.2, Math.PI * 1.8)
  ctx.stroke()
  if (bankAbove) {
    ctx.fillStyle = '#2f4a22'
    ctx.fillRect(x, y, s, s * 0.16)
    ctx.fillStyle = 'rgba(210, 230, 170, 0.28)'
    ctx.fillRect(x, y + s * 0.16, s, Math.max(1, s * 0.04))
  }
}

function wall(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, below: string, above: string, left: string, right: string, wood: boolean): void {
  if (wood) { wallWood(ctx, x, y, s, col, row, below, above, left, right); return }
  const g = islandHash(col, row, 211), h = islandHash(col, row, 215)
  const face = below !== '#'
  ctx.fillStyle = '#1b1814'
  ctx.fillRect(x, y, s, face ? s * 0.44 : s)
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = 'rgba(96, 84, 70, 0.22)'
    ctx.fillRect(x + islandHash(col + k, row, 217) * s, y + islandHash(col, row + k, 219) * s * (face ? 0.4 : 1), Math.max(1, s * 0.05), Math.max(1, s * 0.03))
  }
  if (above !== '#') {
    ctx.fillStyle = 'rgba(150, 128, 104, 0.35)'
    ctx.fillRect(x, y, s, Math.max(1, s * 0.04))
  }
  if (face) {
    const top = y + s * 0.4
    const rock = ctx.createLinearGradient(0, top, 0, y + s)
    rock.addColorStop(0, '#62533f')
    rock.addColorStop(0.55, '#463a2e')
    rock.addColorStop(1, '#2a231d')
    ctx.fillStyle = rock
    ctx.fillRect(x, top, s, s * 0.6)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.fillRect(x, top + s * (0.2 + g * 0.05), s, Math.max(1, s * 0.03))
    ctx.fillRect(x, top + s * (0.4 + h * 0.04), s, Math.max(1, s * 0.03))
    ctx.fillRect(x + s * (0.2 + g * 0.5), top, Math.max(1, s * 0.03), s * 0.22)
    ctx.fillRect(x + s * (0.1 + h * 0.7), top + s * 0.22, Math.max(1, s * 0.03), s * 0.2)
    ctx.fillStyle = 'rgba(214, 184, 140, 0.24)'
    ctx.fillRect(x, top, s, Math.max(1, s * 0.035))
  }
  if (left !== '#') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.fillRect(x, y, Math.max(2, s * 0.06), s)
  }
  if (right !== '#') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.fillRect(x + s - Math.max(2, s * 0.06), y, Math.max(2, s * 0.06), s)
  }
}

/** A trunk seen from the front where the ground opens below it; a leafy
 *  canopy top, seen from above, everywhere else — boulders and dense brush
 *  read the same way the Hollow Grove's own boulder ring does. */
function wallWood(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, below: string, above: string, left: string, right: string): void {
  const g = islandHash(col, row, 211), h = islandHash(col, row, 215)
  const face = below !== '#'
  ctx.fillStyle = '#173a1c'
  ctx.fillRect(x, y, s, face ? s * 0.44 : s)
  for (let k = 0; k < 5; k++) {
    ctx.fillStyle = k % 2 ? 'rgba(60, 110, 50, 0.3)' : 'rgba(10, 24, 10, 0.35)'
    ctx.beginPath()
    ctx.ellipse(x + islandHash(col + k, row, 217) * s, y + islandHash(col, row + k, 219) * s * (face ? 0.4 : 1), s * 0.09, s * 0.05, 0, 0, TAU)
    ctx.fill()
  }
  if (above !== '#') {
    ctx.fillStyle = 'rgba(90, 130, 70, 0.3)'
    ctx.fillRect(x, y, s, Math.max(1, s * 0.04))
  }
  if (face) {
    const top = y + s * 0.4
    const bark = ctx.createLinearGradient(0, top, 0, y + s)
    bark.addColorStop(0, '#6a4a2c')
    bark.addColorStop(0.55, '#4a3320')
    bark.addColorStop(1, '#2c2013')
    ctx.fillStyle = bark
    ctx.fillRect(x, top, s, s * 0.6)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)'
    ctx.lineWidth = Math.max(1, s * 0.025)
    ctx.beginPath()
    ctx.moveTo(x + s * (0.2 + g * 0.15), top); ctx.lineTo(x + s * (0.24 + g * 0.15), y + s)
    ctx.moveTo(x + s * (0.6 + h * 0.15), top); ctx.lineTo(x + s * (0.56 + h * 0.15), y + s)
    ctx.stroke()
    ctx.fillStyle = 'rgba(210, 190, 140, 0.16)'
    ctx.fillRect(x, top, s, Math.max(1, s * 0.03))
  }
  if (left !== '#') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)'
    ctx.fillRect(x, y, Math.max(2, s * 0.06), s)
  }
  if (right !== '#') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)'
    ctx.fillRect(x + s - Math.max(2, s * 0.06), y, Math.max(2, s * 0.06), s)
  }
}

function flame(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, time: number): void {
  const lick = 1 + Math.sin(time * 13) * 0.12 + Math.sin(time * 7.7) * 0.08
  const top = y - s * 0.34 * lick
  for (const [color, width, lift] of [['rgba(255, 120, 30, 0.9)', 0.1, 0], ['#ffc257', 0.065, 0.03], ['#fff4c8', 0.03, 0.06]] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x - s * width, y - s * 0.1)
    ctx.quadraticCurveTo(x - s * width, top + s * lift + s * 0.08, x, top + s * lift)
    ctx.quadraticCurveTo(x + s * width, top + s * lift + s * 0.08, x + s * width, y - s * 0.1)
    ctx.closePath()
    ctx.fill()
  }
}
