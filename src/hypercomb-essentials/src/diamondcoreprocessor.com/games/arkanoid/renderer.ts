// diamondcoreprocessor.com/games/arkanoid/renderer.ts
//
// Draws the Engine's world (bricks, paddle, balls, pills, lasers, gun aim, HUD)
// onto a 2D context the overlay has already transformed into world units. Pure
// draw — no state.

import {
  type Engine, type Brick, type Ball, type Capsule, type Laser,
  POWER_META, W, H, BRICK_W, BRICK_H, BRICK_TOP,
} from './engine.js'
import { EDIT_COLS, EDIT_ROWS } from './levels.js'

// Brick colour by max hit-points (1..4 / tough). Cool→warm ramp, vivid since
// this is a game overlay (the "no flashy tile effects" rule is for the hive
// grid, not the game canvas).
const BRICK_COLORS: Record<number, string> = { 1: '#5ad1c4', 2: '#5aa9ff', 3: '#b98cff', 4: '#ff8f6a' }
const TOUGH_COLOR = '#ffd76a'

export class Renderer {
  #ctx: CanvasRenderingContext2D
  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  draw(engine: Engine, time: number): void {
    this.#bricks(engine.bricks)
    this.#lasers(engine.lasers)
    this.#gunAim(engine, time)
    this.#paddle(engine)
    for (const b of engine.balls) this.#ball(b, time)
    this.#capsules(engine.capsules, time)
    this.#hud(engine)
  }

  // ── designer view ────────────────────────────────────────
  drawEditor(grid: readonly string[], hover: { col: number; row: number } | null): void {
    const ctx = this.#ctx
    // bricks from the grid chars
    for (let r = 0; r < grid.length; r++) {
      const line = grid[r]
      for (let c = 0; c < line.length; c++) {
        const ch = line[c]
        if (ch === '.' || ch === ' ') continue
        const hp = ch === '*' ? 4 : (parseInt(ch, 10) || 1)
        const color = hp >= 4 ? TOUGH_COLOR : (BRICK_COLORS[hp] ?? '#5aa9ff')
        const x = c * BRICK_W, y = BRICK_TOP + r * BRICK_H
        this.#roundRect(x + 1.5, y + 1.5, BRICK_W - 3, BRICK_H - 3, 4)
        ctx.fillStyle = color; ctx.fill()
        ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(255,255,255,0.3)'
        this.#roundRect(x + 1.5, y + 1.5, BRICK_W - 3, (BRICK_H - 3) * 0.4, 4); ctx.fill()
        ctx.globalAlpha = 1
      }
    }
    // grid over the editable area
    const gw = EDIT_COLS * BRICK_W, gh = EDIT_ROWS * BRICK_H
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1
    for (let c = 0; c <= EDIT_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * BRICK_W + 0.5, BRICK_TOP); ctx.lineTo(c * BRICK_W + 0.5, BRICK_TOP + gh); ctx.stroke() }
    for (let r = 0; r <= EDIT_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, BRICK_TOP + r * BRICK_H + 0.5); ctx.lineTo(gw, BRICK_TOP + r * BRICK_H + 0.5); ctx.stroke() }
    // hover cell
    if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < EDIT_COLS && hover.row < EDIT_ROWS) {
      ctx.strokeStyle = 'rgba(126,224,255,0.9)'; ctx.lineWidth = 2
      ctx.strokeRect(hover.col * BRICK_W + 1, BRICK_TOP + hover.row * BRICK_H + 1, BRICK_W - 2, BRICK_H - 2)
    }
    // bat preview + hint
    ctx.fillStyle = 'rgba(90,169,255,0.4)'
    this.#roundRect(W / 2 - 42, H - 34, 84, 13, 6); ctx.fill()
    ctx.fillStyle = 'rgba(154,160,200,0.85)'; ctx.font = '13px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
    ctx.fillText('paint bricks · ▶ Test to play', W / 2, H - 44)
  }

  #bricks(bricks: readonly Brick[]): void {
    const ctx = this.#ctx
    for (const b of bricks) {
      if (!b.alive) continue
      const base = b.max >= 4 ? TOUGH_COLOR : (BRICK_COLORS[b.max] ?? '#5aa9ff')
      const wear = b.hp / b.max
      ctx.globalAlpha = 0.55 + 0.45 * wear
      this.#roundRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 4)
      ctx.fillStyle = base
      ctx.fill()
      ctx.globalAlpha = (0.55 + 0.45 * wear) * 0.5
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      this.#roundRect(b.x + 1.5, b.y + 1.5, b.w - 3, (b.h - 3) * 0.4, 4)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // The rotating gun: a dashed orbit "around the outside" of the bat plus a
  // barrel + reticle dot at the current aim — slide the bat to sweep it.
  #gunAim(engine: Engine, time: number): void {
    if (!engine.gunActive) return
    const ctx = this.#ctx
    const p = engine.paddle
    const cx = p.x, cy = p.y + p.h / 2
    const R = 46
    const a = engine.aimAngle
    ctx.save()
    // orbit ring
    ctx.strokeStyle = 'rgba(176,123,255,0.35)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 5])
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    // aim line
    ctx.strokeStyle = 'rgba(200,160,255,0.55)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke()
    // barrel
    ctx.strokeStyle = '#d8c2ff'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22); ctx.stroke()
    // reticle dot
    const dotR = 4 + Math.sin(time * 8) * 1
    ctx.fillStyle = '#e9ddff'
    ctx.shadowColor = 'rgba(176,123,255,0.9)'; ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, dotR, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  #paddle(engine: Engine): void {
    const ctx = this.#ctx
    const p = engine.paddle
    const x = p.x - p.w / 2
    ctx.save()
    ctx.shadowColor = 'rgba(126,224,255,0.65)'
    ctx.shadowBlur = 12
    this.#roundRect(x, p.y, p.w, p.h, p.h / 2)
    const g = ctx.createLinearGradient(x, p.y, x, p.y + p.h)
    g.addColorStop(0, '#bfe9ff')
    g.addColorStop(1, '#5aa9ff')
    ctx.fillStyle = g
    ctx.fill()
    ctx.restore()
    // Laser cannons on the bat ends while armed.
    if (engine.laserTimer > 0) {
      ctx.fillStyle = '#ff8f8f'
      ctx.fillRect(x + 4, p.y - 5, 4, 6)
      ctx.fillRect(x + p.w - 8, p.y - 5, 4, 6)
    }
  }

  #ball(ball: Ball, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    const pulse = 0.85 + 0.15 * Math.sin(time * 6)
    ctx.shadowColor = `rgba(255,255,255,${0.7 * pulse})`
    ctx.shadowBlur = 14
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.restore()
  }

  #capsules(capsules: readonly Capsule[], time: number): void {
    const ctx = this.#ctx
    for (const cap of capsules) {
      const meta = POWER_META[cap.kind]
      const w = 30, h = 15
      const x = cap.x - w / 2, y = cap.y - h / 2
      ctx.save()
      ctx.shadowColor = meta.color
      ctx.shadowBlur = 12
      this.#roundRect(x, y, w, h, h / 2)
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.25, meta.color)
      g.addColorStop(1, meta.color)
      ctx.fillStyle = g
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(10,12,26,0.92)'
      ctx.font = '700 11px "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(meta.letter, cap.x, cap.y + 0.5)
    }
    void time
  }

  #lasers(lasers: readonly Laser[]): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = 'rgba(255,90,90,0.9)'
    ctx.shadowBlur = 8
    ctx.fillStyle = '#ff6b6b'
    for (const l of lasers) ctx.fillRect(l.x - 1.5, l.y, 3, 12)
    ctx.restore()
  }

  #hud(engine: Engine): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(223,231,255,0.9)'
    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(`✦ ${engine.score}`, 8, 8)
    // Lives as small balls, top-right.
    for (let i = 0; i < engine.lives; i++) {
      ctx.beginPath()
      ctx.arc(W - 12 - i * 16, 16, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
    // Active power countdown badges, centred just under the top edge.
    const powers = engine.activePowers
    if (powers.length) {
      const bw = 46, gap = 6
      let bx = (W - (powers.length * bw + (powers.length - 1) * gap)) / 2
      for (const pw of powers) {
        const meta = POWER_META[pw.kind]
        this.#roundRect(bx, 6, bw, 18, 5)
        ctx.fillStyle = 'rgba(10,14,30,0.66)'
        ctx.fill()
        // countdown bar
        ctx.fillStyle = meta.color
        ctx.globalAlpha = 0.85
        this.#roundRect(bx, 21, bw * pw.frac, 3, 1.5)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = meta.color
        ctx.font = '700 11px "Segoe UI", system-ui, sans-serif'
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
        ctx.fillText(meta.letter, bx + 6, 15)
        ctx.fillStyle = '#dfe7ff'
        ctx.textAlign = 'right'
        ctx.fillText(`${pw.secs}s`, bx + bw - 6, 15)
        bx += bw + gap
      }
    }
    ctx.restore()
  }

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }
}
