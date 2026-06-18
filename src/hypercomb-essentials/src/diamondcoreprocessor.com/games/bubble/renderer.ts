// diamondcoreprocessor.com/games/bubble/renderer.ts
//
// Canvas2D renderer for the Bubble Bobble engine. Everything is drawn
// procedurally — no image assets — so the module stays self-contained and
// signature-clean. It draws in WORLD units (0..width, 0..height); the overlay
// owns the device-pixel-ratio transform, so the vector art stays crisp at any
// display size. The renderer is stateless beyond its ctx and reads the engine's
// public state each frame.

import { Engine, TILE, WALL, type Enemy, type Bubble, type Fruit, type Particle, type LevelDef } from './engine.js'

const ENEMY_TINTS = ['#ff5d8f', '#7c5cff', '#ffac3b', '#2fd3a0'] as const

export class Renderer {
  #ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.#ctx = ctx
  }

  draw(e: Engine, time: number): void {
    const ctx = this.#ctx
    this.#background(e.width, e.height, time)
    this.#platforms(e)
    for (const f of e.fruits) this.#fruit(f, time)
    for (const en of e.enemies) if (en.alive && !en.captured) this.#enemy(en.x + en.w / 2, en.y + en.h / 2, en.w, en, time)
    for (const b of e.bubbles) this.#bubble(b, time)
    this.#bub(e, time)
    for (const p of e.particles) this.#particle(p)
    this.#hud(e)
    if (e.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,60,80,${0.4 * (e.hurtFlash / 0.5)})`
      ctx.fillRect(0, 0, e.width, e.height)
    }
  }

  // ── backdrop ─────────────────────────────────────────────

  #background(w: number, h: number, time: number): void {
    const ctx = this.#ctx
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#241653')
    g.addColorStop(0.5, '#141038')
    g.addColorStop(1, '#080620')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // soft drifting bokeh — large faint circles rising slowly
    ctx.save()
    for (let i = 0; i < 14; i++) {
      const bx = (i * 137.5) % w
      const drift = (time * (8 + (i % 4) * 4) + i * 90)
      const by = h - (drift % (h + 120)) + 60
      const rad = 26 + (i % 5) * 12
      const rg = ctx.createRadialGradient(bx, by, 0, bx, by, rad)
      const hue = (i * 40 + time * 12) % 360
      rg.addColorStop(0, `hsla(${hue},70%,70%,0.10)`)
      rg.addColorStop(1, 'hsla(0,0%,100%,0)')
      ctx.fillStyle = rg
      ctx.beginPath(); ctx.arc(bx, by, rad, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()

    // vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.78)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, w, h)
  }

  // ── platforms (contiguous runs → smooth candy bars) ──────

  #platforms(e: Engine): void {
    this.#platformRuns((c, r) => e.tileAt(c, r), e.cols, e.rows)
  }

  /** Draw platform tiles as continuous rounded candy bars (horizontal runs).
   *  Shared by the play view and the designer's editor view. */
  #platformRuns(at: (c: number, r: number) => number, cols: number, rows: number): void {
    for (let r = 0; r < rows; r++) {
      let c = 0
      while (c < cols) {
        if (at(c, r) !== WALL) { c++; continue }
        let c1 = c
        while (c1 < cols && at(c1, r) === WALL) c1++
        this.#platformBar(c * TILE, r * TILE, (c1 - c) * TILE)
        c = c1
      }
    }
  }

  // ── designer view ────────────────────────────────────────

  drawEditor(level: LevelDef, hover: { col: number; row: number } | null, time: number): void {
    const ctx = this.#ctx
    const w = level.cols * TILE, h = level.rows * TILE
    this.#background(w, h, time)
    this.#platformRuns((c, r) => level.tiles[r * level.cols + c] ?? 0, level.cols, level.rows)
    for (const e of level.enemies) {
      this.#enemy(e.col * TILE + TILE / 2, e.row * TILE + TILE / 2, TILE * 0.72,
        { dir: e.dir ?? 1, angry: false, kind: e.kind ?? 0, captured: true, bob: 0 } as never, time)
    }
    this.#spawnMarker(level.player.col, level.player.row)
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    for (let c = 0; c <= level.cols; c++) { ctx.beginPath(); ctx.moveTo(c * TILE + .5, 0); ctx.lineTo(c * TILE + .5, h); ctx.stroke() }
    for (let r = 0; r <= level.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE + .5); ctx.lineTo(w, r * TILE + .5); ctx.stroke() }
    // hover cell
    if (hover && hover.col >= 0 && hover.row >= 0 && hover.col < level.cols && hover.row < level.rows) {
      ctx.strokeStyle = 'rgba(126,224,255,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(hover.col * TILE + 1, hover.row * TILE + 1, TILE - 2, TILE - 2)
    }
  }

  #spawnMarker(col: number, row: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    ctx.strokeStyle = 'rgba(95,224,138,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6)
    ctx.fillStyle = 'rgba(95,224,138,0.95)'
    ctx.font = `700 ${Math.floor(TILE * 0.5)}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('P', x + TILE / 2, y + TILE / 2 + 1)
  }

  #platformBar(x: number, y: number, w: number): void {
    const ctx = this.#ctx
    const h = TILE
    const rad = Math.min(11, h / 2, w / 2)
    // drop shadow
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 4
    const body = ctx.createLinearGradient(0, y, 0, y + h)
    body.addColorStop(0, '#5b73d6')
    body.addColorStop(0.5, '#42539f')
    body.addColorStop(1, '#2c3970')
    ctx.fillStyle = body
    this.#roundRect(x, y, w, h, rad)
    ctx.fill()
    ctx.restore()
    // glossy top highlight
    ctx.fillStyle = 'rgba(180,205,255,0.55)'
    this.#roundRect(x + 3, y + 3, w - 6, 5, 3)
    ctx.fill()
    // inner bottom shade
    ctx.fillStyle = 'rgba(10,12,30,0.4)'
    this.#roundRect(x + 3, y + h - 6, w - 6, 4, 2)
    ctx.fill()
    // crisp rim
    ctx.strokeStyle = 'rgba(150,180,255,0.35)'
    ctx.lineWidth = 1
    this.#roundRect(x + 0.5, y + 0.5, w - 1, h - 1, rad)
    ctx.stroke()
  }

  // ── Bub, the dragon ──────────────────────────────────────

  #bub(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    const cx = p.x + p.w / 2
    const bob = e.walking ? Math.sin(time * 16) * 1.6 : 0
    // squash & stretch from vertical velocity (subtle, volume-preserving)
    const k = Math.max(-1, Math.min(1, -p.vy / 620))
    const sy = 1 + k * 0.12
    const sx = 1 / sy
    const blink = e.invuln > 0 && Math.sin(time * 30) < 0
    if (blink) return  // flicker while invulnerable

    const w = p.w, h = p.h
    const footY = p.y + h + bob

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse(cx, p.y + h + 3, w * 0.46, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(cx, footY)
    ctx.scale(sx, sy)
    ctx.translate(-cx, -footY)

    const topY = p.y + bob
    const midY = topY + h * 0.52
    const f = p.facing

    // tail
    ctx.fillStyle = '#1f9d54'
    ctx.beginPath()
    ctx.moveTo(cx - f * w * 0.34, footY - h * 0.18)
    ctx.quadraticCurveTo(cx - f * w * 0.62, footY - h * 0.05, cx - f * w * 0.52, footY - h * 0.32)
    ctx.fill()

    // back spikes
    ctx.fillStyle = '#0f7a3c'
    for (let i = 0; i < 3; i++) {
      const sxp = cx - f * (w * 0.18 + i * w * 0.16)
      const syp = topY + h * 0.16 + i * h * 0.12
      ctx.beginPath()
      ctx.moveTo(sxp, syp)
      ctx.lineTo(sxp - f * 7, syp - 5)
      ctx.lineTo(sxp - f * 2, syp + 5)
      ctx.fill()
    }

    // feet
    ctx.fillStyle = '#0f7a3c'
    ctx.beginPath(); ctx.ellipse(cx - w * 0.22, footY - 2, w * 0.18, 5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + w * 0.22, footY - 2, w * 0.18, 5, 0, 0, Math.PI * 2); ctx.fill()

    // body
    const bodyGrad = ctx.createRadialGradient(cx - f * w * 0.12, midY - h * 0.12, w * 0.1, cx, midY, w * 0.62)
    bodyGrad.addColorStop(0, '#5fe08a')
    bodyGrad.addColorStop(0.6, '#33c869')
    bodyGrad.addColorStop(1, '#1f9d54')
    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.ellipse(cx, midY, w * 0.5, h * 0.46, 0, 0, Math.PI * 2)
    ctx.fill()

    // belly
    ctx.fillStyle = 'rgba(245,255,225,0.92)'
    ctx.beginPath()
    ctx.ellipse(cx + f * w * 0.04, midY + h * 0.08, w * 0.3, h * 0.3, 0, 0, Math.PI * 2)
    ctx.fill()

    // eyes
    const eyeY = topY + h * 0.32
    const eo = w * 0.17
    for (const dir of [-1, 1]) {
      const ex = cx + dir * eo + f * w * 0.06
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.ellipse(ex, eyeY, w * 0.13, h * 0.16, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#16243a'
      ctx.beginPath(); ctx.arc(ex + f * w * 0.05, eyeY + h * 0.02, w * 0.06, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath(); ctx.arc(ex + f * w * 0.03, eyeY - h * 0.02, w * 0.02, 0, Math.PI * 2); ctx.fill()
    }

    // mouth — round "O" + a forming bubble while blowing, else a small smile
    const mouthX = cx + f * w * 0.2
    const mouthY = topY + h * 0.52
    if (e.blowFlash > 0) {
      const t = 1 - e.blowFlash / 0.2
      ctx.fillStyle = '#7a1530'
      ctx.beginPath(); ctx.ellipse(mouthX, mouthY, w * 0.1, h * 0.1, 0, 0, Math.PI * 2); ctx.fill()
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = '#bfefff'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(mouthX + f * (8 + t * 10), mouthY, 4 + t * 9, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    } else {
      ctx.strokeStyle = '#155e34'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.arc(mouthX, mouthY - 2, w * 0.1, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
    }

    ctx.restore()
  }

  // ── enemies (shared by free + bubble-trapped draw) ───────

  #enemy(cx: number, cy: number, size: number, en: Enemy, time: number): void {
    const ctx = this.#ctx
    const r = size * 0.5
    const wob = Math.sin(en.bob + time * 2) * size * 0.04
    const base = en.angry ? '#ff3b3b' : ENEMY_TINTS[en.kind % ENEMY_TINTS.length]
    const f = en.dir

    // shadow (only for free enemies sitting on ground — cheap + grounding)
    if (!en.captured) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.beginPath(); ctx.ellipse(cx, cy + r + 2, r * 0.85, 3.5, 0, 0, Math.PI * 2); ctx.fill()
    }

    // feet
    ctx.fillStyle = this.#shade(base, -0.3)
    ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy + r * 0.8, r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + r * 0.42, cy + r * 0.8, r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()

    // body
    const bg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3 + wob, r * 0.2, cx, cy + wob, r)
    bg.addColorStop(0, this.#shade(base, 0.32))
    bg.addColorStop(0.7, base)
    bg.addColorStop(1, this.#shade(base, -0.28))
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.arc(cx, cy + wob, r, 0, Math.PI * 2); ctx.fill()

    // little horns
    ctx.fillStyle = this.#shade(base, -0.35)
    ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy - r * 0.7 + wob); ctx.lineTo(cx - r * 0.66, cy - r * 1.05 + wob); ctx.lineTo(cx - r * 0.28, cy - r * 0.82 + wob); ctx.fill()
    ctx.beginPath(); ctx.moveTo(cx + r * 0.5, cy - r * 0.7 + wob); ctx.lineTo(cx + r * 0.66, cy - r * 1.05 + wob); ctx.lineTo(cx + r * 0.28, cy - r * 0.82 + wob); ctx.fill()

    // eyes
    const ey = cy - r * 0.12 + wob
    for (const d of [-1, 1]) {
      const ex = cx + d * r * 0.34
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.26, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#14121f'
      ctx.beginPath(); ctx.arc(ex + f * r * 0.1, ey, r * 0.13, 0, Math.PI * 2); ctx.fill()
    }
    // angry brows
    if (en.angry) {
      ctx.strokeStyle = '#3a0000'; ctx.lineWidth = 2.4
      ctx.beginPath(); ctx.moveTo(cx - r * 0.55, ey - r * 0.42); ctx.lineTo(cx - r * 0.12, ey - r * 0.18); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx + r * 0.55, ey - r * 0.42); ctx.lineTo(cx + r * 0.12, ey - r * 0.18); ctx.stroke()
    }
    // mouth
    ctx.strokeStyle = 'rgba(20,8,20,0.7)'; ctx.lineWidth = 2
    ctx.beginPath()
    if (en.angry) ctx.arc(cx, cy + r * 0.5 + wob, r * 0.26, 1.15 * Math.PI, 1.85 * Math.PI)
    else ctx.arc(cx, cy + r * 0.34 + wob, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.stroke()
  }

  // ── bubbles ──────────────────────────────────────────────

  #bubble(b: Bubble, time: number): void {
    const ctx = this.#ctx
    const wob = Math.sin(b.age * 6) * 0.045
    const rx = b.r * (1 + wob)
    const ry = b.r * (1 - wob)

    // trapped enemy sits inside, drawn first so the glass reads as "over" it
    if (b.enemy) this.#enemy(b.x, b.y, b.r * 1.15, b.enemy, time)

    ctx.save()
    ctx.shadowColor = 'rgba(150,220,255,0.5)'
    ctx.shadowBlur = 14
    // glassy fill
    const fill = ctx.createRadialGradient(b.x - rx * 0.3, b.y - ry * 0.35, rx * 0.1, b.x, b.y, rx)
    fill.addColorStop(0, 'rgba(255,255,255,0.34)')
    fill.addColorStop(0.55, 'rgba(170,225,255,0.10)')
    fill.addColorStop(1, 'rgba(120,180,255,0.05)')
    ctx.fillStyle = fill
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()

    // rainbow rim — hue drifts with age for a soap-film shimmer
    const hue = (b.age * 80 + b.x * 0.4) % 360
    ctx.lineWidth = 3
    ctx.strokeStyle = `hsla(${hue},90%,75%,0.55)`
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx - 1.5, ry - 1.5, 0, 0, Math.PI * 2); ctx.stroke()

    // specular highlights
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.ellipse(b.x - rx * 0.34, b.y - ry * 0.38, rx * 0.16, ry * 0.1, -0.6, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(b.x, b.y, rx * 0.74, Math.PI * 1.05, Math.PI * 1.35); ctx.stroke()
  }

  // ── fruit (glossy reward orbs) ───────────────────────────

  #fruit(f: Fruit, time: number): void {
    const ctx = this.#ctx
    const cx = f.x + f.w / 2
    const cy = f.y + f.h / 2 + (f.rest ? Math.sin(time * 4 + cx) * 1.2 : 0)
    const r = f.w * 0.5
    const cols = ['#ff4d6d', '#ff8a3d', '#a06bff', '#46d98a']
    const col = cols[f.kind]
    // blink out in its final second
    ctx.save()
    if (f.life < 1) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 18))
    ctx.shadowColor = col; ctx.shadowBlur = 10
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r)
    g.addColorStop(0, this.#shade(col, 0.4))
    g.addColorStop(1, this.#shade(col, -0.25))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    // leaf + stem
    ctx.strokeStyle = '#3a7d2c'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + 3, cy - r - 5); ctx.stroke()
    ctx.fillStyle = '#54b23f'
    ctx.beginPath(); ctx.ellipse(cx + 6, cy - r - 5, 4, 2.2, -0.6, 0, Math.PI * 2); ctx.fill()
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath(); ctx.ellipse(cx - r * 0.32, cy - r * 0.34, r * 0.18, r * 0.1, -0.6, 0, Math.PI * 2); ctx.fill()
  }

  // ── particles (additive sparkle burst) ───────────────────

  #particle(p: Particle): void {
    const ctx = this.#ctx
    const a = Math.max(0, p.life / p.max)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = a
    ctx.fillStyle = `hsl(${p.hue},95%,68%)`
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a), 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // ── HUD ──────────────────────────────────────────────────

  #hud(e: Engine): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(8,6,24,0.4)'
    ctx.fillRect(0, 0, e.width, 26)
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'middle'

    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffd76a'
    ctx.fillText(`🫧 ${e.level.name}`, 10, 14)

    const remaining = e.enemies.filter(en => en.alive).length
    ctx.textAlign = 'center'
    ctx.fillStyle = '#bfe3ff'
    ctx.fillText(remaining > 0 ? `${remaining} foe${remaining === 1 ? '' : 's'} left` : 'clear!', e.width / 2, 14)

    ctx.textAlign = 'right'
    ctx.fillStyle = '#fff'
    ctx.fillText(`✦ ${e.score}`, e.width - 10, 14)

    // lives as little dragon heads, bottom-left
    for (let i = 0; i < e.lives; i++) {
      const hx = 16 + i * 22, hy = e.height - 16
      ctx.fillStyle = '#33c869'
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(hx + 2, hy - 1, 2.4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#16243a'
      ctx.beginPath(); ctx.arc(hx + 3, hy - 1, 1.1, 0, Math.PI * 2); ctx.fill()
    }

    // combo flourish
    if (e.chain > 1) {
      ctx.textAlign = 'center'
      ctx.font = '800 20px "Segoe UI", system-ui, sans-serif'
      ctx.fillStyle = `hsl(${(e.chain * 40) % 360},90%,68%)`
      ctx.fillText(`${e.chain}× CHAIN!`, e.width / 2, 50)
    }
    ctx.restore()
  }

  // ── helpers ──────────────────────────────────────────────

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  /** Lighten (amt>0) or darken (amt<0) a #rrggbb hex by a fraction. */
  #shade(hex: string, amt: number): string {
    const n = parseInt(hex.slice(1), 16)
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const t = amt < 0 ? 0 : 255
    const p = Math.abs(amt)
    r = Math.round((t - r) * p + r)
    g = Math.round((t - g) * p + g)
    b = Math.round((t - b) * p + b)
    return `rgb(${r},${g},${b})`
  }
}
