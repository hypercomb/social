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
// Palette cues: torch-warm rooms framed by warm castle stone (sandstone / granite),
// glowing ORANGE breakable blocks, a small blue-robed Dana, green goblins, stone
// gargoils, pale ghosts, red demonheads, and a status bar with the draining
// life/time meter and the fireball scroll.

import { Engine, TILE, EMPTY, WALL, BRICK, CRACKED, type LevelDef, type Fireball, type Shot } from './engine.js'

const HUD_H = 24

// Baked stone textures are rendered at TEX× their world size so they stay crisp
// when the smoothed high-res pipeline upscales them (drawn back at world TILE size).
const TEX = 3

// Accent palette. WALL is warm CASTLE STONE — torch-lit sandstone/granite — so the
// chambers read as a cavernous keep rather than a cold cave; the conjurable orange
// BRICK still pops against the warm rock.
const C = {
  orange: '#e8902c', orangeLite: '#ffc56b', orangeDark: '#8a4a12',
  rock: '#544236', rockLite: '#8a6f52', rockDark: '#221913', rockWarm: '#3e2f23',
  mortar: '#191109', stoneLite: '#b39069', // ashlar masonry + torchlight
  torch: '#ffb24a', flame: '#ffe1a6',
  gold: '#ffd24d', danaRobe: '#3a6ee0', danaRobeDark: '#2247a8',
  face: '#f4c9a0', hat: '#7b46d6', hatDark: '#4f2a96',
  goblin: '#56b365', goblinDark: '#2f7d3e',
  ghost: '#cfe0ff', demon: '#e2433f',
}

// Enemy kinds that stand on the ground (so they get a contact shadow).
const GROUNDED = new Set(['goblin', 'gargoil', 'dragon', 'saramandor'])

export class Renderer {
  #ctx: CanvasRenderingContext2D
  // Baked block faces — procedural textures are expensive per-pixel, so each
  // block type is painted ONCE into an offscreen canvas and blitted every frame.
  #brickTex: HTMLCanvasElement | null = null
  #crackTex: HTMLCanvasElement | null = null
  #wallTex: HTMLCanvasElement | null = null
  #glowTex: HTMLCanvasElement | null = null   // baked torch light-pool

  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  // ── play view ────────────────────────────────────────────

  /** Draw the cavern WORLD only (no HUD/flash). The caller applies the camera +
   *  shake translate, so caverns can be larger than the viewport and scroll. */
  drawWorld(e: Engine, time: number): void {
    this.#background(e.width, e.height, time)
    const torches = this.#torchCells(e.grid, e.cols, e.rows)
    this.#torchGlow(torches, time)      // warm light pools, under the scene
    this.#tiles(e.grid, e.cols, e.rows)
    this.#torchFlames(torches, time)    // the fixtures + flames, on the walls
    for (const m of e.mirrors) this.#mirror(m.col, m.row, time)
    this.#door(e.level.door.col, e.level.door.row, e.doorOpen, time)
    for (const it of e.items) {
      if (it.taken) continue
      if (it.hidden) { if (it.secret) this.#secretHint(it.col, it.row, time); continue }
      this.#item(it.kind, it.col, it.row, time, it.reveal)
    }
    for (const f of e.fairies) if (!f.taken) this.#fairy(f.x, f.y, time)
    for (const en of e.enemies) this.#enemy(en, time)
    this.#dana(e, time)
    for (const f of e.fireballs) this.#fireball(f)
    for (const s of e.shots) this.#shot(s)
    this.#wandTarget(e)
  }

  /** Screen-space HUD + hurt flash (drawn after the world, no camera translate),
   *  spanning the VIEWPORT rather than the (possibly larger) level. */
  drawHud(e: Engine, time: number, viewW: number, viewH: number): void {
    // a warm vignette frames the viewport (screen-space, behind the HUD bar)
    const vg = this.#ctx.createRadialGradient(viewW / 2, viewH * 0.5, viewH * 0.36, viewW / 2, viewH * 0.5, viewH * 0.82)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,4,0,0.5)')
    this.#ctx.fillStyle = vg; this.#ctx.fillRect(0, 0, viewW, viewH)
    this.#hud(e, time, viewW)
    if (e.hurtFlash > 0) {
      this.#ctx.fillStyle = `rgba(255,40,40,${0.35 * (e.hurtFlash / 0.5)})`
      this.#ctx.fillRect(0, 0, viewW, viewH)
    }
  }

  // ── designer view ────────────────────────────────────────

  drawEditor(level: LevelDef, hover: { col: number; row: number } | null, time: number): void {
    const ctx = this.#ctx
    const w = level.cols * TILE, h = level.rows * TILE
    this.#background(w, h, time)
    const torches = this.#torchCells(level.tiles, level.cols, level.rows)
    this.#torchGlow(torches, time)
    this.#tiles(level.tiles, level.cols, level.rows)
    this.#torchFlames(torches, time)
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
    // A torch-lit castle vault: deep warm browns with an amber glow rising from the
    // depths and a slow drift of dust motes catching the firelight in place.
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0c0805'); g.addColorStop(0.65, '#120b06'); g.addColorStop(1, '#241308')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 26; i++) {
      const x = (i * 97.13) % w
      const y = (i * 57.3) % h
      const tw = 0.06 + (Math.sin(time * 1.6 + i) + 1) * 0.08
      ctx.fillStyle = `rgba(255,196,120,${tw})`
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
    this.#cavernRim(grid, cols, rows)
  }

  // Organic rock teeth (stalactites / stalagmites / nubs) jutting from every
  // rock→open boundary so the chambers read as caverns, not boxes. Decorative
  // only (no collision); deterministic per cell, so it never flickers.
  #cavernRim(grid: ArrayLike<number>, cols: number, rows: number): void {
    const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 || r >= rows) ? WALL : grid[r * cols + c]
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (at(c, r) !== WALL) continue
        const x = c * TILE, y = r * TILE
        const rnd = this.#noise(((c + 1) * 73856093) ^ ((r + 1) * 19349663))
        if (at(c, r + 1) === EMPTY) this.#teeth(x, y + TILE, TILE, true, 1, rnd)   // stalactites
        if (at(c, r - 1) === EMPTY) this.#teeth(x, y, TILE, true, -1, rnd)         // stalagmites
        if (at(c - 1, r) === EMPTY) this.#teeth(y, x, TILE, false, -1, rnd)        // left nubs
        if (at(c + 1, r) === EMPTY) this.#teeth(y, x + TILE, TILE, false, 1, rnd)  // right nubs
      }
    }
  }

  /** Two rock teeth along an edge. `horiz` true → teeth point vertically (dir ±1);
   *  false → the axes swap so they point horizontally. `a` is the along-edge start. */
  #teeth(a: number, edge: number, span: number, horiz: boolean, dir: number, rnd: () => number): void {
    const ctx = this.#ctx
    for (let i = 0; i < 2; i++) {
      const p = a + (i + 0.2 + rnd() * 0.5) * (span / 2)
      const len = TILE * (horiz ? 0.16 + rnd() * 0.22 : 0.1 + rnd() * 0.14)
      const half = 2 + rnd() * 2.4
      ctx.fillStyle = C.rockDark
      ctx.beginPath()
      if (horiz) { ctx.moveTo(p - half, edge); ctx.lineTo(p + half, edge); ctx.lineTo(p, edge + dir * len) }
      else { ctx.moveTo(edge, p - half); ctx.lineTo(edge, p + half); ctx.lineTo(edge + dir * len, p) }
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(150,120,86,0.45)'
      ctx.beginPath()
      if (horiz) { ctx.moveTo(p - half, edge); ctx.lineTo(p - half + 1.5, edge); ctx.lineTo(p, edge + dir * len * 0.6) }
      else { ctx.moveTo(edge, p - half); ctx.lineTo(edge, p - half + 1.5); ctx.lineTo(edge + dir * len * 0.6, p) }
      ctx.closePath(); ctx.fill()
    }
  }

  #wall(c: number, r: number): void {
    if (!this.#wallTex) this.#wallTex = this.#buildWall()
    this.#ctx.drawImage(this.#wallTex, c * TILE, r * TILE, TILE, TILE)
  }

  #brick(c: number, r: number, tex: HTMLCanvasElement): void { this.#ctx.drawImage(tex, c * TILE, r * TILE, TILE, TILE) }
  #brickTexture(): HTMLCanvasElement { return (this.#brickTex ??= this.#buildBrick(false)) }
  #crackTexture(): HTMLCanvasElement { return (this.#crackTex ??= this.#buildBrick(true)) }

  // Solomon's Key breakable block: ONE carved, framed panel-block per tile (NOT a
  // running-bond brick wall — adjacent tiles read as a row of distinct blocks). A
  // warm extruded face, a proud cube bevel, an inset frame groove + sheen, and four
  // forged corner rivets. `cracked` adds fracture lines (one head-hit).
  #buildBrick(cracked: boolean): HTMLCanvasElement {
    const s = TILE
    const cv = document.createElement('canvas'); cv.width = s * TEX; cv.height = s * TEX
    const x = cv.getContext('2d')!
    x.scale(TEX, TEX)                                  // bake the world-unit art at TEX× res
    // extruded block face — warm gradient, lit top-left → dark bottom-right
    const face = x.createLinearGradient(0, 0, s, s)
    face.addColorStop(0, C.orangeLite); face.addColorStop(0.55, C.orange); face.addColorStop(1, C.orangeDark)
    x.fillStyle = face; x.fillRect(0, 0, s, s)
    // outer cube bevel — the block stands proud of the wall
    x.fillStyle = 'rgba(255,228,158,0.6)'; x.fillRect(0, 0, s, 2); x.fillRect(0, 0, 2, s)
    x.fillStyle = 'rgba(54,24,2,0.6)'; x.fillRect(0, s - 2, s, 2); x.fillRect(s - 2, 0, 2, s)
    // inset frame groove → the panelled "tile" look (a carved square channel)
    const f = 4.5
    x.strokeStyle = 'rgba(70,30,4,0.75)'; x.lineWidth = 1; x.strokeRect(f, f, s - 2 * f, s - 2 * f)
    x.strokeStyle = 'rgba(255,214,148,0.35)'; x.lineWidth = 1; x.strokeRect(f + 1, f + 1, s - 2 * f - 2, s - 2 * f - 2)
    // soft sheen on the inner panel (top-left light)
    const sheen = x.createRadialGradient(s * 0.38, s * 0.34, 1, s * 0.5, s * 0.5, s * 0.62)
    sheen.addColorStop(0, 'rgba(255,224,152,0.32)'); sheen.addColorStop(1, 'rgba(255,180,90,0)')
    x.fillStyle = sheen; x.fillRect(f + 1, f + 1, s - 2 * f - 2, s - 2 * f - 2)
    // four forged corner rivets
    x.fillStyle = 'rgba(58,26,2,0.6)'
    for (const [cx, cy] of [[f + 2, f + 2], [s - f - 2, f + 2], [f + 2, s - f - 2], [s - f - 2, s - f - 2]]) {
      x.beginPath(); x.arc(cx, cy, 1, 0, Math.PI * 2); x.fill()
    }
    if (cracked) {
      x.strokeStyle = 'rgba(40,16,0,0.85)'; x.lineWidth = 1.6
      x.beginPath(); x.moveTo(s * 0.5, 2); x.lineTo(s * 0.42, s * 0.4); x.lineTo(s * 0.6, s * 0.6); x.lineTo(s * 0.5, s - 2); x.stroke()
      x.beginPath(); x.moveTo(s * 0.42, s * 0.4); x.lineTo(s * 0.18, s * 0.5); x.stroke()
      x.beginPath(); x.moveTo(s * 0.6, s * 0.6); x.lineTo(s * 0.84, s * 0.52); x.stroke()
    }
    return cv
  }

  // Castle stone: warm sandstone/granite cut as RUNNING-BOND ASHLAR — two courses of
  // blocks, the lower offset half a stone, each beveled (lit top-left, shadowed
  // bottom-right) over a dark mortar bed, with mottled grain + the odd hairline crack.
  // Tiles seamlessly into a keep wall; #cavernRim adds organic teeth at its edges so
  // the border never reads as a clean box.
  #buildWall(): HTMLCanvasElement {
    const s = TILE
    const cv = document.createElement('canvas'); cv.width = s * TEX; cv.height = s * TEX
    const x = cv.getContext('2d')!
    x.scale(TEX, TEX)                               // bake the world-unit art at TEX× res
    const rnd = this.#noise(0x2a17)
    x.fillStyle = C.mortar; x.fillRect(0, 0, s, s) // mortar bed
    const ch = s / 2, sw = s / 2, m = 1.5
    for (let course = 0; course < 2; course++) {
      const oy = course * ch
      for (let sx = course === 1 ? -sw / 2 : 0; sx < s; sx += sw) {
        const rx = sx + m, ry = oy + m, rw = sw - m * 2, rh = ch - m * 2
        const g = x.createLinearGradient(0, ry, 0, ry + rh)
        g.addColorStop(0, C.rockLite); g.addColorStop(1, C.rock)
        x.fillStyle = g; x.fillRect(rx, ry, rw, rh)
        for (let k = (rw * rh) >> 4; k > 0; k--) { // mottled grain
          const d = rnd() - 0.5
          x.fillStyle = d > 0 ? `rgba(214,176,124,${d * 0.3})` : `rgba(0,0,0,${-d * 0.4})`
          x.fillRect(rx + (rnd() * rw | 0), ry + (rnd() * rh | 0), 2, 2)
        }
        x.fillStyle = C.stoneLite; x.fillRect(rx, ry, rw, 1); x.fillRect(rx, ry, 1, rh)       // lit bevel
        x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(rx, ry + rh - 1, rw, 1); x.fillRect(rx + rw - 1, ry, 1, rh) // shadow bevel
        if (rnd() < 0.4) { // a hairline crack
          x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 1
          let px = rx + rnd() * rw, py = ry + 2
          x.beginPath(); x.moveTo(px, py)
          for (let q = 0; q < 2; q++) { px += (rnd() - 0.5) * 6; py += rh * 0.4; x.lineTo(px, py) }
          x.stroke()
        }
      }
    }
    return cv
  }

  // ── torchlight: warm light pools that fill the big scrolling castle rooms ──

  /** Wall cells that carry a torch — deterministic (stable, no flicker of position):
   *  a sparse subset of WALL cells that face open space to the left or right, mounted
   *  in the upper-middle band. Returns the flame anchor (in the open cell) + facing. */
  #torchCells(grid: ArrayLike<number>, cols: number, rows: number): { x: number; y: number; dir: number }[] {
    const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 || r >= rows) ? WALL : grid[r * cols + c]
    const out: { x: number; y: number; dir: number }[] = []
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (at(c, r) !== WALL) continue
        const openR = at(c + 1, r) === EMPTY, openL = at(c - 1, r) === EMPTY
        if (!openR && !openL) continue
        if ((c * 7 + r * 5) % 6 !== 0) continue                 // sparse, deterministic
        const dir = openR ? 1 : -1
        out.push({ x: dir > 0 ? (c + 1) * TILE + TILE * 0.16 : c * TILE - TILE * 0.16, y: r * TILE + TILE * 0.42, dir })
      }
    }
    return out
  }

  #glowTexture(): HTMLCanvasElement {
    if (this.#glowTex) return this.#glowTex
    const s = 192
    const cv = document.createElement('canvas'); cv.width = s; cv.height = s
    const x = cv.getContext('2d')!
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,180,92,0.55)'); g.addColorStop(0.4, 'rgba(255,140,60,0.2)'); g.addColorStop(1, 'rgba(255,120,40,0)')
    x.fillStyle = g; x.fillRect(0, 0, s, s)
    return this.#glowTex = cv
  }

  /** Additive warm light pools at each torch — the big visual lift for dark rooms. */
  #torchGlow(torches: { x: number; y: number; dir: number }[], time: number): void {
    if (!torches.length) return
    const ctx = this.#ctx, tex = this.#glowTexture()
    ctx.save(); ctx.globalCompositeOperation = 'lighter'
    for (const t of torches) {
      const flick = 0.82 + Math.sin(time * 9 + t.x * 0.7) * 0.12 + Math.sin(time * 23 + t.y) * 0.05
      const R = TILE * 4.2 * flick
      ctx.globalAlpha = 0.5 * flick
      ctx.drawImage(tex, t.x - R, t.y - R, R * 2, R * 2)
    }
    ctx.restore()
  }

  /** The bracket + flickering flame mounted on the wall (drawn over the tiles). */
  #torchFlames(torches: { x: number; y: number; dir: number }[], time: number): void {
    const ctx = this.#ctx
    for (const t of torches) {
      ctx.fillStyle = '#3a2a18' // iron bracket on the wall face
      ctx.fillRect(Math.round(t.dir > 0 ? t.x - TILE * 0.18 : t.x + TILE * 0.18 - 3), Math.round(t.y + 2), 3, 6)
      const flick = Math.sin(time * 12 + t.x) * 1.4 + Math.sin(time * 7 + t.y) * 0.8
      const fx = t.x, fy = t.y - 2
      ctx.save()
      ctx.shadowColor = 'rgba(255,150,50,0.8)'; ctx.shadowBlur = 6
      ctx.fillStyle = C.torch
      ctx.beginPath(); ctx.ellipse(fx, fy, 3.2, 6 + flick, 0, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 0
      ctx.fillStyle = C.flame
      ctx.beginPath(); ctx.ellipse(fx, fy + 1, 1.6, 3.4 + flick * 0.6, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff7e0'
      ctx.beginPath(); ctx.arc(fx, fy + 2, 1.1, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }

  /** A soft contact shadow on the ground under a character (grounds the sprite). */
  #shadow(cx: number, footY: number, w: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(cx, footY, w * 0.55, 3, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
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
    this.#shadow(cx, p.y + p.h, p.w)
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
    } else if (GROUNDED.has(en.kind)) {
      this.#shadow(x + w / 2, y + h, w)
    }
    switch (en.kind) {
      case 'ghost': this.#ghost(x, y, w, h, en.dir, time); break
      case 'neul': this.#neul(x, y, w, h, time); break
      case 'sparkball': this.#sparkball(x, y, w, h, en.anim); break
      case 'demonhead': this.#demonhead(x, y, w, h, time); break
      case 'gargoil': this.#gargoil(x, y, w, h, en.dir, en.alive); break
      case 'saramandor': this.#saramandor(x, y, w, h, en.dir, en.alive); break
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

  // Neul: a half-ghost / half-bat vertical flyer — pale violet, ragged wings,
  // one staring eye. Smashes blocks, fireball-only.
  #neul(x: number, y: number, w: number, h: number, time: number): void {
    const ctx = this.#ctx
    const flap = Math.sin(time * 12) * 3
    ctx.save()
    ctx.shadowColor = 'rgba(180,150,255,0.6)'; ctx.shadowBlur = 7
    ctx.fillStyle = '#a98fe0'
    // wings
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h * 0.5)
    ctx.lineTo(x - w * 0.1, y + h * 0.2 - flap); ctx.lineTo(x - w * 0.05, y + h * 0.7); ctx.lineTo(x + w * 0.5, y + h * 0.6); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x + w * 0.5, y + h * 0.5)
    ctx.lineTo(x + w * 1.1, y + h * 0.2 - flap); ctx.lineTo(x + w * 1.05, y + h * 0.7); ctx.lineTo(x + w * 0.5, y + h * 0.6); ctx.fill()
    // body
    ctx.fillStyle = '#cdb6f5'
    ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.5, w * 0.3, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#2a1a4a'; ctx.fillRect(Math.round(x + w * 0.42), Math.round(y + h * 0.42), 4, 4)
    ctx.restore()
  }

  // Sparkball: a crackling ball of electricity — white-hot core, jagged yellow
  // arcs that jitter each frame. Fireball-only.
  #sparkball(x: number, y: number, w: number, h: number, anim: number): void {
    const ctx = this.#ctx
    const cx = x + w / 2, cy = y + h / 2, r = w * 0.4
    ctx.save()
    ctx.shadowColor = 'rgba(255,240,120,0.9)'; ctx.shadowBlur = 10
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ffe14a'); g.addColorStop(1, 'rgba(255,150,0,0.1)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    // electric arcs
    ctx.strokeStyle = '#fff7c0'; ctx.lineWidth = 1.5
    for (let i = 0; i < 4; i++) {
      const a = anim * 0.3 + i * Math.PI / 2
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * r * 1.5, cy + Math.sin(a) * r * 1.5)
      ctx.lineTo(cx + Math.cos(a + 0.5) * r * 1.2, cy + Math.sin(a + 0.5) * r * 1.2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Saramandor: a small fire-lizard demon — orange body, flame crest, breathing
  // embers in its facing direction. Drop / crush / fireball.
  #saramandor(x: number, y: number, w: number, h: number, dir: number, alive: boolean): void {
    const ctx = this.#ctx
    ctx.fillStyle = alive ? '#ff7a2a' : '#8a4118'
    this.#path(() => this.#roundRect(x, y + h * 0.35, w, h * 0.65, 5)); ctx.fill()
    // head
    const hx = dir > 0 ? x + w * 0.82 : x + w * 0.18
    ctx.beginPath(); ctx.arc(hx, y + h * 0.42, w * 0.22, 0, Math.PI * 2); ctx.fill()
    // flame crest
    if (alive) {
      ctx.fillStyle = '#ffd24a'
      for (let i = 0; i < 3; i++) {
        const sx = x + w * (0.32 + i * 0.2)
        ctx.beginPath(); ctx.moveTo(sx, y + h * 0.36); ctx.lineTo(sx - 3, y + h * 0.08); ctx.lineTo(sx + 3, y + h * 0.36); ctx.fill()
      }
      ctx.fillStyle = '#2a0a04'; ctx.fillRect(Math.round(dir > 0 ? hx : hx - 2), Math.round(y + h * 0.4), 2, 2)
    }
  }

  #enemyMarker(kind: string, col: number, row: number, dir: number, time: number): void {
    const d: Record<string, { w: number; h: number }> = {
      goblin: { w: 0.72, h: 0.84 }, gargoil: { w: 0.78, h: 0.82 }, dragon: { w: 0.86, h: 0.78 },
      saramandor: { w: 0.7, h: 0.74 }, ghost: { w: 0.74, h: 0.74 }, neul: { w: 0.66, h: 0.66 },
      sparkball: { w: 0.58, h: 0.58 }, demonhead: { w: 0.6, h: 0.6 }, panel: { w: 0.9, h: 0.9 },
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
      case 'treasure': this.#treasure(cx, cy); break
      case 'jar': this.#jar(cx, cy, '#3a86ff', '#bfe0ff'); break
      case 'superjar': this.#jar(cx, cy, '#ff7a2a', '#ffd08a'); break
      case 'scroll': this.#scroll(cx, cy); break
      case 'hourglass': this.#hourglass(cx, cy, '#5fd6ff'); break
      case 'hourglassHalf': this.#hourglass(cx, cy, '#ffb24d'); break
      case 'fairy': this.#fairy(cx, cy, time); break
      case 'life': this.#life(cx, cy); break
      case 'seal': this.#seal(cx, cy, time); break
      case 'zodiac': this.#zodiac(cx, cy, time); break
      case 'wings': this.#wings(cx, cy, time); break
      case 'pageTime': this.#page(cx, cy, time, true); break
      case 'pageSpace': this.#page(cx, cy, time, false); break
      case 'princess': this.#princess(cx, cy, time); break
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

  #treasure(cx: number, cy: number): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = 'rgba(255,210,90,0.7)'; ctx.shadowBlur = 7
    ctx.fillStyle = '#b07a2a' // sack
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.quadraticCurveTo(cx + 8, cy - 2, cx + 6, cy + 7); ctx.lineTo(cx - 6, cy + 7); ctx.quadraticCurveTo(cx - 8, cy - 2, cx, cy - 6); ctx.fill()
    ctx.fillStyle = '#7a5018'; ctx.fillRect(Math.round(cx - 5), Math.round(cy - 6), 10, 2) // tie
    ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('$', cx, cy + 2)
    ctx.restore()
  }

  #scroll(cx: number, cy: number): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = 'rgba(255,240,200,0.6)'; ctx.shadowBlur = 5
    ctx.fillStyle = '#efe2c0'; this.#path(() => this.#roundRect(cx - 7, cy - 4, 14, 8, 2)); ctx.fill()
    ctx.fillStyle = '#cdbf95'; ctx.fillRect(Math.round(cx - 7), Math.round(cy - 4), 2, 8); ctx.fillRect(Math.round(cx + 5), Math.round(cy - 4), 2, 8) // rollers
    ctx.strokeStyle = '#9a8a5a'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx - 3, cy - 1); ctx.lineTo(cx + 3, cy - 1); ctx.moveTo(cx - 3, cy + 1); ctx.lineTo(cx + 3, cy + 1); ctx.stroke()
    ctx.restore()
  }

  // Solomon's Seal — a glowing six-pointed star (two interlocked triangles).
  #seal(cx: number, cy: number, time: number): void {
    const ctx = this.#ctx
    const r = 7 + Math.sin(time * 4) * 0.6
    ctx.save(); ctx.shadowColor = 'rgba(120,180,255,0.9)'; ctx.shadowBlur = 10
    ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(90,140,255,0.25)'
    for (const flip of [0, Math.PI]) {
      ctx.beginPath()
      for (let i = 0; i < 3; i++) {
        const a = flip + i * (Math.PI * 2 / 3) - Math.PI / 2
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.closePath(); ctx.fill(); ctx.stroke()
    }
    ctx.restore()
  }

  // Constellation panel — a dark tablet with linked stars (a zodiac sign).
  #zodiac(cx: number, cy: number, time: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.shadowColor = 'rgba(255,225,120,0.7)'; ctx.shadowBlur = 8
    ctx.fillStyle = '#1b1740'; this.#path(() => this.#roundRect(cx - 9, cy - 8, 18, 16, 3)); ctx.fill()
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 1.5; this.#path(() => this.#roundRect(cx - 9, cy - 8, 18, 16, 3)); ctx.stroke()
    const stars = [[-5, -3], [0, -5], [4, 1], [-2, 4], [6, 5]]
    ctx.strokeStyle = 'rgba(255,235,160,0.7)'; ctx.lineWidth = 1; ctx.beginPath()
    stars.forEach(([sx, sy], i) => { i === 0 ? ctx.moveTo(cx + sx, cy + sy) : ctx.lineTo(cx + sx, cy + sy) }); ctx.stroke()
    ctx.fillStyle = '#fff7d0'
    for (const [sx, sy] of stars) { const tw = 1 + (Math.sin(time * 5 + sx) + 1) * 0.6; ctx.beginPath(); ctx.arc(cx + sx, cy + sy, tw, 0, Math.PI * 2); ctx.fill() }
    ctx.restore()
  }

  // Golden Wings — a pair of spread wings (warp ahead).
  #wings(cx: number, cy: number, time: number): void {
    const ctx = this.#ctx
    const flap = Math.sin(time * 8) * 2
    ctx.save(); ctx.shadowColor = 'rgba(255,215,90,0.8)'; ctx.shadowBlur = 9
    ctx.fillStyle = '#ffd24d'
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx, cy)
      ctx.quadraticCurveTo(cx + s * 12, cy - 6 - flap, cx + s * 11, cy + 4)
      ctx.quadraticCurveTo(cx + s * 7, cy + 1, cx, cy + 3)
      ctx.closePath(); ctx.fill()
    }
    ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // A lost Page — an ancient parchment with a glowing emblem: a clock (Page of
  // Time) or an orbit of stars (Page of Space).
  #page(cx: number, cy: number, time: number, isTime: boolean): void {
    const ctx = this.#ctx
    ctx.save(); ctx.shadowColor = isTime ? 'rgba(120,220,255,0.8)' : 'rgba(200,160,255,0.8)'; ctx.shadowBlur = 9
    ctx.fillStyle = '#efe2c0'
    this.#path(() => this.#roundRect(cx - 6, cy - 8, 12, 16, 2)); ctx.fill()
    ctx.strokeStyle = '#bda87a'; ctx.lineWidth = 1; this.#path(() => this.#roundRect(cx - 6, cy - 8, 12, 16, 2)); ctx.stroke()
    if (isTime) {
      ctx.strokeStyle = '#2a7ad0'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke()
      const a = time * 1.5
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a * 0.2) * 2, cy + Math.sin(a * 0.2) * 2); ctx.stroke()
    } else {
      ctx.fillStyle = '#7a4fd0'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#9b7cff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.4, time * 0.6, 0, Math.PI * 2); ctx.stroke()
      const sa = time * 1.2
      ctx.fillStyle = '#fff7d0'; ctx.beginPath(); ctx.arc(cx + Math.cos(sa) * 5, cy + Math.sin(sa) * 2.4, 1.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  // The caged fairy Princess — a small crowned figure with gossamer wings, the
  // goal of the true ending.
  #princess(cx: number, cy: number, time: number): void {
    const ctx = this.#ctx
    const glow = 0.6 + Math.sin(time * 3) * 0.25
    ctx.save(); ctx.shadowColor = `rgba(255,190,240,${glow})`; ctx.shadowBlur = 12
    // wings
    ctx.fillStyle = 'rgba(220,200,255,0.8)'
    ctx.beginPath(); ctx.ellipse(cx - 6, cy, 4, 8, -0.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx + 6, cy, 4, 8, 0.4, 0, Math.PI * 2); ctx.fill()
    // gown
    ctx.fillStyle = '#ff9ed6'
    ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx - 6, cy + 10); ctx.lineTo(cx + 6, cy + 10); ctx.closePath(); ctx.fill()
    // head
    ctx.fillStyle = '#ffe0c0'; ctx.beginPath(); ctx.arc(cx, cy - 7, 4, 0, Math.PI * 2); ctx.fill()
    // crown
    ctx.fillStyle = '#ffd24d'
    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 9); ctx.lineTo(cx - 4, cy - 12); ctx.lineTo(cx - 1, cy - 10)
    ctx.lineTo(cx, cy - 13); ctx.lineTo(cx + 1, cy - 10); ctx.lineTo(cx + 4, cy - 12); ctx.lineTo(cx + 4, cy - 9); ctx.closePath(); ctx.fill()
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

  // A faint, slow violet twinkle over an un-revealed SECRET cell — a sharp eye
  // catches a shimmer that says "wave the wand here", but it's no blatant beacon.
  #secretHint(col: number, row: number, time: number): void {
    const ctx = this.#ctx
    const cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2
    const tw = Math.max(0, Math.sin(time * 1.5 + col * 1.7 + row))   // 0..1, mostly low
    const a = 0.05 + tw * tw * 0.16
    ctx.save()
    ctx.fillStyle = `rgba(206,184,255,${a})`
    ctx.beginPath(); ctx.arc(cx, cy, 1.5 + tw * 1.3, 0, Math.PI * 2); ctx.fill()
    if (tw > 0.86) { // a brief cross-sparkle at the peak
      ctx.strokeStyle = `rgba(232,222,255,${a})`; ctx.lineWidth = 0.6
      ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); ctx.stroke()
    }
    ctx.restore()
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

  #hud(e: Engine, time: number, viewW: number): void {
    const ctx = this.#ctx
    ctx.save()
    ctx.fillStyle = 'rgba(6,6,18,0.82)'
    ctx.fillRect(0, 0, viewW, HUD_H)
    ctx.fillStyle = 'rgba(126,182,214,0.4)'
    ctx.fillRect(0, HUD_H - 1, viewW, 1)
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
    ctx.fillStyle = '#cbb06a'; ctx.fillText('TIME', viewW / 2 - 30, midY)
    ctx.font = 'bold 12px "Courier New", monospace'
    ctx.fillStyle = low ? (Math.sin(time * 12) > 0 ? '#ff5a5a' : '#ffd24d') : '#ffe39a'
    ctx.fillText(String(t).padStart(5, '0'), viewW / 2 + 16, midY)

    // right cluster: fairies · lives · fireball scroll
    let rx = viewW - 6
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
    // fairy + seal tallies, then any held meta items (zodiac / wings)
    ctx.font = 'bold 11px "Courier New", monospace'
    ctx.fillStyle = '#ffd6f0'
    ctx.fillText(`✦${e.fairyCount}`, rx, midY)
    rx -= ctx.measureText(`✦${e.fairyCount}`).width + 6
    if (e.sealCount > 0) {
      ctx.fillStyle = '#bfe0ff'
      ctx.fillText(`✡${e.sealCount}`, rx, midY)
      rx -= ctx.measureText(`✡${e.sealCount}`).width + 6
    }
    if (e.zodiacHeld) { ctx.fillStyle = '#ffd76a'; ctx.fillText('★', rx, midY); rx -= 14 }
    if (e.wingsHeld) { ctx.fillStyle = '#ffe39a'; ctx.fillText('≫', rx, midY); rx -= 14 }
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
