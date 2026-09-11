// Paints the island in three-quarter view. The ground is seen from above, but
// whatever stands on it — trees, houses, brick walls, cliff faces — is seen
// from the front and rises into the cell behind it. That takes two canvases:
// GROUND under the people, and ABOVE over them, holding only the part of a
// thing that rises into the cell behind it. Walk north of a tree and you pass
// behind it; walk south of it and you are in front.
//
// Land is drawn as soft unions of per-cell discs filled with tileable
// textures, so coasts, forest floors and roads have organic edges instead of
// square tiles. Terrain changes only when the wand touches it, so each chunk
// of each layer is baked once and blitted, and a cast forgets just the chunks
// around its cell. Per frame: water glints, cloud shadows, motes, wand effects
// and one baked light grade. No shadowBlur.

import { islandHash, type Island, type IslandHouse, type IslandTerrain } from './island.js'

const CHUNK = 12
const TAU = Math.PI * 2

/** The visible window in CSS pixels; `tile` is the size of one cell. */
export interface IslandCamera { x: number; y: number; width: number; height: number; tile: number; dpr: number }
/** A cell as it is now: the island as built, with the wand's changes on top. */
export type TerrainLookup = (col: number, row: number) => IslandTerrain
export interface WandBurst { x: number; y: number; age: number; kind: 'lay' | 'lift' | 'deny' }
export const BURST_LIFE = 0.6

export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try { return canvas.getContext('2d') } catch { return null }
}

const isWater = (t: IslandTerrain): boolean => t === 'deep' || t === 'water' || t === 'spring' || t === 'stone' || t === 'bridge'
const isLand = (t: IslandTerrain): boolean => !isWater(t)
const isHighland = (t: IslandTerrain): boolean => t === 'rock' || t === 'snow'
const isBlock = (t: IslandTerrain): boolean => t === 'brick' || t === 'crack' || t === 'laid' || t === 'seal'
const isFloor = (t: IslandTerrain): boolean => t === 'plaza' || t === 'rubble' || t === 'rune' || isBlock(t)
const isRoad = (t: IslandTerrain): boolean => t === 'path' || t === 'bridge'
const isGrassy = (t: IslandTerrain): boolean => isLand(t) && t !== 'sand'

const ROOFS = ['#b0503c', '#4f6f9f', '#7b5a9e', '#b3743a'] as const
const FLOWER_COLORS = ['#f4e27c', '#f3a6c9', '#ffffff', '#b9a8f4'] as const
const MINIMAP: Readonly<Record<IslandTerrain, readonly [number, number, number]>> = {
  deep: [24, 70, 104], water: [66, 146, 172], sand: [220, 198, 142], grass: [96, 144, 70], path: [214, 190, 138],
  bridge: [170, 120, 74], tree: [44, 92, 50], hill: [132, 158, 92], rock: [140, 132, 114], snow: [240, 244, 247],
  plaza: [200, 190, 170], house: [176, 85, 63], brick: [168, 116, 76], crack: [168, 116, 76], rubble: [196, 184, 164],
  rune: [226, 196, 120], laid: [212, 150, 92], spring: [120, 214, 232], stone: [186, 178, 164], seal: [132, 120, 190],
}

interface Cell { col: number; row: number; terrain: IslandTerrain; x: number; y: number; grain: number }
type Layer = 'ground' | 'above'

export class IslandPainter {
  readonly #island: Island
  readonly #terrainAt: TerrainLookup
  /** Baked chunks by layer and position; null records a chunk with nothing on it. */
  readonly #chunks = new Map<string, HTMLCanvasElement | null>()
  readonly #textures = new Map<string, CanvasPattern | null>()
  #scale = ''
  #cloud: HTMLCanvasElement | null | undefined
  #grading: { key: string; canvas: HTMLCanvasElement | null } = { key: '', canvas: null }

  constructor(island: Island, terrainAt: TerrainLookup) {
    this.#island = island
    this.#terrainAt = terrainAt
  }

  paint(ground: CanvasRenderingContext2D, above: CanvasRenderingContext2D | null, camera: IslandCamera, time: number): void {
    const { tile, dpr, x, y, width, height } = camera
    const scale = `${tile}:${dpr}`
    if (scale !== this.#scale) { this.#chunks.clear(); this.#scale = scale }
    ground.setTransform(dpr, 0, 0, dpr, 0, 0)
    ground.fillStyle = TEXTURES.deep.fallback
    ground.fillRect(0, 0, width, height)
    above?.setTransform(dpr, 0, 0, dpr, 0, 0)
    above?.clearRect(0, 0, width, height)
    const span = CHUNK * tile
    const c0 = Math.max(0, Math.floor(x / span)), c1 = Math.min(Math.ceil(this.#island.cols / CHUNK) - 1, Math.floor((x + width) / span))
    const r0 = Math.max(0, Math.floor(y / span)), r1 = Math.min(Math.ceil(this.#island.rows / CHUNK) - 1, Math.floor((y + height) / span))
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const floor = this.#chunk('ground', col, row, tile, dpr)
      if (floor) ground.drawImage(floor, col * span - x, row * span - y, span, span)
      const rising = above ? this.#chunk('above', col, row, tile, dpr) : null
      if (rising && above) above.drawImage(rising, col * span - x, row * span - y, span, span)
    }
    // Keep what is on screen plus a ring around it; the oldest bakes go first.
    const keep = 2 * (c1 - c0 + 3) * (r1 - r0 + 3)
    while (this.#chunks.size > keep) this.#chunks.delete(this.#chunks.keys().next().value as string)
    this.#water(ground, camera, time)
  }

  /** Everything over the people: cloud shadows, the wand, motes and the light. */
  paintOverlay(ctx: CanvasRenderingContext2D, camera: IslandCamera, time: number, bursts: readonly WandBurst[], reticle: { col: number; row: number } | null): void {
    ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0)
    this.#clouds(ctx, camera, time)
    if (reticle) drawReticle(ctx, camera, reticle, time)
    for (const burst of bursts) drawBurst(ctx, camera, burst)
    drawMotes(ctx, camera, time)
    this.#grade(ctx, camera)
  }

  /** Forgets the baked chunks a changed cell can show in. */
  invalidate(col: number, row: number): void {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const key = `${Math.floor((col + dc) / CHUNK)},${Math.floor((row + dr) / CHUNK)}`
      this.#chunks.delete(`ground:${key}`)
      this.#chunks.delete(`above:${key}`)
    }
  }

  /** The whole island as built, at one pixel per cell. */
  minimap(): HTMLCanvasElement | null {
    const { cols, rows, grid } = this.#island
    const canvas = document.createElement('canvas')
    canvas.width = cols
    canvas.height = rows
    const ctx = canvasContext(canvas)
    if (!ctx) return null
    const image = ctx.createImageData(cols, rows)
    for (let i = 0; i < grid.length; i++) {
      const [r, g, b] = MINIMAP[this.#terrainAt(i % cols, Math.floor(i / cols))]
      image.data[i * 4] = r
      image.data[i * 4 + 1] = g
      image.data[i * 4 + 2] = b
      image.data[i * 4 + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  #chunk(layer: Layer, chunkCol: number, chunkRow: number, tile: number, dpr: number): HTMLCanvasElement | null {
    const key = `${layer}:${chunkCol},${chunkRow}`
    if (this.#chunks.has(key)) {
      const cached = this.#chunks.get(key) ?? null
      this.#chunks.delete(key)
      this.#chunks.set(key, cached)
      return cached
    }
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = Math.ceil(CHUNK * tile * dpr)
    const ctx = canvasContext(canvas)
    if (!ctx) return null
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const col0 = chunkCol * CHUNK, row0 = chunkRow * CHUNK
    const drew = layer === 'ground' ? this.#bakeGround(ctx, col0, row0, tile, dpr) : this.#bakeAbove(ctx, col0, row0, tile)
    const baked = drew ? canvas : null
    this.#chunks.set(key, baked)
    return baked
  }

  #bakeGround(ctx: CanvasRenderingContext2D, col0: number, row0: number, tile: number, dpr: number): boolean {
    const at = this.#terrainAt
    const texture = (name: TextureName): string | CanvasPattern => this.#texture(ctx, name, col0, row0, tile, dpr)
    const cells: Cell[] = []
    for (let row = -2; row < CHUNK + 2; row++) for (let col = -2; col < CHUNK + 2; col++) {
      const c = col0 + col, r = row0 + row
      cells.push({ col: c, row: r, terrain: at(c, r), x: col * tile, y: row * tile, grain: islandHash(c, r, 51) })
    }
    const union = (test: (t: IslandTerrain) => boolean, radius: number, lift = 0): Path2D => {
      const path = new Path2D()
      for (const cell of cells) {
        if (!test(cell.terrain)) continue
        const r = radius * tile * (0.93 + cell.grain * 0.14)
        const cx = cell.x + tile / 2, cy = cell.y + tile / 2 + lift * tile
        path.moveTo(cx + r, cy)
        path.arc(cx, cy, r, 0, TAU)
      }
      return path
    }
    const fill = (style: string | CanvasPattern, path: Path2D): void => { ctx.fillStyle = style; ctx.fill(path) }

    ctx.fillStyle = texture('deep')
    ctx.fillRect(0, 0, CHUNK * tile, CHUNK * tile)
    fill(texture('shallow'), union(isLand, 1.45))
    fill(texture('shallow'), union(t => isWater(t) && t !== 'deep', 0.8))
    fill('rgba(236, 250, 252, 0.5)', union(isLand, 0.9))
    fill('#5a4630', union(isLand, 0.74, 0.16))
    fill(texture('sand'), union(isLand, 0.74))
    fill(texture('grass'), union(isGrassy, 0.66))
    fill(texture('forest'), union(t => t === 'tree', 0.62))
    fill('rgba(196, 226, 132, 0.2)', union(t => t === 'hill', 0.5, -0.12))
    fill('rgba(28, 48, 20, 0.2)', union(t => t === 'hill', 0.48, 0.24))

    const roads = (width: number): Path2D => {
      const path = new Path2D()
      const half = width * tile / 2
      const joins = (t: IslandTerrain): boolean => isRoad(t) || isFloor(t)
      for (const cell of cells) {
        if (!isRoad(cell.terrain)) continue
        const cx = cell.x + tile / 2, cy = cell.y + tile / 2
        path.moveTo(cx + half, cy)
        path.arc(cx, cy, half, 0, TAU)
        if (joins(at(cell.col + 1, cell.row))) path.rect(cx, cy - half, tile, half * 2)
        if (joins(at(cell.col, cell.row + 1))) path.rect(cx - half, cy, half * 2, tile)
        if (isFloor(at(cell.col - 1, cell.row))) path.rect(cx - tile, cy - half, tile, half * 2)
        if (isFloor(at(cell.col, cell.row - 1))) path.rect(cx - half, cy - tile, half * 2, tile)
      }
      return path
    }
    fill('rgba(88, 68, 40, 0.42)', roads(0.94))
    fill(texture('dirt'), roads(0.76))

    const floors = (inset: number): Path2D => {
      const path = new Path2D()
      for (const cell of cells) {
        if (isFloor(cell.terrain)) path.rect(cell.x - inset * tile, cell.y - inset * tile, tile * (1 + inset * 2), tile * (1 + inset * 2))
      }
      return path
    }
    fill('rgba(70, 58, 44, 0.45)', floors(0.1))
    fill(texture('cobble'), floors(0.04))
    fill(texture('rock'), union(isHighland, 0.66))
    fill(texture('snow'), union(t => t === 'snow', 0.6))

    for (const cell of cells) {
      if (cell.col < col0 - 1 || cell.col > col0 + CHUNK || cell.row < row0 - 1 || cell.row > row0 + CHUNK) continue
      const { x, y, terrain, grain } = cell
      if (isHighland(terrain)) {
        if (!isHighland(at(cell.col, cell.row + 1))) drawCliff(ctx, x, y, tile, terrain === 'snow', grain)
      } else if (terrain === 'grass' || terrain === 'sand' || terrain === 'hill') drawDecor(ctx, x, y, tile, terrain, cell.col, cell.row, at)
      else if (terrain === 'tree') drawTrunk(ctx, x, y, tile)
      else if (terrain === 'bridge') drawBridge(ctx, x, y, tile, isRoad(at(cell.col - 1, cell.row)) || isRoad(at(cell.col + 1, cell.row)))
      else if (terrain === 'rune') drawRune(ctx, x, y, tile)
      else if (terrain === 'spring' || terrain === 'stone') {
        drawSpring(ctx, x, y, tile)
        if (terrain === 'stone') drawStone(ctx, x, y, tile)
      } else if (terrain === 'rubble') drawRubble(ctx, x, y, tile, cell.col, cell.row)
      else if (isBlock(terrain)) drawBlock(ctx, x, y, tile, terrain, grain)
    }
    // The lower part of each crown stays in its own row; it may spill sideways.
    for (let row = 0; row < CHUNK; row++) {
      clipBand(ctx, row * tile, tile, () => {
        for (let col = -1; col <= CHUNK; col++) {
          if (at(col0 + col, row0 + row) === 'tree') drawCanopy(ctx, col * tile, row * tile, tile, col0 + col, row0 + row, at)
        }
      })
    }
    for (const house of this.#island.houses) {
      if (!overlaps(house.x - 1, house.y, house.w + 2, house.h + 1, col0, row0)) continue
      clipBand(ctx, (house.y - row0) * tile, (house.h + 0.2) * tile, () => drawHouse(ctx, house, (house.x - col0) * tile, (house.y - row0) * tile, tile))
    }
    return true
  }

  /** Band `row` holds what rises out of the row below it. */
  #bakeAbove(ctx: CanvasRenderingContext2D, col0: number, row0: number, tile: number): boolean {
    const at = this.#terrainAt
    let drew = false
    for (let row = 0; row < CHUNK; row++) {
      const trees: number[] = []
      for (let col = -1; col <= CHUNK; col++) if (at(col0 + col, row0 + row + 1) === 'tree') trees.push(col)
      if (!trees.length) continue
      drew = true
      clipBand(ctx, row * tile, tile, () => {
        for (const col of trees) drawCanopy(ctx, col * tile, (row + 1) * tile, tile, col0 + col, row0 + row + 1, at)
      })
    }
    for (const house of this.#island.houses) {
      if (!overlaps(house.x, house.y - 1, house.w, 1, col0, row0)) continue
      drew = true
      clipBand(ctx, (house.y - 1 - row0) * tile, tile, () => drawHouse(ctx, house, (house.x - col0) * tile, (house.y - row0) * tile, tile))
    }
    return drew
  }

  #texture(ctx: CanvasRenderingContext2D, name: TextureName, col0: number, row0: number, tile: number, dpr: number): string | CanvasPattern {
    const size = Math.max(16, Math.round(tile * 3 * dpr / 2) * 2)
    const key = `${name}:${size}`
    let pattern = this.#textures.get(key)
    if (pattern === undefined) {
      const image = makeTexture(name, size)
      pattern = image ? ctx.createPattern(image, 'repeat') : null
      this.#textures.set(key, pattern)
    }
    if (!pattern) return TEXTURES[name].fallback
    // Anchor the texture to the island, not the chunk, so chunks meet seamlessly.
    const period = size / dpr
    pattern.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, -((col0 * tile) % period), -((row0 * tile) % period)]))
    return pattern
  }

  #water(ctx: CanvasRenderingContext2D, camera: IslandCamera, time: number): void {
    const { tile, x, y, width, height } = camera
    const c0 = Math.max(0, Math.floor(x / tile)), c1 = Math.min(this.#island.cols - 1, Math.floor((x + width) / tile))
    const r0 = Math.max(0, Math.floor(y / tile)), r1 = Math.min(this.#island.rows - 1, Math.floor((y + height) / tile))
    ctx.lineCap = 'round'
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      const grain = islandHash(col, row, 77)
      if (grain > 0.14) continue
      const terrain = this.#terrainAt(col, row)
      if (terrain !== 'water' && terrain !== 'deep' && terrain !== 'spring') continue
      const px = col * tile - x, py = row * tile - y
      if (grain < 0.1) {
        const phase = (time * 0.3 + grain * 37) % 1
        ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.35
        ctx.strokeStyle = '#d6f2f8'
        ctx.lineWidth = Math.max(1, tile * 0.04)
        const lx = px + tile * (0.1 + phase * 0.5), ly = py + tile * (0.25 + grain * 5)
        ctx.beginPath()
        ctx.moveTo(lx, ly)
        ctx.quadraticCurveTo(lx + tile * 0.14, ly - tile * 0.05, lx + tile * 0.3, ly)
        ctx.stroke()
      } else {
        const twinkle = Math.sin(time * 2.6 + grain * 400)
        if (twinkle < 0.75) continue
        ctx.globalAlpha = Math.min(1, (twinkle - 0.75) * 3)
        ctx.fillStyle = '#ffffff'
        const sx = px + tile * 0.5, sy = py + tile * 0.5, arm = tile * 0.09
        ctx.fillRect(sx - arm, sy - 0.75, arm * 2, 1.5)
        ctx.fillRect(sx - 0.75, sy - arm, 1.5, arm * 2)
      }
    }
    ctx.globalAlpha = 1
  }

  #clouds(ctx: CanvasRenderingContext2D, camera: IslandCamera, time: number): void {
    if (this.#cloud === undefined) this.#cloud = cloudSprite()
    const cloud = this.#cloud
    if (!cloud) return
    const { tile } = camera
    const worldWidth = this.#island.cols * tile, worldHeight = this.#island.rows * tile
    const w = tile * 16, h = tile * 9
    ctx.globalAlpha = 0.14
    for (let k = 0; k < 22; k++) {
      const drift = islandHash(k, 5, 83) * (worldWidth + w) + time * tile * (0.25 + islandHash(k, 7, 83) * 0.2)
      const cx = (drift % (worldWidth + w)) - w - camera.x
      const cy = islandHash(k, 6, 83) * worldHeight - camera.y
      if (cx > camera.width || cx + w < 0 || cy > camera.height || cy + h < 0) continue
      ctx.drawImage(cloud, cx, cy, w, h)
    }
    ctx.globalAlpha = 1
  }

  #grade(ctx: CanvasRenderingContext2D, camera: IslandCamera): void {
    const key = `${camera.width}x${camera.height}`
    if (this.#grading.key !== key) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(camera.width / 2))
      canvas.height = Math.max(1, Math.round(camera.height / 2))
      const g = canvasContext(canvas)
      if (g) {
        const w = canvas.width, h = canvas.height
        const light = g.createLinearGradient(0, 0, 0, h)
        light.addColorStop(0, 'rgba(255, 232, 180, 0.12)')
        light.addColorStop(0.45, 'rgba(255, 232, 180, 0)')
        g.fillStyle = light
        g.fillRect(0, 0, w, h)
        const edge = g.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.34, w / 2, h * 0.55, Math.hypot(w, h) * 0.62)
        edge.addColorStop(0, 'rgba(8, 16, 22, 0)')
        edge.addColorStop(1, 'rgba(8, 16, 22, 0.44)')
        g.fillStyle = edge
        g.fillRect(0, 0, w, h)
      }
      this.#grading = { key, canvas: g ? canvas : null }
    }
    if (this.#grading.canvas) ctx.drawImage(this.#grading.canvas, 0, 0, camera.width, camera.height)
  }
}

function overlaps(x: number, y: number, w: number, h: number, col0: number, row0: number): boolean {
  return x + w > col0 && x < col0 + CHUNK && y + h > row0 && y < row0 + CHUNK
}

/** Draws inside one horizontal band of the chunk only. */
function clipBand(ctx: CanvasRenderingContext2D, y: number, height: number, draw: () => void): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(-ctx.canvas.width, y, ctx.canvas.width * 3, height)
  ctx.clip()
  draw()
  ctx.restore()
}

function tint(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1, 7), 16)
  const channel = (shift: number): number => {
    const c = (value >> shift) & 255
    return Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function ellipse(ctx: CanvasRenderingContext2D, color: string | CanvasGradient, x: number, y: number, rx: number, ry: number): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU)
  ctx.fill()
}

function hexagramPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (const start of [-Math.PI / 2, Math.PI / 2]) {
    for (let k = 0; k <= 3; k++) {
      const angle = start + k * TAU / 3
      if (k === 0) ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
      else ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    }
  }
}

// ── cells ──────────────────────────────────────────────────

function drawCliff(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, snow: boolean, grain: number): void {
  ellipse(ctx, 'rgba(18, 20, 14, 0.3)', x + 0.5 * s, y + 1.1 * s, 0.66 * s, 0.15 * s)
  const top = y + 0.44 * s, bottom = y + 1.06 * s
  const face = ctx.createLinearGradient(0, top, 0, bottom)
  face.addColorStop(0, snow ? '#a4aeb6' : '#968c79')
  face.addColorStop(0.5, snow ? '#7c868f' : '#6e6556')
  face.addColorStop(1, snow ? '#586069' : '#4a433a')
  ctx.fillStyle = face
  roundedRect(ctx, x - 0.12 * s, top, 1.24 * s, bottom - top, 0.14 * s)
  ctx.fill()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
  for (let k = 0; k < 4; k++) {
    const sx = x + (0.02 + k * 0.27 + grain * 0.08) * s
    ctx.beginPath()
    ctx.moveTo(sx, top + 0.08 * s)
    ctx.lineTo(sx + 0.05 * s, bottom - 0.1 * s)
    ctx.lineTo(sx + 0.1 * s, bottom - 0.1 * s)
    ctx.lineTo(sx + 0.06 * s, top + 0.08 * s)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.fillRect(x - 0.1 * s, top, 1.2 * s, 0.06 * s)
  if (snow) {
    ctx.fillStyle = '#f3f7fa'
    roundedRect(ctx, x - 0.1 * s, top - 0.05 * s, 1.2 * s, 0.1 * s, 0.05 * s)
    ctx.fill()
  }
}

function drawDecor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, terrain: IslandTerrain, col: number, row: number, at: TerrainLookup): void {
  const g = islandHash(col, row, 61), h = islandHash(col, row, 67), k = islandHash(col, row, 71)
  if (terrain === 'sand') {
    if (g < 0.06) stones(ctx, x + (0.2 + h * 0.6) * s, y + (0.3 + k * 0.5) * s, s * 0.6)
    return
  }
  if (terrain === 'hill') {
    if (g < 0.1) boulder(ctx, x + (0.25 + h * 0.5) * s, y + (0.35 + k * 0.4) * s, s * 0.16)
    else if (g < 0.35) tuft(ctx, x + (0.2 + h * 0.6) * s, y + (0.3 + k * 0.5) * s, s)
    return
  }
  const neighbours = [at(col, row - 1), at(col, row + 1), at(col - 1, row), at(col + 1, row)]
  if (neighbours.some(isWater)) {
    if (g < 0.5) reeds(ctx, x + (0.15 + h * 0.7) * s, y + (0.5 + k * 0.35) * s, s)
    return
  }
  if (g < 0.07) flowers(ctx, x + (0.2 + h * 0.6) * s, y + (0.25 + k * 0.55) * s, s, k)
  else if (g < 0.1 && !neighbours.some(isRoad)) bush(ctx, x + (0.3 + h * 0.4) * s, y + (0.4 + k * 0.3) * s, s)
  else if (g < 0.12) stones(ctx, x + (0.2 + h * 0.6) * s, y + (0.3 + k * 0.5) * s, s)
  else if (g < 0.34) tuft(ctx, x + (0.2 + h * 0.6) * s, y + (0.3 + k * 0.6) * s, s)
}

function tuft(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(38, 80, 32, 0.75)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  ctx.beginPath()
  for (const lean of [-0.08, -0.02, 0.05, 0.1]) {
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + lean * s * 0.5, y - s * 0.08, x + lean * s, y - s * (0.12 + Math.abs(lean)))
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(166, 210, 108, 0.6)'
  ctx.beginPath()
  ctx.moveTo(x + s * 0.01, y)
  ctx.lineTo(x + s * 0.03, y - s * 0.13)
  ctx.stroke()
}

function flowers(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tone: number): void {
  const petal = FLOWER_COLORS[Math.floor(tone * FLOWER_COLORS.length)] ?? FLOWER_COLORS[0]
  for (const [dx, dy] of [[0, 0], [0.12, 0.05], [-0.08, 0.09]] as const) {
    const fx = x + dx * s, fy = y + dy * s, r = s * 0.035
    ctx.fillStyle = 'rgba(40, 80, 30, 0.8)'
    ctx.fillRect(fx - 0.5, fy, 1, s * 0.07)
    ctx.fillStyle = petal
    ctx.beginPath()
    for (let p = 0; p < 5; p++) {
      const angle = p / 5 * TAU
      ctx.moveTo(fx + Math.cos(angle) * r + r * 0.8, fy + Math.sin(angle) * r)
      ctx.arc(fx + Math.cos(angle) * r, fy + Math.sin(angle) * r, r * 0.8, 0, TAU)
    }
    ctx.fill()
    ellipse(ctx, '#f7d44a', fx, fy, r * 0.6, r * 0.6)
  }
}

function bush(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ellipse(ctx, 'rgba(10, 26, 10, 0.3)', x + s * 0.05, y + s * 0.13, s * 0.22, s * 0.07)
  const lobes = [[-0.09, 0, 0.12], [0.08, 0.01, 0.12], [0, -0.07, 0.13]] as const
  for (const [color, lift, scale] of [['#244f25', 0.025, 1.05], ['#3d7a35', 0, 1], ['#62a24e', -0.03, 0.45]] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    for (const [dx, dy, r] of lobes) {
      ctx.moveTo(x + dx * s + r * s * scale, y + (dy + lift) * s)
      ctx.arc(x + dx * s - (scale < 1 ? 0.03 * s : 0), y + (dy + lift) * s, r * s * scale, 0, TAU)
    }
    ctx.fill()
  }
}

function reeds(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.strokeStyle = '#557a36'
  ctx.lineWidth = Math.max(1, s * 0.025)
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const lean of [-0.06, 0, 0.07]) {
    ctx.moveTo(x + lean * s * 0.3, y)
    ctx.quadraticCurveTo(x + lean * s * 0.6, y - s * 0.14, x + lean * s, y - s * 0.28)
  }
  ctx.stroke()
  ellipse(ctx, '#6b4a2a', x + 0.07 * s, y - 0.3 * s, s * 0.022, s * 0.055)
  ellipse(ctx, '#6b4a2a', x - 0.06 * s, y - 0.28 * s, s * 0.022, s * 0.05)
}

function stones(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  for (const [dx, dy, r] of [[0, 0, 0.07], [0.1, 0.03, 0.045]] as const) {
    ellipse(ctx, 'rgba(20, 26, 16, 0.3)', x + (dx + 0.015) * s, y + (dy + 0.02) * s, r * s, r * 0.6 * s)
    ellipse(ctx, '#9c968a', x + dx * s, y + dy * s, r * s, r * 0.66 * s)
    ellipse(ctx, 'rgba(255, 255, 255, 0.35)', x + (dx - r * 0.3) * s, y + (dy - r * 0.25) * s, r * 0.4 * s, r * 0.22 * s)
  }
}

function boulder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ellipse(ctx, 'rgba(18, 22, 12, 0.32)', x + r * 0.3, y + r * 0.7, r * 1.1, r * 0.4)
  const body = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  body.addColorStop(0, '#b3ab98')
  body.addColorStop(1, '#6b6456')
  ellipse(ctx, body, x, y, r, r * 0.8)
  ellipse(ctx, 'rgba(255, 255, 255, 0.25)', x - r * 0.35, y - r * 0.35, r * 0.35, r * 0.2)
}

function drawTrunk(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ellipse(ctx, 'rgba(10, 24, 12, 0.34)', x + 0.64 * s, y + 0.9 * s, 0.44 * s, 0.13 * s)
  const bark = ctx.createLinearGradient(x + 0.42 * s, 0, x + 0.58 * s, 0)
  bark.addColorStop(0, '#7c5838')
  bark.addColorStop(1, '#43301f')
  ctx.fillStyle = bark
  roundedRect(ctx, x + 0.43 * s, y + 0.44 * s, 0.14 * s, 0.46 * s, 0.04 * s)
  ctx.fill()
  ellipse(ctx, '#43301f', x + 0.5 * s, y + 0.9 * s, 0.13 * s, 0.045 * s)
}

/** A tree's crown: standing on its own cell and rising into the one behind. */
function drawCanopy(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number, at: TerrainLookup): void {
  const g = islandHash(col, row, 41), g2 = islandHash(col, row, 43)
  const cx = x + (0.5 + (g - 0.5) * 0.1) * s
  const highland = [at(col, row - 1), at(col, row + 1), at(col - 1, row), at(col + 1, row)].some(t => t === 'hill' || isHighland(t))
  if (highland || g2 < 0.14) {
    for (let tier = 0; tier < 3; tier++) {
      const top = y + (-0.44 + tier * 0.3) * s, bottom = top + 0.56 * s, half = (0.24 + tier * 0.1) * s
      const body = ctx.createLinearGradient(cx - half, 0, cx + half, 0)
      body.addColorStop(0, '#448f4f')
      body.addColorStop(1, '#1d4f2e')
      for (const [style, dy, spread] of [['#15381f', 0.05 * s, 0.03 * s], [body, 0, 0]] as const) {
        ctx.fillStyle = style
        ctx.beginPath()
        ctx.moveTo(cx, top + dy)
        ctx.lineTo(cx + half + spread, bottom + dy)
        ctx.quadraticCurveTo(cx, bottom + dy + half * 0.28, cx - half - spread, bottom + dy)
        ctx.closePath()
        ctx.fill()
      }
    }
    return
  }
  const cy = y + (0.08 + (g2 - 0.5) * 0.08) * s
  const r = (0.47 + g * 0.05) * s
  const lobes = (style: string | CanvasGradient, scale: number, lift: number): void => {
    ctx.fillStyle = style
    ctx.beginPath()
    for (let k = 0; k < 7; k++) {
      const angle = k / 7 * TAU + g * 3
      const px = cx + Math.cos(angle) * r * 0.46, py = cy + Math.sin(angle) * r * 0.4 + lift * s
      const radius = r * (0.52 + islandHash(col + k, row, 47) * 0.12) * scale
      ctx.moveTo(px + radius, py)
      ctx.arc(px, py, radius, 0, TAU)
    }
    ctx.fill()
  }
  lobes('#163d21', 1, 0.07)
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r * 1.2)
  body.addColorStop(0, '#62ab5c')
  body.addColorStop(0.55, '#2f7036')
  body.addColorStop(1, '#1c4a27')
  lobes(body, 0.94, 0)
  ctx.fillStyle = 'rgba(160, 222, 126, 0.32)'
  ctx.beginPath()
  for (let k = 0; k < 5; k++) {
    const px = cx - r * 0.45 + islandHash(col, row + k, 53) * r * 0.7, py = cy - r * 0.55 + islandHash(col + k, row, 59) * r * 0.6
    const radius = r * (0.1 + islandHash(k, col, 61) * 0.08)
    ctx.moveTo(px + radius, py)
    ctx.arc(px, py, radius, 0, TAU)
  }
  ctx.fill()
}

/** A two-by-two house from the front: footing, timber-framed walls, lit
 *  windows and a door on its own cells; the tiled roof rises behind. */
function drawHouse(ctx: CanvasRenderingContext2D, house: IslandHouse, x: number, y: number, s: number): void {
  const w = house.w * s, h = house.h * s
  ctx.fillStyle = 'rgba(12, 24, 16, 0.3)'
  ctx.beginPath()
  ctx.moveTo(x + w - 0.08 * s, y + 0.95 * s)
  ctx.lineTo(x + w + 0.3 * s, y + 1.2 * s)
  ctx.lineTo(x + w + 0.3 * s, y + h + 0.06 * s)
  ctx.lineTo(x + 0.25 * s, y + h + 0.06 * s)
  ctx.lineTo(x + 0.25 * s, y + h - 0.1 * s)
  ctx.closePath()
  ctx.fill()
  const plaster = ctx.createLinearGradient(0, y + 0.9 * s, 0, y + h - 0.28 * s)
  plaster.addColorStop(0, '#f1e3c2')
  plaster.addColorStop(1, '#d3bf96')
  ctx.fillStyle = plaster
  ctx.fillRect(x + 0.14 * s, y + 0.92 * s, w - 0.28 * s, h - 1.2 * s)
  ctx.fillStyle = '#6b4a2e'
  for (const post of [0.14, 0.62, 1.3, 1.78]) ctx.fillRect(x + post * s, y + 0.92 * s, 0.08 * s, h - 1.2 * s)
  ctx.fillRect(x + 0.14 * s, y + 0.92 * s, w - 0.28 * s, 0.07 * s)
  ctx.fillRect(x + 0.14 * s, y + 1.42 * s, w - 0.28 * s, 0.05 * s)
  ctx.fillStyle = '#8c8579'
  roundedRect(ctx, x + 0.1 * s, y + h - 0.3 * s, w - 0.2 * s, 0.24 * s, 0.05 * s)
  ctx.fill()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
  for (let k = 1; k < 5; k++) ctx.fillRect(x + (0.1 + k * 0.36) * s, y + h - 0.3 * s, Math.max(1, 0.025 * s), 0.24 * s)
  for (const left of [0.3, 1.42]) {
    ctx.fillStyle = '#4f3520'
    ctx.fillRect(x + left * s, y + 1.07 * s, 0.3 * s, 0.28 * s)
    const glass = ctx.createLinearGradient(0, y + 1.1 * s, 0, y + 1.32 * s)
    glass.addColorStop(0, '#ffe8a4')
    glass.addColorStop(1, '#e09f4a')
    ctx.fillStyle = glass
    ctx.fillRect(x + (left + 0.03) * s, y + 1.1 * s, 0.24 * s, 0.22 * s)
    ctx.fillStyle = '#4f3520'
    ctx.fillRect(x + (left + 0.14) * s, y + 1.1 * s, 0.02 * s, 0.22 * s)
    ctx.fillRect(x + (left + 0.03) * s, y + 1.2 * s, 0.24 * s, 0.02 * s)
  }
  const doorX = x + w / 2 - 0.17 * s, doorY = y + 1.2 * s
  const arch = (dx: number, dy: number, dw: number, dh: number): void => {
    ctx.beginPath()
    ctx.moveTo(dx, dy + dh)
    ctx.lineTo(dx, dy + dw / 2)
    ctx.arc(dx + dw / 2, dy + dw / 2, dw / 2, Math.PI, TAU)
    ctx.lineTo(dx + dw, dy + dh)
    ctx.closePath()
  }
  ctx.fillStyle = '#3f2818'
  arch(doorX - 0.03 * s, doorY - 0.03 * s, 0.4 * s, 0.76 * s)
  ctx.fill()
  const door = ctx.createLinearGradient(doorX, 0, doorX + 0.34 * s, 0)
  door.addColorStop(0, '#8e5d36')
  door.addColorStop(1, '#5c3a21')
  ctx.fillStyle = door
  arch(doorX, doorY, 0.34 * s, 0.73 * s)
  ctx.fill()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.fillRect(doorX + 0.11 * s, doorY + 0.12 * s, Math.max(1, 0.02 * s), 0.58 * s)
  ctx.fillRect(doorX + 0.22 * s, doorY + 0.12 * s, Math.max(1, 0.02 * s), 0.58 * s)
  ellipse(ctx, '#e4c46a', doorX + 0.27 * s, doorY + 0.44 * s, 0.025 * s, 0.025 * s)
  const colour = ROOFS[house.roof] ?? ROOFS[0]
  const roof = new Path2D()
  roof.moveTo(x + 0.02 * s, y + 1.02 * s)
  roof.lineTo(x + 0.26 * s, y - 0.66 * s)
  roof.lineTo(x + w - 0.26 * s, y - 0.66 * s)
  roof.lineTo(x + w - 0.02 * s, y + 1.02 * s)
  roof.closePath()
  const tiles = ctx.createLinearGradient(x, 0, x + w, 0)
  tiles.addColorStop(0, tint(colour, 0.14))
  tiles.addColorStop(1, tint(colour, -0.24))
  ctx.fillStyle = tiles
  ctx.fill(roof)
  ctx.save()
  ctx.clip(roof)
  for (let band = 0; band < 7; band++) {
    const by = y + (-0.62 + band * 0.25) * s
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.fillRect(x, by + 0.2 * s, w, 0.05 * s)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)'
    ctx.beginPath()
    for (let k = 0; k < 9; k++) {
      const tx = x + (k + (band % 2) * 0.5) * 0.26 * s
      ctx.moveTo(tx + 0.12 * s, by + 0.2 * s)
      ctx.arc(tx, by + 0.2 * s, 0.12 * s, 0, Math.PI, true)
    }
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = tint(colour, -0.4)
  ctx.fillRect(x + 0.24 * s, y - 0.7 * s, w - 0.48 * s, 0.1 * s)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.fillRect(x + 0.1 * s, y + 0.96 * s, w - 0.2 * s, 0.07 * s)
  if (house.roof % 2 === 0) {
    ctx.fillStyle = '#7d6552'
    ctx.fillRect(x + w - 0.66 * s, y - 0.94 * s, 0.22 * s, 0.46 * s)
    ctx.fillStyle = '#5b493b'
    ctx.fillRect(x + w - 0.7 * s, y - 0.98 * s, 0.3 * s, 0.07 * s)
  }
}

function drawBridge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, horizontal: boolean): void {
  const span = (a: number, b: number, length: number, breadth: number): void => {
    if (horizontal) ctx.fillRect(x + a * s, y + b * s, length * s, breadth * s)
    else ctx.fillRect(x + b * s, y + a * s, breadth * s, length * s)
  }
  ctx.fillStyle = 'rgba(8, 30, 40, 0.35)'
  span(0, 0.34, 1, 0.56)
  const deck = horizontal ? ctx.createLinearGradient(0, y + 0.2 * s, 0, y + 0.8 * s) : ctx.createLinearGradient(x + 0.2 * s, 0, x + 0.8 * s, 0)
  deck.addColorStop(0, '#bd8e5a')
  deck.addColorStop(1, '#7a5431')
  ctx.fillStyle = deck
  span(0, 0.22, 1, 0.56)
  ctx.fillStyle = 'rgba(50, 30, 14, 0.45)'
  for (let k = 0; k < 5; k++) span(k * 0.2 + 0.1, 0.22, Math.max(1 / s, 0.025), 0.56)
  ctx.fillStyle = '#5a3c22'
  span(0, 0.16, 1, 0.07)
  span(0, 0.77, 1, 0.07)
}

function drawRune(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cx = x + 0.5 * s, cy = y + 0.5 * s
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.46 * s)
  glow.addColorStop(0, 'rgba(255, 214, 120, 0.32)')
  glow.addColorStop(1, 'rgba(255, 214, 120, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(x, y, s, s)
  ctx.strokeStyle = 'rgba(206, 164, 78, 0.95)'
  ctx.lineWidth = Math.max(1, 0.04 * s)
  ctx.beginPath()
  ctx.arc(cx, cy, 0.34 * s, 0, TAU)
  ctx.stroke()
  hexagramPath(ctx, cx, cy, 0.24 * s)
  ctx.stroke()
}

function drawSpring(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const cx = x + 0.5 * s, cy = y + 0.5 * s
  ctx.strokeStyle = 'rgba(170, 244, 255, 0.6)'
  ctx.lineWidth = Math.max(1, 0.035 * s)
  ctx.beginPath()
  ctx.arc(cx, cy, 0.33 * s, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(170, 244, 255, 0.32)'
  hexagramPath(ctx, cx, cy, 0.22 * s)
  ctx.stroke()
}

function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ellipse(ctx, 'rgba(8, 30, 40, 0.4)', x + 0.54 * s, y + 0.66 * s, 0.42 * s, 0.2 * s)
  ellipse(ctx, '#6f6a5e', x + 0.5 * s, y + 0.58 * s, 0.41 * s, 0.22 * s)
  const top = ctx.createLinearGradient(0, y + 0.3 * s, 0, y + 0.66 * s)
  top.addColorStop(0, '#ddd6c6')
  top.addColorStop(1, '#a29a88')
  ellipse(ctx, top, x + 0.5 * s, y + 0.5 * s, 0.4 * s, 0.21 * s)
  ellipse(ctx, 'rgba(255, 255, 255, 0.35)', x + 0.4 * s, y + 0.44 * s, 0.14 * s, 0.06 * s)
}

function drawRubble(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: number, row: number): void {
  for (let k = 0; k < 4; k++) {
    const bx = x + (0.12 + islandHash(col + k, row, 7) * 0.6) * s, by = y + (0.28 + islandHash(col, row + k, 9) * 0.5) * s
    ctx.fillStyle = 'rgba(20, 12, 6, 0.3)'
    ctx.fillRect(bx + 0.03 * s, by + 0.04 * s, 0.17 * s, 0.1 * s)
    ctx.fillStyle = k % 2 ? '#b27f53' : '#9a6a44'
    roundedRect(ctx, bx, by, 0.17 * s, 0.1 * s, 0.02 * s)
    ctx.fill()
  }
}

/** A brick block from the front: a lit top face and a coursed front face. */
function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: IslandTerrain, grain: number): void {
  const laid = kind === 'laid', seal = kind === 'seal'
  const [topLight, topDark] = seal ? ['#b0a8dc', '#7d74b0'] : laid ? ['#f3c98e', '#cf9a5c'] : ['#d8ad7e', '#b3845a']
  const [faceLight, faceDark] = seal ? ['#6f66a6', '#433b76'] : laid ? ['#cc8d4e', '#8c582a'] : ['#a9764c', '#6c472a']
  ctx.fillStyle = 'rgba(14, 18, 12, 0.3)'
  ctx.beginPath()
  ctx.moveTo(x + 0.95 * s, y + 0.3 * s)
  ctx.lineTo(x + 1.18 * s, y + 0.46 * s)
  ctx.lineTo(x + 1.18 * s, y + 1.12 * s)
  ctx.lineTo(x + 0.2 * s, y + 1.12 * s)
  ctx.lineTo(x + 0.05 * s, y + 0.98 * s)
  ctx.closePath()
  ctx.fill()
  const face = ctx.createLinearGradient(0, y + 0.32 * s, 0, y + s)
  face.addColorStop(0, faceLight)
  face.addColorStop(1, faceDark)
  ctx.fillStyle = face
  ctx.fillRect(x + 0.03 * s, y + 0.32 * s, 0.94 * s, 0.66 * s)
  ctx.fillStyle = 'rgba(40, 24, 14, 0.38)'
  const mortar = Math.max(1, 0.03 * s)
  ctx.fillRect(x + 0.03 * s, y + 0.54 * s, 0.94 * s, mortar)
  ctx.fillRect(x + 0.03 * s, y + 0.76 * s, 0.94 * s, mortar)
  for (const [left, top] of [[0.5, 0.32], [0.26, 0.54], [0.74, 0.54], [0.5, 0.76]] as const) ctx.fillRect(x + left * s, y + top * s, mortar, 0.22 * s)
  const topFace = ctx.createLinearGradient(0, y, 0, y + 0.34 * s)
  topFace.addColorStop(0, topLight)
  topFace.addColorStop(1, topDark)
  ctx.fillStyle = topFace
  roundedRect(ctx, x + 0.03 * s, y + 0.02 * s, 0.94 * s, 0.34 * s, 0.05 * s)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 248, 230, 0.35)'
  ctx.fillRect(x + 0.06 * s, y + 0.04 * s, 0.88 * s, Math.max(1, 0.035 * s))
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.fillRect(x + 0.03 * s, y + 0.95 * s, 0.94 * s, 0.03 * s)
  if (kind === 'crack') {
    ctx.strokeStyle = 'rgba(30, 16, 8, 0.85)'
    ctx.lineWidth = Math.max(1, 0.035 * s)
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x + (0.3 + grain * 0.2) * s, y + 0.06 * s)
    ctx.lineTo(x + 0.44 * s, y + 0.3 * s)
    ctx.lineTo(x + 0.36 * s, y + 0.52 * s)
    ctx.lineTo(x + 0.58 * s, y + 0.7 * s)
    ctx.lineTo(x + 0.5 * s, y + 0.94 * s)
    ctx.moveTo(x + 0.44 * s, y + 0.3 * s)
    ctx.lineTo(x + 0.7 * s, y + 0.22 * s)
    ctx.stroke()
  }
  if (seal) {
    ctx.strokeStyle = 'rgba(255, 226, 140, 0.9)'
    ctx.lineWidth = Math.max(1, 0.035 * s)
    hexagramPath(ctx, x + 0.5 * s, y + 0.66 * s, 0.2 * s)
    ctx.stroke()
  }
  if (laid) {
    ctx.fillStyle = 'rgba(255, 246, 214, 0.9)'
    ctx.fillRect(x + 0.14 * s, y + 0.1 * s, 0.1 * s, Math.max(1, 0.025 * s))
    ctx.fillRect(x + 0.18 * s, y + 0.06 * s, Math.max(1, 0.025 * s), 0.1 * s)
  }
}

// ── the air ────────────────────────────────────────────────

function cloudSprite(): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = 220
  canvas.height = 130
  const ctx = canvasContext(canvas)
  if (!ctx) return null
  for (let k = 0; k < 7; k++) {
    const cx = 40 + islandHash(k, 1, 131) * 140, cy = 40 + islandHash(k, 2, 131) * 50, r = 26 + islandHash(k, 3, 131) * 28
    const puff = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    puff.addColorStop(0, 'rgba(8, 20, 28, 0.9)')
    puff.addColorStop(1, 'rgba(8, 20, 28, 0)')
    ctx.fillStyle = puff
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  return canvas
}

function drawMotes(ctx: CanvasRenderingContext2D, camera: IslandCamera, time: number): void {
  const wide = camera.width + 40, high = camera.height + 40
  ctx.fillStyle = '#fff6cc'
  for (let k = 0; k < 36; k++) {
    const sx = islandHash(k, 1, 97) * 2000 + Math.sin(time * 0.4 + k) * 24 + time * (6 + islandHash(k, 3, 97) * 10) - camera.x
    const sy = islandHash(k, 2, 97) * 2000 + Math.cos(time * 0.33 + k * 1.3) * 18 - time * 4 - camera.y
    const alpha = 0.25 + 0.35 * Math.sin(time * 1.1 + k * 2.3)
    if (alpha <= 0) continue
    ctx.globalAlpha = alpha
    const size = 1.2 + islandHash(k, 4, 97) * 1.6
    ctx.fillRect(((sx % wide) + wide) % wide - 20, ((sy % high) + high) % high - 20, size, size)
  }
  ctx.globalAlpha = 1
}

function drawReticle(ctx: CanvasRenderingContext2D, camera: IslandCamera, cell: { col: number; row: number }, time: number): void {
  const { tile } = camera
  const x = cell.col * tile - camera.x, y = cell.row * tile - camera.y
  const pulse = Math.sin(time * 5)
  const arm = tile * 0.26, inset = tile * (0.05 - pulse * 0.02)
  ctx.strokeStyle = `rgba(255, 224, 140, ${0.6 + pulse * 0.3})`
  ctx.lineWidth = Math.max(1.5, tile * 0.05)
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const [cx, cy, sx, sy] of [[x + inset, y + inset, 1, 1], [x + tile - inset, y + inset, -1, 1], [x + inset, y + tile - inset, 1, -1], [x + tile - inset, y + tile - inset, -1, -1]] as const) {
    ctx.moveTo(cx + arm * sx, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + arm * sy)
  }
  ctx.stroke()
}

function drawBurst(ctx: CanvasRenderingContext2D, camera: IslandCamera, burst: WandBurst): void {
  const t = Math.min(1, burst.age / BURST_LIFE)
  const { tile } = camera
  const cx = burst.x * tile - camera.x, cy = burst.y * tile - camera.y
  const color = burst.kind === 'lay' ? '255, 214, 120' : burst.kind === 'lift' ? '200, 160, 255' : '255, 110, 100'
  ctx.strokeStyle = `rgba(${color}, ${1 - t})`
  ctx.lineWidth = Math.max(1, tile * 0.08 * (1 - t))
  ctx.beginPath()
  ctx.arc(cx, cy, tile * (0.18 + t * 0.55), 0, TAU)
  ctx.stroke()
  if (burst.kind === 'deny') return
  ctx.fillStyle = `rgba(${color}, ${1 - t})`
  for (let k = 0; k < 8; k++) {
    const angle = k / 8 * TAU + t
    const distance = tile * (0.15 + t * 0.7)
    const size = Math.max(1, tile * 0.07 * (1 - t))
    ctx.fillRect(cx + Math.cos(angle) * distance - size / 2, cy + Math.sin(angle) * distance - size / 2, size, size)
  }
}

// ── textures ───────────────────────────────────────────────

type TextureName = 'deep' | 'shallow' | 'sand' | 'grass' | 'forest' | 'dirt' | 'cobble' | 'rock' | 'snow'
type Rgb = readonly [number, number, number]
interface TextureSpec {
  seed: number
  dark: Rgb
  light: Rgb
  /** Noise cells across the texture: `broad` for patches, `fine` for grain. */
  broad: number
  fine: number
  detail: (ctx: CanvasRenderingContext2D, size: number, seed: number) => void
  fallback: string
}

const TEXTURES: Readonly<Record<TextureName, TextureSpec>> = {
  deep: { seed: 11, dark: [16, 54, 86], light: [30, 84, 120], broad: 3, fine: 16, detail: waves, fallback: '#1d5274' },
  shallow: { seed: 13, dark: [44, 124, 148], light: [84, 170, 184], broad: 3, fine: 14, detail: caustics, fallback: '#3f8fa8' },
  sand: { seed: 17, dark: [204, 178, 124], light: [238, 218, 168], broad: 4, fine: 30, detail: specks, fallback: '#dac48c' },
  grass: { seed: 19, dark: [70, 118, 54], light: [118, 166, 80], broad: 3, fine: 22, detail: blades, fallback: '#5d8946' },
  forest: { seed: 23, dark: [38, 72, 38], light: [66, 104, 54], broad: 3, fine: 20, detail: litter, fallback: '#3b6634' },
  dirt: { seed: 29, dark: [146, 116, 80], light: [192, 162, 116], broad: 3, fine: 26, detail: pebbles, fallback: '#c6b47e' },
  cobble: { seed: 31, dark: [104, 94, 82], light: [126, 116, 102], broad: 2, fine: 20, detail: cobbles, fallback: '#bdae93' },
  rock: { seed: 37, dark: [104, 98, 88], light: [154, 146, 128], broad: 3, fine: 24, detail: cracks, fallback: '#8b836f' },
  snow: { seed: 41, dark: [200, 214, 226], light: [246, 250, 253], broad: 3, fine: 20, detail: sparkles, fallback: '#e4eaee' },
}

function makeTexture(name: TextureName, size: number): HTMLCanvasElement | null {
  const spec = TEXTURES[name]
  const half = Math.max(8, size / 2)
  const base = document.createElement('canvas')
  base.width = base.height = half
  const baseContext = canvasContext(base)
  if (!baseContext) return null
  const image = baseContext.createImageData(half, half)
  for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    const t = periodicNoise(x, y, half, spec.broad, spec.seed) * 0.62 + periodicNoise(x, y, half, spec.fine, spec.seed + 1) * 0.3 + islandHash(x, y, spec.seed + 2) * 0.08
    const i = (y * half + x) * 4
    image.data[i] = spec.dark[0] + (spec.light[0] - spec.dark[0]) * t
    image.data[i + 1] = spec.dark[1] + (spec.light[1] - spec.dark[1]) * t
    image.data[i + 2] = spec.dark[2] + (spec.light[2] - spec.dark[2]) * t
    image.data[i + 3] = 255
  }
  baseContext.putImageData(image, 0, 0)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = half * 2
  const ctx = canvasContext(canvas)
  if (!ctx) return null
  ctx.drawImage(base, 0, 0, half * 2, half * 2)
  spec.detail(ctx, half * 2, spec.seed)
  return canvas
}

function periodicNoise(x: number, y: number, size: number, cells: number, seed: number): number {
  const fx = x / size * cells, fy = y / size * cells
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
  const wrap = (v: number): number => ((v % cells) + cells) % cells
  const a = islandHash(wrap(x0), wrap(y0), seed), b = islandHash(wrap(x0 + 1), wrap(y0), seed)
  const c = islandHash(wrap(x0), wrap(y0 + 1), seed), d = islandHash(wrap(x0 + 1), wrap(y0 + 1), seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Scatters details; one near an edge is drawn again across it, so the texture repeats without a seam. */
function scatter(size: number, count: number, seed: number, draw: (x: number, y: number, a: number, b: number) => void): void {
  const margin = size * 0.1
  for (let k = 0; k < count; k++) {
    const x = islandHash(k, 1, seed) * size, y = islandHash(k, 2, seed) * size
    const a = islandHash(k, 3, seed), b = islandHash(k, 4, seed)
    const xs = x < margin ? [x, x + size] : x > size - margin ? [x, x - size] : [x]
    const ys = y < margin ? [y, y + size] : y > size - margin ? [y, y - size] : [y]
    for (const px of xs) for (const py of ys) draw(px, py, a, b)
  }
}

function waves(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  ctx.strokeStyle = 'rgba(160, 210, 230, 0.09)'
  ctx.lineWidth = unit * 0.9
  ctx.lineCap = 'round'
  scatter(size, 34, seed, (x, y, a) => {
    ctx.beginPath()
    ctx.arc(x, y, unit * (5 + a * 7), Math.PI * 1.2, Math.PI * 1.8)
    ctx.stroke()
  })
}

function caustics(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  ctx.strokeStyle = 'rgba(214, 246, 250, 0.14)'
  ctx.lineWidth = unit * 0.8
  ctx.lineCap = 'round'
  scatter(size, 46, seed, (x, y, a, b) => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.bezierCurveTo(x + unit * 4, y - unit * 3 * a, x + unit * 7, y + unit * 3 * b, x + unit * 11, y)
    ctx.stroke()
  })
}

function specks(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  scatter(size, Math.round(size * size / 90), seed, (x, y, a, b) => {
    ctx.fillStyle = a < 0.5 ? 'rgba(150, 122, 80, 0.35)' : 'rgba(252, 240, 206, 0.45)'
    ctx.fillRect(x, y, unit * (0.5 + b), unit * (0.5 + b))
  })
  ctx.strokeStyle = 'rgba(170, 138, 92, 0.18)'
  ctx.lineWidth = unit
  scatter(size, 10, seed + 5, (x, y, a) => {
    ctx.beginPath()
    ctx.arc(x, y + unit * 8, unit * (6 + a * 6), Math.PI * 1.15, Math.PI * 1.85)
    ctx.stroke()
  })
}

function blades(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1, unit * 0.9)
  for (const [color, from] of [['rgba(46, 90, 38, 0.55)', 0], ['rgba(152, 198, 100, 0.5)', 1]] as const) {
    ctx.strokeStyle = color
    ctx.beginPath()
    scatter(size, Math.round(size * size / 110), seed + from, (x, y, a, b) => {
      const h = unit * (2.2 + b * 3.2)
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + (a - 0.5) * unit * 2, y - h * 0.6, x + (a - 0.5) * unit * 3.4, y - h)
    })
    ctx.stroke()
  }
}

function litter(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  scatter(size, Math.round(size * size / 160), seed, (x, y, a, b) => {
    ctx.fillStyle = a < 0.5 ? 'rgba(112, 88, 50, 0.35)' : a < 0.8 ? 'rgba(90, 120, 60, 0.4)' : 'rgba(150, 170, 90, 0.35)'
    ctx.beginPath()
    ctx.ellipse(x, y, unit * (0.8 + b * 1.4), unit * (0.5 + b * 0.7), a * TAU, 0, TAU)
    ctx.fill()
  })
}

function pebbles(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  scatter(size, Math.round(size * size / 70), seed + 3, (x, y, a) => {
    ctx.fillStyle = a < 0.5 ? 'rgba(96, 74, 46, 0.3)' : 'rgba(222, 198, 152, 0.35)'
    ctx.fillRect(x, y, unit * 0.8, unit * 0.8)
  })
  scatter(size, Math.round(size * size / 300), seed, (x, y, a, b) => {
    const rx = unit * (1 + b * 1.6), ry = rx * 0.7
    ellipse(ctx, 'rgba(80, 62, 40, 0.35)', x + unit * 0.5, y + unit * 0.6, rx, ry)
    ellipse(ctx, a < 0.5 ? '#b8ab94' : '#a39580', x, y, rx, ry)
    ellipse(ctx, 'rgba(255, 250, 235, 0.45)', x - rx * 0.3, y - ry * 0.35, rx * 0.4, ry * 0.3)
  })
}

function cobbles(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const rows = 6, height = size / rows, gap = height * 0.09
  for (let r = 0; r < rows; r++) {
    let x = -height * 1.4 + (r % 2) * height * 0.7
    for (let k = 0; x < size + height; k++) {
      const width = height * (1.1 + islandHash(r, k, seed) * 0.6)
      const tone = 150 + Math.round(islandHash(k, r, seed + 1) * 40)
      const left = x + gap, top = r * height + gap, w = width - gap * 2, h = height - gap * 2
      ctx.fillStyle = `rgb(${tone}, ${tone - 8}, ${tone - 20})`
      roundedRect(ctx, left, top, w, h, height * 0.22)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 250, 235, 0.22)'
      roundedRect(ctx, left + gap * 0.4, top + gap * 0.3, w * 0.7, h * 0.28, height * 0.12)
      ctx.fill()
      ctx.fillStyle = 'rgba(40, 32, 24, 0.22)'
      ctx.fillRect(left + height * 0.1, top + h - height * 0.12, w - height * 0.2, height * 0.1)
      x += width
    }
  }
}

function cracks(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  ctx.strokeStyle = 'rgba(70, 64, 56, 0.45)'
  ctx.lineWidth = Math.max(1, unit * 0.7)
  scatter(size, 14, seed, (x, y, a, b) => {
    ctx.beginPath()
    ctx.moveTo(x, y)
    let px = x, py = y
    for (let step = 0; step < 4; step++) {
      px += (islandHash(step, Math.round(a * 1000), seed) - 0.5) * unit * 10
      py += unit * (3 + b * 4)
      ctx.lineTo(px, py)
    }
    ctx.stroke()
  })
  scatter(size, Math.round(size * size / 250), seed + 7, (x, y, a) => {
    ctx.fillStyle = a < 0.5 ? 'rgba(120, 140, 88, 0.35)' : 'rgba(190, 182, 164, 0.4)'
    ctx.fillRect(x, y, unit * 1.2, unit * 1.2)
  })
}

function sparkles(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  const unit = size / 120
  scatter(size, 26, seed, (x, y, a, b) => ellipse(ctx, 'rgba(150, 176, 204, 0.22)', x, y, unit * (6 + a * 8), unit * (2 + b * 2)))
  scatter(size, Math.round(size * size / 260), seed + 1, (x, y) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fillRect(x, y, unit * 0.8, unit * 0.8)
  })
}
