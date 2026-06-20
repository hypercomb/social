// diamondcoreprocessor.com/games/solomon/overworld.ts
//
// The Zelda-like overworld that strings the caverns together. The play areas are
// no longer isolated boxes — they're chambers in one big cave system, and you
// WALK between them. This module is two pieces, mirroring engine/renderer:
//
//   • Overworld     — pure logic: a procedurally-carved top-down cave map, a set
//                     of cavern-mouth nodes, a top-down Dana with 4-direction
//                     movement + tile collision, and enter / unlock bookkeeping.
//                     Framework-free, so it's headless-testable.
//   • OverworldView — Canvas2D rendering: layered cave rock baked once, moody
//                     torch lighting, glowing cavern mouths, and a 3/4-view Dana.
//
// The overlay owns the loop + input and switches between this and the platformer
// engine: walk into a mouth to drop into that cavern; clear it to surface here.

export const OTILE = 28

export const O_ROCK = 0   // solid cave wall
export const O_PATH = 1   // carved, walkable cave floor
export const O_MOUTH = 2  // a cavern entrance (walkable; triggers entry)

export interface CavernNode {
  col: number
  row: number
  /** Index into the overlay's level list (a sentinel for the Princess Room). */
  levelIndex: number
  name: string
  /** 1-based label shown on the mouth (0 ⇒ unnumbered, e.g. the Princess). */
  label: number
}

export interface NodeDef { levelIndex: number; name: string; label: number }

type Facing = 'up' | 'down' | 'left' | 'right'

// Map shape: a boustrophedon ("snake") of node bands so the journey winds back
// and forth across the cave like a real route. 4 bands × 4 nodes = 16 stops.
const BANDS = 4
const PER_BAND = 4
const MARGIN = 5
const BAND_GAP = 8
const COL_GAP = 14
const CORRIDOR_HALF = 2     // trail half-width in tiles (→ 5 wide open land)
const CLEARING_R = 4        // clearing radius carved at each mouth
const DANA_SIZE = OTILE * 0.55
const WALK_SPEED = 132

/** Deterministic 0..1 noise (mulberry32) — the cave looks the same every load. */
function noise(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export class Overworld {
  cols: number
  rows: number
  grid: Uint8Array
  nodes: CavernNode[] = []

  dana = { x: 0, y: 0, w: DANA_SIZE, h: DANA_SIZE }
  facing: Facing = 'down'
  moving = false
  anim = 0
  input = { up: false, down: false, left: false, right: false }

  /** Level indices the player may enter, and ones already cleared. The overlay
   *  owns the gating policy and calls unlock()/markCleared(); we just enforce it. */
  unlocked = new Set<number>()
  cleared = new Set<number>()

  constructor(defs: NodeDef[]) {
    this.cols = MARGIN * 2 + (PER_BAND - 1) * COL_GAP
    this.rows = MARGIN * 2 + (BANDS - 1) * BAND_GAP
    this.grid = new Uint8Array(this.cols * this.rows) // all O_ROCK

    // Place nodes along the snake, then carve corridors + cave-rooms.
    for (let k = 0; k < defs.length; k++) {
      const band = Math.floor(k / PER_BAND)
      const within = k % PER_BAND
      const j = band % 2 === 0 ? within : PER_BAND - 1 - within // reverse on odd bands
      const col = MARGIN + j * COL_GAP
      const row = MARGIN + band * BAND_GAP
      this.nodes.push({ col, row, levelIndex: defs[k].levelIndex, name: defs[k].name, label: defs[k].label })
    }
    for (const n of this.nodes) this.#carveDisc(n.col, n.row, CLEARING_R)
    for (let k = 0; k < this.nodes.length - 1; k++) this.#carveCorridor(this.nodes[k], this.nodes[k + 1])
    // A little organic noise on the cave-room rims so they aren't perfect circles.
    this.#roughen()
    for (const n of this.nodes) this.grid[n.row * this.cols + n.col] = O_MOUTH

    this.spawnAt(this.nodes[0]?.levelIndex ?? 0)
  }

  get width(): number { return this.cols * OTILE }
  get height(): number { return this.rows * OTILE }

  // ── map carving ──────────────────────────────────────────

  #set(col: number, row: number, code: number): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      if (this.grid[row * this.cols + col] !== O_MOUTH) this.grid[row * this.cols + col] = code
    }
  }

  #carveDisc(cc: number, cr: number, r: number): void {
    for (let row = cr - r; row <= cr + r; row++)
      for (let col = cc - r; col <= cc + r; col++)
        if ((col - cc) ** 2 + (row - cr) ** 2 <= r * r) this.#set(col, row, O_PATH)
  }

  #carveCorridor(a: CavernNode, b: CavernNode): void {
    const w = CORRIDOR_HALF
    if (a.row === b.row) {
      const r = a.row
      for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++)
        for (let d = -w; d <= w; d++) this.#set(col, r + d, O_PATH)
    } else if (a.col === b.col) {
      const c = a.col
      for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++)
        for (let d = -w; d <= w; d++) this.#set(c + d, row, O_PATH)
    } else {
      // L-bend (shouldn't happen on the snake, but stay robust): horizontal then vertical.
      const mid = { col: b.col, row: a.row, levelIndex: -1, name: '', label: 0 }
      this.#carveCorridor(a, mid); this.#carveCorridor(mid, b)
    }
  }

  // Nibble a few extra path cells at carved/rock boundaries so edges read organic.
  #roughen(): void {
    const rnd = noise(0x0a7e)
    const add: number[] = []
    for (let row = 1; row < this.rows - 1; row++) {
      for (let col = 1; col < this.cols - 1; col++) {
        if (this.grid[row * this.cols + col] !== O_ROCK) continue
        let near = 0
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.grid[(row + dr) * this.cols + (col + dc)] === O_PATH) near++
        if (near >= 1 && rnd() < 0.30) add.push(row * this.cols + col)
      }
    }
    for (const i of add) this.grid[i] = O_PATH
  }

  // ── queries ──────────────────────────────────────────────

  walkable(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false
    return this.grid[row * this.cols + col] !== O_ROCK
  }

  rectWalkable(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.floor(x / OTILE), c1 = Math.floor((x + w - 1) / OTILE)
    const r0 = Math.floor(y / OTILE), r1 = Math.floor((y + h - 1) / OTILE)
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!this.walkable(c, r)) return false
    return true
  }

  isUnlocked(levelIndex: number): boolean { return this.unlocked.has(levelIndex) }
  unlock(levelIndex: number): void { this.unlocked.add(levelIndex) }
  markCleared(levelIndex: number): void { this.cleared.add(levelIndex) }

  /** The cavern node Dana is standing on AND allowed to enter, or null. */
  entranceUnder(): CavernNode | null {
    const cx = this.dana.x + this.dana.w / 2, cy = this.dana.y + this.dana.h / 2
    for (const n of this.nodes) {
      const nx = n.col * OTILE + OTILE / 2, ny = n.row * OTILE + OTILE / 2
      if (Math.hypot(cx - nx, cy - ny) < OTILE * 0.7 && this.isUnlocked(n.levelIndex)) return n
    }
    return null
  }

  /** The node closest to Dana (regardless of lock state) — for the HUD label. */
  nearestNode(): CavernNode | null {
    const cx = this.dana.x + this.dana.w / 2, cy = this.dana.y + this.dana.h / 2
    let best: CavernNode | null = null, bd = Infinity
    for (const n of this.nodes) {
      const d = Math.hypot(cx - (n.col * OTILE + OTILE / 2), cy - (n.row * OTILE + OTILE / 2))
      if (d < bd) { bd = d; best = n }
    }
    return bd < OTILE * 1.4 ? best : null
  }

  nodeFor(levelIndex: number): CavernNode | null { return this.nodes.find(n => n.levelIndex === levelIndex) ?? null }

  /** Drop Dana onto a node's mouth (used on entry-return). */
  spawnAt(levelIndex: number): void {
    const n = this.nodeFor(levelIndex) ?? this.nodes[0]
    if (!n) return
    this.dana.x = n.col * OTILE + (OTILE - this.dana.w) / 2
    this.dana.y = n.row * OTILE + (OTILE - this.dana.h) / 2
    this.facing = 'down'
    this.moving = false
    this.input.up = this.input.down = this.input.left = this.input.right = false
  }

  // ── simulation ───────────────────────────────────────────

  update(dt: number): void {
    let dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
    let dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0)
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071 }
    this.moving = dx !== 0 || dy !== 0
    if (dx < 0) this.facing = 'left'
    else if (dx > 0) this.facing = 'right'
    else if (dy < 0) this.facing = 'up'
    else if (dy > 0) this.facing = 'down'

    const sx = dx * WALK_SPEED * dt
    const sy = dy * WALK_SPEED * dt
    const nx = this.dana.x + sx
    if (this.rectWalkable(nx, this.dana.y, this.dana.w, this.dana.h)) this.dana.x = nx
    const ny = this.dana.y + sy
    if (this.rectWalkable(this.dana.x, ny, this.dana.w, this.dana.h)) this.dana.y = ny

    if (this.moving) this.anim += dt * 8
  }
}

// ── view ───────────────────────────────────────────────────

const CV = {
  void: '#16200f',
  grass0: '#5c7d3a', grass1: '#41602a', dirt0: '#7b5e3c', dirt1: '#5a4329', sand0: '#b6a066',
  water0: '#2f6098', water1: '#1b3c68', waterLite: '#86bce6',
  forest0: '#2c4d24', forest1: '#163214', forestLite: '#3f6a2e',
  rock0: '#6e6880', rock1: '#3c3650', rockLite: '#9a93b0',
  glowWarm: 'rgba(255,180,90,', glowCool: 'rgba(120,210,255,', glowDim: 'rgba(120,120,150,',
}

export class OverworldView {
  #ctx: CanvasRenderingContext2D
  #terrain: HTMLCanvasElement | null = null
  cam = { x: 0, y: 0 }

  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  draw(ow: Overworld, vw: number, vh: number, time: number): void {
    const ctx = this.#ctx
    if (!this.#terrain) this.#terrain = this.#bakeTerrain(ow)

    const cx = ow.dana.x + ow.dana.w / 2, cy = ow.dana.y + ow.dana.h / 2
    this.cam.x = clamp(cx - vw / 2, 0, Math.max(0, ow.width - vw))
    this.cam.y = clamp(cy - vh / 2, 0, Math.max(0, ow.height - vh))
    const camx = Math.round(this.cam.x), camy = Math.round(this.cam.y)
    const sx = (wx: number) => wx - camx, sy = (wy: number) => wy - camy

    // baked terrain crop
    ctx.fillStyle = CV.void; ctx.fillRect(0, 0, vw, vh)
    ctx.drawImage(this.#terrain, camx, camy, vw, vh, 0, 0, vw, vh)

    // a light dusk tint (the LAND stays visible), then warm light at Dana + mouths
    ctx.fillStyle = 'rgba(20,26,40,0.2)'; ctx.fillRect(0, 0, vw, vh)
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    const dscx = sx(cx), dscy = sy(cy)
    const torch = ctx.createRadialGradient(dscx, dscy, 6, dscx, dscy, OTILE * 5)
    torch.addColorStop(0, 'rgba(255,200,120,0.5)'); torch.addColorStop(0.5, 'rgba(255,150,70,0.18)'); torch.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = torch; ctx.beginPath(); ctx.arc(dscx, dscy, OTILE * 5, 0, Math.PI * 2); ctx.fill()
    for (const n of ow.nodes) {
      const mx = sx(n.col * OTILE + OTILE / 2), my = sy(n.row * OTILE + OTILE / 2)
      if (mx < -60 || mx > vw + 60 || my < -60 || my > vh + 60) continue
      const cleared = ow.cleared.has(n.levelIndex)
      const open = ow.isUnlocked(n.levelIndex)
      const col = cleared ? CV.glowCool : open ? CV.glowWarm : CV.glowDim
      const pulse = open && !cleared ? 0.5 + Math.sin(time * 4) * 0.18 : 0.28
      const g = ctx.createRadialGradient(mx, my, 2, mx, my, OTILE * 1.8)
      g.addColorStop(0, col + pulse + ')'); g.addColorStop(1, col + '0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, OTILE * 1.8, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()

    // cavern mouths (arches + labels)
    for (const n of ow.nodes) {
      const mx = sx(n.col * OTILE + OTILE / 2), my = sy(n.row * OTILE + OTILE / 2)
      if (mx < -40 || mx > vw + 40 || my < -40 || my > vh + 40) continue
      this.#mouth(mx, my, ow.cleared.has(n.levelIndex), ow.isUnlocked(n.levelIndex), n.label, time)
    }

    this.#dana(dscx, dscy, ow.facing, ow.anim, ow.moving, time)

    // "enter" prompt + cavern name when standing on an unlocked mouth
    const ent = ow.entranceUnder()
    const near = ow.nearestNode()
    if (ent) this.#prompt(vw, vh, `${ent.label ? 'Cavern ' + ent.label + ' — ' : ''}${ent.name}`, '↵ / Z  enter')
    else if (near && !ow.isUnlocked(near.levelIndex)) this.#prompt(vw, vh, near.name, '🔒 locked — clear the path first')

    // vignette
    const vg = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.4, vw / 2, vh / 2, vh * 0.85)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,12,22,0.42)')
    ctx.fillStyle = vg; ctx.fillRect(0, 0, vw, vh)
  }

  /** Re-bake when a new game starts (caverns relock) — cheap insurance. */
  reset(): void { this.#terrain = null }

  #bakeTerrain(ow: Overworld): HTMLCanvasElement {
    const cv = document.createElement('canvas'); cv.width = ow.width; cv.height = ow.height
    const x = cv.getContext('2d')!
    const rnd = noise(0x51a7)
    const W = ow.width, H = ow.height
    // a smooth biome field 0..1 → coherent regions (water · grass · forest · mountain)
    const biome = (c: number, r: number) =>
      ((Math.sin(c * 0.17) + Math.sin(r * 0.2 + 1) + Math.sin((c + r) * 0.12 + 2) + Math.sin((c - r) * 0.09 + 4)) / 8) + 0.5
    const rock = (c: number, r: number) => (c < 0 || c >= ow.cols || r < 0 || r >= ow.rows) ? true : ow.grid[r * ow.cols + c] === O_ROCK

    x.fillStyle = CV.void; x.fillRect(0, 0, W, H)
    for (let row = 0; row < ow.rows; row++) {
      for (let col = 0; col < ow.cols; col++) {
        const tx = col * OTILE, ty = row * OTILE
        const b = biome(col, row)
        if (!rock(col, row)) {
          // ── traversable LAND: grass / dirt / sand, blended by biome ──
          const g = x.createLinearGradient(tx, ty, tx, ty + OTILE)
          if (b < 0.42) { g.addColorStop(0, CV.dirt0); g.addColorStop(1, CV.dirt1) }
          else if (b > 0.7) { g.addColorStop(0, CV.sand0); g.addColorStop(1, CV.dirt0) }
          else { g.addColorStop(0, CV.grass0); g.addColorStop(1, CV.grass1) }
          x.fillStyle = g; x.fillRect(tx, ty, OTILE, OTILE)
          for (let s = (OTILE * OTILE) >> 5; s > 0; s--) {
            const d = rnd() - 0.5
            x.fillStyle = d > 0 ? `rgba(255,250,200,${d * 0.16})` : `rgba(20,30,10,${-d * 0.28})`
            x.fillRect(tx + ((rnd() * OTILE) | 0), ty + ((rnd() * OTILE) | 0), 2, 2)
          }
          if (b >= 0.42 && b <= 0.7 && rnd() < 0.5) this.#tuft(x, tx + rnd() * OTILE, ty + OTILE * (0.5 + rnd() * 0.4), rnd)
          else if (rnd() < 0.12) { x.fillStyle = rnd() < 0.5 ? '#b7a98f' : '#9a9078'; x.fillRect(tx + ((rnd() * OTILE) | 0), ty + ((rnd() * OTILE) | 0), 3, 2) }
          x.fillStyle = 'rgba(0,0,0,0.3)' // cliff shadow cast onto land
          if (rock(col - 1, row)) x.fillRect(tx, ty, 4, OTILE)
          if (rock(col, row - 1)) x.fillRect(tx, ty, OTILE, 4)
        } else {
          // ── impassable TERRAIN by biome: water / forest / mountain ──
          if (b < 0.36) this.#water(x, tx, ty, rnd)
          else if (b < 0.64) this.#forest(x, tx, ty, rnd)
          else this.#mountain(x, tx, ty, rnd)
        }
      }
    }
    // a lit ridge on rock that fronts open land below it (sense of height)
    for (let row = 0; row < ow.rows; row++) for (let col = 0; col < ow.cols; col++) {
      if (rock(col, row) && !rock(col, row + 1)) { x.fillStyle = 'rgba(255,250,210,0.13)'; x.fillRect(col * OTILE, row * OTILE + OTILE - 3, OTILE, 3) }
    }
    return cv
  }

  #tuft(x: CanvasRenderingContext2D, px: number, py: number, rnd: () => number): void {
    x.strokeStyle = rnd() < 0.5 ? '#6e9442' : '#557a32'; x.lineWidth = 1
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(px + i * 2 - 2, py); x.lineTo(px + i * 2 - 2 + (rnd() - 0.5) * 3, py - 3 - rnd() * 3); x.stroke() }
    if (rnd() < 0.22) { x.fillStyle = ['#ffd24d', '#ff8fb0', '#bfa8ff'][(rnd() * 3) | 0]; x.beginPath(); x.arc(px, py - 4, 1.4, 0, Math.PI * 2); x.fill() }
  }

  #water(x: CanvasRenderingContext2D, tx: number, ty: number, rnd: () => number): void {
    const g = x.createLinearGradient(tx, ty, tx, ty + OTILE)
    g.addColorStop(0, CV.water0); g.addColorStop(1, CV.water1)
    x.fillStyle = g; x.fillRect(tx, ty, OTILE, OTILE)
    x.strokeStyle = 'rgba(190,220,255,0.22)'; x.lineWidth = 1
    for (let i = 0; i < 2; i++) { const wy = ty + 6 + i * 10 + rnd() * 4; x.beginPath(); x.moveTo(tx + 3, wy); x.quadraticCurveTo(tx + OTILE / 2, wy - 2, tx + OTILE - 3, wy); x.stroke() }
  }

  #forest(x: CanvasRenderingContext2D, tx: number, ty: number, rnd: () => number): void {
    x.fillStyle = CV.forest1; x.fillRect(tx, ty, OTILE, OTILE)
    for (let i = 0; i < 3; i++) {
      const cx = tx + 5 + rnd() * (OTILE - 10), cy = ty + 5 + rnd() * (OTILE - 10), r = 4 + rnd() * 4
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.arc(cx + 1.5, cy + 2.5, r * 0.8, 0, Math.PI * 2); x.fill()
      x.fillStyle = rnd() < 0.5 ? CV.forest0 : CV.forestLite; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill()
    }
  }

  #mountain(x: CanvasRenderingContext2D, tx: number, ty: number, rnd: () => number): void {
    const g = x.createLinearGradient(tx, ty, tx, ty + OTILE)
    g.addColorStop(0, CV.rock0); g.addColorStop(1, CV.rock1)
    x.fillStyle = g; x.fillRect(tx, ty, OTILE, OTILE)
    for (let s = (OTILE * OTILE) >> 4; s > 0; s--) {
      const d = rnd() - 0.5
      x.fillStyle = d > 0 ? `rgba(190,185,215,${d * 0.3})` : `rgba(0,0,0,${-d * 0.35})`
      x.fillRect(tx + ((rnd() * OTILE) | 0), ty + ((rnd() * OTILE) | 0), 2, 2)
    }
    // a faceted crag — dark face + lit edge
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.moveTo(tx + OTILE * 0.5, ty + 4); x.lineTo(tx + OTILE - 4, ty + OTILE - 4); x.lineTo(tx + 4, ty + OTILE - 4); x.closePath(); x.fill()
    x.fillStyle = CV.rockLite; x.beginPath(); x.moveTo(tx + OTILE * 0.5, ty + 4); x.lineTo(tx + OTILE * 0.5, ty + OTILE - 4); x.lineTo(tx + 4, ty + OTILE - 4); x.closePath(); x.fill()
  }

  #mouth(mx: number, my: number, cleared: boolean, open: boolean, label: number, time: number): void {
    const ctx = this.#ctx
    const r = OTILE * 0.72
    ctx.save()
    // stone arch
    ctx.fillStyle = open ? '#4a4258' : '#2c2a3a'
    ctx.beginPath(); ctx.arc(mx, my, r, Math.PI, 0); ctx.lineTo(mx + r, my + r * 0.7); ctx.lineTo(mx - r, my + r * 0.7); ctx.closePath(); ctx.fill()
    // dark opening
    const inner = ctx.createRadialGradient(mx, my, 1, mx, my, r * 0.8)
    inner.addColorStop(0, cleared ? 'rgba(40,90,120,0.95)' : open ? 'rgba(60,30,10,0.98)' : 'rgba(10,10,18,0.98)')
    inner.addColorStop(1, '#05040c')
    ctx.fillStyle = inner
    ctx.beginPath(); ctx.arc(mx, my, r * 0.7, Math.PI, 0); ctx.lineTo(mx + r * 0.7, my + r * 0.6); ctx.lineTo(mx - r * 0.7, my + r * 0.6); ctx.closePath(); ctx.fill()
    // rune ring for open mouths
    if (open && !cleared) {
      ctx.strokeStyle = `rgba(255,200,120,${0.6 + Math.sin(time * 4) * 0.3})`; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(mx, my, r + 3, Math.PI * 1.05, -0.05); ctx.stroke()
    } else if (cleared) {
      ctx.strokeStyle = 'rgba(120,210,255,0.5)'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(mx, my, r + 3, Math.PI * 1.05, -0.05); ctx.stroke()
    }
    // label
    if (label > 0) {
      ctx.fillStyle = open ? '#ffe6b0' : '#7a7790'
      ctx.font = 'bold 12px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(label), mx, my - r * 0.2)
    } else {
      // the Princess mouth — a little crown
      ctx.fillStyle = open ? '#ffd24d' : '#6a6480'
      ctx.beginPath(); ctx.moveTo(mx - 6, my - r * 0.1); ctx.lineTo(mx - 6, my - r * 0.45); ctx.lineTo(mx - 2, my - r * 0.25)
      ctx.lineTo(mx, my - r * 0.5); ctx.lineTo(mx + 2, my - r * 0.25); ctx.lineTo(mx + 6, my - r * 0.45); ctx.lineTo(mx + 6, my - r * 0.1); ctx.closePath(); ctx.fill()
    }
    if (cleared) { ctx.fillStyle = '#7dffb0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✓', mx + r * 0.7, my - r * 0.4) }
    ctx.restore()
  }

  // 3/4-view torch-bearing Dana.
  #dana(cx: number, cy: number, facing: Facing, anim: number, moving: boolean, time: number): void {
    const ctx = this.#ctx
    const bob = moving ? Math.abs(Math.sin(anim)) * 2 : Math.sin(time * 2) * 0.6
    const fx = facing === 'left' ? -1 : facing === 'right' ? 1 : 0
    ctx.save()
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx, cy + 9, 8, 3, 0, 0, Math.PI * 2); ctx.fill()
    const top = cy - bob
    // robe
    ctx.fillStyle = '#3a6ee0'
    ctx.beginPath(); ctx.moveTo(cx, top - 2); ctx.lineTo(cx - 7, top + 10); ctx.lineTo(cx + 7, top + 10); ctx.closePath(); ctx.fill()
    // little feet
    if (moving) { ctx.fillStyle = '#2a2030'; const s = Math.sin(anim) * 3; ctx.fillRect(Math.round(cx - 5 + s), Math.round(top + 9), 3, 3); ctx.fillRect(Math.round(cx + 2 - s), Math.round(top + 9), 3, 3) }
    // head
    ctx.fillStyle = '#f4c9a0'; ctx.beginPath(); ctx.arc(cx, top - 3, 4.5, 0, Math.PI * 2); ctx.fill()
    // hat (tip leans in facing dir)
    ctx.fillStyle = '#7b46d6'
    ctx.beginPath(); ctx.moveTo(cx + fx * 4, top - 11); ctx.lineTo(cx - 6, top - 4); ctx.lineTo(cx + 6, top - 4); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(cx + fx * 4, top - 11, 1.4, 0, Math.PI * 2); ctx.fill()
    // torch held ahead, with a tiny flame
    const tx = cx + (fx || 0) * 8 + (facing === 'up' ? 0 : 0), tyv = top + (facing === 'up' ? -4 : 2)
    if (facing !== 'up') {
      ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + fx * 5, top + 2); ctx.lineTo(tx, tyv); ctx.stroke()
      const fl = ctx.createRadialGradient(tx, tyv - 3, 0, tx, tyv - 3, 5)
      fl.addColorStop(0, '#fff3c0'); fl.addColorStop(0.5, '#ff9a30'); fl.addColorStop(1, 'rgba(255,80,20,0)')
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(tx, tyv - 3, 5, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  #prompt(vw: number, vh: number, title: string, sub: string): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const w = Math.max(160, ctx.measureText(title).width + 60)
    const bx = vw / 2 - w / 2, by = vh - 52
    ctx.fillStyle = 'rgba(8,6,20,0.82)'; ctx.strokeStyle = 'rgba(126,182,214,0.5)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.roundRect(bx, by, w, 40, 8); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#ffe6b0'; ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(title, vw / 2, by + 14)
    ctx.fillStyle = '#9ec9ff'; ctx.font = '11px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(sub, vw / 2, by + 29)
    ctx.restore()
  }
}
