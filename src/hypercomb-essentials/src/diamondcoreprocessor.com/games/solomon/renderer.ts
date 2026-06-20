// diamondcoreprocessor.com/games/solomon/renderer.ts
//
// Canvas2D renderer for the Solomon's Key engine — repainted to read like the
// NES original. Everything is drawn procedurally (no image assets) so the module
// stays self-contained and signature-clean; the canvas runs with smoothing OFF
// and integer scaling, so the chunky shapes land on a crisp pixel grid. The
// renderer is stateless beyond its ctx + a couple of baked block textures; it
// reads the engine's public state each frame. The same painters draw the
// designer's edit view so play + edit look identical.
//
// NES palette cues: near-black rooms framed by bluish-grey permanent stone,
// glowing ORANGE breakable blocks, a small blue-robed Dana, green goblins, stone
// gargoils, pale ghosts, red demonheads, and a status bar with the draining
// life/time meter and the fireball scroll.

import { Engine, TILE, WALL, BRICK, CRACKED, type LevelDef, type Fireball, type Shot } from './engine.js'

const HUD_H = 24

// NES-ish accent palette.
const C = {
  orange: '#e8902c', orangeLite: '#ffc56b', orangeDark: '#8a4a12',
  stone: '#5b5f86', stoneLite: '#9aa0c8', stoneDark: '#2e3150',
  gold: '#ffd24d', danaRobe: '#3a6ee0', danaRobeDark: '#2247a8',
  face: '#f4c9a0', hat: '#7b46d6', hatDark: '#4f2a96',
  goblin: '#56b365', goblinDark: '#2f7d3e',
  ghost: '#cfe0ff', demon: '#e2433f',
}

export class Renderer {
  #ctx: CanvasRenderingContext2D
  // Baked block faces — procedural textures are expensive per-pixel, so each
  // block type is painted ONCE into an offscreen canvas and blitted every frame.
  #brickTex: HTMLCanvasElement | null = null
  #crackTex: HTMLCanvasElement | null = null
  #wallTex: HTMLCanvasElement | null = null

  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  // ── play view ────────────────────────────────────────────

  draw(e: Engine, time: number): void {
    const ctx = this.#ctx
    this.#background(e.width, e.height, time)
    this.#tiles(e.grid, e.cols, e.rows)
    for (const m of e.mirrors) this.#mirror(m.col, m.row, time)
    this.#door(e.level.door.col, e.level.door.row, e.doorOpen, time)
    for (const it of e.items) {
      if (it.taken || it.hidden) continue
      this.#item(it.kind, it.col, it.row, time, it.reveal)
    }
    for (const f of e.fairies) if (!f.taken) this.#fairy(f.x, f.y, time)
    for (const en of e.enemies) this.#enemy(en, time)
    this.#dana(e, time)
    for (const f of e.fireballs) this.#fireball(f)
    for (const s of e.shots) this.#shot(s)
    this.#wandTarget(e)
    this.#hud(e, time)
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
    for (const m of level.mirrors) this.#mirror(m.col, m.row, time)
    this.#door(level.door.col, level.door.row, false, time)
    for (const it of level.items) this.#item(it.kind, it.col, it.row, time, it.hidden ? 0 : 1, it.hidden)
    for (const en of level.enemies) this.#enemyMarker(en.kind ?? 'goblin', en.col, en.row, en.dir ?? 1, time)
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

  // ── room ─────────────────────────────────────────────────

  #background(w: number, h: number, time: number): void {
    const ctx = this.#ctx
    // Near-black NES room; the permanent stone border supplies the "frame".
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0a0a1c'); g.addColorStop(1, '#05050f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(150,150,210,0.16)'
    for (let i = 0; i < 30; i++) {
      const x = (i * 97.13) % w
      const y = (i * 53.7 + time * 5) % h
      ctx.fillRect(x | 0, y | 0, 2, 2)
    }
  }

  #tiles(grid: ArrayLike<number>, cols: number, rows: number): void {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r * cols + c]
        if (t === WALL) this.#wall(c, r)
        else if (t === BRICK) this.#brick(c, r, this.#brickTexture())
        else if (t === CRACKED) this.#brick(c, r, this.#crackTexture())
      }
    }
  }

  #wall(c: number, r: number): void {
    if (!this.#wallTex) this.#wallTex = this.#buildWall()
    this.#ctx.drawImage(this.#wallTex, c * TILE, r * TILE)
  }

  #brick(c: number, r: number, tex: HTMLCanvasElement): void { this.#ctx.drawImage(tex, c * TILE, r * TILE) }
  #brickTexture(): HTMLCanvasElement { return (this.#brickTex ??= this.#buildBrick(false)) }
  #crackTexture(): HTMLCanvasElement { return (this.#crackTex ??= this.#buildBrick(true)) }

  // Orange NES breakable block: chunky brick courses, lit top-left bevel, dark
  // mortar + extruded cube edges. `cracked` adds fracture lines (one head-hit).
  #buildBrick(cracked: boolean): HTMLCanvasElement {
    const s = TILE
    const cv = document.createElement('canvas'); cv.width = s; cv.height = s
    const x = cv.getContext('2d')!
    x.fillStyle = C.orangeDark; x.fillRect(0, 0, s, s) // mortar backing
    const rowH = 8, bw = 16, m = 1
    let course = 0
    for (let by = 0; by < s; by += rowH, course++) {
      const off = (course % 2) * (bw / 2)
      for (let bx = -bw; bx < s; bx += bw) {
        const rx = Math.round(bx + off) + m, ry = by + m
        const rw = bw - m * 2, rh = rowH - m * 2
        x.fillStyle = C.orange; x.fillRect(rx, ry, rw, rh)
        x.fillStyle = C.orangeLite; x.fillRect(rx, ry, rw, 1); x.fillRect(rx, ry, 1, rh) // bevel
        x.fillStyle = 'rgba(80,38,4,0.6)'; x.fillRect(rx, ry + rh - 1, rw, 1); x.fillRect(rx + rw - 1, ry, 1, rh)
      }
    }
    x.fillStyle = 'rgba(255,220,150,0.22)'; x.fillRect(0, 0, s, 2); x.fillRect(0, 0, 2, s) // cube edge
    x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, s - 2, s, 2); x.fillRect(s - 2, 0, 2, s)
    if (cracked) {
      x.strokeStyle = 'rgba(20,8,0,0.85)'; x.lineWidth = 2
      x.beginPath(); x.moveTo(s * 0.5, 2); x.lineTo(s * 0.42, s * 0.4); x.lineTo(s * 0.6, s * 0.6); x.lineTo(s * 0.5, s - 2); x.stroke()
      x.beginPath(); x.moveTo(s * 0.42, s * 0.4); x.lineTo(s * 0.18, s * 0.5); x.stroke()
      x.beginPath(); x.moveTo(s * 0.6, s * 0.6); x.lineTo(s * 0.84, s * 0.52); x.stroke()
    }
    return cv
  }

  // Grey permanent stone block: cool cobble grain, beveled cube edges. Static and
  // earthy so the glowing orange bricks pop against it.
  #buildWall(): HTMLCanvasElement {
    const s = TILE
    const cv = document.createElement('canvas'); cv.width = s; cv.height = s
    const x = cv.getContext('2d')!
    const rnd = this.#noise(0x2a17)
    const g = x.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, C.stone); g.addColorStop(1, C.stoneDark)
    x.fillStyle = g; x.fillRect(0, 0, s, s)
    for (let yy = 0; yy < s; yy += 2) {
      for (let xx = 0; xx < s; xx += 2) {
        const d = rnd() - 0.5
        x.fillStyle = d > 0 ? `rgba(190,200,255,${d * 0.45})` : `rgba(0,0,0,${-d * 0.5})`
        x.fillRect(xx, yy, 2, 2)
      }
    }
    x.fillStyle = C.stoneLite; x.globalAlpha = 0.5; x.fillRect(0, 0, s, 2); x.fillRect(0, 0, 2, s); x.globalAlpha = 1
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, s - 3, s, 3); x.fillRect(s - 2, 0, 2, s)
    return cv
  }

  // Deterministic 0..1 noise (mulberry32) so baked textures are stable per build.
  #noise(seed: number): () => number {
    let t = seed >>> 0
    return () => {
      t = (t + 0x6d2b79f5) >>> 0
      let x = t
      x = Math.imul(x ^ (x >>> 15), x | 1)
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  // ── Dana ─────────────────────────────────────────────────

  #dana(e: Engine, time: number): void {
    const ctx = this.#ctx
    const p = e.player
    const bob = e.walking && e.onGround ? Math.sin(time * 14) * 1 : 0
    const cx = Math.round(p.x + p.w / 2)
    const top = Math.round(p.y + bob)
    const w = p.w, h = p.h
    const f = e.facing
    ctx.save()
    // robe (a tapered body)
    ctx.fillStyle = C.danaRobe
    ctx.beginPath()
    ctx.moveTo(cx, top + h * 0.34)
    ctx.lineTo(p.x + w * 0.04, p.y + h)
    ctx.lineTo(p.x + w * 0.96, p.y + h)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = C.danaRobeDark
    ctx.fillRect(Math.round(p.x + w * 0.04), Math.round(p.y + h - 3), Math.round(w * 0.92), 3)
    // little stepping feet while walking
    if (e.walking && e.onGround) {
      const swing = Math.sin(time * 14) * 2
      ctx.fillStyle = C.face
      ctx.fillRect(Math.round(cx - 5 + swing), Math.round(p.y + h - 3), 3, 3)
      ctx.fillRect(Math.round(cx + 2 - swing), Math.round(p.y + h - 3), 3, 3)
    }
    // face
    ctx.fillStyle = C.face
    ctx.beginPath(); ctx.arc(cx, top + h * 0.28, w * 0.3, 0, Math.PI * 2); ctx.fill()
    // pointed wizard hat
    ctx.fillStyle = C.hat
    ctx.beginPath()
    ctx.moveTo(cx + f * w * 0.16, top - h * 0.06)
    ctx.lineTo(cx - w * 0.4, top + h * 0.16)
    ctx.lineTo(cx + w * 0.4, top + h * 0.16)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = C.hatDark
    ctx.fillRect(Math.round(cx - w * 0.4), Math.round(top + h * 0.13), Math.round(w * 0.8), 2) // brim
    ctx.fillStyle = C.gold // hat tip star
    ctx.beginPath(); ctx.arc(cx + f * w * 0.16, top - h * 0.06, 1.6, 0, Math.PI * 2); ctx.fill()
    // eye
    ctx.fillStyle = '#15152a'
    ctx.fillRect(Math.round(cx + f * w * 0.06), Math.round(top + h * 0.26), 2, 2)
    // wand spark when casting / firing
    if (e.conjureFlash > 0) {
      const wx = cx + f * w * 0.62, wy = top + h * 0.42
      ctx.fillStyle = `rgba(255,240,150,${e.conjureFlash / 0.18})`
      ctx.beginPath(); ctx.arc(wx, wy, 3 + (0.18 - e.conjureFlash) * 28, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  // ── enemies ──────────────────────────────────────────────

  #enemy(en: { kind: string; x: number; y: number; w: number; h: number; alive: boolean; squash: number; dir: number; anim: number }, time: number): void {
    let { x, y, w, h } = en
    if (!en.alive) {
      if (en.squash <= 0) return
      const k = en.squash / 0.4
      const nh = h * Math.max(0.15, k)
      y += h - nh; h = nh
    }
    switch (en.kind) {
      case 'ghost': this.#ghost(x, y, w, h, en.dir, time); break
      case 'demonhead': this.#demonhead(x, y, w, h, time); break
      case 'gargoil': this.#gargoil(x, y, w, h, en.dir, en.alive); break
      case 'dragon': this.#dragon(x, y, w, h, en.dir, en.alive); break
      case 'panel': this.#panel(x, y, w, h, en.dir); break
      default: this.#goblin(x, y, w, h, en.dir, en.alive, en.anim); break
    }
  }

  #goblin(x: number, y: number, w: number, h: number, dir: number, alive: boolean, anim: number): void {
    const ctx = this.#ctx
    const step = alive ? Math.sin(anim * 0.4) * 1.5 : 0
    ctx.fillStyle = alive ? C.goblin : C.goblinDark
    this.#path(() => this.#roundRect(x, y + 2, w, h - 2, 5)); ctx.fill()
    // pointed ears
    ctx.fillStyle = C.goblinDark
    ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + 4); ctx.lineTo(x - 1, y - 3); ctx.lineTo(x + w * 0.3, y + 3); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x + w * 0.88, y + 4); ctx.lineTo(x + w + 1, y - 3); ctx.lineTo(x + w * 0.7, y + 3); ctx.fill()
    if (alive) {
      // glaring eyes look toward travel
      const ex = dir > 0 ? 0.6 : 0.4
      ctx.fillStyle = '#fff'
      ctx.fillRect(Math.round(x + w * 0.3), Math.round(y + h * 0.36), 4, 4)
      ctx.fillRect(Math.round(x + w * 0.58), Math.round(y + h * 0.36), 4, 4)
      ctx.fillStyle = '#a01010'
      ctx.fillRect(Math.round(x + w * (ex - 0.12)), Math.round(y + h * 0.38), 2, 2)
      ctx.fillRect(Math.round(x + w * (ex + 0.16)), Math.round(y + h * 0.38), 2, 2)
      // grimace
      ctx.fillStyle = '#1a0808'; ctx.fillRect(Math.round(x + w * 0.3), Math.round(y + h * 0.66 + step), Math.round(w * 0.4), 2)
    }
  }

  #gargoil(x: number, y: number, w: number, h: number, dir: number, alive: boolean): void {
    const ctx = this.#ctx
    ctx.fillStyle = alive ? '#8b8fae' : '#55586f'
    // folded stone wings behind the body
    ctx.beginPath()
    ctx.moveTo(x + w * 0.5, y + h * 0.3)
    ctx.lineTo(x - w * 0.12, y + h * 0.1); ctx.lineTo(x + w * 0.2, y + h * 0.7)
    ctx.lineTo(x + w * 0.8, y + h * 0.7); ctx.lineTo(x + w * 1.12, y + h * 0.1)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = alive ? '#a6abd0' : '#666a85'
    this.#path(() => this.#roundRect(x + w * 0.18, y + 2, w * 0.64, h - 2, 4)); ctx.fill()
    if (alive) {
      // horns + burning eyes (it spits fire)
      ctx.fillStyle = '#6c7090'
      ctx.beginPath(); ctx.moveTo(x + w * 0.34, y + 3); ctx.lineTo(x + w * 0.26, y - 4); ctx.lineTo(x + w * 0.44, y + 2); ctx.fill()
      ctx.beginPath(); ctx.moveTo(x + w * 0.66, y + 3); ctx.lineTo(x + w * 0.74, y - 4); ctx.lineTo(x + w * 0.56, y + 2); ctx.fill()
      ctx.fillStyle = '#ffcb4a'
      const ex = dir > 0 ? 0.58 : 0.42
      ctx.fillRect(Math.round(x + w * (ex - 0.12)), Math.round(y + h * 0.4), 3, 3)
      ctx.fillRect(Math.round(x + w * (ex + 0.04)), Math.round(y + h * 0.4), 3, 3)
    }
  }

  #dragon(x: number, y: number, w: number, h: number, dir: number, alive: boolean): void {
    const ctx = this.#ctx
    ctx.fillStyle = alive ? '#d56fb0' : '#7c4067'
    this.#path(() => this.#roundRect(x, y + h * 0.3, w, h * 0.7, 5)); ctx.fill()
    // head lunging in the facing direction
    const hx = dir > 0 ? x + w * 0.82 : x + w * 0.18
    ctx.beginPath(); ctx.arc(hx, y + h * 0.34, w * 0.22, 0, Math.PI * 2); ctx.fill()
    // back spines
    ctx.fillStyle = alive ? '#f3a6d4' : '#955a82'
    for (let i = 0; i < 3; i++) {
      const sx = x + w * (0.3 + i * 0.2)
      ctx.beginPath(); ctx.moveTo(sx, y + h * 0.3); ctx.lineTo(sx - 3, y + h * 0.1); ctx.lineTo(sx + 3, y + h * 0.3); ctx.fill()
    }
    if (alive) { ctx.fillStyle = '#2a0a1c'; ctx.fillRect(Math.round(dir > 0 ? hx : hx - 2), Math.round(y + h * 0.3), 2, 2) }
  }

  #ghost(x: number, y: number, w: number, h: number, _dir: number, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = C.ghost
    ctx.shadowColor = 'rgba(180,210,255,0.7)'; ctx.shadowBlur = 8
    // rounded dome + a wavy hem
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h * 0.45, w * 0.45, Math.PI, 0)
    const hem = y + h * 0.9
    for (let i = 0; i <= 4; i++) {
      const px = x + w * (i / 4)
      const py = hem + (i % 2 === 0 ? Math.sin(time * 6) * 2 : 4)
      ctx.lineTo(px, py)
    }
    ctx.lineTo(x + w * 0.05, y + h * 0.45)
    ctx.closePath(); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#33407a'
    ctx.fillRect(Math.round(x + w * 0.3), Math.round(y + h * 0.36), 3, 4)
    ctx.fillRect(Math.round(x + w * 0.58), Math.round(y + h * 0.36), 3, 4)
    ctx.restore()
  }

  #demonhead(x: number, y: number, w: number, h: number, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = 'rgba(255,60,40,0.6)'; ctx.shadowBlur = 6
    ctx.fillStyle = C.demon
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.5, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    // horns
    ctx.fillStyle = '#9a1f1c'
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * 0.1); ctx.lineTo(x, y - 3); ctx.lineTo(x + w * 0.4, y + h * 0.16); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x + w * 0.8, y + h * 0.1); ctx.lineTo(x + w, y - 3); ctx.lineTo(x + w * 0.6, y + h * 0.16); ctx.fill()
    // angry eyes + fanged grin
    const blink = (Math.sin(time * 8) + 1) * 0.5
    ctx.fillStyle = '#ffe14d'
    ctx.fillRect(Math.round(x + w * 0.26), Math.round(y + h * 0.4), 4, 3)
    ctx.fillRect(Math.round(x + w * 0.58), Math.round(y + h * 0.4), 4, 3)
    ctx.fillStyle = '#3a0808'
    ctx.fillRect(Math.round(x + w * 0.28), Math.round(y + h * 0.64), Math.round(w * 0.44), 2)
    ctx.fillStyle = '#fff'
    if (blink > 0.5) { ctx.fillRect(Math.round(x + w * 0.34), Math.round(y + h * 0.64), 2, 3); ctx.fillRect(Math.round(x + w * 0.6), Math.round(y + h * 0.64), 2, 3) }
    ctx.restore()
  }

  #panel(x: number, y: number, w: number, h: number, dir: number): void {
    const ctx = this.#ctx
    // a petrified stone face embedded in the wall
    ctx.fillStyle = '#3c3f5e'
    this.#path(() => this.#roundRect(x, y, w, h, 4)); ctx.fill()
    ctx.fillStyle = '#1c1d30'
    ctx.fillRect(Math.round(x + w * 0.2), Math.round(y + h * 0.3), Math.round(w * 0.18), Math.round(h * 0.18))
    ctx.fillRect(Math.round(x + w * 0.62), Math.round(y + h * 0.3), Math.round(w * 0.18), Math.round(h * 0.18))
    ctx.fillStyle = '#ff7a2a' // glowing maw it spits fire from
    ctx.fillRect(Math.round(dir > 0 ? x + w * 0.55 : x + w * 0.2), Math.round(y + h * 0.62), Math.round(w * 0.25), Math.round(h * 0.16))
  }

  #enemyMarker(kind: string, col: number, row: number, dir: number, time: number): void {
    const d: Record<string, { w: number; h: number }> = {
      goblin: { w: 0.72, h: 0.84 }, gargoil: { w: 0.78, h: 0.82 }, dragon: { w: 0.86, h: 0.78 },
      ghost: { w: 0.74, h: 0.74 }, demonhead: { w: 0.6, h: 0.6 }, panel: { w: 0.9, h: 0.9 },
    }
    const m = d[kind] ?? d['goblin']
    const w = TILE * m.w, h = TILE * m.h
    this.#enemy({ kind, x: col * TILE + (TILE - w) / 2, y: row * TILE + (TILE - h), w, h, alive: true, squash: 0, dir, anim: time * 60 } as never, time)
  }

  // ── items ────────────────────────────────────────────────

  #item(kind: string, col: number, row: number, time: number, reveal = 1, hiddenGhost = false): void {
    const ctx = this.#ctx
    const cx = col * TILE + TILE / 2
    const cy = row * TILE + TILE / 2 + Math.sin(time * 3 + col) * 1.5
    ctx.save()
    if (hiddenGhost) ctx.globalAlpha = 0.35 // designer view: hidden items show faint
    if (reveal < 0.4) { // a fresh reveal pops with a quick flash
      ctx.shadowColor = 'rgba(255,255,200,0.9)'; ctx.shadowBlur = 14 * (1 - reveal / 0.4)
    }
    switch (kind) {
      case 'key': this.#key(cx, cy); break
      case 'bell': this.#bell(cx, cy); break
      case 'jewel': this.#jewel(cx, cy, '#5fd6ff'); break
      case 'jar': this.#jar(cx, cy, '#3a86ff', '#bfe0ff'); break
      case 'superjar': this.#jar(cx, cy, '#ff7a2a', '#ffd08a'); break
      case 'hourglass': this.#hourglass(cx, cy, '#5fd6ff'); break
      case 'hourglassHalf': this.#hourglass(cx, cy, '#ffb24d'); break
      case 'fairy': this.#fairy(cx, cy, time); break
      case 'life': this.#life(cx, cy); break
    }
    ctx.restore()
  }

  #key(cx: number, cy: number): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = 'rgba(255,215,80,0.8)'; ctx.shadowBlur = 8
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 9); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy + 9); ctx.lineTo(cx + 5, cy + 9); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx + 4, cy + 5); ctx.stroke()
    ctx.restore()
  }

  #bell(cx: number, cy: number): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = 'rgba(255,210,80,0.7)'; ctx.shadowBlur = 6
    ctx.fillStyle = C.gold
    ctx.beginPath()
    ctx.moveTo(cx, cy - 7)
    ctx.quadraticCurveTo(cx + 7, cy - 4, cx + 6, cy + 4)
    ctx.lineTo(cx - 6, cy + 4)
    ctx.quadraticCurveTo(cx - 7, cy - 4, cx, cy - 7)
    ctx.fill()
    ctx.fillStyle = '#b8860b'; ctx.fillRect(Math.round(cx - 7), Math.round(cy + 4), 14, 2)
    ctx.beginPath(); ctx.arc(cx, cy + 7, 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  #jewel(cx: number, cy: number, color: string): void {
    const ctx = this.#ctx
    const r = 6
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 8
    ctx.fillStyle = color
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.2); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  #jar(cx: number, cy: number, body: string, flame: string): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = body; ctx.shadowBlur = 6
    ctx.fillStyle = body
    this.#path(() => this.#roundRect(cx - 5, cy - 3, 10, 9, 3)); ctx.fill()
    ctx.fillStyle = '#2a2a40'; ctx.fillRect(Math.round(cx - 3), Math.round(cy - 6), 6, 3) // neck
    ctx.fillStyle = flame // wisp of flame
    ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx - 3, cy - 6); ctx.lineTo(cx + 3, cy - 6); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  #hourglass(cx: number, cy: number, sand: string): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = sand; ctx.shadowBlur = 6
    ctx.fillStyle = '#caa86a'
    ctx.fillRect(Math.round(cx - 6), Math.round(cy - 8), 12, 2); ctx.fillRect(Math.round(cx - 6), Math.round(cy + 6), 12, 2) // caps
    ctx.fillStyle = sand
    ctx.beginPath(); ctx.moveTo(cx - 5, cy - 6); ctx.lineTo(cx + 5, cy - 6); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 5, cy + 6); ctx.lineTo(cx + 5, cy + 6); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  #fairy(cx: number, cy: number, time: number): void {
    const ctx = this.#ctx
    const flap = Math.sin(time * 18) * 3
    ctx.save(); ctx.shadowColor = 'rgba(255,200,255,0.8)'; ctx.shadowBlur = 8
    ctx.fillStyle = 'rgba(220,200,255,0.85)' // wings
    ctx.beginPath(); ctx.ellipse(cx - 4, cy, 3, 5 + flap, -0.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + 4, cy, 3, 5 + flap, 0.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffd6f0' // body
    ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  #life(cx: number, cy: number): void {
    const ctx = this.#ctx
    // a tiny Dana token = 1-up
    ctx.save(); ctx.shadowColor = 'rgba(120,180,255,0.7)'; ctx.shadowBlur = 6
    ctx.fillStyle = C.hat
    ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx - 6, cy - 1); ctx.lineTo(cx + 6, cy - 1); ctx.closePath(); ctx.fill()
    ctx.fillStyle = C.face; ctx.beginPath(); ctx.arc(cx, cy + 2, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = C.danaRobe; ctx.fillRect(Math.round(cx - 3), Math.round(cy + 3), 6, 4)
    ctx.restore()
  }

  // ── projectiles ──────────────────────────────────────────

  #fireball(f: Fireball): void {
    const ctx = this.#ctx
    const dir = Math.sign(f.vx) || 1
    const core = f.super ? '#ffd08a' : '#bfe0ff'
    const mid = f.super ? '#ff8f3a' : '#4aa0ff'
    ctx.save()
    ctx.shadowColor = f.super ? 'rgba(255,150,40,0.9)' : 'rgba(80,160,255,0.9)'
    ctx.shadowBlur = 12
    ctx.fillStyle = f.super ? 'rgba(255,140,40,0.4)' : 'rgba(80,160,255,0.4)'
    ctx.beginPath(); ctx.moveTo(f.x - dir * 4, f.y - 4); ctx.lineTo(f.x - dir * 17, f.y); ctx.lineTo(f.x - dir * 4, f.y + 4); ctx.closePath(); ctx.fill()
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 8)
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.4, core); grad.addColorStop(0.7, mid); grad.addColorStop(1, 'rgba(20,20,40,0.05)')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(f.x, f.y, f.super ? 8 : 7, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  #shot(s: Shot): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = 'rgba(255,80,40,0.9)'; ctx.shadowBlur = 8
    const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 6)
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, '#ff5a2a'); grad.addColorStop(1, 'rgba(120,20,0,0.1)')
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // ── mirror, door, markers ────────────────────────────────

  #mirror(col: number, row: number, time: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    // dark skull-mirror frame
    ctx.fillStyle = '#15172b'
    this.#path(() => this.#roundRect(x + 3, y + 2, TILE - 6, TILE - 4, 6)); ctx.fill()
    ctx.strokeStyle = '#3a2a5a'; ctx.lineWidth = 2
    this.#path(() => this.#roundRect(x + 3, y + 2, TILE - 6, TILE - 4, 6)); ctx.stroke()
    // shifting purple sheen across the glass
    const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE)
    const p = (Math.sin(time * 2) + 1) * 0.5
    g.addColorStop(Math.max(0, p - 0.2), 'rgba(40,20,70,0.2)')
    g.addColorStop(p, 'rgba(180,120,255,0.55)')
    g.addColorStop(Math.min(1, p + 0.2), 'rgba(40,20,70,0.2)')
    ctx.fillStyle = g
    this.#path(() => this.#roundRect(x + 5, y + 4, TILE - 10, TILE - 8, 4)); ctx.fill()
    // hollow eye sockets so it reads as a demon mirror
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.beginPath(); ctx.arc(x + TILE * 0.38, y + TILE * 0.42, 2.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(x + TILE * 0.62, y + TILE * 0.42, 2.4, 0, Math.PI * 2); ctx.fill()
  }

  #door(col: number, row: number, open: boolean, time: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    ctx.fillStyle = '#5a4a2a' // arch frame
    ctx.fillRect(x - 1, y - TILE * 0.1, TILE + 2, TILE * 1.1)
    if (open) {
      const glow = 0.6 + Math.sin(time * 4) * 0.2
      const g = ctx.createLinearGradient(x, y, x, y + TILE)
      g.addColorStop(0, `rgba(255,230,120,${glow})`); g.addColorStop(1, `rgba(255,170,40,${glow})`)
      ctx.fillStyle = g; ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + TILE / 2 - 1, y + 2, 2, TILE - 4)
    } else {
      ctx.fillStyle = '#241a0d'; ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2)
      ctx.strokeStyle = '#3c2c16'; ctx.lineWidth = 2
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 3 + i * (TILE - 6) / 3, y + 1); ctx.lineTo(x + 3 + i * (TILE - 6) / 3, y + TILE - 1); ctx.stroke() }
    }
  }

  #spawnMarker(col: number, row: number): void {
    const ctx = this.#ctx
    const x = col * TILE, y = row * TILE
    ctx.strokeStyle = 'rgba(120,220,160,0.9)'; ctx.lineWidth = 2
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
    if (e.tileAt(col, row) === WALL) return
    const breakable = e.breakableAt(col, row)
    ctx.strokeStyle = breakable ? 'rgba(255,140,120,0.5)' : 'rgba(150,255,200,0.45)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.strokeRect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4)
    ctx.setLineDash([])
  }

  // ── HUD: NES status bar ──────────────────────────────────

  #hud(e: Engine, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(6,6,18,0.82)'
    ctx.fillRect(0, 0, e.width, HUD_H)
    ctx.fillStyle = 'rgba(126,182,214,0.4)'
    ctx.fillRect(0, HUD_H - 1, e.width, 1)
    ctx.font = '11px "Courier New", monospace'
    ctx.textBaseline = 'middle'
    const midY = HUD_H / 2

    // score (left), zero-padded NES style
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9ec9ff'; ctx.fillText('SCORE', 6, midY)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px "Courier New", monospace'
    ctx.fillText(String(e.score).padStart(7, '0'), 44, midY)

    // life / time meter (centre) — pulses red when nearly out
    const low = e.life < 2000
    const t = Math.ceil(e.life / 10) * 10
    ctx.textAlign = 'center'
    ctx.font = '11px "Courier New", monospace'
    ctx.fillStyle = '#cbb06a'; ctx.fillText('TIME', e.width / 2 - 30, midY)
    ctx.font = 'bold 12px "Courier New", monospace'
    ctx.fillStyle = low ? (Math.sin(time * 12) > 0 ? '#ff5a5a' : '#ffd24d') : '#ffe39a'
    ctx.fillText(String(t).padStart(5, '0'), e.width / 2 + 16, midY)

    // right cluster: fairies · lives · fireball scroll
    let rx = e.width - 6
    ctx.textAlign = 'right'
    // fireball scroll — up to MAX_AMMO slots (blue normal, orange super)
    for (let i = e.ammo.length - 1; i >= 0; i--) {
      const sx = rx - 6
      const sup = e.ammo[i]
      ctx.fillStyle = sup ? '#ff8f3a' : '#4aa0ff'
      ctx.beginPath(); ctx.arc(sx, midY, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx - 1, midY - 1, 1.4, 0, Math.PI * 2); ctx.fill()
      rx -= 12
    }
    if (e.ammo.length) rx -= 4
    // lives — small wizard hats
    for (let i = 0; i < Math.min(e.lives, 5); i++) {
      const hx = rx - 6
      ctx.fillStyle = C.hat
      ctx.beginPath(); ctx.moveTo(hx, midY + 5); ctx.lineTo(hx - 5, midY - 5); ctx.lineTo(hx + 5, midY - 5); ctx.closePath(); ctx.fill()
      rx -= 14
    }
    rx -= 2
    // fairy tally
    ctx.fillStyle = '#ffd6f0'; ctx.font = 'bold 11px "Courier New", monospace'
    ctx.fillText(`✦${e.fairyCount}`, rx, midY)
    ctx.restore()
  }

  // ── helpers ──────────────────────────────────────────────

  #path(build: () => void): void { this.#ctx.beginPath(); build() }

  #roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.#ctx
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
  }
}
