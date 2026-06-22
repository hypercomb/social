// diamondcoreprocessor.com/games/bubble/renderer.ts
//
// Canvas2D renderer for the Bubble Bobble engine. Everything is drawn
// procedurally — no image assets — so the module stays self-contained and
// signature-clean. It draws in WORLD units (0..width, 0..height); the overlay
// owns the device-pixel-ratio transform, so the vector art stays crisp at any
// display size. The renderer is stateless beyond its ctx and reads the engine's
// public state each frame.
//
// The look targets the 1986 arcade in a clean modern-vector style: a round,
// chubby BUB dragon, the classic monster cast (Zen-Chan, Mighta, Banebou,
// Monsta), chunky teal platform bricks and the signature bordered single screen.

import { Engine, TILE, WALL, POWER_META, enemyKind, type Enemy, type Bubble, type Fruit, type Candy, type FloatText, type Particle, type PowerKind, type LevelDef } from './engine.js'

// Enemy tints live with their species in ENEMY_KINDS (engine.ts) — the renderer
// reads enemyKind(kind).tint so behaviour + colour never drift apart.
// Close blue-teal stone shades for the brick faces — subtle per-brick variation
// reads as real masonry rather than a flat slab (BB Round-1 teal platforms).
const BRICK_TINTS = ['#2f7fb0', '#2b86b8', '#2d93ad', '#287aa6', '#2f8fb2', '#2a8198'] as const
// The bright frame around the play field — the BB bordered screen.
const FRAME = '#39c6e6'

export class Renderer {
  #ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.#ctx = ctx
  }

  draw(e: Engine, time: number): void {
    const ctx = this.#ctx
    this.#background(e.width, e.height, time)
    this.#platforms(e)
    const cleanupUrgent = e.state === 'cleanup' && e.cleanupTimer < 1
    for (const f of e.fruits) this.#fruit(f, time, cleanupUrgent)
    for (const c of e.candies) this.#candy(c, time)
    for (const en of e.enemies) if (en.alive && !en.captured) this.#enemy(en.x + en.w / 2, en.y + en.h / 2, en.w, en, time)
    for (const b of e.bubbles) this.#bubble(b, time)
    this.#bub(e, time)
    for (const p of e.particles) this.#particle(p)
    for (const f of e.floats) this.#float(f)
    this.#frame(e.width, e.height)
    this.#hud(e)
    this.#powerBadges(e)
    this.#chainPopup(e)
    this.#hurry(e, time)
    if (e.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,60,80,${0.4 * (e.hurtFlash / 0.5)})`
      ctx.fillRect(0, 0, e.width, e.height)
    }
  }

  // ── backdrop ─────────────────────────────────────────────

  #background(w: number, h: number, time: number): void {
    const ctx = this.#ctx
    // Deep near-black field, faintly blue at the top — the BB cabinet look.
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0a1230')
    g.addColorStop(0.5, '#06091f')
    g.addColorStop(1, '#03040f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    // a sparse, slow starfield — restrained, just enough to feel alive
    ctx.save()
    for (let i = 0; i < 26; i++) {
      const sx = (i * 97.3) % w
      const sy = (i * 53.7 + Math.sin(time * 0.4 + i) * 4) % h
      const tw = 0.25 + 0.25 * Math.sin(time * 1.5 + i * 1.3)
      ctx.fillStyle = `rgba(180,210,255,${tw})`
      ctx.fillRect(sx, sy, 1.6, 1.6)
    }
    ctx.restore()
  }

  /** The signature bordered screen — a bright rounded frame with corner studs. */
  #frame(w: number, h: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.strokeStyle = FRAME
    ctx.shadowColor = 'rgba(57,198,230,0.6)'
    ctx.shadowBlur = 10
    ctx.lineWidth = 3
    this.#roundRect(3, 3, w - 6, h - 6, 10)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = FRAME
    for (const [cx, cy] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]] as const) {
      ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  // ── platforms (contiguous runs → chunky teal brick bars) ──

  #platforms(e: Engine): void {
    this.#platformRuns((c, r) => e.tileAt(c, r), e.cols, e.rows)
  }

  /** Draw platform tiles as continuous rounded brick bars (horizontal runs).
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
      ctx.strokeStyle = 'rgba(57,198,230,0.9)'
      ctx.lineWidth = 2
      ctx.strokeRect(hover.col * TILE + 1, hover.row * TILE + 1, TILE - 2, TILE - 2)
    }
    this.#frame(w, h)
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

  /** A contiguous platform run drawn as a rounded brick wall — staggered courses
   *  of small beveled bricks over a dark mortar base. */
  #platformBar(x: number, y: number, w: number): void {
    const ctx = this.#ctx
    const h = TILE
    const rad = Math.min(10, h / 2, w / 2)

    // drop shadow + dark mortar base (shows through the gaps between bricks)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 4
    const mortar = ctx.createLinearGradient(0, y, 0, y + h)
    mortar.addColorStop(0, '#15324a')
    mortar.addColorStop(1, '#0b1d2e')
    ctx.fillStyle = mortar
    this.#roundRect(x, y, w, h, rad)
    ctx.fill()
    ctx.restore()

    // masonry — two running-bond courses of small beveled bricks, clipped to the bar
    ctx.save()
    this.#roundRect(x, y, w, h, rad)
    ctx.clip()
    const brickH = h / 2
    const brickW = TILE * 0.62
    const m = 1.3
    for (let r = 0; r < 2; r++) {
      const by = y + r * brickH
      const stagger = r % 2 ? -brickW / 2 : 0
      let i = 0
      for (let bx = x + stagger; bx < x + w; bx += brickW, i++) {
        const tint = BRICK_TINTS[(i * 3 + r * 2) % BRICK_TINTS.length]
        const fx = bx + m, fy = by + m, fw = brickW - m * 2, fh = brickH - m * 2
        if (fw <= 0) continue
        ctx.fillStyle = tint
        ctx.fillRect(fx, fy, fw, fh)
        ctx.fillStyle = this.#shade(tint, 0.3)
        ctx.fillRect(fx, fy, fw, 1.5)
        ctx.fillRect(fx, fy, 1.5, fh)
        ctx.fillStyle = this.#shade(tint, -0.32)
        ctx.fillRect(fx, fy + fh - 1.5, fw, 1.5)
        ctx.fillRect(fx + fw - 1.5, fy, 1.5, fh)
      }
    }
    ctx.restore()

    // glossy sheen along the top + a crisp rim
    ctx.fillStyle = 'rgba(190,235,255,0.5)'
    this.#roundRect(x + 3, y + 2.5, w - 6, 3.5, 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(120,210,255,0.4)'
    ctx.lineWidth = 1
    this.#roundRect(x + 0.5, y + 0.5, w - 1, h - 1, rad)
    ctx.stroke()
  }

  // ── Bub, the round dragon ────────────────────────────────

  #bub(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    const cx = p.x + p.w / 2
    const bob = e.walking ? Math.sin(time * 16) * 1.4 : 0
    // squash & stretch from vertical velocity (subtle, volume-preserving)
    const k = Math.max(-1, Math.min(1, -p.vy / 620))
    const sy = 1 + k * 0.12
    const sx = 1 / sy
    const blink = e.invuln > 0 && Math.sin(time * 30) < 0
    if (blink) return  // flicker while invulnerable

    const w = p.w, h = p.h
    const f = p.facing
    const footY = p.y + h + bob
    const bodyCy = p.y + h * 0.56 + bob
    const rx = w * 0.6, ry = h * 0.54

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse(cx, p.y + h + 3, w * 0.5, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.translate(cx, footY)
    ctx.scale(sx, sy)
    ctx.translate(-cx, -footY)

    // little curled tail at the back
    ctx.fillStyle = '#2a9d4a'
    ctx.beginPath()
    ctx.moveTo(cx - f * rx * 0.7, footY - h * 0.18)
    ctx.quadraticCurveTo(cx - f * rx * 1.15, footY - h * 0.16, cx - f * rx * 1.0, footY - h * 0.42)
    ctx.quadraticCurveTo(cx - f * rx * 0.9, footY - h * 0.24, cx - f * rx * 0.62, footY - h * 0.2)
    ctx.fill()

    // rounded dorsal crest (three soft bumps along the back-top)
    ctx.fillStyle = '#2a9d4a'
    for (let i = 0; i < 3; i++) {
      const t = i / 2
      const bx = cx - f * (rx * 0.1) - f * (rx * 0.6) * t
      const byc = bodyCy - ry * 0.78 + ry * 0.5 * t
      ctx.beginPath(); ctx.arc(bx, byc, 3.4 - i * 0.5, 0, Math.PI * 2); ctx.fill()
    }

    // feet (two rounded toes)
    ctx.fillStyle = '#1f8f43'
    ctx.beginPath(); ctx.ellipse(cx - w * 0.24, footY - 2.5, w * 0.2, 5.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + w * 0.24, footY - 2.5, w * 0.2, 5.5, 0, 0, Math.PI * 2); ctx.fill()

    // body — a fat round dragon
    const bodyGrad = ctx.createRadialGradient(cx - f * w * 0.14, bodyCy - h * 0.16, w * 0.12, cx, bodyCy, rx)
    bodyGrad.addColorStop(0, '#74e88a')
    bodyGrad.addColorStop(0.6, '#43c95e')
    bodyGrad.addColorStop(1, '#239a48')
    ctx.fillStyle = bodyGrad
    ctx.beginPath(); ctx.ellipse(cx, bodyCy, rx, ry, 0, 0, Math.PI * 2); ctx.fill()

    // cream belly
    ctx.fillStyle = 'rgba(250,248,214,0.95)'
    ctx.beginPath(); ctx.ellipse(cx + f * w * 0.05, bodyCy + h * 0.12, rx * 0.6, ry * 0.62, 0, 0, Math.PI * 2); ctx.fill()

    // snout/muzzle bump on the facing side
    ctx.fillStyle = '#5fde78'
    ctx.beginPath(); ctx.ellipse(cx + f * rx * 0.62, bodyCy + ry * 0.18, w * 0.2, h * 0.16, 0, 0, Math.PI * 2); ctx.fill()

    // eyes — big, close together, near the top
    const eyeY = bodyCy - ry * 0.36
    const eo = w * 0.2
    for (const d of [-1, 1]) {
      const ex = cx + d * eo + f * w * 0.07
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.ellipse(ex, eyeY, w * 0.15, h * 0.18, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#15233a'
      ctx.beginPath(); ctx.arc(ex + f * w * 0.05, eyeY + h * 0.02, w * 0.07, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(ex + f * w * 0.02, eyeY - h * 0.03, w * 0.025, 0, Math.PI * 2); ctx.fill()
    }

    // mouth — open "O" with a forming bubble while blowing, else a small smile
    const mouthX = cx + f * rx * 0.5
    const mouthY = bodyCy + ry * 0.28
    if (e.blowFlash > 0) {
      const t = 1 - e.blowFlash / 0.2
      ctx.fillStyle = '#7a1530'
      ctx.beginPath(); ctx.ellipse(mouthX, mouthY, w * 0.11, h * 0.11, 0, 0, Math.PI * 2); ctx.fill()
      ctx.save()
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = '#bfefff'
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(mouthX + f * (9 + t * 11), mouthY, 4 + t * 10, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    } else {
      ctx.strokeStyle = '#155e34'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.arc(mouthX, mouthY - 2, w * 0.11, 0.12 * Math.PI, 0.88 * Math.PI)
      ctx.stroke()
    }

    ctx.restore()
  }

  // ── enemies (the classic cast) ───────────────────────────

  #enemy(cx: number, cy: number, size: number, en: Enemy, time: number): void {
    const ctx = this.#ctx
    const r = size * 0.5
    const wob = Math.sin(en.bob + time * 2) * size * 0.04
    const kind = enemyKind(en.kind)
    const fly = kind.behavior === 'fly'
    const base = en.angry ? '#ff3b3b' : kind.tint
    const f = en.dir

    // ground shadow — only for grounded species
    if (!en.captured && !fly) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.beginPath(); ctx.ellipse(cx, cy + r + 2, r * 0.85, 3.5, 0, 0, Math.PI * 2); ctx.fill()
    }

    if (fly) { this.#monsta(cx, cy + wob, r, base, f, en.angry, time); return }

    // beating-foot / spring squash for the hopper as a bit of life
    // feet (ground species)
    ctx.fillStyle = this.#shade(base, -0.3)
    ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy + r * 0.82, r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + r * 0.42, cy + r * 0.82, r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()

    // body
    const bg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3 + wob, r * 0.2, cx, cy + wob, r)
    bg.addColorStop(0, this.#shade(base, 0.32))
    bg.addColorStop(0.7, base)
    bg.addColorStop(1, this.#shade(base, -0.28))
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.arc(cx, cy + wob, r, 0, Math.PI * 2); ctx.fill()

    // species topper
    if (kind.name === 'zen-chan') this.#zenCap(cx, cy + wob, r, base)
    else if (kind.name === 'mighta') this.#mightaHorns(cx, cy + wob, r, base)
    else if (kind.name === 'banebou') this.#banebouTuft(cx, cy + wob, r, base)

    // eyes
    const ey = cy - r * 0.1 + wob
    for (const d of [-1, 1]) {
      const ex = cx + d * r * 0.34
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.27, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#14121f'
      ctx.beginPath(); ctx.arc(ex + f * r * 0.1, ey, r * 0.14, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath(); ctx.arc(ex + f * r * 0.04, ey - r * 0.08, r * 0.05, 0, Math.PI * 2); ctx.fill()
    }
    // angry / mighta brows
    if (en.angry || kind.name === 'mighta') {
      ctx.strokeStyle = en.angry ? '#3a0000' : this.#shade(base, -0.45); ctx.lineWidth = 2.4
      ctx.beginPath(); ctx.moveTo(cx - r * 0.55, ey - r * 0.42); ctx.lineTo(cx - r * 0.12, ey - r * 0.18); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx + r * 0.55, ey - r * 0.42); ctx.lineTo(cx + r * 0.12, ey - r * 0.18); ctx.stroke()
    }
    // mouth — grin (angry shows teeth)
    ctx.strokeStyle = 'rgba(20,8,20,0.7)'; ctx.lineWidth = 2
    ctx.beginPath()
    if (en.angry) ctx.arc(cx, cy + r * 0.5 + wob, r * 0.26, 1.15 * Math.PI, 1.85 * Math.PI)
    else ctx.arc(cx, cy + r * 0.36 + wob, r * 0.26, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.stroke()
  }

  /** Zen-Chan's rounded helmet cap + antenna ball. */
  #zenCap(cx: number, cy: number, r: number, base: string): void {
    const ctx = this.#ctx
    ctx.fillStyle = this.#shade(base, -0.35)
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.74, r * 0.78, r * 0.5, 0, Math.PI, 0); ctx.fill()
    ctx.fillStyle = this.#shade(base, 0.2)
    ctx.fillRect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 0.12)
    // antenna
    ctx.strokeStyle = this.#shade(base, -0.4); ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.05); ctx.lineTo(cx, cy - r * 1.4); ctx.stroke()
    ctx.fillStyle = '#ffe27a'
    ctx.beginPath(); ctx.arc(cx, cy - r * 1.46, r * 0.16, 0, Math.PI * 2); ctx.fill()
  }

  /** Mighta's two stubby horns. */
  #mightaHorns(cx: number, cy: number, r: number, base: string): void {
    const ctx = this.#ctx
    ctx.fillStyle = this.#shade(base, -0.35)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + d * r * 0.5, cy - r * 0.66)
      ctx.lineTo(cx + d * r * 0.74, cy - r * 1.12)
      ctx.lineTo(cx + d * r * 0.24, cy - r * 0.82)
      ctx.closePath(); ctx.fill()
    }
  }

  /** Banebou's single springy top tuft. */
  #banebouTuft(cx: number, cy: number, r: number, base: string): void {
    const ctx = this.#ctx
    ctx.strokeStyle = this.#shade(base, -0.4); ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.9)
    ctx.quadraticCurveTo(cx + r * 0.3, cy - r * 1.2, cx - r * 0.05, cy - r * 1.4)
    ctx.stroke()
    ctx.fillStyle = this.#shade(base, 0.25)
    ctx.beginPath(); ctx.arc(cx - r * 0.05, cy - r * 1.46, r * 0.16, 0, Math.PI * 2); ctx.fill()
  }

  /** Monsta — the pink flyer: a rounded body with two beating side fins, a small
   *  tail fin and a cute face. Faintly translucent. */
  #monsta(cx: number, cy: number, r: number, base: string, f: number, angry: boolean, time: number): void {
    const ctx = this.#ctx
    const beat = Math.sin(time * 12) * 0.5 + 0.5
    ctx.save()
    ctx.globalAlpha = 0.94
    // beating wings/fins behind the body
    ctx.fillStyle = this.#hexA(base, 0.55)
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(cx + d * r * 0.95, cy - r * 0.05, r * 0.52, r * (0.3 + beat * 0.2), d * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // tail fin
    ctx.fillStyle = this.#shade(base, -0.2)
    ctx.beginPath()
    ctx.moveTo(cx - f * r * 0.7, cy)
    ctx.lineTo(cx - f * r * 1.1, cy - r * 0.4)
    ctx.lineTo(cx - f * r * 1.1, cy + r * 0.4)
    ctx.closePath(); ctx.fill()
    // body
    const bg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r)
    bg.addColorStop(0, this.#shade(base, 0.4))
    bg.addColorStop(0.7, base)
    bg.addColorStop(1, this.#shade(base, -0.25))
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.05, r * 0.92, 0, 0, Math.PI * 2); ctx.fill()
    // eyes
    for (const d of [-1, 1]) {
      const ex = cx + d * r * 0.32 + f * r * 0.12
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.arc(ex, cy - r * 0.12, r * 0.24, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#14121f'
      ctx.beginPath(); ctx.arc(ex + f * r * 0.08, cy - r * 0.12, r * 0.12, 0, Math.PI * 2); ctx.fill()
    }
    // brows if angry
    if (angry) {
      ctx.strokeStyle = '#3a0000'; ctx.lineWidth = 2.2
      ctx.beginPath(); ctx.moveTo(cx - r * 0.55, cy - r * 0.42); ctx.lineTo(cx - r * 0.1, cy - r * 0.22); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx + r * 0.55, cy - r * 0.42); ctx.lineTo(cx + r * 0.1, cy - r * 0.22); ctx.stroke()
    }
    // small mouth
    ctx.strokeStyle = 'rgba(20,8,20,0.7)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.34, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
    ctx.restore()
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
    const fill = ctx.createRadialGradient(b.x - rx * 0.3, b.y - ry * 0.35, rx * 0.1, b.x, b.y, rx)
    fill.addColorStop(0, 'rgba(255,255,255,0.34)')
    fill.addColorStop(0.55, 'rgba(170,225,255,0.10)')
    fill.addColorStop(1, 'rgba(120,180,255,0.05)')
    ctx.fillStyle = fill
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()

    // soft-film rim — a faint hue drift for the soap shimmer
    const hue = (b.age * 80 + b.x * 0.4) % 360
    ctx.lineWidth = 3
    ctx.strokeStyle = `hsla(${hue},90%,78%,0.5)`
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

  // ── food (glossy reward orbs) ────────────────────────────

  #fruit(f: Fruit, time: number, urgent: boolean): void {
    const ctx = this.#ctx
    const cx = f.x + f.w / 2
    const cy = f.y + f.h / 2 + (f.rest ? Math.sin(time * 4 + cx) * 1.2 : 0)
    const r = f.w * 0.5
    const cols = ['#ff4d6d', '#ff8a3d', '#a06bff', '#46d98a']
    const col = cols[f.kind]
    ctx.save()
    if (urgent || f.life < 1.2) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 18))
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
    // chain-multiplier badge — chained food is worth ×N
    if (f.mult > 1) {
      ctx.save()
      ctx.font = '800 11px "Segoe UI", system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const tx = cx + r * 0.7, ty = cy - r - 5
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(6,4,18,0.9)'
      ctx.strokeText('×' + f.mult, tx, ty)
      ctx.fillStyle = '#ffd76a'
      ctx.fillText('×' + f.mult, tx, ty)
      ctx.restore()
    }
  }

  // ── power-up sweets (glossy gem + white emblem) ──────────

  #candy(c: Candy, time: number): void {
    const ctx = this.#ctx
    const cx = c.x + c.w / 2
    const cy = c.y + c.h / 2 + (c.rest ? Math.sin(time * 4 + c.bob) * 1.4 : 0)
    const r = c.w * 0.5
    const col = POWER_META[c.kind].color
    ctx.save()
    if (c.life < 1.2) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 18))
    ctx.shadowColor = col; ctx.shadowBlur = 12
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.32, r * 0.1, cx, cy, r)
    g.addColorStop(0, this.#shade(col, 0.45))
    g.addColorStop(1, this.#shade(col, -0.28))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.7, 0, Math.PI * 2); ctx.stroke()
    this.#powerEmblem(c.kind, cx, cy, r, '#ffffff')
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.ellipse(cx - r * 0.34, cy - r * 0.38, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** A compact vector emblem for each power, centred at (cx,cy), drawn in `color`.
   *  Shared by the dropped sweet (white on the gem) and the HUD badges (tinted). */
  #powerEmblem(kind: PowerKind, cx: number, cy: number, r: number, color: string): void {
    const ctx = this.#ctx
    const s = r * 0.6
    ctx.save()
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (kind === 'shoe') {
      // a little boot facing right
      ctx.beginPath()
      ctx.moveTo(cx - s * 0.7, cy - s * 0.55)
      ctx.lineTo(cx - s * 0.28, cy - s * 0.55)
      ctx.lineTo(cx - s * 0.12, cy + s * 0.05)
      ctx.lineTo(cx + s * 0.78, cy + s * 0.3)
      ctx.quadraticCurveTo(cx + s, cy + s * 0.36, cx + s, cy + s * 0.55)
      ctx.lineTo(cx - s * 0.7, cy + s * 0.55)
      ctx.closePath()
      ctx.fill()
    } else {
      // candy — a wrapped sweet (round centre with two pinched ends)
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2); ctx.fill()
      for (const d of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(cx + d * s * 0.5, cy)
        ctx.lineTo(cx + d * s * 0.95, cy - s * 0.4)
        ctx.lineTo(cx + d * s * 0.95, cy + s * 0.4)
        ctx.closePath(); ctx.fill()
      }
    }
    ctx.restore()
  }

  // ── floating "+N" score popups ───────────────────────────

  #float(f: FloatText): void {
    const ctx = this.#ctx
    const k = f.life / f.max
    ctx.save()
    ctx.globalAlpha = Math.min(1, k * 1.7)
    ctx.font = '800 13px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(6,4,18,0.85)'
    ctx.strokeText(f.text, f.x, f.y)
    ctx.fillStyle = f.color
    ctx.fillText(f.text, f.x, f.y)
    ctx.restore()
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

    // lives as little Bub heads, bottom-left
    for (let i = 0; i < e.lives; i++) {
      const hx = 18 + i * 24, hy = e.height - 18
      ctx.fillStyle = '#43c95e'
      ctx.beginPath(); ctx.arc(hx, hy, 8.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#2a9d4a'
      ctx.beginPath(); ctx.arc(hx - 5, hy - 7, 2.4, 0, Math.PI * 2); ctx.fill()
      for (const d of [-1, 1]) {
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.arc(hx + d * 3, hy - 1.5, 2.6, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#15233a'
        ctx.beginPath(); ctx.arc(hx + d * 3 + 1, hy - 1.5, 1.2, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.restore()
  }

  /** A small chain banner when popping foes in quick succession. */
  #chainPopup(e: Engine): void {
    if (e.chain <= 1) return
    const ctx = this.#ctx
    ctx.save()
    ctx.textAlign = 'center'
    ctx.font = '800 20px "Segoe UI", system-ui, sans-serif'
    const hue = (e.chain * 40) % 360
    ctx.fillStyle = `hsl(${hue},90%,68%)`
    ctx.shadowColor = `hsla(${hue},90%,60%,0.6)`; ctx.shadowBlur = 12
    ctx.fillText(`${e.chain}× CHAIN!`, e.width / 2, 52)
    ctx.restore()
  }

  /** The arcade "Hurry up!" warning when the screen has dragged on. */
  #hurry(e: Engine, time: number): void {
    if (e.hurryFlash <= 0) return
    const ctx = this.#ctx
    ctx.save()
    ctx.globalAlpha = Math.min(1, e.hurryFlash) * (0.6 + 0.4 * Math.abs(Math.sin(time * 14)))
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = '900 ' + Math.round(e.height * 0.11) + 'px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = '#ff5a5a'
    ctx.shadowColor = 'rgba(255,60,60,0.7)'; ctx.shadowBlur = 18
    ctx.fillText('HURRY!', e.width / 2, e.height * 0.4)
    ctx.restore()
  }

  /** Active powers as a row of chips below the HUD bar. */
  #powerBadges(e: Engine): void {
    const powers = e.activePowers
    if (powers.length === 0) return
    const ctx = this.#ctx
    const size = 26, gap = 6, y = 31
    let x = 10
    for (const kind of powers) {
      const col = POWER_META[kind].color
      ctx.save()
      ctx.fillStyle = 'rgba(8,6,24,0.6)'
      this.#roundRect(x, y, size, size, 7); ctx.fill()
      ctx.strokeStyle = col; ctx.lineWidth = 1.4
      this.#roundRect(x + 0.7, y + 0.7, size - 1.4, size - 1.4, 6); ctx.stroke()
      this.#powerEmblem(kind, x + size / 2, y + size / 2, size * 0.34, col)
      ctx.restore()
      x += size + gap
    }
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

  /** A #rrggbb hex as an rgba() string at alpha `a`. */
  #hexA(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
}
