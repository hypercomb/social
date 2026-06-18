// diamondcoreprocessor.com/games/solomon/renderer.ts
//
// Canvas2D renderer for the Solomon's Key engine. Everything is drawn
// procedurally — no image assets — so the module stays self-contained and
// signature-clean. The renderer is stateless beyond its ctx; it reads the
// engine's public state each frame. The same tile painters are reused by the
// designer so play + edit views look identical.

import { Engine, TILE, WALL, BRICK, type LevelDef, type Fireball } from './engine.js'

export class Renderer {
  #ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.#ctx = ctx
  }

  // ── play view ────────────────────────────────────────────

  draw(e: Engine, time: number): void {
    const ctx = this.#ctx
    this.#background(e.width, e.height, time)
    this.#tiles(e.grid, e.cols, e.rows)
    this.#door(e.level.door.col, e.level.door.row, e.doorOpen, time)
    for (const g of e.gems) if (!g.taken) this.#gem(g.col, g.row, time)
    if (e.key && !e.key.taken) this.#key(e.key.col, e.key.row, time)
    for (const en of e.enemies) this.#enemy(en)
    this.#dana(e, time)
    for (const f of e.fireballs) this.#fireball(f)
    this.#wandTarget(e)
    this.#hud(e)
    if (e.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${0.35 * (e.hurtFlash / 0.5)})`
      ctx.fillRect(0, 0, e.width, e.height)
    }
  }

  // ── designer view ────────────────────────────────────────

  drawEditor(level: LevelDef, hover: { col: number; row: number } | null, time: number): void {
    const ctx = this.#ctx
    const w = level.cols * TILE, h = level.rows * TILE
    this.#background(w, h, time)
    this.#tiles(level.tiles, level.cols, level.rows)
    this.#door(level.door.col, level.door.row, false, time)
    for (const g of level.gems) this.#gem(g.col, g.row, time)
    if (level.key) this.#key(level.key.col, level.key.row, time)
    for (const en of level.enemies) {
      this.#enemy({ x: en.col * TILE + TILE * 0.11, y: en.row * TILE + TILE * 0.11, w: TILE * 0.78, h: TILE * 0.78, alive: true, squash: 0, dir: en.dir ?? 1 } as never)
    }
    // spawn marker
    this.#spawnMarker(level.player.col, level.player.row)
    // grid + hover cell
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let c = 0; c <= level.cols; c++) { ctx.beginPath(); ctx.moveTo(c * TILE + .5, 0); ctx.lineTo(c * TILE + .5, h); ctx.stroke() }
    for (let r = 0; r <= level.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE + .5); ctx.lineTo(w, r * TILE + .5); ctx.stroke() }
    if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < level.cols && hover.row < level.rows) {
      ctx.strokeStyle = 'rgba(120,220,255,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(hover.col * TILE + 1, hover.row * TILE + 1, TILE - 2, TILE - 2)
    }
  }

  // ── pieces ───────────────────────────────────────────────

  #background(w: number, h: number, time: number): void {
    const ctx = this.#ctx
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#1a0f33')
    g.addColorStop(0.55, '#120a26')
    g.addColorStop(1, '#070512')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    // faint drifting "stars"
    ctx.fillStyle = 'rgba(180,160,255,0.18)'
    for (let i = 0; i < 36; i++) {
      const x = ((i * 97.13) % w)
      const y = ((i * 53.7 + time * 6) % h)
      ctx.fillRect(x, y, 2, 2)
    }
  }

  #tiles(grid: ArrayLike<number>, cols: number, rows: number): void {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r * cols + c]
        if (t === WALL) this.#wall(c, r)
        else if (t === BRICK) this.#brick(c, r)
      }
    }
  }

  #wall(c: number, r: number): void {
    const ctx = this.#ctx, x = c * TILE, y = r * TILE
    ctx.fillStyle = '#3a3550'
    ctx.fillRect(x, y, TILE, TILE)
    ctx.fillStyle = '#4b4668'
    ctx.fillRect(x + 2, y + 2, TILE - 4, 3)
    ctx.fillStyle = '#211e30'
    ctx.fillRect(x, y + TILE - 4, TILE, 4)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + .5, y + .5, TILE - 1, TILE - 1)
  }

  #brick(c: number, r: number): void {
    const ctx = this.#ctx, x = c * TILE, y = r * TILE
    ctx.fillStyle = '#b9772f'
    ctx.fillRect(x, y, TILE, TILE)
    // bevel
    ctx.fillStyle = '#d99b52'
    ctx.fillRect(x + 1, y + 1, TILE - 2, 4)
    ctx.fillStyle = '#8a5320'
    ctx.fillRect(x + 1, y + TILE - 5, TILE - 2, 4)
    // mortar lines
    ctx.strokeStyle = 'rgba(60,30,10,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y + TILE / 2 + .5); ctx.lineTo(x + TILE, y + TILE / 2 + .5)
    ctx.moveTo(x + TILE / 2 + .5, y); ctx.lineTo(x + TILE / 2 + .5, y + TILE / 2)
    ctx.moveTo(x + TILE / 4 + .5, y + TILE / 2); ctx.lineTo(x + TILE / 4 + .5, y + TILE)
    ctx.moveTo(x + 3 * TILE / 4 + .5, y + TILE / 2); ctx.lineTo(x + 3 * TILE / 4 + .5, y + TILE)
    ctx.stroke()
  }

  #dana(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    const bob = e.walking ? Math.sin(time * 14) * 1.5 : 0
    const cx = p.x + p.w / 2
    const top = p.y + bob
    ctx.save()
    // robe
    ctx.fillStyle = '#2e6bd6'
    ctx.beginPath()
    ctx.moveTo(cx, top + p.h * 0.35)
    ctx.lineTo(p.x + p.w * 0.05, p.y + p.h)
    ctx.lineTo(p.x + p.w * 0.95, p.y + p.h)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#1f4fa8'
    ctx.fillRect(p.x + p.w * 0.05, p.y + p.h - 4, p.w * 0.9, 4)
    // face
    ctx.fillStyle = '#f4c9a0'
    ctx.beginPath()
    ctx.arc(cx, top + p.h * 0.3, p.w * 0.32, 0, Math.PI * 2)
    ctx.fill()
    // hat
    ctx.fillStyle = '#7a3fd0'
    ctx.beginPath()
    ctx.moveTo(cx + e.facing * p.w * 0.18, top - p.h * 0.04)
    ctx.lineTo(cx - p.w * 0.42, top + p.h * 0.18)
    ctx.lineTo(cx + p.w * 0.42, top + p.h * 0.18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#ffd24d'
    ctx.beginPath()
    ctx.arc(cx + e.facing * p.w * 0.18, top - p.h * 0.04, 1.8, 0, Math.PI * 2)
    ctx.fill()
    // eye
    ctx.fillStyle = '#1a1a2a'
    ctx.beginPath()
    ctx.arc(cx + e.facing * p.w * 0.12, top + p.h * 0.3, 1.6, 0, Math.PI * 2)
    ctx.fill()
    // wand spark when casting
    if (e.conjureFlash > 0) {
      const wx = cx + e.facing * p.w * 0.6
      const wy = top + p.h * 0.4
      ctx.fillStyle = `rgba(255,240,150,${e.conjureFlash / 0.18})`
      ctx.beginPath(); ctx.arc(wx, wy, 4 + (0.18 - e.conjureFlash) * 30, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  #enemy(en: { x: number; y: number; w: number; h: number; alive: boolean; squash: number; dir: number }): void {
    const ctx = this.#ctx
    let { x, y, w, h } = en
    if (!en.alive) {
      if (en.squash <= 0) return
      // flatten as it dies
      const k = en.squash / 0.4
      const nh = h * k
      y += h - nh; h = nh
    }
    ctx.fillStyle = en.alive ? '#c5304a' : '#7a2030'
    ctx.beginPath()
    this.#roundRect(x, y, w, h, 6)
    ctx.fill()
    // horns
    ctx.fillStyle = '#8a1f30'
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y); ctx.lineTo(x + w * 0.05, y - 5); ctx.lineTo(x + w * 0.35, y); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x + w * 0.8, y); ctx.lineTo(x + w * 0.95, y - 5); ctx.lineTo(x + w * 0.65, y); ctx.fill()
    if (en.alive) {
      // eyes look in travel direction
      const ex = en.dir > 0 ? 0.62 : 0.38
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(x + w * 0.36, y + h * 0.42, w * 0.13, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x + w * 0.64, y + h * 0.42, w * 0.13, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#1a1a2a'
      ctx.beginPath(); ctx.arc(x + w * (ex - 0.28), y + h * 0.44, w * 0.06, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(x + w * ex, y + h * 0.44, w * 0.06, 0, Math.PI * 2); ctx.fill()
      // mouth
      ctx.strokeStyle = '#3a0a14'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x + w * 0.32, y + h * 0.72); ctx.lineTo(x + w * 0.68, y + h * 0.72); ctx.stroke()
    }
  }

  #fireball(f: Fireball): void {
    const ctx = this.#ctx
    const dir = Math.sign(f.vx) || 1
    ctx.save()
    ctx.shadowColor = 'rgba(255,150,40,0.9)'
    ctx.shadowBlur = 12
    // tail streaking behind the orb
    ctx.fillStyle = 'rgba(255,140,30,0.4)'
    ctx.beginPath()
    ctx.moveTo(f.x - dir * 4, f.y - 4)
    ctx.lineTo(f.x - dir * 17, f.y)
    ctx.lineTo(f.x - dir * 4, f.y + 4)
    ctx.closePath()
    ctx.fill()
    // glowing core
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 8)
    grad.addColorStop(0, '#fff6c0')
    grad.addColorStop(0.5, '#ffae33')
    grad.addColorStop(1, 'rgba(255,80,20,0.1)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(f.x, f.y, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  #key(col: number, row: number, time: number): void {
    const ctx = this.#ctx
    const cx = col * TILE + TILE / 2
    const cy = row * TILE + TILE / 2 + Math.sin(time * 3) * 2
    ctx.save()
    ctx.shadowColor = 'rgba(255,215,80,0.8)'
    ctx.shadowBlur = 10
    ctx.strokeStyle = '#ffd24d'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 9); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy + 9); ctx.lineTo(cx + 5, cy + 9); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx + 4, cy + 5); ctx.stroke()
    ctx.restore()
  }

  #gem(col: number, row: number, time: number): void {
    const ctx = this.#ctx
    const cx = col * TILE + TILE / 2
    const cy = row * TILE + TILE / 2 + Math.sin(time * 3 + col) * 1.5
    const r = 6
    ctx.save()
    ctx.shadowColor = 'rgba(120,230,255,0.7)'; ctx.shadowBlur = 8
    ctx.fillStyle = '#5fd6ff'
    ctx.beginPath()
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.2); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  #door(col: number, row: number, open: boolean, time: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    // arch frame
    ctx.fillStyle = '#5a4a2a'
    ctx.fillRect(x - 1, y - TILE * 0.1, TILE + 2, TILE * 1.1)
    if (open) {
      const glow = 0.6 + Math.sin(time * 4) * 0.2
      const g = ctx.createLinearGradient(x, y, x, y + TILE)
      g.addColorStop(0, `rgba(255,230,120,${glow})`)
      g.addColorStop(1, `rgba(255,170,40,${glow})`)
      ctx.fillStyle = g
      ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillRect(x + TILE / 2 - 1, y + 2, 2, TILE - 4)
    } else {
      ctx.fillStyle = '#241a0d'
      ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2)
      ctx.strokeStyle = '#3c2c16'; ctx.lineWidth = 2
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 3 + i * (TILE - 6) / 3, y + 1); ctx.lineTo(x + 3 + i * (TILE - 6) / 3, y + TILE - 1); ctx.stroke() }
    }
  }

  #spawnMarker(col: number, row: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    ctx.strokeStyle = 'rgba(120,220,160,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6)
    ctx.fillStyle = 'rgba(120,220,160,0.9)'
    ctx.font = `${Math.floor(TILE * 0.5)}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('P', x + TILE / 2, y + TILE / 2 + 1)
  }

  #wandTarget(e: Engine): void {
    if (e.state !== 'playing') return
    const ctx = this.#ctx
    const { col, row } = e.targetCell()
    if (!e.inBounds(col, row)) return
    const t = e.tileAt(col, row)
    if (t === WALL) return
    ctx.strokeStyle = t === BRICK ? 'rgba(255,120,120,0.55)' : 'rgba(150,255,200,0.5)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4)
    ctx.setLineDash([])
  }

  #hud(e: Engine): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(0, 0, e.width, 22)
    ctx.font = '13px monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffd24d'
    ctx.fillText(`♦ ${e.level.name}`, 8, 12)
    ctx.textAlign = 'center'
    ctx.fillStyle = e.doorOpen ? '#7dffb0' : '#cfd2ff'
    ctx.fillText(e.doorOpen ? 'door open — escape!' : (e.key ? 'find the key' : ''), e.width / 2, 12)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#fff'
    ctx.fillText(`✦ ${e.score}`, e.width - 8, 12)
    // lives as little wizard hats
    for (let i = 0; i < e.lives; i++) {
      const hx = e.width - 70 - i * 16
      ctx.fillStyle = '#7a3fd0'
      ctx.beginPath(); ctx.moveTo(hx, 16); ctx.lineTo(hx - 5, 6); ctx.lineTo(hx + 5, 6); ctx.closePath(); ctx.fill()
    }
    ctx.restore()
  }

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
  }
}
