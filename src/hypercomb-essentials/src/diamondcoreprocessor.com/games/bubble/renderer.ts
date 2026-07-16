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
// chubby BUB dragon with a real run cycle and air poses, the classic monster
// cast (Zen-Chan, Mighta, Banebou, Monsta), chunky brick platforms and the
// signature bordered single screen. Every round wears its own THEME palette —
// classic BB recolours the platforms each screen.

import { Engine, TILE, WALL, POWER_META, BUBBLE_WARN, UMBRELLA_META, enemyKind, type Enemy, type Bubble, type Fruit, type Candy, type FloatText, type Particle, type Ring, type Baron, type Droplet, type Shot, type Diamond, type Umbrella, type PowerKind, type LevelDef } from './engine.js'

// ── worlds (classic BB rethemes every screen) ────────────────
// A theme is a whole WORLD, not just a recolour: the brick palette, the masonry
// STYLE its blocks are cut in, and the motif drifting through its backdrop.
// Close shades per palette give subtle per-block variation so a run reads as
// real masonry rather than a flat slab; backgrounds stay near-black (the BB
// cabinet look), just tinted toward the world.
export type BrickStyle = 'stone' | 'crystal' | 'moss' | 'coral'
export type Motif = 'stars' | 'embers' | 'motes' | 'spores' | 'bubbles'

export interface Theme {
  name: string
  bricks: readonly string[]
  frame: string
  bgTop: string
  bgMid: string
  bgBase: string
  brick: BrickStyle
  motif: Motif
}
const THEMES: Theme[] = [
  {
    name: 'Insect Cave',
    bricks: ['#2f7fb0', '#2b86b8', '#2d93ad', '#287aa6', '#2f8fb2', '#2a8198'],
    frame: '#39c6e6', bgTop: '#0a1230', bgMid: '#06091f', bgBase: '#03040f',
    brick: 'stone', motif: 'stars',
  },
  {
    name: 'Ember Forge',
    bricks: ['#b3812f', '#bb8d2b', '#b0862d', '#a97b28', '#b5912f', '#9b792a'],
    frame: '#ffc44d', bgTop: '#26110a', bgMid: '#120709', bgBase: '#080305',
    brick: 'stone', motif: 'embers',
  },
  {
    name: 'Crystal Grotto',
    bricks: ['#7a4fc0', '#8256c8', '#7357bd', '#6d48b6', '#8560c2', '#6b4aa8'],
    frame: '#b48cff', bgTop: '#140b2e', bgMid: '#090620', bgBase: '#05030f',
    brick: 'crystal', motif: 'motes',
  },
  {
    name: 'Moss Thicket',
    bricks: ['#2fa05f', '#2ba868', '#2d9d5d', '#289656', '#2fa862', '#2a9158'],
    frame: '#5fe08a', bgTop: '#07172a', bgMid: '#040d1c', bgBase: '#02060f',
    brick: 'moss', motif: 'spores',
  },
  {
    name: 'Coral Reef',
    bricks: ['#c04f74', '#c8567e', '#bd5773', '#b6486b', '#c26082', '#a84a66'],
    frame: '#ff8ab5', bgTop: '#0a1832', bgMid: '#080d22', bgBase: '#040514',
    brick: 'coral', motif: 'bubbles',
  },
]
/** World names, in theme-index order — the designer's picker reads this. */
export const THEME_NAMES: readonly string[] = THEMES.map(t => t.name)
export const THEME_COUNT = THEMES.length

export function themeFor(level: LevelDef): Theme {
  const n = THEMES.length
  return THEMES[(((level.theme ?? 0) % n) + n) % n]
}

export class Renderer {
  #ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.#ctx = ctx
  }

  draw(e: Engine, time: number, hi = 0): void {
    const ctx = this.#ctx
    const th = themeFor(e.level)
    this.#background(e.width, e.height, time, th)
    this.#platforms(e, th)
    const cleanupUrgent = e.state === 'cleanup' && e.cleanupTimer < 1
    for (const d of e.diamonds) this.#diamond(d, time)
    for (const f of e.fruits) this.#fruit(f, time, cleanupUrgent)
    for (const c of e.candies) this.#candy(c, time)
    for (const u of e.umbrellas) this.#umbrella(u, time)
    for (const en of e.enemies) if (en.alive && !en.captured) this.#enemy(en.x + en.w / 2, en.y + en.h / 2, en.w, en, time)
    for (const b of e.bubbles) this.#bubble(b, time)
    for (const d of e.waters) this.#droplet(d)
    for (const s of e.shots) this.#shot(s, time)
    if (e.baron) this.#baron(e.baron, time)
    this.#bub(e, time)
    for (const r of e.rings) this.#ring(r)
    for (const p of e.particles) this.#particle(p)
    for (const f of e.floats) this.#float(f)
    this.#frame(e.width, e.height, th)
    this.#hud(e, hi)
    this.#powerBadges(e)
    this.#chainPopup(e)
    this.#hurry(e, time)
    if (e.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,60,80,${0.4 * (e.hurtFlash / 0.5)})`
      ctx.fillRect(0, 0, e.width, e.height)
    }
  }

  // ── backdrop ─────────────────────────────────────────────

  #background(w: number, h: number, time: number, th: Theme): void {
    const ctx = this.#ctx
    // Deep near-black field, faintly world-tinted at the top — the BB cabinet look.
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, th.bgTop)
    g.addColorStop(0.5, th.bgMid)
    g.addColorStop(1, th.bgBase)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    this.#motif(w, h, time, th)
  }

  /** The world's backdrop life — sparse and slow by design: it must never
   *  compete with the play field for the eye. Every mote is a pure function of
   *  its index and the clock, so there's no particle state to carry. */
  #motif(w: number, h: number, time: number, th: Theme): void {
    const ctx = this.#ctx
    ctx.save()
    switch (th.motif) {
      case 'embers': {
        // warm sparks lifting off the forge floor
        for (let i = 0; i < 20; i++) {
          const x = (i * 83.1) % w + Math.sin(time * 0.7 + i) * 6
          const y = h - ((time * (10 + (i % 5) * 3) + i * 67) % (h + 24))
          const a = Math.max(0, 0.16 + 0.24 * Math.sin(time * 2 + i * 1.7))
          ctx.fillStyle = `rgba(255,${140 + (i % 4) * 22},80,${a})`
          ctx.beginPath(); ctx.arc(x, y, 0.9 + (i % 3) * 0.4, 0, Math.PI * 2); ctx.fill()
        }
        break
      }
      case 'motes': {
        // crystal dust drifting on a slow diagonal
        for (let i = 0; i < 22; i++) {
          const x = ((i * 91.7) + time * 5) % (w + 12) - 6
          const y = ((i * 57.3) + time * 3) % (h + 12) - 6
          const a = 0.18 + 0.3 * Math.abs(Math.sin(time * 1.2 + i))
          ctx.fillStyle = `rgba(206,178,255,${a})`
          ctx.beginPath(); ctx.arc(x, y, 0.8 + (i % 2) * 0.5, 0, Math.PI * 2); ctx.fill()
        }
        break
      }
      case 'spores': {
        // pale seeds sinking through the thicket, swaying as they go
        for (let i = 0; i < 20; i++) {
          const x = (i * 89.3) % w + Math.sin(time * 0.8 + i * 2.1) * 7
          const y = ((i * 61.7) + time * 7) % (h + 16) - 8
          const a = 0.14 + 0.22 * Math.abs(Math.sin(time * 0.9 + i))
          ctx.fillStyle = `rgba(190,240,180,${a})`
          ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.35, 0, Math.PI * 2); ctx.fill()
        }
        break
      }
      case 'bubbles': {
        // the reef's own bubbles rising past the play field
        ctx.lineWidth = 1
        for (let i = 0; i < 16; i++) {
          const x = (i * 103.1) % w + Math.sin(time * 0.9 + i * 1.3) * 5
          const y = h - ((time * (12 + (i % 4) * 4) + i * 79) % (h + 20))
          const r = 1.2 + (i % 4) * 0.7
          ctx.strokeStyle = `rgba(150,220,255,${0.14 + 0.16 * Math.abs(Math.sin(time + i))})`
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
        }
        break
      }
      default: {
        // a sparse, slow starfield — restrained, just enough to feel alive
        for (let i = 0; i < 26; i++) {
          const sx = (i * 97.3) % w
          const sy = (i * 53.7 + Math.sin(time * 0.4 + i) * 4) % h
          const tw = 0.25 + 0.25 * Math.sin(time * 1.5 + i * 1.3)
          ctx.fillStyle = `rgba(180,210,255,${tw})`
          ctx.fillRect(sx, sy, 1.6, 1.6)
        }
      }
    }
    ctx.restore()
  }

  /** The signature bordered screen — a bright rounded frame with corner studs. */
  #frame(w: number, h: number, th: Theme): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.strokeStyle = th.frame
    ctx.shadowColor = this.#hexA(th.frame, 0.6)
    ctx.shadowBlur = 10
    ctx.lineWidth = 3
    this.#roundRect(3, 3, w - 6, h - 6, 10)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = th.frame
    for (const [cx, cy] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]] as const) {
      ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  // ── platforms (contiguous runs → chunky themed brick bars) ──

  #platforms(e: Engine, th: Theme): void {
    this.#platformRuns((c, r) => e.tileAt(c, r), e.cols, e.rows, th)
  }

  /** Draw platform tiles as continuous rounded brick bars (horizontal runs).
   *  Shared by the play view and the designer's editor view. */
  #platformRuns(at: (c: number, r: number) => number, cols: number, rows: number, th: Theme): void {
    for (let r = 0; r < rows; r++) {
      let c = 0
      while (c < cols) {
        if (at(c, r) !== WALL) { c++; continue }
        let c1 = c
        while (c1 < cols && at(c1, r) === WALL) c1++
        this.#platformBar(c * TILE, r * TILE, (c1 - c) * TILE, th)
        c = c1
      }
    }
  }

  // ── designer view ────────────────────────────────────────

  drawEditor(level: LevelDef, hover: { col: number; row: number } | null, time: number): void {
    const ctx = this.#ctx
    const th = themeFor(level)
    const w = level.cols * TILE, h = level.rows * TILE
    this.#background(w, h, time, th)
    this.#platformRuns((c, r) => level.tiles[r * level.cols + c] ?? 0, level.cols, level.rows, th)
    for (const e of level.enemies) {
      this.#enemy(e.col * TILE + TILE / 2, e.row * TILE + TILE / 2, TILE * 1.44,
        { dir: e.dir ?? 1, angry: false, kind: e.kind ?? 0, captured: true, bob: 0, vy: 0 } as never, time)
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
    this.#frame(w, h, th)
  }

  #spawnMarker(col: number, row: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    ctx.strokeStyle = 'rgba(95,224,138,0.95)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3)
    ctx.fillStyle = 'rgba(95,224,138,0.95)'
    ctx.font = `700 ${Math.floor(TILE * 0.9)}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('P', x + TILE / 2, y + TILE / 2 + 1)
  }

  /** A contiguous platform run — ONE thin course of beveled blocks, one block
   *  per tile, exactly the arcade's brick strip, in the round's theme. */
  #platformBar(x: number, y: number, w: number, th: Theme): void {
    const ctx = this.#ctx
    const h = TILE
    const rad = Math.min(4, h / 2, w / 2)

    // drop shadow + dark mortar base (shows through the block seams)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 7
    ctx.shadowOffsetY = 3
    const mortar = ctx.createLinearGradient(0, y, 0, y + h)
    mortar.addColorStop(0, this.#shade(th.bricks[0], -0.55))
    mortar.addColorStop(1, this.#shade(th.bricks[0], -0.75))
    ctx.fillStyle = mortar
    this.#roundRect(x, y, w, h, rad)
    ctx.fill()
    ctx.restore()

    // masonry — one block per tile, cut in the world's style, clipped to the bar
    ctx.save()
    this.#roundRect(x, y, w, h, rad)
    ctx.clip()
    const m = 1
    let i = 0
    for (let bx = x; bx < x + w; bx += TILE, i++) {
      const tint = th.bricks[(i * 3) % th.bricks.length]
      this.#brickFace(bx + m, y + m, TILE - m * 2, h - m * 2, tint, th.brick)
    }
    ctx.restore()

    // glossy sheen along the top + a crisp rim
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    this.#roundRect(x + 2, y + 1.5, w - 4, 2, 1.5)
    ctx.fill()
    ctx.strokeStyle = this.#hexA(th.frame, 0.35)
    ctx.lineWidth = 1
    this.#roundRect(x + 0.5, y + 0.5, w - 1, h - 1, rad)
    ctx.stroke()
  }

  /** Baron von Blubba — the invincible skeletal hunter: a ghost-white whale
   *  with hollow sockets, a bony grin and a faint wake of dissolving bubbles. */
  #baron(b: Baron, time: number): void {
    const ctx = this.#ctx
    const r = TILE * 1.24
    const pulse = 1 + Math.sin(time * 9) * 0.04
    const f = b.vx < 0 ? -1 : 1
    // wake: three fading ghost-bubbles trailing his path
    const sp = Math.hypot(b.vx, b.vy) || 1
    for (let i = 1; i <= 3; i++) {
      const wx = b.x - (b.vx / sp) * i * r * 0.8
      const wy = b.y - (b.vy / sp) * i * r * 0.8
      ctx.strokeStyle = `rgba(210,230,255,${0.28 / i})`
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(wx, wy, r * (0.5 - i * 0.09), 0, Math.PI * 2); ctx.stroke()
    }
    ctx.save()
    // body — pale, faintly glowing
    ctx.shadowColor = 'rgba(210,230,255,0.6)'
    ctx.shadowBlur = 16
    const g = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.3, r * 0.15, b.x, b.y, r * pulse)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.65, '#dbe7fa')
    g.addColorStop(1, '#9fb4d8')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.ellipse(b.x, b.y, r * 1.1 * pulse, r * 0.95 * pulse, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // side fins, beating
    const beat = Math.sin(time * 11) * 0.5 + 0.5
    ctx.fillStyle = 'rgba(219,231,250,0.8)'
    for (const d of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(b.x + d * r * 0.95, b.y, r * 0.45, r * (0.24 + beat * 0.16), d * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // hollow eye sockets with pin-red pupils
    for (const d of [-1, 1]) {
      const ex = b.x + d * r * 0.34 + f * r * 0.1
      ctx.fillStyle = '#2a3450'
      ctx.beginPath(); ctx.arc(ex, b.y - r * 0.18, r * 0.2, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ff4d4d'
      ctx.beginPath(); ctx.arc(ex + f * r * 0.05, b.y - r * 0.18, r * 0.055, 0, Math.PI * 2); ctx.fill()
    }
    // bony zig-zag grin
    ctx.strokeStyle = '#3a4664'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const my = b.y + r * 0.34
    ctx.moveTo(b.x - r * 0.5, my)
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(b.x - r * 0.5 + r * 0.2 * (i + 0.5), my + (i % 2 ? -1 : 1) * r * 0.11)
    }
    ctx.lineTo(b.x + r * 0.5, my)
    ctx.stroke()
    ctx.restore()
  }

  /** One block face in the world's masonry style. */
  #brickFace(fx: number, fy: number, fw: number, fh: number, tint: string, style: BrickStyle): void {
    const ctx = this.#ctx
    if (fw <= 0 || fh <= 0) return
    switch (style) {
      case 'crystal': {
        // a cut gem: bright upper-left facet, shadowed lower-right, glint
        ctx.fillStyle = tint
        ctx.fillRect(fx, fy, fw, fh)
        ctx.fillStyle = this.#shade(tint, 0.45)
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + fw, fy); ctx.lineTo(fx, fy + fh); ctx.closePath(); ctx.fill()
        ctx.fillStyle = this.#shade(tint, -0.38)
        ctx.beginPath(); ctx.moveTo(fx + fw, fy); ctx.lineTo(fx + fw, fy + fh); ctx.lineTo(fx, fy + fh); ctx.closePath(); ctx.fill()
        ctx.strokeStyle = this.#shade(tint, 0.6)
        ctx.lineWidth = 0.8
        ctx.beginPath(); ctx.moveTo(fx + fw, fy); ctx.lineTo(fx, fy + fh); ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.fillRect(fx + fw * 0.24, fy + fh * 0.24, 1.3, 1.3)
        break
      }
      case 'moss': {
        // stone under a mossy fringe along the lit top edge
        this.#stoneFace(fx, fy, fw, fh, tint)
        ctx.fillStyle = this.#shade(tint, 0.42)
        for (let k = 0; k < 3; k++) {
          ctx.beginPath()
          ctx.arc(fx + fw * (0.2 + k * 0.3), fy + 0.7, 1.5, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
      case 'coral': {
        // rounded, porous, with a wet highlight across the crown
        ctx.fillStyle = tint
        this.#roundRect(fx, fy, fw, fh, Math.min(3, fw / 2, fh / 2)); ctx.fill()
        ctx.fillStyle = this.#shade(tint, 0.34)
        this.#roundRect(fx + 0.8, fy + 0.8, fw - 1.6, fh * 0.34, 1.2); ctx.fill()
        ctx.fillStyle = this.#shade(tint, -0.42)
        for (let k = 0; k < 3; k++) {
          ctx.beginPath()
          ctx.arc(fx + fw * (0.26 + k * 0.24), fy + fh * (k % 2 ? 0.72 : 0.55), 0.9, 0, Math.PI * 2)
          ctx.fill()
        }
        break
      }
      default: this.#stoneFace(fx, fy, fw, fh, tint)
    }
  }

  /** The plain beveled block — lit top/left, shadowed bottom/right. */
  #stoneFace(fx: number, fy: number, fw: number, fh: number, tint: string): void {
    const ctx = this.#ctx
    ctx.fillStyle = tint
    ctx.fillRect(fx, fy, fw, fh)
    ctx.fillStyle = this.#shade(tint, 0.3)
    ctx.fillRect(fx, fy, fw, 1.2)
    ctx.fillRect(fx, fy, 1.2, fh)
    ctx.fillStyle = this.#shade(tint, -0.32)
    ctx.fillRect(fx, fy + fh - 1.2, fw, 1.2)
    ctx.fillRect(fx + fw - 1.2, fy, 1.2, fh)
  }

  // ── Bub, the round dragon ────────────────────────────────

  #bub(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    // death tumble: Bub spins away with X-ed eyes — no other state applies
    if (e.dying > 0) { this.#bubTumble(e, time); return }
    const cx = p.x + p.w / 2
    const bob = e.walking ? Math.sin(time * 16) * 1.4 : 0
    // squash & stretch from vertical velocity (subtle, volume-preserving)
    const k = Math.max(-1, Math.min(1, -p.vy / 620))
    const sy = 1 + k * 0.12
    const sx = 1 / sy
    const flicker = e.invuln > 0 && Math.sin(time * 30) < 0
    if (flicker) return  // flicker while invulnerable

    const w = p.w, h = p.h
    const f = p.facing
    const footY = p.y + h + bob
    const bodyCy = p.y + h * 0.56 + bob
    const rx = w * 0.6, ry = h * 0.54
    const airborne = !e.onGround

    // ground shadow
    if (!airborne) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath()
      ctx.ellipse(cx, p.y + h + 3, w * 0.5, 4.5, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.save()
    ctx.translate(cx, footY)
    ctx.scale(sx, sy)
    ctx.translate(-cx, -footY)

    // little curled tail at the back — swishes while walking
    const swish = e.walking ? Math.sin(time * 13) * 0.12 : Math.sin(time * 2.2) * 0.05
    ctx.fillStyle = '#2a9d4a'
    ctx.beginPath()
    ctx.moveTo(cx - f * rx * 0.7, footY - h * 0.18)
    ctx.quadraticCurveTo(cx - f * rx * 1.15, footY - h * (0.16 + swish), cx - f * rx * 1.0, footY - h * (0.42 + swish))
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

    // feet — a real run cycle on the ground; tucked rising, dangling falling
    ctx.fillStyle = '#1f8f43'
    const step = time * 15
    for (const d of [-1, 1] as const) {
      let fx = cx + d * w * 0.24
      let fy = footY - 2.5
      if (airborne) {
        if (p.vy < 0) { fx = cx + d * w * 0.18; fy = footY - h * 0.14 }        // tuck on the way up
        else fy = footY - 1 + Math.sin(time * 9 + d) * 1.4                     // dangle on the way down
      } else if (e.walking) {
        const ph = Math.sin(step + (d > 0 ? 0 : Math.PI))
        fx += f * ph * w * 0.11
        fy -= Math.max(0, ph) * 3.6                                            // alternate lift
      }
      ctx.beginPath(); ctx.ellipse(fx, fy, w * 0.2, 5.5, 0, 0, Math.PI * 2); ctx.fill()
    }

    // body — a fat round dragon
    const bodyGrad = ctx.createRadialGradient(cx - f * w * 0.14, bodyCy - h * 0.16, w * 0.12, cx, bodyCy, rx)
    bodyGrad.addColorStop(0, '#74e88a')
    bodyGrad.addColorStop(0.6, '#43c95e')
    bodyGrad.addColorStop(1, '#239a48')
    ctx.fillStyle = bodyGrad
    ctx.beginPath(); ctx.ellipse(cx, bodyCy, rx, ry, 0, 0, Math.PI * 2); ctx.fill()

    // two tiny rounded ears atop the head
    ctx.fillStyle = '#37b455'
    for (const d of [-1, 1] as const) {
      ctx.beginPath()
      ctx.ellipse(cx + d * rx * 0.4 + f * w * 0.05, bodyCy - ry * 0.92, w * 0.1, h * 0.13, d * 0.45, 0, Math.PI * 2)
      ctx.fill()
    }

    // cream belly
    ctx.fillStyle = 'rgba(250,248,214,0.95)'
    ctx.beginPath(); ctx.ellipse(cx + f * w * 0.05, bodyCy + h * 0.12, rx * 0.6, ry * 0.62, 0, 0, Math.PI * 2); ctx.fill()

    // front paw — lifts to the mouth when blowing
    ctx.fillStyle = '#37b455'
    const armY = bodyCy + ry * (e.blowFlash > 0 ? -0.02 : 0.22)
    ctx.beginPath(); ctx.ellipse(cx + f * rx * 0.74, armY, w * 0.11, h * 0.09, f * 0.4, 0, Math.PI * 2); ctx.fill()

    // snout/muzzle bump on the facing side
    ctx.fillStyle = '#5fde78'
    ctx.beginPath(); ctx.ellipse(cx + f * rx * 0.62, bodyCy + ry * 0.18, w * 0.2, h * 0.16, 0, 0, Math.PI * 2); ctx.fill()

    // eyes — big, close together, near the top; periodic blink
    const eyeY = bodyCy - ry * 0.36
    const eo = w * 0.2
    const blink = (time % 3.4) < 0.11
    for (const d of [-1, 1]) {
      const ex = cx + d * eo + f * w * 0.07
      if (blink) {
        ctx.strokeStyle = '#15233a'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(ex - w * 0.11, eyeY); ctx.lineTo(ex + w * 0.11, eyeY); ctx.stroke()
        continue
      }
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

  /** The death tumble: Bub spins as he flies up and falls away, eyes X-ed. */
  #bubTumble(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2
    const w = p.w, h = p.h
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(time * 11)
    // body + belly
    const g = ctx.createRadialGradient(-w * 0.14, -h * 0.16, w * 0.12, 0, 0, w * 0.6)
    g.addColorStop(0, '#74e88a')
    g.addColorStop(0.6, '#43c95e')
    g.addColorStop(1, '#239a48')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.6, h * 0.54, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(250,248,214,0.95)'
    ctx.beginPath(); ctx.ellipse(0, h * 0.12, w * 0.36, h * 0.33, 0, 0, Math.PI * 2); ctx.fill()
    // X-ed eyes
    ctx.strokeStyle = '#15233a'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    for (const d of [-1, 1]) {
      const ex = d * w * 0.2, ey = -h * 0.18, s = w * 0.09
      ctx.beginPath(); ctx.moveTo(ex - s, ey - s); ctx.lineTo(ex + s, ey + s); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(ex + s, ey - s); ctx.lineTo(ex - s, ey + s); ctx.stroke()
    }
    // little round mouth of dismay
    ctx.strokeStyle = '#155e34'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, h * 0.16, w * 0.08, 0, Math.PI * 2); ctx.stroke()
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

    // spring squash & stretch from vertical velocity (hoppers + chase-jumps)
    const vy = en.vy ?? 0
    const stretch = Math.max(-0.16, Math.min(0.16, -vy / 2600))
    // waddle: a small side-to-side rock while roaming
    const waddle = en.captured ? 0 : Math.sin(en.bob * 2.4) * 0.07
    ctx.save()
    ctx.translate(cx, cy + r)
    ctx.rotate(waddle)
    ctx.scale(1 / (1 + stretch), 1 + stretch)
    ctx.translate(-cx, -(cy + r))

    // feet (ground species) — patter while walking
    ctx.fillStyle = this.#shade(base, -0.3)
    const patter = en.captured ? 0 : Math.sin(en.bob * 4) * 1.6
    ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy + r * 0.82 - Math.max(0, patter), r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + r * 0.42, cy + r * 0.82 - Math.max(0, -patter), r * 0.3, r * 0.18, 0, 0, Math.PI * 2); ctx.fill()

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

    ctx.restore()
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
    const sq = b.squash > 0 ? (b.squash / 0.2) * 0.22 : 0   // crown-bounce squash
    const rx = b.r * (1 + wob + sq)
    const ry = b.r * (1 - wob - sq)
    // a trapped foe struggles harder — and the film flashes red — as escape nears
    const warning = !!b.enemy && b.life < BUBBLE_WARN
    const warnK = warning ? Math.abs(Math.sin(b.age * 16)) : 0

    // trapped enemy sits inside, drawn first so the glass reads as "over" it
    if (b.enemy) {
      const wig = warning ? Math.sin(b.age * 26) * 2.4 : Math.sin(b.age * 7) * 0.9
      this.#enemy(b.x + wig, b.y, b.r * 1.15, b.enemy, time)
    }

    ctx.save()
    ctx.shadowColor = warning ? 'rgba(255,90,90,0.55)'
      : b.special === 'water' ? 'rgba(80,170,255,0.6)'
      : b.special === 'lightning' ? 'rgba(255,220,90,0.6)'
      : 'rgba(150,220,255,0.5)'
    ctx.shadowBlur = 14
    const fill = ctx.createRadialGradient(b.x - rx * 0.3, b.y - ry * 0.35, rx * 0.1, b.x, b.y, rx)
    if (b.enemy) {
      // the film picks up a wash of the trapped species' colour
      const tint = b.enemy.angry ? '#ff3b3b' : enemyKind(b.enemy.kind).tint
      fill.addColorStop(0, 'rgba(255,255,255,0.32)')
      fill.addColorStop(0.55, this.#hexA(tint, 0.12))
      fill.addColorStop(1, this.#hexA(tint, 0.07))
    } else if (b.special === 'lightning') {
      fill.addColorStop(0, 'rgba(255,255,255,0.45)')
      fill.addColorStop(0.55, 'rgba(255,225,120,0.22)')
      fill.addColorStop(1, 'rgba(255,200,60,0.14)')
    } else {
      fill.addColorStop(0, 'rgba(255,255,255,0.42)')
      fill.addColorStop(0.55, 'rgba(170,225,255,0.18)')
      fill.addColorStop(1, 'rgba(120,190,255,0.12)')
    }
    ctx.fillStyle = fill
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()

    // element cores: water sloshes; lightning carries a flickering bolt glyph
    if (b.special === 'water') {
      ctx.beginPath(); ctx.ellipse(b.x, b.y, rx - 1.5, ry - 1.5, 0, 0, Math.PI * 2); ctx.clip()
      const lvl = b.y + ry * 0.1
      const wave = Math.sin(b.age * 3.1) * 2.2
      ctx.fillStyle = 'rgba(70,150,240,0.5)'
      ctx.beginPath()
      ctx.moveTo(b.x - rx, lvl + wave)
      ctx.quadraticCurveTo(b.x, lvl - wave * 2, b.x + rx, lvl + wave)
      ctx.lineTo(b.x + rx, b.y + ry)
      ctx.lineTo(b.x - rx, b.y + ry)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(180,225,255,0.5)'
      ctx.beginPath()
      ctx.ellipse(b.x, lvl + wave * 0.4, rx * 0.8, 1.6, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (b.special === 'lightning') {
      const s = b.r * 0.52
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(b.age * 18)
      ctx.fillStyle = '#ffe27a'
      ctx.beginPath()
      ctx.moveTo(b.x + s * 0.25, b.y - s)
      ctx.lineTo(b.x - s * 0.45, b.y + s * 0.15)
      ctx.lineTo(b.x - s * 0.05, b.y + s * 0.15)
      ctx.lineTo(b.x - s * 0.25, b.y + s)
      ctx.lineTo(b.x + s * 0.45, b.y - s * 0.15)
      ctx.lineTo(b.x + s * 0.05, b.y - s * 0.15)
      ctx.closePath(); ctx.fill()
    }
    ctx.restore()

    // soap-film rim — iridescent hue drift; elementals wear their element's
    // colour; a trap about to burst strobes red
    const hue = (b.age * 80 + b.x * 0.4) % 360
    ctx.lineWidth = 3
    ctx.strokeStyle = warning
      ? `rgba(255,${Math.round(150 - warnK * 90)},${Math.round(150 - warnK * 110)},${0.55 + warnK * 0.35})`
      : b.special === 'water' ? 'rgba(110,190,255,0.85)'
      : b.special === 'lightning' ? 'rgba(255,222,110,0.9)'
      : `hsla(${hue},90%,78%,0.75)`
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    // a second, counter-drifting film arc — the two-tone soap shimmer
    ctx.lineWidth = 1.6
    ctx.strokeStyle = `hsla(${(hue + 140) % 360},85%,80%,0.35)`
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx - 0.8, ry - 0.8, 0, b.age * 1.7, b.age * 1.7 + Math.PI * 0.9); ctx.stroke()
    ctx.lineWidth = 1.2
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.ellipse(b.x, b.y, rx - 1.5, ry - 1.5, 0, 0, Math.PI * 2); ctx.stroke()

    // specular highlights
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.ellipse(b.x - rx * 0.34, b.y - ry * 0.38, rx * 0.16, ry * 0.1, -0.6, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(b.x, b.y, rx * 0.74, Math.PI * 1.05, Math.PI * 1.35); ctx.stroke()
  }

  // ── water droplets + shots (bolts, boulders) ─────────────

  /** A water droplet: a falling bead, flattening into a streak as it flows. */
  #droplet(d: Droplet): void {
    const ctx = this.#ctx
    const a = Math.min(1, d.life / 1.2)
    const cx = d.x + d.w / 2, cy = d.y + d.h / 2
    ctx.save()
    ctx.globalAlpha = a
    ctx.fillStyle = '#6fc0ff'
    ctx.shadowColor = 'rgba(90,170,255,0.7)'
    ctx.shadowBlur = 6
    ctx.beginPath()
    if (d.flowing) ctx.ellipse(cx, cy + 1, 5.5, 2.4, 0, 0, Math.PI * 2)
    else ctx.ellipse(cx, cy, 2.6, 3.4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(235,248,255,0.85)'
    ctx.beginPath(); ctx.arc(cx - 1, cy - 1.2, 0.9, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /** Bolts crackle; boulders tumble. */
  #shot(s: Shot, time: number): void {
    const ctx = this.#ctx
    if (s.kind === 'bolt') {
      const dir = Math.sign(s.vx) || 1
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = '#ffe27a'
      ctx.shadowColor = 'rgba(255,220,90,0.8)'
      ctx.shadowBlur = 10
      ctx.lineWidth = 2.6
      ctx.lineJoin = 'round'
      // a jagged trailing streak behind the head, re-jittered every frame
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      for (let i = 1; i <= 4; i++) {
        ctx.lineTo(s.x - dir * i * 9, s.y + Math.sin(s.age * 40 + i * 2.1) * 5)
      }
      ctx.stroke()
      ctx.fillStyle = '#fff7d0'
      ctx.beginPath(); ctx.arc(s.x, s.y, 3.6, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    } else {
      // boulder — a tumbling faceted rock
      const r = 8
      ctx.save()
      ctx.translate(s.x, s.y)
      ctx.rotate(s.x * 0.04)
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r)
      g.addColorStop(0, '#b49a80')
      g.addColorStop(0.7, '#8a705a')
      g.addColorStop(1, '#5e4a3a')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(r, 0)
      for (let i = 1; i < 7; i++) {
        const a = (Math.PI * 2 * i) / 7
        const rr = r * (0.82 + 0.18 * ((i * 5) % 3) / 2)
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = 'rgba(40,26,18,0.6)'
      ctx.lineWidth = 1.2
      ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.2); ctx.lineTo(r * 0.1, r * 0.3); ctx.stroke()
      ctx.restore()
    }
  }

  // ── food (distinct vector snacks per tier) ───────────────

  #fruit(f: Fruit, time: number, urgent: boolean): void {
    const ctx = this.#ctx
    const cx = f.x + f.w / 2
    const cy = f.y + f.h / 2 + (f.rest ? Math.sin(time * 4 + cx) * 1.2 : 0)
    const r = f.w * 0.5
    ctx.save()
    if (urgent || f.life < 1.2) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 18))
    switch (f.kind) {
      case 0: this.#cherries(cx, cy, r); break
      case 1: this.#banana(cx, cy, r); break
      case 2: this.#melon(cx, cy, r); break
      default: this.#gem(cx, cy, r)
    }
    ctx.restore()
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

  /** Tier 0 — a pair of glossy cherries on a shared stem. */
  #cherries(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    ctx.strokeStyle = '#3a7d2c'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(cx - r * 0.35, cy + r * 0.15); ctx.quadraticCurveTo(cx - r * 0.1, cy - r * 0.7, cx + r * 0.1, cy - r * 0.95); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx + r * 0.45, cy - r * 0.05); ctx.quadraticCurveTo(cx + r * 0.3, cy - r * 0.6, cx + r * 0.1, cy - r * 0.95); ctx.stroke()
    ctx.fillStyle = '#54b23f'
    ctx.beginPath(); ctx.ellipse(cx + r * 0.32, cy - r * 0.92, r * 0.3, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill()
    for (const [bx, by, br] of [[cx - r * 0.35, cy + r * 0.35, r * 0.5], [cx + r * 0.45, cy + r * 0.2, r * 0.42]] as const) {
      ctx.save()
      ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 8
      const g = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br)
      g.addColorStop(0, '#ff8ba3'); g.addColorStop(1, '#d92548')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.beginPath(); ctx.ellipse(bx - br * 0.3, by - br * 0.35, br * 0.2, br * 0.12, -0.6, 0, Math.PI * 2); ctx.fill()
    }
  }

  /** Tier 1 — a fat banana crescent. */
  #banana(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.5)
    ctx.shadowColor = '#ffd76a'; ctx.shadowBlur = 8
    ctx.fillStyle = '#ffd23f'
    ctx.beginPath()
    ctx.arc(0, -r * 0.25, r * 0.95, 0.15 * Math.PI, 0.85 * Math.PI)
    ctx.arc(0, -r * 0.55, r * 0.62, 0.82 * Math.PI, 0.18 * Math.PI, true)
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#8a5a1d'
    ctx.beginPath(); ctx.arc(-r * 0.88, r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(r * 0.88, r * 0.1, r * 0.12, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.6
    ctx.beginPath(); ctx.arc(0, -r * 0.28, r * 0.75, 0.3 * Math.PI, 0.7 * Math.PI); ctx.stroke()
    ctx.restore()
  }

  /** Tier 2 — a watermelon wedge, rind out. */
  #melon(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.translate(cx, cy + r * 0.15)
    ctx.shadowColor = '#ff4d6d'; ctx.shadowBlur = 8
    // flesh wedge
    ctx.fillStyle = '#ff5470'
    ctx.beginPath(); ctx.moveTo(0, r * 0.55)
    ctx.arc(0, r * 0.55, r * 1.05, Math.PI * 1.15, Math.PI * 1.85)
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    // rind
    ctx.strokeStyle = '#2fa05f'; ctx.lineWidth = r * 0.22
    ctx.beginPath(); ctx.arc(0, r * 0.55, r * 1.05, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke()
    ctx.strokeStyle = '#d8f7c9'; ctx.lineWidth = r * 0.08
    ctx.beginPath(); ctx.arc(0, r * 0.55, r * 0.93, Math.PI * 1.17, Math.PI * 1.83); ctx.stroke()
    // seeds
    ctx.fillStyle = '#24122a'
    for (const [sx, sy] of [[-r * 0.3, -r * 0.05], [r * 0.25, -r * 0.12], [0, r * 0.18]] as const) {
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.07, r * 0.11, 0.3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  /** Tier 3 — the big-score faceted gem. */
  #gem(cx: number, cy: number, r: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = '#a06bff'; ctx.shadowBlur = 12
    ctx.fillStyle = '#a06bff'
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r * 0.85, cy - r * 0.25)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r * 0.85, cy - r * 0.25)
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    // facets
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.85, cy - r * 0.25); ctx.lineTo(cx, cy - r * 0.25); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(20,8,40,0.28)'
    ctx.beginPath(); ctx.moveTo(cx, cy + r); ctx.lineTo(cx - r * 0.85, cy - r * 0.25); ctx.lineTo(cx, cy - r * 0.25); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.85, cy - r * 0.25); ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r * 0.85, cy - r * 0.25); ctx.closePath(); ctx.stroke()
    ctx.restore()
  }

  // ── treasure + warp items ────────────────────────────────

  /** A diamond: a bright cut stone that turns slowly on the spot, with a
   *  travelling glint. Static treasure, so it reads as placed, not dropped. */
  #diamond(d: Diamond, time: number): void {
    const ctx = this.#ctx
    const cx = d.x + d.w / 2
    const cy = d.y + d.h / 2 + Math.sin(time * 2.4 + d.bob) * 1.4
    const r = d.w * 0.5
    // a slow turn — the stone narrows and widens as it rotates
    const turn = 0.45 + 0.55 * Math.abs(Math.cos(time * 1.6 + d.bob))
    ctx.save()
    ctx.shadowColor = 'rgba(120,225,255,0.75)'
    ctx.shadowBlur = 12
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
    g.addColorStop(0, '#eafcff')
    g.addColorStop(0.5, '#7fdcff')
    g.addColorStop(1, '#2f9fd6')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r * 0.86 * turn, cy - r * 0.18)
    ctx.lineTo(cx, cy + r)
    ctx.lineTo(cx - r * 0.86 * turn, cy - r * 0.18)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    // table facet + girdle
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r * 0.86 * turn, cy - r * 0.18)
    ctx.lineTo(cx, cy - r * 0.18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(20,60,90,0.25)'
    ctx.beginPath()
    ctx.moveTo(cx, cy + r)
    ctx.lineTo(cx - r * 0.86 * turn, cy - r * 0.18)
    ctx.lineTo(cx, cy - r * 0.18)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.86 * turn, cy - r * 0.18)
    ctx.lineTo(cx + r * 0.86 * turn, cy - r * 0.18)
    ctx.stroke()
    // a glint that sweeps across every couple of seconds
    const glint = (time * 0.7 + d.bob) % 3
    if (glint < 0.35) {
      ctx.globalAlpha = 1 - glint / 0.35
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(cx - r * 0.2, cy - r * 0.42, 1.4, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  /** An umbrella: a scalloped canopy over a crooked handle, in its warp colour.
   *  It bobs where it lands — the prize that ends the round. */
  #umbrella(u: Umbrella, time: number): void {
    const ctx = this.#ctx
    const cx = u.x + u.w / 2
    const cy = u.y + u.h / 2 + (u.rest ? Math.sin(time * 3.4 + u.bob) * 1.6 : 0)
    const r = u.w * 0.46
    const col = UMBRELLA_META[u.kind].color
    ctx.save()
    if (u.life < 1.2) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(time * 18))
    // handle — a shaft with a hooked end
    ctx.strokeStyle = '#e6e2d0'
    ctx.lineWidth = 1.8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.2)
    ctx.lineTo(cx, cy + r * 0.75)
    ctx.arc(cx - r * 0.18, cy + r * 0.75, r * 0.18, 0, Math.PI, false)
    ctx.stroke()
    // canopy — a dome with a scalloped hem. Keep the glow tight: at ~21px the
    // canopy is small enough that a wide bloom swallows its silhouette.
    ctx.shadowColor = col
    ctx.shadowBlur = 5
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy)
    g.addColorStop(0, this.#shade(col, 0.4))
    g.addColorStop(1, this.#shade(col, -0.22))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy - r * 0.2, r, Math.PI, 0)
    // three scallops back across the hem
    for (let k = 0; k < 3; k++) {
      const x0 = cx + r - (k * 2 * r) / 3
      const x1 = cx + r - ((k + 1) * 2 * r) / 3
      ctx.quadraticCurveTo((x0 + x1) / 2, cy + r * 0.22, x1, cy - r * 0.2)
    }
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    // rib seams + the little finial on top
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 1
    for (const dx of [-0.5, 0, 0.5]) {
      ctx.beginPath()
      ctx.moveTo(cx, cy - r * 1.2)
      ctx.quadraticCurveTo(cx + r * dx, cy - r * 0.7, cx + r * dx * 1.34, cy - r * 0.2)
      ctx.stroke()
    }
    ctx.fillStyle = '#ffe27a'
    ctx.beginPath(); ctx.arc(cx, cy - r * 1.24, 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
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

  // ── particles (additive sparkle burst) + pop rings ───────

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

  /** The expanding burst outline every popped bubble leaves behind. */
  #ring(r: Ring): void {
    const ctx = this.#ctx
    const a = Math.max(0, r.life / 0.32)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `hsla(${r.hue},90%,72%,${a * 0.9})`
    ctx.lineWidth = 0.5 + 2.5 * a
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  // ── HUD ──────────────────────────────────────────────────

  #hud(e: Engine, hi: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(8,6,24,0.4)'
    ctx.fillRect(0, 0, e.width, 26)
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'middle'

    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffd76a'
    ctx.fillText(`🫧 ${e.level.name}`, 10, 14)

    ctx.textAlign = 'center'
    if (e.level.bonus) {
      // the diamond room reports treasure + clock instead of foes; the last
      // few seconds burn red
      const urgent = e.bonusTimer < 4
      ctx.fillStyle = urgent ? '#ff8a8a' : '#bfe3ff'
      ctx.fillText(`◆ ${e.diamonds.length} left  ·  ${e.bonusTimer.toFixed(1)}s`, e.width / 2, 14)
    } else {
      const remaining = e.enemies.filter(en => en.alive).length
      ctx.fillStyle = '#bfe3ff'
      ctx.fillText(remaining > 0 ? `${remaining} foe${remaining === 1 ? '' : 's'} left` : 'clear!', e.width / 2, 14)
    }

    // running score, with the high score beside it (live-topping, arcade style)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(191,227,255,0.75)'
    ctx.fillText(`HI ${Math.max(hi, e.score)}`, e.width - 10, 14)
    ctx.fillStyle = '#fff'
    ctx.fillText(`✦ ${e.score}`, e.width - 108, 14)

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
