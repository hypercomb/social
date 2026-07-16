// diamondcoreprocessor.com/games/solomon/renderer.ts
//
// Canvas2D renderer for the Solomon's Key engine — the high-fidelity remaster.
// Same torch-lit castle identity, rebuilt on the roper renderer's architecture:
//
//   • BAKE the static layers once (backdrop, per-pixel-lit wall terrain with its
//     cavern-rim teeth) and blit them every frame — the single biggest saving.
//   • ZERO shadowBlur (a GPU-less-preview killer): every glow is an additive
//     blit of a cached radial glow sprite (`glowSprite`).
//   • ONE shared candlelight pulse per frame (slow sine + flutter + a gutter
//     stutter, plus an event `spike()` that bleeds off) — every light in the
//     dungeon breathes on the same clock, so events make the whole room flare.
//   • Characters are multi-part procedural sprites (contact shadow, gradient-lit
//     body, sheen, rim light, dark contour, blinking tracked eyes) animated by
//     math off `time` + the engine's state machines (telegraph, playerAnim…).
//   • Deterministic hash noise only — no Math.random in the frame path.
//
// The public API is unchanged (drawWorld / drawHud / drawEditor) plus two small
// hooks the overlay drives: spike(amount) and punch(kind, k). Every read of a
// NEW engine field is defensive (`?? fallback`) so partial objects (the
// designer's markers) never throw.

import {
  Engine, TILE, WALL, BRICK, CRACKED, LIFE_FULL,
  type LevelDef, type Fireball, type Shot,
} from './engine.js'

const HUD_H = 28

// Baked art is rendered above world resolution so the smoothed pipeline
// downscales it crisp. Tiles bake at TEX×; the wall layer bakes at WALL_S×.
const TEX = 3
const WALL_S = 2

// The palette. Warm castle stone, glowing conjurable orange brick, a blue-robed
// Dana — plus the named LIGHT accents every glow draws from.
const C = {
  orange: '#e8902c', orangeLite: '#ffc56b', orangeDark: '#8a4a12',
  rock: '#544236', rockLite: '#8a6f52', rockDark: '#221913',
  mortar: '#191109', stoneLite: '#b39069',
  gold: '#ffd24d', danaRobe: '#3a6ee0', danaRobeDark: '#2247a8',
  face: '#f4c9a0', hat: '#7b46d6', hatDark: '#4f2a96',
  goblin: '#56b365', goblinDark: '#2f7d3e',
  ghost: '#cfe0ff', demon: '#e2433f',
  // light accents (glow sprite tints)
  TORCH: '#ffb24a', MAGIC: '#bfe9ff', DOOR_GOLD: '#ffd76a', DEMON_RED: '#ff5040',
  SPARK: '#ffe14a', GHOST_COOL: '#a9c4ff', FAIRY: '#ffc9ec', SEAL: '#7ea8ff', EMBER: '#ff8f4d',
}

const GROUNDED = new Set(['goblin', 'gargoil', 'dragon', 'saramandor'])

// ── per-shrine room palettes ────────────────────────────────
// Each shrine bakes its chambers in different stone; the conjurable ORANGE
// brick stays constant everywhere (it's the game's verb — it must always pop).

interface RoomPalette {
  bgTop: string; bgMid: string; bgBot: string
  archNear: string; archFar: string          // backdrop vault silhouettes
  floorGlow: string                          // rgba() rising from the depths
  rock: string; rockLite: string; rockDark: string
  mortar: string; stoneLite: string
  rim: string                                // rgba() top-edge light on walls
  toothLite: string                          // rgba() lit edge on rim teeth
}

const THEMES: Record<string, RoomPalette> = {
  sandstone: {   // Shrine of Aries — the warm torch-lit keep
    bgTop: '#0c0805', bgMid: '#120b06', bgBot: '#241308',
    archNear: 'rgba(16,10,5,0.85)', archFar: 'rgba(26,15,7,0.7)',
    floorGlow: 'rgba(255,150,60,0.14)',
    rock: '#544236', rockLite: '#8a6f52', rockDark: '#221913',
    mortar: '#191109', stoneLite: '#b39069',
    rim: 'rgba(255,205,140,0.40)', toothLite: 'rgba(150,120,86,0.45)',
  },
  verdant: {     // Shrine of Taurus — mossy overgrown halls
    bgTop: '#060a04', bgMid: '#0a1006', bgBot: '#14220c',
    archNear: 'rgba(10,16,6,0.85)', archFar: 'rgba(16,26,10,0.7)',
    floorGlow: 'rgba(150,220,90,0.11)',
    rock: '#46523a', rockLite: '#6f8a5a', rockDark: '#1a2114',
    mortar: '#101407', stoneLite: '#96b478',
    rim: 'rgba(215,255,175,0.36)', toothLite: 'rgba(120,150,90,0.45)',
  },
  crystal: {     // Shrine of Gemini — cold blue-violet vaults
    bgTop: '#050711', bgMid: '#080b18', bgBot: '#111a34',
    archNear: 'rgba(8,10,20,0.85)', archFar: 'rgba(13,17,32,0.7)',
    floorGlow: 'rgba(120,170,255,0.12)',
    rock: '#3d4460', rockLite: '#67729e', rockDark: '#151827',
    mortar: '#0d0f1a', stoneLite: '#9aa8d8',
    rim: 'rgba(195,215,255,0.38)', toothLite: 'rgba(120,135,190,0.45)',
  },
  abyss: {       // Shrine of Cancer — the drowned deep
    bgTop: '#030808', bgMid: '#050d0d', bgBot: '#0a1c19',
    archNear: 'rgba(5,12,12,0.85)', archFar: 'rgba(8,18,17,0.7)',
    floorGlow: 'rgba(60,220,190,0.10)',
    rock: '#2c4444', rockLite: '#4d7370', rockDark: '#0f1c1c',
    mortar: '#081010', stoneLite: '#7aa89e',
    rim: 'rgba(165,255,230,0.32)', toothLite: 'rgba(90,150,135,0.45)',
  },
}

function themePal(theme: string | undefined): RoomPalette {
  return THEMES[theme ?? 'sandstone'] ?? THEMES['sandstone']
}

// ── deterministic noise + tiny math helpers ─────────────────

/** mulberry32 stream — stable per seed (baked textures never flicker). */
function sol_noise(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** One deterministic 0..1 from an integer (frame-path safe). */
function sol_hash(n: number): number {
  let x = n | 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

function sol_hash2(a: number, b: number): number { return sol_hash(a * 73856093 ^ b * 19349663) }

/** Lighten (t>0) / darken (t<0) a #rrggbb toward white / black. */
function sol_shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  if (t >= 0) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t }
  else { r *= 1 + t; g *= 1 + t; b *= 1 + t }
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

function easeOutBack(p: number): number {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── glow sprites: the shadowBlur replacement ────────────────

const GLOWS = new Map<string, HTMLCanvasElement>()

/** A cached 128px radial glow (white-hot core → color → transparent). Draw it
 *  with `globalCompositeOperation='lighter'` + alpha — never shadowBlur. */
export function glowSprite(color: string): HTMLCanvasElement {
  let cv = GLOWS.get(color)
  if (cv) return cv
  cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const x = cv.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.25, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  x.globalAlpha = 0.9
  x.fillStyle = g
  x.fillRect(0, 0, 128, 128)
  GLOWS.set(color, cv)
  return cv
}

/** Additive glow blit centered at (x, y) with radius r. */
function glow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, alpha: number): void {
  if (alpha <= 0.004 || r <= 0) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2)
  ctx.restore()
}

// ── module-level bakes (static across every room) ───────────

let BRICK_VARIANTS: HTMLCanvasElement[] | null = null
let CRACK_VARIANTS: HTMLCanvasElement[] | null = null
const WALL_SETS = new Map<string, HTMLCanvasElement[]>()   // per-theme ashlar variants

/** The conjurable block: a carved, framed panel with a proud bevel + rivets.
 *  Three variants (rivets + grain shift) kill the wallpaper repeat. */
function bakeBrick(variant: number, cracked: boolean): HTMLCanvasElement {
  const s = TILE
  const cv = document.createElement('canvas')
  cv.width = cv.height = s * TEX
  const x = cv.getContext('2d')!
  x.scale(TEX, TEX)
  const rnd = sol_noise(0x9b1 + variant * 77)
  const face = x.createLinearGradient(0, 0, s, s)
  face.addColorStop(0, C.orangeLite); face.addColorStop(0.55, C.orange); face.addColorStop(1, C.orangeDark)
  x.fillStyle = face; x.fillRect(0, 0, s, s)
  // mottled kiln grain
  for (let i = 0; i < 26; i++) {
    const d = rnd() - 0.5
    x.fillStyle = d > 0 ? `rgba(255,220,160,${d * 0.22})` : `rgba(70,30,4,${-d * 0.3})`
    x.fillRect((rnd() * (s - 2)) | 0, (rnd() * (s - 2)) | 0, 1.6, 1.6)
  }
  // proud cube bevel
  x.fillStyle = 'rgba(255,228,158,0.6)'; x.fillRect(0, 0, s, 2); x.fillRect(0, 0, 2, s)
  x.fillStyle = 'rgba(54,24,2,0.6)'; x.fillRect(0, s - 2, s, 2); x.fillRect(s - 2, 0, 2, s)
  // inset frame groove + inner sheen
  const f = 4.5
  x.strokeStyle = 'rgba(70,30,4,0.75)'; x.lineWidth = 1; x.strokeRect(f, f, s - 2 * f, s - 2 * f)
  x.strokeStyle = 'rgba(255,214,148,0.35)'; x.strokeRect(f + 1, f + 1, s - 2 * f - 2, s - 2 * f - 2)
  const sheen = x.createRadialGradient(s * 0.38, s * 0.34, 1, s * 0.5, s * 0.5, s * 0.62)
  sheen.addColorStop(0, 'rgba(255,224,152,0.32)'); sheen.addColorStop(1, 'rgba(255,180,90,0)')
  x.fillStyle = sheen; x.fillRect(f + 1, f + 1, s - 2 * f - 2, s - 2 * f - 2)
  // forged rivets, nudged per variant
  x.fillStyle = 'rgba(58,26,2,0.65)'
  const nud = (variant - 1) * 0.7
  for (const [cx, cy] of [[f + 2 + nud, f + 2], [s - f - 2, f + 2 + nud], [f + 2, s - f - 2 - nud], [s - f - 2 - nud, s - f - 2]]) {
    x.beginPath(); x.arc(cx, cy, 1, 0, Math.PI * 2); x.fill()
  }
  if (cracked) {
    x.strokeStyle = 'rgba(40,16,0,0.85)'; x.lineWidth = 1.6
    const j = variant * 1.3
    x.beginPath(); x.moveTo(s * 0.5 + j, 2); x.lineTo(s * 0.42, s * 0.4); x.lineTo(s * 0.6 - j, s * 0.6); x.lineTo(s * 0.5, s - 2); x.stroke()
    x.beginPath(); x.moveTo(s * 0.42, s * 0.4); x.lineTo(s * 0.18, s * 0.5 + j); x.stroke()
    x.beginPath(); x.moveTo(s * 0.6 - j, s * 0.6); x.lineTo(s * 0.84, s * 0.52); x.stroke()
  }
  return cv
}

/** Castle stone: running-bond ashlar with mottled grain + hairline cracks,
 *  cut in the room's theme palette. */
function bakeWallTile(variant: number, pal: RoomPalette): HTMLCanvasElement {
  const s = TILE
  const cv = document.createElement('canvas')
  cv.width = cv.height = s * TEX
  const x = cv.getContext('2d')!
  x.scale(TEX, TEX)
  const rnd = sol_noise(0x2a17 + variant * 131)
  x.fillStyle = pal.mortar; x.fillRect(0, 0, s, s)
  const ch = s / 2, sw = s / 2, m = 1.5
  const grainLite = sol_shade(pal.stoneLite, 0.15)
  for (let course = 0; course < 2; course++) {
    const oy = course * ch
    for (let sx = course === 1 ? -sw / 2 : 0; sx < s; sx += sw) {
      const rx = sx + m, ry = oy + m, rw = sw - m * 2, rh = ch - m * 2
      const g = x.createLinearGradient(0, ry, 0, ry + rh)
      g.addColorStop(0, pal.rockLite); g.addColorStop(1, pal.rock)
      x.fillStyle = g; x.fillRect(rx, ry, rw, rh)
      for (let k = (rw * rh) >> 4; k > 0; k--) {
        const d = rnd() - 0.5
        x.globalAlpha = Math.abs(d) * (d > 0 ? 0.3 : 0.4)
        x.fillStyle = d > 0 ? grainLite : '#000'
        x.fillRect(rx + (rnd() * rw | 0), ry + (rnd() * rh | 0), 2, 2)
        x.globalAlpha = 1
      }
      x.fillStyle = pal.stoneLite; x.fillRect(rx, ry, rw, 1); x.fillRect(rx, ry, 1, rh)
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(rx, ry + rh - 1, rw, 1); x.fillRect(rx + rw - 1, ry, 1, rh)
      if (rnd() < 0.4) {
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

function brickVariant(c: number, r: number, cracked: boolean): HTMLCanvasElement {
  BRICK_VARIANTS ??= [bakeBrick(0, false), bakeBrick(1, false), bakeBrick(2, false)]
  CRACK_VARIANTS ??= [bakeBrick(0, true), bakeBrick(1, true), bakeBrick(2, true)]
  const i = (sol_hash2(c, r) * 3) | 0
  return (cracked ? CRACK_VARIANTS : BRICK_VARIANTS)[Math.min(2, i)]
}

// ── the renderer ────────────────────────────────────────────

interface Torch { x: number; y: number; dir: number }

/** Structural view of a foe — the designer synthesizes partial ones, so every
 *  machine-state read stays optional. */
interface FoeView {
  kind: string; x: number; y: number; w: number; h: number
  alive: boolean; squash: number; dir: number; anim: number
  state?: string; telegraph?: number; ttl?: number; fireCd?: number
}

export class Renderer {
  #ctx: CanvasRenderingContext2D

  // room bakes + their invalidation key
  #backdrop: HTMLCanvasElement | null = null
  #backdropKey = ''
  #wallLayer: HTMLCanvasElement | null = null
  #wallMask: Uint8Array | null = null
  #wallTheme = ''
  #torches: Torch[] = []

  // lighting orchestration
  #pulse = 1
  #spikeV = 0
  #lastT = 0

  // per-engine animation state (reset when the engine ref changes)
  #forEngine: unknown = null
  #doorAnim = 0
  #punchLand = 0
  #punchHurt = 0
  #scorePop = 0
  #prevScore = -1

  // HUD caches
  #hudPanel: HTMLCanvasElement | null = null
  #hudPanelW = 0
  #vignette: HTMLCanvasElement | null = null
  #vignetteKey = ''

  constructor(ctx: CanvasRenderingContext2D) { this.#ctx = ctx }

  /** Event light-flare: everything glowing flares briefly, then bleeds off. */
  spike(amount: number): void { this.#spikeV = Math.min(2.2, this.#spikeV + amount) }

  /** Impact envelopes the overlay drives (landing squash, hurt tint). */
  punch(kind: 'land' | 'hurt', k = 1): void {
    if (kind === 'land') this.#punchLand = Math.min(1.4, Math.max(this.#punchLand, k))
    else this.#punchHurt = 1
  }

  // ── play view ────────────────────────────────────────────

  drawWorld(e: Engine, time: number): void {
    const ctx = this.#ctx
    const dt = this.#syncFrame(e, time)
    this.#ensureBakes(e.grid, e.cols, e.rows, e.level.theme ?? 'sandstone')
    const pulse = this.#pulse

    if (e.doorOpen) this.#doorAnim = Math.min(1, this.#doorAnim + dt * 1.6)

    if (this.#backdrop) ctx.drawImage(this.#backdrop, 0, 0)
    bg_motes(ctx, e.width, e.height, time, pulse)
    if (this.#wallLayer) ctx.drawImage(this.#wallLayer, 0, 0, e.width, e.height)
    room_bricks(ctx, e.grid, e.cols, e.rows, pulse)
    light_pools(ctx, this.#torches, time, pulse, e.level.door, this.#doorAnim)
    torch_fixtures(ctx, this.#torches, time)

    for (const m of e.mirrors) prop_mirror(ctx, m.col, m.row, time, pulse, m.telegraph ?? 0)
    prop_door(ctx, e.level.door.col, e.level.door.row, this.#doorAnim, time, pulse)

    for (const it of e.items) {
      if (it.taken) continue
      if (it.hidden) { if (it.secret) fx_secretHint(ctx, it.col, it.row, time); continue }
      item_draw(ctx, it.kind, it.col, it.row, time, pulse, it.reveal, false)
    }
    for (const f of e.fairies) if (!f.taken) item_fairy(ctx, f.x, f.y, time, pulse)

    for (const en of e.enemies) actor_enemy(ctx, en as FoeView, time, pulse, e.player.x + e.player.w / 2, e.player.y + e.player.h / 2)
    actor_dana(ctx, e, time, this.#punchLand, this.#punchHurt)

    for (const f of e.fireballs) proj_fireball(ctx, f, time, pulse)
    for (const s of e.shots) proj_shot(ctx, s, time, pulse)
    fx_wandTarget(ctx, e, pulse)
  }

  drawHud(e: Engine, time: number, viewW: number, viewH: number): void {
    const ctx = this.#ctx
    // warm vignette framing the viewport (cached, screen-space)
    const vKey = `${viewW}x${viewH}`
    if (this.#vignetteKey !== vKey) {
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, viewW); cv.height = Math.max(1, viewH)
      const x = cv.getContext('2d')!
      const vg = x.createRadialGradient(viewW / 2, viewH * 0.5, viewH * 0.36, viewW / 2, viewH * 0.5, viewH * 0.82)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,4,0,0.5)')
      x.fillStyle = vg; x.fillRect(0, 0, viewW, viewH)
      this.#vignette = cv
      this.#vignetteKey = vKey
    }
    if (this.#vignette) ctx.drawImage(this.#vignette, 0, 0)

    // score pop envelope
    if (this.#prevScore >= 0 && e.score > this.#prevScore) this.#scorePop = 1
    this.#prevScore = e.score
    this.#scorePop = Math.max(0, this.#scorePop - 0.06)

    hud_bar(ctx, e, time, viewW, this.#panel(viewW), this.#scorePop, this.#pulse)

    if (e.hurtFlash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${0.35 * (e.hurtFlash / 0.5)})`
      ctx.fillRect(0, 0, viewW, viewH)
    }
  }

  // ── designer view ────────────────────────────────────────

  drawEditor(level: LevelDef, hover: { col: number; row: number } | null, time: number): void {
    const ctx = this.#ctx
    const w = level.cols * TILE, h = level.rows * TILE
    this.#syncFrame(level, time)
    this.#ensureBakes(level.tiles, level.cols, level.rows, level.theme ?? 'sandstone')
    const pulse = this.#pulse

    if (this.#backdrop) ctx.drawImage(this.#backdrop, 0, 0)
    bg_motes(ctx, w, h, time, pulse)
    if (this.#wallLayer) ctx.drawImage(this.#wallLayer, 0, 0, w, h)
    room_bricks(ctx, level.tiles, level.cols, level.rows, pulse)
    light_pools(ctx, this.#torches, time, pulse, level.door, 0)
    torch_fixtures(ctx, this.#torches, time)

    for (const m of level.mirrors) prop_mirror(ctx, m.col, m.row, time, pulse, 0)
    prop_door(ctx, level.door.col, level.door.row, 0, time, pulse)
    for (const it of level.items) item_draw(ctx, it.kind, it.col, it.row, time, pulse, 0, !!it.hidden)
    for (const en of level.enemies) {
      const d: Record<string, { w: number; h: number }> = {
        goblin: { w: 0.72, h: 0.84 }, gargoil: { w: 0.78, h: 0.82 }, dragon: { w: 0.86, h: 0.78 },
        saramandor: { w: 0.7, h: 0.74 }, ghost: { w: 0.74, h: 0.74 }, neul: { w: 0.66, h: 0.66 },
        sparkball: { w: 0.58, h: 0.58 }, demonhead: { w: 0.6, h: 0.6 }, panel: { w: 0.9, h: 0.9 },
      }
      const kind = en.kind ?? 'goblin'
      const m = d[kind] ?? d['goblin']
      const ew = TILE * m.w, eh = TILE * m.h
      actor_enemy(ctx, {
        kind, x: en.col * TILE + (TILE - ew) / 2, y: en.row * TILE + (TILE - eh), w: ew, h: eh,
        alive: true, squash: 0, dir: en.dir ?? 1, anim: time * 60,
      }, time, pulse, en.col * TILE - TILE * 2, en.row * TILE)
    }
    // spawn marker
    ctx.strokeStyle = 'rgba(120,220,160,0.9)'; ctx.lineWidth = 2
    ctx.strokeRect(level.player.col * TILE + 3, level.player.row * TILE + 3, TILE - 6, TILE - 6)
    ctx.fillStyle = 'rgba(120,220,160,0.9)'
    ctx.font = `${Math.floor(TILE * 0.5)}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('P', level.player.col * TILE + TILE / 2, level.player.row * TILE + TILE / 2 + 1)

    // grid + hover
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

  // ── orchestration ────────────────────────────────────────

  /** Advance the frame clock, decay envelopes, compute the shared pulse.
   *  Resets per-engine anim state when the engine/level ref changes. */
  #syncFrame(owner: unknown, time: number): number {
    const dt = Math.max(0, Math.min(0.1, time - this.#lastT))
    this.#lastT = time
    if (this.#forEngine !== owner) {
      this.#forEngine = owner
      this.#doorAnim = 0
      this.#punchLand = this.#punchHurt = 0
      this.#scorePop = 0
      this.#prevScore = -1
    }
    this.#spikeV = Math.max(0, this.#spikeV - this.#spikeV * 3.2 * dt - 0.02 * dt)
    this.#punchLand = Math.max(0, this.#punchLand - dt * 4.5)
    this.#punchHurt = Math.max(0, this.#punchHurt - dt * 6)
    const slow = Math.sin(time * 2.1) * 0.31
    const flutter = Math.sin(time * 11.3) * 0.13
    const stutter = (sol_hash(Math.floor(time * 8)) - 0.5) * 0.12
    this.#pulse = Math.max(0.45, Math.min(1, 0.72 + slow + flutter + stutter)) + this.#spikeV * 0.5
    return dt
  }

  /** Rebuild the backdrop + lit wall layer when the WALL mask OR the theme
   *  changes (level load, designer wall paints). Conjure/dispel never touches
   *  WALL cells, so gameplay frames only pay a tiny byte-compare. */
  #ensureBakes(grid: ArrayLike<number>, cols: number, rows: number, theme: string): void {
    const n = cols * rows
    const pal = themePal(theme)
    let dirty = !this.#wallMask || this.#wallMask.length !== n || this.#wallTheme !== theme
    if (!dirty) {
      const m = this.#wallMask!
      for (let i = 0; i < n; i++) {
        if ((grid[i] === WALL ? 1 : 0) !== m[i]) { dirty = true; break }
      }
    }
    const bKey = `${cols}x${rows}:${theme}`
    if (this.#backdropKey !== bKey) {
      this.#backdrop = bakeBackdrop(cols * TILE, rows * TILE, pal)
      this.#backdropKey = bKey
    }
    if (!dirty) return
    const mask = new Uint8Array(n)
    for (let i = 0; i < n; i++) mask[i] = grid[i] === WALL ? 1 : 0
    this.#wallMask = mask
    this.#wallTheme = theme
    this.#wallLayer = bakeWallLayer(mask, cols, rows, pal, theme)
    this.#torches = findTorches(mask, cols, rows)
  }

  #panel(viewW: number): HTMLCanvasElement {
    if (this.#hudPanel && this.#hudPanelW === viewW) return this.#hudPanel
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, viewW); cv.height = HUD_H
    const x = cv.getContext('2d')!
    const g = x.createLinearGradient(0, 0, 0, HUD_H)
    g.addColorStop(0, 'rgba(12,8,4,0.88)'); g.addColorStop(1, 'rgba(24,14,6,0.82)')
    x.fillStyle = g; x.fillRect(0, 0, viewW, HUD_H)
    x.fillStyle = 'rgba(255,178,74,0.35)'; x.fillRect(0, HUD_H - 1, viewW, 1)
    // faint torch bleed in the corners
    for (const cx of [0, viewW]) {
      const rg = x.createRadialGradient(cx, 0, 0, cx, 0, HUD_H * 2.2)
      rg.addColorStop(0, 'rgba(255,170,80,0.10)'); rg.addColorStop(1, 'rgba(255,170,80,0)')
      x.fillStyle = rg; x.fillRect(0, 0, viewW, HUD_H)
    }
    this.#hudPanel = cv
    this.#hudPanelW = viewW
    return cv
  }
}

// ── room bakes ──────────────────────────────────────────────

/** The static backdrop: themed depth gradient, two value-noise vault-arch
 *  ridge silhouettes, a floor-glow band, and a wash of static dust. */
function bakeBackdrop(w: number, h: number, pal: RoomPalette): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, w); cv.height = Math.max(1, h)
  const x = cv.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, pal.bgTop); g.addColorStop(0.65, pal.bgMid); g.addColorStop(1, pal.bgBot)
  x.fillStyle = g
  x.fillRect(0, 0, w, h)
  // distant vault arches — two dark ridge silhouettes
  for (const [base, amp, tone, seed] of [[0.52, 0.16, pal.archNear, 3], [0.7, 0.12, pal.archFar, 9]] as const) {
    x.fillStyle = tone
    x.beginPath()
    x.moveTo(0, h)
    for (let px = 0; px <= w; px += 8) {
      const k = px / 90
      const y = h * base - (Math.sin(k + seed) * 0.5 + Math.sin(k * 2.7 + seed * 2) * 0.3 + sol_hash(px + seed * 999) * 0.2) * h * amp
      x.lineTo(px, y)
    }
    x.lineTo(w, h)
    x.closePath()
    x.fill()
  }
  // glow rising from the depths
  const fg = x.createLinearGradient(0, h * 0.72, 0, h)
  fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, pal.floorGlow)
  x.fillStyle = fg; x.fillRect(0, h * 0.72, w, h * 0.28)
  // static dust wash, tinted by the theme's light
  const rnd = sol_noise(0x5eed)
  const dust = sol_shade(pal.stoneLite, 0.3)
  for (let i = 0; i < Math.max(30, (w * h) / 16000); i++) {
    x.globalAlpha = 0.03 + rnd() * 0.05
    x.fillStyle = dust
    x.fillRect((rnd() * w) | 0, (rnd() * h) | 0, 1.5, 1.5)
  }
  x.globalAlpha = 1
  return cv
}

/** The lit WALL terrain, baked at WALL_S×: ashlar tile variants, then a light
 *  pass (top rim highlights, dark undersides, soft drop shadows into the open
 *  cells) and the organic cavern-rim teeth. */
function bakeWallLayer(mask: Uint8Array, cols: number, rows: number, pal: RoomPalette, theme: string): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, cols * TILE * WALL_S)
  cv.height = Math.max(1, rows * TILE * WALL_S)
  const x = cv.getContext('2d')!
  x.scale(WALL_S, WALL_S)
  let variants = WALL_SETS.get(theme)
  if (!variants) {
    variants = [bakeWallTile(0, pal), bakeWallTile(1, pal), bakeWallTile(2, pal)]
    WALL_SETS.set(theme, variants)
  }
  const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 || r >= rows) ? 1 : mask[r * cols + c]

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(c, r)) continue
      const v = variants[(sol_hash2(c, r) * 3) | 0] ?? variants[0]
      x.drawImage(v, c * TILE, r * TILE, TILE, TILE)
    }
  }

  // light pass — top-lit bias in the theme's light
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(c, r)) continue
      const px = c * TILE, py = r * TILE
      if (!at(c, r - 1)) {   // open above → rim highlight
        const g = x.createLinearGradient(0, py, 0, py + 5)
        g.addColorStop(0, pal.rim); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g; x.fillRect(px, py, TILE, 5)
      }
      if (!at(c, r + 1)) {   // open below → dark underside + soft shadow into the room
        x.fillStyle = 'rgba(0,0,0,0.32)'; x.fillRect(px, py + TILE - 3, TILE, 3)
        const g = x.createLinearGradient(0, py + TILE, 0, py + TILE + 9)
        g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)')
        x.fillStyle = g; x.fillRect(px, py + TILE, TILE, 9)
      }
      if (!at(c - 1, r)) { x.globalAlpha = 0.25; x.fillStyle = pal.rim; x.fillRect(px, py, 2, TILE); x.globalAlpha = 1 }
      if (!at(c + 1, r)) { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(px + TILE - 2, py, 2, TILE) }
    }
  }

  // organic rock teeth on every rock↔open edge (baked — was per-frame before)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(c, r)) continue
      const px = c * TILE, py = r * TILE
      const rnd = sol_noise(((c + 1) * 73856093) ^ ((r + 1) * 19349663))
      if (!at(c, r + 1)) teeth(x, px, py + TILE, TILE, true, 1, rnd, pal)
      if (!at(c, r - 1)) teeth(x, px, py, TILE, true, -1, rnd, pal)
      if (!at(c - 1, r)) teeth(x, py, px, TILE, false, -1, rnd, pal)
      if (!at(c + 1, r)) teeth(x, py, px + TILE, TILE, false, 1, rnd, pal)
    }
  }
  return cv
}

function teeth(x: CanvasRenderingContext2D, a: number, edge: number, span: number, horiz: boolean, dir: number, rnd: () => number, pal: RoomPalette): void {
  for (let i = 0; i < 2; i++) {
    const p = a + (i + 0.2 + rnd() * 0.5) * (span / 2)
    const len = TILE * (horiz ? 0.16 + rnd() * 0.22 : 0.1 + rnd() * 0.14)
    const half = 2 + rnd() * 2.4
    x.fillStyle = pal.rockDark
    x.beginPath()
    if (horiz) { x.moveTo(p - half, edge); x.lineTo(p + half, edge); x.lineTo(p, edge + dir * len) }
    else { x.moveTo(edge, p - half); x.lineTo(edge, p + half); x.lineTo(edge + dir * len, p) }
    x.closePath(); x.fill()
    x.fillStyle = pal.toothLite
    x.beginPath()
    if (horiz) { x.moveTo(p - half, edge); x.lineTo(p - half + 1.5, edge); x.lineTo(p, edge + dir * len * 0.6) }
    else { x.moveTo(edge, p - half); x.lineTo(edge, p - half + 1.5); x.lineTo(edge + dir * len * 0.6, p) }
    x.closePath(); x.fill()
  }
}

/** Sparse deterministic torch mounts on WALL faces beside open cells — keyed to
 *  the WALL mask only, so conjured bricks never move a torch. */
function findTorches(mask: Uint8Array, cols: number, rows: number): Torch[] {
  const at = (c: number, r: number) => (c < 0 || c >= cols || r < 0 || r >= rows) ? 1 : mask[r * cols + c]
  const out: Torch[] = []
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (!at(c, r)) continue
      const openR = !at(c + 1, r), openL = !at(c - 1, r)
      if (!openR && !openL) continue
      if ((c * 7 + r * 5) % 6 !== 0) continue
      const dir = openR ? 1 : -1
      out.push({ x: dir > 0 ? (c + 1) * TILE + TILE * 0.16 : c * TILE - TILE * 0.16, y: r * TILE + TILE * 0.42, dir })
    }
  }
  return out
}

// ── frame layers ────────────────────────────────────────────

/** Drifting ember motes — deterministic per-index paths, alpha rides the pulse. */
function bg_motes(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, pulse: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const speed = 3 + (i % 4)
    const px = ((i * 97.13) % w + Math.sin(time * 0.3 + i * 1.7) * 7 + w) % w
    const py = (((i * 57.3) - time * speed) % h + h) % h
    ctx.globalAlpha = (0.05 + sol_hash(i) * 0.1) * pulse
    ctx.fillStyle = '#ffc478'
    ctx.fillRect(px | 0, py | 0, 2, 2)
  }
  ctx.restore()
}

/** Live BRICK/CRACKED cells from the baked variants + an additive top sheen. */
function room_bricks(ctx: CanvasRenderingContext2D, grid: ArrayLike<number>, cols: number, rows: number, pulse: number): void {
  ctx.save()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r * cols + c]
      if (t !== BRICK && t !== CRACKED) continue
      ctx.drawImage(brickVariant(c, r, t === CRACKED), c * TILE, r * TILE, TILE, TILE)
    }
  }
  // one additive pass: a faint warm sheen along brick tops so they sit in the torchlight
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.07 * pulse
  ctx.fillStyle = C.TORCH
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r * cols + c]
      if (t !== BRICK && t !== CRACKED) continue
      ctx.fillRect(c * TILE + 2, r * TILE + 1, TILE - 4, 3)
    }
  }
  ctx.restore()
}

/** ONE additive batch of warm light pools: every torch + the open door spill. */
function light_pools(
  ctx: CanvasRenderingContext2D, torches: Torch[], time: number, pulse: number,
  door: { col: number; row: number }, doorAnim: number,
): void {
  for (const t of torches) {
    const flick = 0.82 + Math.sin(time * 9 + t.x * 0.7) * 0.12 + Math.sin(time * 23 + t.y) * 0.05
    glow(ctx, C.TORCH, t.x, t.y, TILE * 4.2 * flick, 0.4 * flick * pulse)
  }
  if (doorAnim > 0) {
    glow(ctx, C.DOOR_GOLD, door.col * TILE + TILE / 2, door.row * TILE + TILE / 2, TILE * 3 * doorAnim, 0.5 * doorAnim * pulse)
  }
}

/** The sconces + layered teardrop flames + two rising embers per torch. */
function torch_fixtures(ctx: CanvasRenderingContext2D, torches: Torch[], time: number): void {
  for (const t of torches) {
    ctx.fillStyle = '#3a2a18'
    ctx.fillRect(Math.round(t.dir > 0 ? t.x - TILE * 0.18 : t.x + TILE * 0.18 - 3), Math.round(t.y + 2), 3, 6)
    const flick = Math.sin(time * 12 + t.x) * 1.4 + Math.sin(time * 7 + t.y) * 0.8
    const fx = t.x, fy = t.y - 2
    ctx.fillStyle = C.TORCH
    ctx.beginPath(); ctx.ellipse(fx, fy, 3.2, 6 + flick, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffe1a6'
    ctx.beginPath(); ctx.ellipse(fx, fy + 1, 1.6, 3.4 + flick * 0.6, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff7e0'
    ctx.beginPath(); ctx.arc(fx, fy + 2, 1.1, 0, Math.PI * 2); ctx.fill()
    // rising embers on deterministic loops
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 2; i++) {
      const ph = ((time * (0.5 + i * 0.23) + sol_hash((t.x + i * 31) | 0)) % 1)
      ctx.globalAlpha = (1 - ph) * 0.5
      ctx.fillStyle = C.EMBER
      ctx.fillRect(fx + Math.sin((ph * 5 + i) * 3) * 3, fy - 4 - ph * 16, 1.6, 1.6)
    }
    ctx.restore()
  }
}

// ── shared actor helpers ────────────────────────────────────

function contactShadow(ctx: CanvasRenderingContext2D, cx: number, footY: number, w: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.beginPath(); ctx.ellipse(cx, footY, w * 0.55, 3, 0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** Per-entity blink: 0 open → 1 closed, on a hash-offset ~3s cycle. */
function blink(time: number, seed: number): number {
  const cycle = 2.6 + sol_hash(seed) * 2.4
  const ph = (time + sol_hash(seed + 7) * cycle) % cycle
  return ph < 0.11 ? 1 - Math.abs(ph / 0.055 - 1) : 0
}

/** A gradient-lit rounded body: base lit upper-left, shaded lower-right, with a
 *  dark contour. The house recipe every foe builds on. */
function shadedBody(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, r: number): void {
  const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h)
  g.addColorStop(0, sol_shade(base, 0.35))
  g.addColorStop(0.5, base)
  g.addColorStop(1, sol_shade(base, -0.45))
  ctx.fillStyle = g
  rr(ctx, x, y, w, h, r)
  ctx.fill()
  ctx.strokeStyle = sol_shade(base, -0.62)
  ctx.lineWidth = 1.2
  rr(ctx, x + 0.6, y + 0.6, w - 1.2, h - 1.2, r)
  ctx.stroke()
  // rim light along the top-left
  ctx.strokeStyle = 'rgba(255,220,170,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + r, y + 1)
  ctx.lineTo(x + w * 0.62, y + 1)
  ctx.stroke()
}

// ── Dana ────────────────────────────────────────────────────

function actor_dana(ctx: CanvasRenderingContext2D, e: Engine, time: number, punchLand: number, punchHurt: number): void {
  const p = e.player
  const f = (e.facing ?? 1) as 1 | -1
  const anim: string = e.playerAnim ?? 'idle'
  const w = p.w, h = p.h
  const cx = p.x + w / 2
  const footY = p.y + h
  const top = p.y
  const duck = !!e.ducking
  const grounded = !!e.onGround
  const vx = p.vx ?? 0, vy = p.vy ?? 0
  let speed01 = dana_clamp(Math.abs(vx) / 105, 0, 1)
  if (anim === 'run' && e.walking && speed01 < 0.35) speed01 = 0.35

  const cj = e.conjureFlash ?? 0
  const casting = cj > 0
  const kf = casting ? Math.min(1, cj / 0.18) : 0
  const wince = punchHurt > 0.25 || (e.hurtFlash ?? 0) > 0.2

  // aim cell — both the cast line and the idle "sizing up the next block" glance
  const tc = e.targetCell()
  const txW = tc.col * TILE + TILE / 2
  const tyW = tc.row * TILE + TILE / 2

  // two-phase cast: first ~30% of the flash the arm cocks BACK (anticipation),
  // then it snaps through toward the target with a hair of overshoot.
  const pullT = casting ? (kf > 0.7 ? (1 - kf) / 0.3 : 1) : 0
  const castQ = casting && kf <= 0.7 ? easeOutBack(Math.min(1, (0.7 - kf) / 0.42)) : 0

  // ── volume-conserving squash, always anchored at the feet ──
  let k = 0
  switch (anim) {
    case 'jump': k = Math.min(0.14, Math.max(0, -vy) / 2600); break
    case 'fall': k = Math.min(0.10, Math.max(0, vy) / 5600); break
    case 'land': k = -0.20 * punchLand; break
    case 'apex': k = 0.035; break
    case 'idle':
    case 'duck': k = 0.02 * Math.sin(time * 2.6); break            // breathing
    default: break
  }
  if (casting) k -= 0.05 * pullT * (1 - castQ)                     // dip into the cast
  const scaleY = Math.max(0.72, 1 + k)
  const scaleX = 1 / scaleY

  let rot = 0
  switch (anim) {
    case 'run': rot = f * 0.11 * speed01; break                    // ~6–7° forward lean
    case 'duckWalk': rot = f * 0.06; break
    case 'skid': rot = -f * 0.18; break                            // thrown back hard
    case 'jump': rot = f * 0.05; break
    case 'fall': rot = -f * 0.03; break
    default: break
  }
  if (casting) rot += f * 0.06 * castQ

  contactShadow(ctx, cx, footY, w * (grounded ? 1 : 0.7) * (1 + (1 - scaleY) * 0.8))

  // hat-tip spring: lag ∝ −velocity, takeoff flicks, idle micro-wobble
  const hatLift = anim === 'jump' ? 2.2 : anim === 'apex' ? 1.2 : anim === 'fall' ? -0.8 : 0
  dana_tipSpring(
    time,
    dana_clamp(-vx * 0.034, -5.5, 5.5) + (anim === 'idle' ? Math.sin(time * 1.6) * 0.5 : 0),
    dana_clamp(-vy * 0.013, -4.5, 4.5),
  )
  const tdx = dana_tipX, tdy = dana_tipY

  const jx = punchHurt > 0.01 ? (sol_hash(Math.floor(time * 60) | 0) - 0.5) * 2.2 * punchHurt : 0
  ctx.save()
  ctx.translate(cx + jx, footY)
  ctx.scale(scaleX, scaleY)
  ctx.rotate(rot)
  ctx.translate(-cx, -footY)

  // ── skeleton anchors ──
  const ph = p.x / 7                                               // stride phase — feet plant
  const stepA = Math.sin(ph)
  const cosA = Math.cos(ph)
  const striding = anim === 'run' || anim === 'duckWalk'
  const lift = grounded && striding ? Math.abs(cosA) * 1.15 * speed01 : 0   // bob at 2× stride
  const swayU = anim === 'idle' ? Math.sin(time * 0.7) * 0.5 : 0   // idle weight-shift
  const ux = cx + swayU

  const rH = w * 0.33
  const headY = top + h * (duck ? 0.40 : 0.28) - lift
  const robeTop = top + h * (duck ? 0.52 : 0.42) - lift
  const shW = w * 0.30
  const beltY = top + h * (duck ? 0.68 : 0.585) - lift * 0.8
  const hipY = footY - h * (duck ? 0.24 : 0.32)

  // ── feet + legs (drawn first — the robe overlaps the thighs) ──
  const amp = (anim === 'duckWalk' ? 3.2 : 4.8) * speed01
  let fAx = cx - 4.3, fAy = footY, fAt = 0
  let fBx = cx + 4.3, fBy = footY, fBt = 0
  switch (anim) {
    case 'run':
    case 'duckWalk': {
      const liftA = Math.max(0, cosA) * 3.0 * speed01
      const liftB = Math.max(0, -cosA) * 3.0 * speed01
      fAx = cx - f * 1.4 + stepA * amp; fAy = footY - liftA; fAt = f * stepA * 0.18
      fBx = cx + f * 1.4 - stepA * amp; fBy = footY - liftB; fBt = -f * stepA * 0.18
      break
    }
    case 'skid':                                                    // front foot braced
      fAx = cx + f * 6.0; fAy = footY; fAt = -f * 0.3
      fBx = cx - f * 3.4; fBy = footY - 0.6; fBt = f * 0.12
      break
    case 'jump':                                                    // legs tucked
      fAx = cx - f * 0.6 - 3.2; fAy = footY - 4.6; fAt = f * 0.28
      fBx = cx + f * 1.2 + 2.6; fBy = footY - 2.8; fBt = f * 0.16
      break
    case 'apex':                                                    // the hang
      fAx = cx - 3.8; fAy = footY - 3.4; fAt = f * 0.2
      fBx = cx + 3.8; fBy = footY - 2.4; fBt = f * 0.12
      break
    case 'fall':                                                    // trailing up
      fAx = cx - f * 3.6; fAy = footY - 3.6; fAt = -f * 0.15
      fBx = cx + f * 2.6; fBy = footY - 1.4; fBt = -f * 0.05
      break
    case 'land': {                                                  // feet wide
      const wide = 4.3 + 2.4 * Math.min(1, punchLand)
      fAx = cx - wide; fBx = cx + wide
      break
    }
    case 'duck':
      fAx = cx - 4.9; fBx = cx + 4.9
      break
    default: break
  }
  const tuck = anim === 'jump' ? 2.6 : anim === 'apex' ? 1.6 : 0
  ctx.lineCap = 'round'
  ctx.strokeStyle = sol_shade(C.danaRobeDark, -0.34)
  ctx.lineWidth = 2.3
  ctx.beginPath()                                                  // knee thrown toward facing
  ctx.moveTo(cx - f * 1.8, hipY)
  ctx.quadraticCurveTo((cx - f * 1.8 + fAx) / 2 + f * (1.4 + tuck), (hipY + fAy) / 2 - 0.6, fAx, fAy - 1.2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + f * 1.8, hipY)
  ctx.quadraticCurveTo((cx + f * 1.8 + fBx) / 2 + f * (1.4 + tuck), (hipY + fBy) / 2 - 0.6, fBx, fBy - 1.2)
  ctx.stroke()
  dana_boot(ctx, fAx, fAy, f, fAt)
  dana_boot(ctx, fBx, fBy, f, fBt)

  // ── off-hand (behind the robe): fists up while running, out at apex ──
  const shBX = ux - f * shW * 0.85
  const shBY = robeTop + 2.4
  let obx: number, oby: number, obow = -f * 2.0, fist = false
  switch (anim) {
    case 'run':
    case 'duckWalk': {
      const swing = -stepA * 3.9 * speed01                          // counter-swing
      obx = shBX - f * 1.2 + swing; oby = beltY + 1.6 - Math.abs(swing) * 0.35
      obow = -f * (2.2 + Math.abs(swing) * 0.3); fist = true
      break
    }
    case 'skid': obx = shBX - f * 4.6; oby = robeTop - 2.6; obow = -f * 2.8; break
    case 'jump': obx = shBX - f * 2.0; oby = beltY - 0.4; obow = -f * 2.4; fist = true; break
    case 'apex': obx = ux - f * (shW + 4.6); oby = shBY + 1.2; obow = -f * 1.2; break
    case 'fall': obx = ux - f * (shW + 3.4); oby = shBY - 1.8; obow = -f * 1.0; break
    case 'land': obx = ux - f * (shW + 3.2); oby = beltY + 3.4; obow = -f * 1.6; break
    case 'duck': obx = shBX - f * 1.4; oby = beltY + 2.6; obow = -f * 2.2; break
    default: obx = shBX - f * 1.6 + Math.sin(time * 2.6) * 0.3; oby = beltY + 2.8; break
  }
  dana_arm(ctx, shBX, shBY, obx, oby, obow, -0.16)
  dana_hand(ctx, obx, oby, fist)

  // ── the robe ──
  const sway = dana_clamp(vx / 105, -1, 1) * 3 + (anim === 'skid' ? f * 3.5 : 0)   // hem thrown forward on the skid
  const hemLift = anim === 'jump' ? 7 : anim === 'apex' ? 5.4 : anim === 'run' ? 5 : anim === 'fall' ? 3 : 4.2
  const hemY = footY - (duck ? 2.6 : hemLift)
  const hemW = w * 0.50
    + (anim === 'fall' ? 2.6 : anim === 'apex' ? 1.2 : 0)
    + (anim === 'land' ? 1.8 * Math.min(1, punchLand) : 0)
  const scoop = (striding ? Math.sin(ph * 2) * 0.9 * speed01 : 0)
    + (anim === 'fall' ? -2.2 : anim === 'apex' ? -1.2 : 0)
    + (anim === 'land' ? 1.6 * Math.min(1, punchLand) : 0)

  const rg = ctx.createLinearGradient(cx - hemW, robeTop, cx + hemW * 0.7, footY)
  rg.addColorStop(0, sol_shade(C.danaRobe, 0.28))
  rg.addColorStop(0.5, C.danaRobe)
  rg.addColorStop(1, sol_shade(C.danaRobeDark, -0.22))
  ctx.fillStyle = rg
  dana_robePath(ctx, cx, swayU, robeTop, shW, hemW, hemY, sway, scoop)
  ctx.fill()
  // dark contour, then the warm torch rim up the left flank
  ctx.strokeStyle = sol_shade(C.danaRobeDark, -0.5)
  ctx.lineWidth = 1.1
  dana_robePath(ctx, cx, swayU, robeTop, shW, hemW, hemY, sway, scoop)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,205,150,0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - hemW + sway + 1.2, hemY - 1.2)
  ctx.quadraticCurveTo(ux - shW - 1.2 + sway * 0.35, (robeTop + hemY) / 2, ux - shW + 0.6, robeTop + 2.6)
  ctx.stroke()
  // hem: inner shadow band + a pale trim line that catches the torch
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = sol_shade(C.danaRobeDark, -0.35)
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(cx - hemW + sway + 1.6, hemY - 0.4)
  ctx.quadraticCurveTo(cx + sway * 0.5, hemY + 1.4 + scoop, cx + hemW + sway - 1.6, hemY - 0.4)
  ctx.stroke()
  ctx.globalAlpha = 0.8
  ctx.strokeStyle = sol_shade(C.danaRobe, 0.34)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - hemW + sway + 1.8, hemY - 1.8)
  ctx.quadraticCurveTo(cx + sway * 0.5, hemY + 0.2 + scoop, cx + hemW + sway - 1.8, hemY - 1.8)
  ctx.stroke()
  // collar trim + falling fold lines
  ctx.globalAlpha = 1
  ctx.strokeStyle = sol_shade(C.danaRobe, 0.42)
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(ux - shW * 0.78, robeTop + 2.2)
  ctx.quadraticCurveTo(ux, robeTop + 0.4, ux + shW * 0.78, robeTop + 2.2)
  ctx.stroke()
  ctx.globalAlpha = 0.6
  ctx.strokeStyle = sol_shade(C.danaRobe, -0.3)
  ctx.lineWidth = 0.9
  for (const o of [-2.8, 3.1]) {
    ctx.beginPath()
    ctx.moveTo(cx + o * 0.7, beltY + 1.5)
    ctx.quadraticCurveTo(cx + o + sway * 0.4, (beltY + hemY) / 2, cx + o * 1.5 + sway * 0.8, hemY - 1)
    ctx.stroke()
  }
  ctx.restore()
  // belt + gold buckle with a roving glint
  const bw = shW + (hemW - shW) * dana_clamp((beltY - robeTop) / Math.max(1, hemY - robeTop), 0, 1)
  ctx.fillStyle = sol_shade(C.danaRobeDark, -0.38)
  rr(ctx, cx - bw * 0.94, beltY - 1.3, bw * 1.88, 2.7, 1.2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,205,150,0.28)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.86, beltY - 1.2)
  ctx.lineTo(cx + bw * 0.86, beltY - 1.2)
  ctx.stroke()
  ctx.fillStyle = C.gold
  rr(ctx, cx - 1.8, beltY - 1.7, 3.6, 3.4, 0.8)
  ctx.fill()
  ctx.fillStyle = sol_shade(C.gold, -0.55)
  ctx.fillRect(cx - 0.8, beltY - 0.6, 1.6, 1.3)
  const glint = Math.max(0, Math.sin(time * 2.1 + 0.7))
  ctx.fillStyle = `rgba(255,255,235,${0.5 * glint})`
  ctx.fillRect(cx - 1.3, beltY - 1.2, 1.1, 1.1)
  // satchel strap over the wand shoulder, pouch on the far hip
  ctx.strokeStyle = '#6b4a24'
  ctx.lineWidth = 1.9
  ctx.beginPath()
  ctx.moveTo(ux + f * shW * 0.5, robeTop + 2.4)
  ctx.quadraticCurveTo(cx + f * 0.6, (robeTop + beltY) / 2 + 1, cx - f * bw * 0.72, beltY + 0.6)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,205,150,0.25)'
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.moveTo(ux + f * shW * 0.5, robeTop + 1.8)
  ctx.quadraticCurveTo(cx + f * 0.6, (robeTop + beltY) / 2 + 0.4, cx - f * bw * 0.72, beltY)
  ctx.stroke()
  const pxp = cx - f * (bw * 0.72 + 1.2)
  ctx.fillStyle = '#6b4a24'
  rr(ctx, pxp - 2.3, beltY + 0.8, 4.6, 3.6, 1.2)
  ctx.fill()
  ctx.fillStyle = sol_shade('#6b4a24', -0.3)
  rr(ctx, pxp - 2.3, beltY + 0.8, 4.6, 1.6, 1)
  ctx.fill()
  ctx.fillStyle = C.gold
  ctx.fillRect(pxp - 0.5, beltY + 2, 1, 1)
  // little gold star emblem on the chest
  ctx.save()
  ctx.globalAlpha = 0.9
  dana_star(ctx, ux + f * 0.2, robeTop + 5.2, 1.4, 0.3, C.gold)
  ctx.restore()

  // ── the face: gaze, blink, mood ──
  let lookX = f * 0.62, lookY = 0.10
  if (casting) {
    const dxT = txW - ux, dyT = tyW - headY
    const dl = Math.hypot(dxT, dyT) || 1
    lookX = dxT / dl
    lookY = (dyT / dl) * 0.8
  } else if (anim === 'idle' || anim === 'duck') {
    const gz = sol_hash(Math.floor(time / 1.9) * 13 + 5)
    if (gz > 0.62) {                                               // sizing up the next block
      const dxT = txW - ux, dyT = tyW - headY
      const dl = Math.hypot(dxT, dyT) || 1
      lookX = dxT / dl
      lookY = (dyT / dl) * 0.85
    } else if (gz < 0.16) { lookX = f * 0.25; lookY = -0.42 }      // wandering daydream
  } else if (anim === 'jump' || anim === 'apex') lookY = -0.25
  else if (anim === 'fall') lookY = 0.35

  const openK = wince ? 0 : 1 - blink(time, 11)
  let mood = 0
  if (wince || anim === 'skid') mood = 1
  else if (anim === 'land') mood = 3
  else if (anim === 'apex') mood = 2
  else if (casting) mood = 1
  let browK = 0
  if (wince || anim === 'skid' || casting) browK = 1
  else if (anim === 'run') browK = 0.7
  else if (anim === 'land') browK = 0.8
  else if (anim === 'apex') browK = -1
  else if (anim === 'fall') browK = -0.6
  else if (anim === 'jump') browK = -0.4

  dana_face(ctx, ux, headY, rH, f, lookX, lookY, openK, mood, browK)

  // ── the hat (drawn after the face so a ducked brim drops over the eye) ──
  const brimY = headY - (duck ? rH * 0.10 : rH * 0.52)
  const coneH = h * (duck ? 0.34 : 0.30) + hatLift
  const starPos = dana_hat(ctx, ux, brimY, w * 0.5, coneH, f, tdx, tdy - hatLift * 0.4, time)

  // ── wand arm on the facing side ──
  const shFX = ux + f * shW * 0.85
  const shFY = robeTop + 2.4
  let hwx: number, hwy: number, wbow = f * 1.9
  let wAng = f > 0 ? -0.52 : Math.PI + 0.52
  switch (anim) {
    case 'run':
    case 'duckWalk': {
      const swing = stepA * 2.8 * speed01
      hwx = shFX + f * 3.4 + swing; hwy = beltY - 0.4 - Math.abs(swing) * 0.2
      wAng += f * stepA * 0.1
      break
    }
    case 'skid': hwx = shFX + f * 5.0; hwy = robeTop - 1.8; wAng = f > 0 ? -1.1 : Math.PI + 1.1; break
    case 'jump': hwx = shFX + f * 2.2; hwy = beltY - 1.8; wAng = f > 0 ? -0.85 : Math.PI + 0.85; break
    case 'apex': hwx = ux + f * (shW + 4.8); hwy = shFY + 1.0; wAng = f > 0 ? -0.15 : Math.PI + 0.15; break
    case 'fall': hwx = shFX + f * 4.4; hwy = shFY - 2.4; wAng = f > 0 ? -0.9 : Math.PI + 0.9; break
    case 'land': hwx = ux + f * (shW + 3.4); hwy = beltY + 3.2; wAng = f > 0 ? 0.35 : Math.PI - 0.35; break
    case 'duck': hwx = shFX + f * 2.6; hwy = beltY + 1.8; break
    default: hwx = shFX + f * 3.2 + Math.sin(time * 2.6 + 0.9) * 0.25; hwy = beltY - 0.6; break
  }
  if (casting) {
    const aimA = Math.atan2(tyW - shFY, txW - shFX)
    const pullX = shFX - Math.cos(aimA) * 3.4, pullY = shFY + 2.6
    const pushX = shFX + Math.cos(aimA) * 10.2, pushY = shFY + Math.sin(aimA) * 10.2
    if (castQ <= 0) {                                              // anticipation: cock back
      hwx = dana_lerp(hwx, pullX, pullT)
      hwy = dana_lerp(hwy, pullY, pullT)
    } else {                                                       // release: snap through
      hwx = dana_lerp(pullX, pushX, castQ)
      hwy = dana_lerp(pullY, pushY, castQ)
    }
    wbow = f * (2.8 - 2.2 * Math.max(0, castQ))
    wAng = aimA - f * 0.9 * (1 - castQ)                            // easeOutBack overshoots past the aim
  }
  dana_arm(ctx, shFX, shFY, hwx, hwy, wbow, 0.02)
  dana_hand(ctx, hwx, hwy, false)
  const wandTip = dana_wand(ctx, hwx, hwy, wAng, casting ? 1 + (1 - kf) * 0.3 : 1, time)

  // ── hurt: additive whitening pressed through the whole silhouette ──
  if (punchHurt > 0.01) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = Math.min(1, punchHurt) * 0.5
    ctx.fillStyle = '#ffcdb8'
    dana_robePath(ctx, cx, swayU, robeTop, shW, hemW, hemY, sway, scoop)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ux, headY, rH + 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(ux - w * 0.34, brimY)
    ctx.lineTo(starPos[0], starPos[1])
    ctx.lineTo(ux + w * 0.34, brimY)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()

  // ── additive light, blitted in world space so squash never warps it ──
  const st = dana_world(starPos[0], starPos[1], cx, footY, jx, scaleX, scaleY, rot)
  glow(ctx, C.gold, st[0], st[1], 6.5, 0.08 + 0.07 * (0.5 + 0.5 * Math.sin(time * 3.1 + 1.3)))

  if (casting) {
    const wt = dana_world(wandTip[0], wandTip[1], cx, footY, jx, scaleX, scaleY, rot)
    const sparkR = castQ > 0 ? 6.5 + (1 - kf) * 17 : 3 + pullT * 3   // grows as the flash decays
    const sparkA = castQ > 0 ? 0.2 + 0.6 * kf : 0.3 * pullT
    glow(ctx, C.MAGIC, wt[0], wt[1], sparkR, sparkA)
    if (castQ > 0) {                                               // sparkle ticks toward the target
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 3; i++) {
        const jit = sol_hash2(i * 17 + 3, Math.floor(time * 24)) - 0.5
        const q = dana_clamp((0.24 + i * 0.27 + jit * 0.08) * castQ, 0, 1)
        const mx = wt[0] + (txW - wt[0]) * q
        const my = wt[1] + (tyW - wt[1]) * q + jit * 2.4
        ctx.globalAlpha = (0.75 - i * 0.18) * Math.min(1, kf * 1.6)
        dana_star(ctx, mx, my, 1.5 - i * 0.25, time * 2 + i, C.MAGIC)
      }
      ctx.restore()
    }
  }
}

// ── enemies ─────────────────────────────────────────────────

function actor_enemy(ctx: CanvasRenderingContext2D, en: FoeView, time: number, pulse: number, danaX: number, danaY: number): void {
  let { x, y, w, h } = en
  if (!en.alive) {
    if (en.squash <= 0) return
    const k = en.squash / 0.4
    const nh = h * Math.max(0.15, k)
    y += h - nh; h = nh
  } else if (GROUNDED.has(en.kind)) {
    contactShadow(ctx, x + w / 2, y + h, w)
  }
  const tg = en.telegraph ?? 0
  switch (en.kind) {
    case 'ghost': foe_ghost(ctx, x, y, w, h, en, time, pulse); break
    case 'neul': foe_neul(ctx, x, y, w, h, en, time, pulse, danaY); break
    case 'sparkball': foe_sparkball(ctx, x, y, w, h, en, time, pulse); break
    case 'demonhead': foe_demonhead(ctx, x, y, w, h, en, time, pulse); break
    case 'gargoil': foe_gargoil(ctx, x, y, w, h, en, time, pulse, tg); break
    case 'saramandor': foe_saramandor(ctx, x, y, w, h, en, time, pulse, tg); break
    case 'dragon': foe_dragon(ctx, x, y, w, h, en, time, pulse, tg); break
    case 'panel': foe_panel(ctx, x, y, w, h, en, time, pulse); break
    default: foe_goblin(ctx, x, y, w, h, en, time, pulse, tg, danaX); break
  }
}

function foe_goblin(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number, tg: number, danaX: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const cx = x + w / 2, footY = y + h
  if (!en.alive) {
    walk_carcass(ctx, x, y, w, h, sol_shade(C.goblinDark, -0.4))
    ctx.fillStyle = 'rgba(230,222,196,0.55)'   // tusks poking out of the heap
    ctx.fillRect(Math.round(cx - 4), Math.round(y + h * 0.35), 2, 2)
    ctx.fillRect(Math.round(cx + 2), Math.round(y + h * 0.35), 2, 2)
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const winding = st === 'windup', punching = st === 'punch'
  const charging = st === 'attack', recovering = st === 'recover'
  const stride = Math.sin(anim * 0.34)
  const pant = recovering ? Math.sin(time * 11) * 0.5 + 0.5 : 0     // fast shallow panting
  const crouch = (winding || punching ? h * 0.11 : 0) * (0.35 + 0.65 * tg) + pant * 1.7
  ctx.save()
  if (winding || punching) ctx.translate(walk_shiver(time, (x | 0) + (y | 0), 1.5 * tg), 0)
  if (charging) { ctx.translate(cx, footY); ctx.transform(1, 0, -d * 0.22, 1, 0, 0); ctx.translate(-cx, -footY) }
  if (charging) {   // green afterimages peel off the sprint
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#7df096'
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.17 - i * 0.045
      rr(ctx, x - d * i * 7, y + h * 0.26, w, h * 0.74, 6); ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = `rgba(150,255,170,${(0.12 + 0.14 * pulse)})`
    ctx.lineWidth = 1.3
    for (const k of [0.4, 0.68]) {
      ctx.beginPath(); ctx.moveTo(x - d * 16, y + h * k); ctx.lineTo(x + w * 0.5 - d * w * 0.45, y + h * k); ctx.stroke()
    }
    ctx.restore()
  }
  const torsoTop = y + h * 0.24 + crouch
  const shY = torsoTop + h * 0.10
  const armC = sol_shade(C.goblin, -0.2), armFar = sol_shade(C.goblinDark, -0.1)
  // fist targets per state — the arms are the whole performance
  let fAx: number, fAy: number, fBx: number, fBy: number
  if (winding) { fAx = cx + d * w * 0.48; fAy = torsoTop - 3 - tg * 3; fBx = cx - d * w * 0.32; fBy = torsoTop - 2 - tg * 3 }
  else if (punching) { fAx = cx + d * (w * 0.5 + tg * 2); fAy = y + h * 0.05 - tg * 5 + crouch; fBx = cx - d * w * 0.34; fBy = footY - 2.4 }
  else if (charging) {
    const pump = Math.sin(anim * 0.55) * 5
    fAx = cx + d * (w * 0.30 + pump); fAy = torsoTop + h * 0.18
    fBx = cx + d * (-w * 0.12 - pump); fBy = torsoTop + h * 0.26
  } else if (recovering) { fAx = cx + d * w * 0.56; fAy = footY - 2.4; fBx = cx - d * w * 0.5; fBy = footY - 2.4 }
  else {   // knuckle-drag walk: fists swing, lift, and PLANT alternately
    const liftA = Math.max(0, Math.sin(anim * 0.34 + 0.9)) * 2.8
    const liftB = Math.max(0, -Math.sin(anim * 0.34 + 0.9)) * 2.8
    fAx = cx + d * w * 0.5 + stride * 3.2; fAy = footY - 2.2 - liftA
    fBx = cx - d * w * 0.48 - stride * 3.2; fBy = footY - 2.2 - liftB
  }
  walk_limb(ctx, cx - d * w * 0.24, shY, cx - d * w * 0.55, (shY + fBy) / 2 - 1, fBx, fBy, 3.2, armFar)   // far arm behind
  walk_fist(ctx, fBx, fBy, 2.6, armFar, sol_shade(C.goblinDark, -0.45))
  shadedBody(ctx, x + w * 0.05, torsoTop, w * 0.9, footY - torsoTop - 1, C.goblin, 6)
  // pot belly — breathing, with an additive sheen
  const breath = 1 + (recovering ? 0.09 * Math.sin(time * 11) : 0.04 * Math.sin(time * 3.2))
  ctx.fillStyle = sol_shade(C.goblin, 0.14)
  ctx.beginPath(); ctx.ellipse(cx - d, footY - h * 0.26, w * 0.35, h * 0.21 * breath, 0, 0, Math.PI * 2); ctx.fill()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.13 * pulse
  ctx.fillStyle = '#d9ffde'
  ctx.beginPath(); ctx.ellipse(cx - d - w * 0.1, footY - h * 0.33, w * 0.17, h * 0.1, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = sol_shade(C.goblinDark, -0.3)   // belly crease
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - w * 0.2, footY - h * 0.1); ctx.quadraticCurveTo(cx, footY - h * 0.05, cx + w * 0.2, footY - h * 0.1); ctx.stroke()
  // stumpy legs under the belly — feet plant, no slide
  ctx.fillStyle = sol_shade(C.goblinDark, -0.25)
  const legSt = winding || punching || recovering ? 0 : stride * 2.6
  for (const s of [-1, 1]) {
    const fx = cx + s * w * (winding || punching ? 0.28 : 0.17) + s * legSt
    rr(ctx, fx - 3, footY - 3, 6.5, 3, 1.2); ctx.fill()
  }
  // hunched shoulder yoke looming over the head
  ctx.fillStyle = sol_shade(C.goblin, -0.24)
  rr(ctx, cx - w * 0.5, torsoTop - 3, w, h * 0.2, 7); ctx.fill()
  ctx.strokeStyle = 'rgba(255,220,170,0.3)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - w * 0.4, torsoTop - 2); ctx.lineTo(cx + w * 0.18, torsoTop - 2.6); ctx.stroke()
  // head — sunk low in front of the yoke
  const hx = cx + d * w * 0.13, hy = torsoTop + h * 0.06, hr = w * 0.24
  const tw = sol_hash(Math.floor(time * 3) + ((x / TILE) | 0)) * 1.6   // ear twitch
  const earC = sol_shade(C.goblinDark, -0.05)
  walk_poly(ctx, earC, hx - hr * 0.45, hy - hr * 0.45, hx - hr * 1.95, hy - hr * 1.0 - tw,   // far ear, notch bitten
    hx - hr * 1.3, hy - hr * 0.4, hx - hr * 1.1, hy - hr * 0.68, hx - hr * 0.85, hy - hr * 0.15)
  walk_poly(ctx, earC, hx + hr * 0.45, hy - hr * 0.5, hx + hr * 1.35, hy - hr * 1.15 + tw,   // near ear, notch on top edge
    hx + hr * 1.05, hy - hr * 0.72, hx + hr * 1.5, hy - hr * 0.55, hx + hr * 0.85, hy - hr * 0.05)
  const hg = ctx.createRadialGradient(hx - hr * 0.4, hy - hr * 0.4, 1, hx, hy, hr * 1.25)
  hg.addColorStop(0, sol_shade(C.goblin, 0.22)); hg.addColorStop(1, sol_shade(C.goblin, -0.32))
  ctx.fillStyle = hg
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill()
  // underbite jaw juts forward, tusks up at the corners
  ctx.fillStyle = sol_shade(C.goblin, -0.06)
  rr(ctx, hx - hr * 0.95 + d * 1.5, hy + hr * 0.22, hr * 1.9, hr * 0.72, 2); ctx.fill()
  ctx.fillStyle = '#1a0808'
  ctx.fillRect(Math.round(hx - hr * 0.55 + d * 1.5), Math.round(hy + hr * 0.26 - tg), Math.round(hr * 1.1), 1.6 + tg * 1.4)
  ctx.fillStyle = '#e8e0c8'
  walk_poly(ctx, '#e8e0c8', hx - hr * 0.6 + d * 1.5, hy + hr * 0.3, hx - hr * 0.32 + d * 1.5, hy + hr * 0.3, hx - hr * 0.46 + d * 1.5, hy - hr * 0.16)
  walk_poly(ctx, '#e8e0c8', hx + hr * 0.32 + d * 1.5, hy + hr * 0.3, hx + hr * 0.6 + d * 1.5, hy + hr * 0.3, hx + hr * 0.46 + d * 1.5, hy - hr * 0.16)
  // eyes under a heavy brow — red, TRACKING Dana
  const look = Math.max(-1, Math.min(1, (danaX - hx) / 60))
  const ey = hy - hr * 0.08
  const mad = winding || punching || charging
  if (mad) glow(ctx, C.DEMON_RED, hx, ey + 1, hr, (0.16 + 0.4 * tg) * pulse)
  if (blink(time, ((x / TILE) | 0) * 5 + ((y / TILE) | 0) * 11) < 0.5) {
    ctx.fillStyle = '#efe6da'
    ctx.fillRect(Math.round(hx - hr * 0.62), Math.round(ey), 4, 3)
    ctx.fillRect(Math.round(hx + hr * 0.14), Math.round(ey), 4, 3)
    ctx.fillStyle = mad ? '#ff3020' : '#a01010'
    ctx.fillRect(Math.round(hx - hr * 0.62 + 1 + look * 1.4), Math.round(ey + 0.6), 2, 2)
    ctx.fillRect(Math.round(hx + hr * 0.14 + 1 + look * 1.4), Math.round(ey + 0.6), 2, 2)
  }
  walk_poly(ctx, sol_shade(C.goblinDark, -0.42),   // the brow itself, slanted angrier toward Dana
    hx - hr * 0.95, ey - 3 + (d * look < 0 ? 1.2 : 0), hx + hr * 0.95, ey - 3 + (d * look > 0 ? 1.2 : 0),
    hx + hr * 0.95, ey - 0.6, hx - hr * 0.95, ey - 0.6)
  walk_limb(ctx, cx + d * w * 0.26, shY, cx + d * w * 0.6, (shY + fAy) / 2 - 2, fAx, fAy, 3.6, armC)   // near arm in front
  walk_fist(ctx, fAx, fAy, 3, armC, sol_shade(C.goblinDark, -0.45))
  if (punching) glow(ctx, C.SPARK, fAx, fAy, 3.5, 0.35 * tg * pulse)   // cocked fist gleams
  ctx.restore()
}

function foe_gargoil(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number, tg: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const cx = x + w / 2, footY = y + h
  const stone = '#a6abd0', wing = '#767a9a'
  if (!en.alive) {   // toppled to rubble: dark slabs + a snapped wing rib
    walk_poly(ctx, sol_shade(stone, -0.55), x + w * 0.06, footY, x + w * 0.3, y + Math.max(1, h * 0.2), x + w * 0.58, footY)
    walk_poly(ctx, sol_shade(stone, -0.63), x + w * 0.42, footY, x + w * 0.64, y + Math.max(1, h * 0.35), x + w * 0.92, footY)
    walk_poly(ctx, sol_shade(wing, -0.5), x + w * 0.6, footY - 1, x + w * 0.76, y + 1, x + w * 0.82, footY - 1)
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const scanning = st === 'scan', winding = st === 'windup'
  const step = Math.sin(anim * 0.2)
  const oy = -Math.abs(step) * 1.1                           // heavy tread: rises mid-stride
  const sweep = scanning ? Math.sin(time * 2.4) : d * 0.5    // head + eye sweep
  const ripple = Math.sin(anim * 0.2 + 1.1) * 1.5
  const rear = tg * 2.5
  // folded bat wings behind, rippling with the walk
  for (const s of [-1, 1]) {
    const rip = ripple * s
    const tipx = cx + s * w * 0.6, tipy = y + h * 0.02 + oy - rip
    const wrx = cx + s * w * 0.4, wry = y + h * 0.3 + oy - rip * 0.5
    walk_poly(ctx, wing, cx + s * w * 0.1, y + h * 0.3 + oy, tipx, tipy, wrx, wry, cx + s * w * 0.33, y + h * 0.64 + oy)
    walk_poly(ctx, sol_shade(wing, -0.28), cx + s * w * 0.1, y + h * 0.33 + oy, wrx, wry, cx + s * w * 0.29, y + h * 0.62 + oy)
    walk_poly(ctx, sol_shade(wing, 0.18), tipx, tipy, tipx + s * 2.4, tipy - 3.2, tipx + s * 1.2, tipy + 1.5)   // thumb claw
  }
  // stone column legs — feet slabs plant alternately
  for (const s of [-1, 1]) {
    const lx = cx + s * w * 0.16 + s * step * 1.7
    ctx.fillStyle = sol_shade(stone, -0.32)
    ctx.fillRect(Math.round(lx - 2.4), Math.round(footY - h * 0.26), 4.8, Math.round(h * 0.26) - 2)
    ctx.fillStyle = sol_shade(stone, -0.08)
    ctx.fillRect(Math.round(lx - 2.4), Math.round(footY - h * 0.26), 1.4, Math.round(h * 0.26) - 2)
    ctx.fillStyle = sol_shade(stone, -0.48)
    rr(ctx, lx - 3.4, footY - 3, 6.8, 3, 1); ctx.fill()
  }
  // chiseled torso: pelvis, chest split along a center ridge, pauldrons
  const chestTop = y + h * 0.3 + oy - rear * 0.3, waistY = y + h * 0.72 + oy
  walk_poly(ctx, sol_shade(stone, -0.18), cx - w * 0.22, waistY, cx + w * 0.22, waistY, cx + w * 0.18, footY - h * 0.2, cx - w * 0.18, footY - h * 0.2)
  walk_poly(ctx, sol_shade(stone, 0.14), cx - w * 0.33, chestTop, cx, chestTop - 2, cx, waistY, cx - w * 0.25, waistY)     // lit facet
  walk_poly(ctx, sol_shade(stone, -0.24), cx, chestTop - 2, cx + w * 0.33, chestTop, cx + w * 0.25, waistY, cx, waistY)   // shaded facet
  walk_poly(ctx, sol_shade(stone, 0.02), cx - w * 0.44, chestTop - 1, cx - w * 0.3, chestTop - 3, cx - w * 0.26, chestTop + h * 0.14, cx - w * 0.4, chestTop + h * 0.12)
  walk_poly(ctx, sol_shade(stone, -0.34), cx + w * 0.3, chestTop - 3, cx + w * 0.44, chestTop - 1, cx + w * 0.4, chestTop + h * 0.12, cx + w * 0.26, chestTop + h * 0.14)
  ctx.strokeStyle = 'rgba(255,220,170,0.3)'   // torch rim along the shoulder line
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - w * 0.4, chestTop - 1.6); ctx.lineTo(cx + w * 0.12, chestTop - 2.6); ctx.stroke()
  ctx.strokeStyle = 'rgba(24,26,40,0.55)'     // chisel seams + pockmarks
  ctx.beginPath(); ctx.moveTo(cx, chestTop - 2); ctx.lineTo(cx, waistY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx - w * 0.24, chestTop + h * 0.16); ctx.lineTo(cx + w * 0.2, chestTop + h * 0.18); ctx.stroke()
  ctx.fillStyle = 'rgba(24,26,40,0.5)'
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(Math.round(cx - w * 0.2 + sol_hash(i * 23 + ((x / TILE) | 0)) * w * 0.4), Math.round(chestTop + h * 0.06 + sol_hash(i * 57) * h * 0.22), 1.2, 1.2)
  }
  // square-jawed head — sweeps while scanning
  const hx = cx + sweep * w * 0.07, hy = y + h * 0.1 + oy
  walk_poly(ctx, sol_shade(stone, 0.2), hx - w * 0.17, hy + 2, hx - w * 0.1, hy - h * 0.06 - rear * 0.4, hx + w * 0.12, hy - h * 0.06 - rear * 0.4, hx + w * 0.17, hy + 2)
  walk_poly(ctx, sol_shade(stone, -0.04), hx - w * 0.17, hy + 2, hx + w * 0.17, hy + 2, hx + w * 0.14, hy + h * 0.14, hx - w * 0.14, hy + h * 0.14)
  walk_poly(ctx, sol_shade(stone, -0.16), hx - w * 0.13, hy + h * 0.12, hx + w * 0.13, hy + h * 0.12, hx + w * 0.11, hy + h * 0.21, hx - w * 0.11, hy + h * 0.21)
  ctx.fillStyle = 'rgba(24,26,40,0.6)'   // mouth slit in the square jaw
  ctx.fillRect(Math.round(hx - w * 0.08), Math.round(hy + h * 0.135), Math.round(w * 0.16), 1.3)
  for (const s of [-1, 1]) {   // faceted horns, lit on the inner edge
    walk_poly(ctx, sol_shade(stone, -0.35), hx + s * w * 0.09, hy - h * 0.04, hx + s * w * 0.2, hy - h * 0.17 - rear, hx + s * w * 0.16, hy - h * 0.02)
    walk_poly(ctx, sol_shade(stone, 0.26), hx + s * w * 0.09, hy - h * 0.04, hx + s * w * 0.155, hy - h * 0.15 - rear, hx + s * w * 0.125, hy - h * 0.03)
  }
  const browY = hy + h * 0.015
  ctx.fillStyle = sol_shade(stone, -0.45)   // brow ledge + its cast shadow
  ctx.fillRect(Math.round(hx - w * 0.13), Math.round(browY), Math.round(w * 0.26), 2)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(Math.round(hx - w * 0.12), Math.round(browY) + 2, Math.round(w * 0.24), 1)
  // ember eyes slide with the sweep
  const eShift = sweep * 2.2, eyY = browY + 3
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, 0.5 + 0.4 * pulse)
  ctx.fillStyle = '#ffb648'
  ctx.fillRect(Math.round(hx - 4.6 + eShift), Math.round(eyY), 2.4, 2)
  ctx.fillRect(Math.round(hx + 2.2 + eShift), Math.round(eyY), 2.4, 2)
  ctx.restore()
  glow(ctx, C.EMBER, hx + eShift, eyY + 1, 4.5, (0.2 + 0.35 * tg + (scanning ? 0.1 : 0)) * pulse)
  // windup: inner fire fissures crack open across the chest
  if (winding && tg > 0.05) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 1
    ctx.strokeStyle = `rgba(255,128,44,${Math.min(1, (0.3 + 0.5 * tg) * pulse)})`
    const cmy = chestTop + h * 0.15
    for (let i = 0; i < 4; i++) {
      const a0 = sol_hash(i * 41 + 7) * Math.PI * 2
      let px = cx + Math.cos(a0) * w * 0.08, py = cmy + Math.sin(a0) * h * 0.06
      ctx.beginPath(); ctx.moveTo(px, py)
      for (let s = 1; s <= 3; s++) {
        px += ((sol_hash(i * 97 + s * 13) - 0.5) * 7 + Math.cos(a0) * 3.5) * tg
        py += ((sol_hash(i * 53 + s * 29) - 0.5) * 6 + Math.sin(a0) * 3.5) * tg
        ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
    ctx.restore()
    glow(ctx, C.EMBER, cx, cmy, w * (0.2 + 0.35 * tg), 0.3 * tg * pulse)
  }
  fireTelegraph(ctx, x, hy + h * 0.14 - h * 0.45, w, h, d, tg, en.fireCd ?? 99)
}

function foe_dragon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number, tg: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const footY = y + h
  const pink = '#d56fb0'
  if (!en.alive) {
    walk_carcass(ctx, x, y, w, h, sol_shade(pink, -0.58))
    ctx.strokeStyle = sol_shade(pink, -0.72)   // segment creases still read on the heap
    ctx.lineWidth = 1
    for (const t of [0.3, 0.55, 0.8]) { ctx.beginPath(); ctx.moveTo(x + w * t, y + 2); ctx.lineTo(x + w * t, footY - 2); ctx.stroke() }
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const winding = st === 'windup', attacking = st === 'attack'
  const bob = Math.sin(anim * 0.14) * 1                       // slow, heavy bob
  const rear = winding ? tg : attacking ? 1 : 0
  const lift = rear * h * 0.32                                // the front third rears up
  const ax = (t: number): number => d > 0 ? x + w * t : x + w * (1 - t)
  const la = (t: number): number => lift * Math.max(0, (t - 0.4) / 0.6)
  const top = (t: number, k: number): number => footY - h * k + bob - la(t)
  const hx = ax(0.94), hy = footY - h * 0.64 + bob * 0.6 - lift * 0.95, hr = w * 0.135
  // tail whips behind on a slow quadratic
  const whip = Math.sin(anim * 0.17) * 2.6 + Math.sin(time * 1.9) * 0.8
  walk_whip(ctx, ax(0.05), footY - h * 0.15, ax(0.05) - d * w * 0.22, footY - h * 0.32 + whip,
    ax(0.05) - d * w * 0.44, footY - h * 0.1 + whip * 0.6, 4, sol_shade(pink, -0.16), 'rgba(255,220,170,0.3)')
  walk_poly(ctx, sol_shade(pink, -0.16), ax(0.05) - d * w * 0.44, footY - h * 0.1 + whip * 0.6,   // spade tip
    ax(0.05) - d * w * 0.53, footY - h * 0.16 + whip * 0.6, ax(0.05) - d * w * 0.5, footY - h * 0.03 + whip * 0.6)
  // far legs step behind the body
  ctx.fillStyle = sol_shade(pink, -0.42)
  for (const p of [0, 1]) {
    const lx = ax(0.26 + p * 0.34) - d * 2 - Math.sin(anim * 0.14 + p * Math.PI) * 2.2
    ctx.fillRect(Math.round(lx - 2), Math.round(footY - h * 0.15), 4, Math.round(h * 0.15) - 2)
    rr(ctx, lx - 3, footY - 3, 6, 3, 1); ctx.fill()
  }
  // the long body: one scalloped path over three arched humps into the neck
  const body = new Path2D()
  body.moveTo(ax(0.03), footY - h * 0.1)
  body.quadraticCurveTo(ax(0.17), top(0.17, 0.54), ax(0.3), top(0.3, 0.34))
  body.quadraticCurveTo(ax(0.43), top(0.43, 0.66), ax(0.56), top(0.56, 0.42))
  body.quadraticCurveTo(ax(0.68), top(0.68, 0.86), ax(0.8), top(0.8, 0.56))     // shoulder — the tallest arch
  body.quadraticCurveTo(ax(0.88), top(0.88, 0.7), ax(0.94), hy + hr * 0.5)
  body.lineTo(ax(0.97), hy + hr * 1.5)
  body.quadraticCurveTo(ax(0.7), footY - 1, ax(0.45), footY - 2)
  body.quadraticCurveTo(ax(0.2), footY - 1, ax(0.03), footY - h * 0.1)
  body.closePath()
  const bg = ctx.createLinearGradient(0, y - lift, 0, footY)
  bg.addColorStop(0, sol_shade(pink, 0.3)); bg.addColorStop(0.55, pink); bg.addColorStop(1, sol_shade(pink, -0.45))
  ctx.fillStyle = bg
  ctx.fill(body)
  ctx.strokeStyle = sol_shade(pink, -0.6)
  ctx.lineWidth = 1.1
  ctx.stroke(body)
  ctx.strokeStyle = sol_shade(pink, -0.5)   // saddle creases between segments
  for (const t of [0.3, 0.56]) { ctx.beginPath(); ctx.moveTo(ax(t), top(t, t === 0.3 ? 0.32 : 0.4)); ctx.lineTo(ax(t) - d * 1.5, footY - 3); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,214,235,0.55)'   // belly plates
  ctx.lineWidth = 1.4
  for (let i = 0; i < 5; i++) {
    const t = 0.14 + i * 0.16
    ctx.beginPath(); ctx.moveTo(ax(t) - 3.4, footY - 3); ctx.quadraticCurveTo(ax(t), footY - 4.8, ax(t) + 3.4, footY - 3); ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(255,220,170,0.32)'   // torch rim riding the two big humps
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(ax(0.38), top(0.43, 0.6)); ctx.quadraticCurveTo(ax(0.43), top(0.43, 0.66) - 1, ax(0.5), top(0.5, 0.56)); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(ax(0.63), top(0.68, 0.78)); ctx.quadraticCurveTo(ax(0.68), top(0.68, 0.86) - 1, ax(0.75), top(0.75, 0.7)); ctx.stroke()
  // near legs — deliberate planted steps
  ctx.fillStyle = sol_shade(pink, -0.3)
  for (const p of [0, 1]) {
    const lx = ax(0.26 + p * 0.34) + d * 2 + Math.sin(anim * 0.14 + p * Math.PI) * 2.2
    ctx.fillRect(Math.round(lx - 2), Math.round(footY - h * 0.16), 4, Math.round(h * 0.16) - 2)
    rr(ctx, lx - 3.2, footY - 3, 6.5, 3, 1); ctx.fill()
  }
  // back spines waving in sequence down the humps
  for (let i = 0; i < 5; i++) {
    const [t, k] = [[0.16, 0.5], [0.29, 0.36], [0.42, 0.62], [0.55, 0.44], [0.67, 0.82]][i]
    const bx = ax(t), by = top(t, k) + 1
    const wob = Math.sin(time * 3.1 - i * 0.85) * 1.5
    walk_poly(ctx, '#f3a6d4', bx - 2.6, by, bx + wob * 0.4 - 0.4, by - h * 0.14 - wob, bx + 2.6, by)
    walk_poly(ctx, sol_shade('#f3a6d4', -0.35), bx + 0.5, by, bx + wob * 0.4 + 0.3, by - h * 0.13 - wob, bx + 2.4, by)
  }
  // the head: skull, brow, snout, and a jaw that actually lifts
  const hg = ctx.createRadialGradient(hx - d * hr * 0.4, hy - hr * 0.5, 1, hx, hy, hr * 1.4)
  hg.addColorStop(0, sol_shade(pink, 0.28)); hg.addColorStop(1, sol_shade(pink, -0.3))
  ctx.fillStyle = hg
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill()
  const snx = d > 0 ? hx + hr * 0.3 : hx - hr * 0.3 - w * 0.17
  ctx.fillStyle = sol_shade(pink, 0.06)
  rr(ctx, snx, hy - hr * 0.55, w * 0.17, hr, 2); ctx.fill()
  const open = attacking ? 1 : Math.max(tg * 0.8, Math.max(0, Math.sin(time * 1.3)) * 0.07)
  const jhx = hx + d * hr * 0.25, jhy = hy + hr * 0.42, drop = open * 8
  if (open > 0.15) {   // dark gullet + upper teeth show
    walk_poly(ctx, '#5a1030', jhx, jhy - 1, jhx + d * w * 0.18, hy + hr * 0.2, jhx + d * w * 0.15, jhy + 2.4 + drop * 0.8)
    ctx.fillStyle = '#f2ead8'
    walk_poly(ctx, '#f2ead8', jhx + d * w * 0.1, hy + hr * 0.42, jhx + d * w * 0.14, hy + hr * 0.42, jhx + d * w * 0.12, hy + hr * 0.42 + 2.2)
  }
  walk_poly(ctx, sol_shade(pink, -0.22), jhx - d * 2, jhy + 3.4, jhx, jhy,   // the lower jaw
    jhx + d * w * 0.19, jhy + 1 + drop * 0.4, jhx + d * w * 0.16, jhy + 3 + drop)
  ctx.fillStyle = '#2a0a1c'   // nostril
  ctx.fillRect(Math.round(hx + d * (hr * 0.3 + w * 0.13)), Math.round(hy - hr * 0.35), 1.6, 1.6)
  ctx.strokeStyle = sol_shade(pink, -0.55)   // brow ridge
  ctx.lineWidth = 1.4
  ctx.beginPath(); ctx.moveTo(hx + d * hr * 0.65, hy - hr * 0.55); ctx.lineTo(hx - d * hr * 0.15, hy - hr * 0.75); ctx.stroke()
  if (blink(time, ((x / TILE) | 0) * 7 + 3) < 0.5) {   // slit-pupil eye + catchlight
    ctx.fillStyle = '#ffe9f4'
    ctx.fillRect(Math.round(hx + d * hr * 0.1) - 1.5, Math.round(hy - hr * 0.35), 3, 2.6)
    ctx.fillStyle = '#5a1030'
    ctx.fillRect(Math.round(hx + d * hr * 0.1) - 0.5, Math.round(hy - hr * 0.35), 1, 2.6)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(Math.round(hx + d * hr * 0.1) - 1.5, Math.round(hy - hr * 0.35), 1, 1)
  }
  // windup: throat kindles; attack: muzzle flash pulses at the open maw
  if (winding && tg > 0.05) {
    glow(ctx, C.EMBER, ax(0.9), hy + hr * 1.4, 3 + tg * 7, tg * 0.55 * pulse)
    glow(ctx, C.EMBER, hx, hy + hr * 0.6, 2 + tg * 4, tg * 0.4 * pulse)
  }
  if (attacking) {
    const flash = 0.55 + 0.45 * Math.sin(time * 26)
    const mawX = hx + d * (hr * 0.3 + w * 0.17), mawY = hy + hr * 0.35
    glow(ctx, C.TORCH, mawX + d * 3, mawY, 7 + flash * 5, (0.3 + 0.35 * flash) * pulse)
    glow(ctx, C.SPARK, mawX + d * 2, mawY, 3.5, 0.5 * flash * pulse)
  }
  fireTelegraph(ctx, x, hy + 2 - h * 0.45, w, h, d, tg, en.fireCd ?? 99)
}

function foe_saramandor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number, tg: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const footY = y + h
  const base = '#ff7a2a'
  if (!en.alive) {
    walk_carcass(ctx, x, y, w, h, sol_shade('#8a4118', -0.2))
    ctx.strokeStyle = sol_shade('#8a4118', -0.4)   // limp tail
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(x + w * 0.2, footY - 2); ctx.lineTo(x - w * 0.15, footY - 1); ctx.stroke()
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const winding = st === 'windup', fleeing = st === 'flee'
  const ax = (t: number): number => d > 0 ? x + w * t : x + w * (1 - t)
  const und = (t: number): number => Math.sin(anim * 0.45 - t * 4.6) * (fleeing ? 0.7 : 1.5)   // travelling body wave
  const lidft = winding ? tg * 2.8 : 0
  const stretch = fleeing ? 0.1 : 0                     // body pulls LONG in the sprint away
  const hx = ax(0.96 + stretch), hy = footY - h * 0.26 - lidft
  ctx.save()
  if (winding) ctx.translate(walk_shiver(time, (x | 0), 0.9 * tg), 0)
  // S-curled tail sweeping behind
  const sway = Math.sin(anim * 0.45 + 1.3) * (fleeing ? 1 : 2.4)
  walk_whip(ctx, ax(0.08 - stretch * 0.6), footY - h * 0.17, ax(0.08) - d * w * 0.18, footY - h * 0.34 - sway,
    ax(0.08) - d * w * (fleeing ? 0.5 : 0.4), footY - 2.5 + sway * 0.5, 3.2, sol_shade(base, -0.12), 'rgba(255,220,170,0.35)')
  // legs: four scampering nubs — or two blur streaks in the flee
  if (fleeing) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255,170,90,${0.25 + 0.15 * pulse})`
    ctx.lineWidth = 1.4
    for (const k of [3.2, 5.6]) {
      ctx.beginPath(); ctx.moveTo(ax(0.05) - d * 7, footY - k); ctx.lineTo(ax(0.75), footY - k); ctx.stroke()
    }
    ctx.fillStyle = '#ffc07a'   // kicked-up dust flecks trail off
    for (let i = 0; i < 3; i++) {
      const p = (time * 2.2 + sol_hash(i * 19) * 0.9) % 1
      ctx.globalAlpha = (1 - p) * 0.5
      ctx.fillRect(ax(0.05) - d * (4 + p * 12), footY - 2 - p * 4 - i * 1.5, 1.6, 1.6)
    }
    ctx.restore()
  } else {
    const legC = sol_shade(base, -0.32)
    for (let i = 0; i < 4; i++) {
      const pair = i >> 1, side = i & 1
      const ph = anim * 0.6 + pair * 1.6 + side * Math.PI
      const hipX = ax(0.3 + pair * 0.36), hipY = footY - h * 0.16
      const swing = Math.sin(ph) * 3
      const fy = footY - Math.max(0, Math.sin(ph + 0.7)) * 2
      walk_limb(ctx, hipX, hipY, hipX + d * swing * 0.5, hipY + 2.5, hipX + d * swing, fy - 1, 1.8, legC)
      ctx.fillStyle = legC
      ctx.fillRect(Math.round(hipX + d * swing) - 1, Math.round(fy) - 2, 2.2, 1.8)
    }
  }
  // the low sinuous body — one path, one gradient, arched mid
  const body = new Path2D()
  body.moveTo(ax(0.04 - stretch * 0.6), footY - h * 0.1)
  body.quadraticCurveTo(ax(0.3), footY - h * 0.36 + und(0.3), ax(0.58), footY - h * 0.3 + und(0.58))
  body.quadraticCurveTo(ax(0.78), footY - h * 0.34 + und(0.78) - lidft * 0.7, ax(0.9 + stretch), hy - h * 0.06)
  body.quadraticCurveTo(hx + d * w * 0.16, hy - h * 0.04, hx + d * w * 0.14, hy + h * 0.08)   // blunt newt snout
  body.quadraticCurveTo(hx + d * w * 0.06, hy + h * 0.14, ax(0.86 + stretch), footY - 2.5)
  body.quadraticCurveTo(ax(0.5), footY - 1.5, ax(0.04 - stretch * 0.6), footY - h * 0.1)
  body.closePath()
  const bg = ctx.createLinearGradient(0, footY - h * 0.44, 0, footY)
  bg.addColorStop(0, sol_shade(base, 0.28)); bg.addColorStop(0.5, base); bg.addColorStop(1, sol_shade(base, -0.42))
  ctx.fillStyle = bg
  ctx.fill(body)
  ctx.strokeStyle = sol_shade(base, -0.58)
  ctx.lineWidth = 1
  ctx.stroke(body)
  // bright belly stripe hugging the underside (+ faint additive echo)
  ctx.strokeStyle = 'rgba(255,208,138,0.85)'
  ctx.lineWidth = 1.8
  ctx.beginPath(); ctx.moveTo(ax(0.12), footY - 2.6); ctx.quadraticCurveTo(ax(0.5), footY - 3.6, ax(0.86 + stretch), footY - 3); ctx.stroke()
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.15 * pulse
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(ax(0.12), footY - 2.6); ctx.quadraticCurveTo(ax(0.5), footY - 3.6, ax(0.86 + stretch), footY - 3); ctx.stroke()
  ctx.restore()
  // face: forward-fixed eye + catchlight, mouth line
  if (blink(time, ((x / TILE) | 0) * 3 + ((y / TILE) | 0) * 13) < 0.5) {
    ctx.fillStyle = '#fff2d8'
    ctx.beginPath(); ctx.arc(hx + d * w * 0.02, hy - 0.5, 2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#38160a'
    ctx.beginPath(); ctx.arc(hx + d * (w * 0.02 + 0.8), hy - 0.4, 1, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(Math.round(hx + d * w * 0.02) - 1, Math.round(hy) - 2, 1, 1)
  }
  ctx.strokeStyle = sol_shade(base, -0.5)
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(hx + d * w * 0.13, hy + h * 0.06); ctx.lineTo(hx + d * w * 0.02, hy + h * 0.08); ctx.stroke()
  // flame crest — teardrops flicker down the spine; tall in windup, pinned flat in the flee
  for (let i = 0; i < 4; i++) {
    const t = 0.5 + i * 0.15
    const bx = ax(t + (i === 3 ? stretch : 0))
    const by = (i === 3 ? hy - h * 0.05 : footY - h * 0.33 + und(t)) + 0.5
    const flick = 0.72 + sol_hash(Math.floor(time * 15) + i * 7) * 0.45
    const hgt = h * (0.16 + (i === 1 ? 0.07 : 0) + (i === 3 ? 0.04 : 0)) * (1 + tg) * flick * (fleeing ? 0.42 : 1)
    walk_flame(ctx, bx, by, 2.6, hgt, -d * (fleeing ? 4.5 : 1.2), (0.5 + 0.28 * pulse))
  }
  // ember drip stretching off the jaw
  const dp = (time * 1.1 + sol_hash((x / TILE) | 0)) % 1
  const jawX = hx + d * w * 0.1
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = (1 - dp) * 0.7
  ctx.fillStyle = '#ffb073'
  ctx.fillRect(jawX - 0.7, hy + h * 0.1 + dp * 7, 1.5, 1.5 + dp * 2.5)
  ctx.restore()
  glow(ctx, C.EMBER, jawX, hy + h * 0.1 + dp * 7, 2.5, (1 - dp) * 0.45 * pulse)
  fireTelegraph(ctx, x, hy + 1 - h * 0.45, w, h, d, tg, en.fireCd ?? 99)
  ctx.restore()
}

/** The shared fire-spitter windup cue: a banked maw coal that builds to
 *  white-hot, two inhale streaks converging on the maw, and spark motes drawn
 *  down the throat. Falls back to a subtle coal just before an untelegraphed
 *  shot (fireCd small). Deterministic — animation keys off tg itself. */
function fireTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dir: number, tg: number, fireCd: number): void {
  const amt = Math.max(tg, fireCd < 0.5 ? 0.25 : 0)
  if (amt <= 0.02) return
  const mx = dir > 0 ? x + w : x
  const my = y + h * 0.45
  glow(ctx, C.DEMON_RED, mx, my, 5 + amt * 11, amt * 0.7)
  glow(ctx, C.EMBER, mx + dir * 2, my, 3 + amt * 5, amt * 0.5)
  if (amt > 0.55) glow(ctx, C.SPARK, mx + dir * 2, my, 2 + (amt - 0.55) * 7, (amt - 0.55) * 1.3)
  if (tg <= 0.2) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // two inhale streaks — their spread narrows as the breath peaks
  const reach = 10 + tg * 8
  ctx.strokeStyle = `rgba(255,140,88,${0.55 * tg})`
  ctx.lineWidth = 1.2
  ctx.lineCap = 'round'
  for (const off of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(mx + dir * reach, my + off * (6 - 3.5 * tg))
    ctx.quadraticCurveTo(mx + dir * reach * 0.45, my + off * (2.5 - tg), mx + dir * 2.5, my + off * 0.8)
    ctx.stroke()
  }
  // spark motes marching into the maw as tg builds
  ctx.fillStyle = '#ffd24a'
  for (let i = 0; i < 3; i++) {
    const p = (tg * 2.4 + sol_hash(i * 17 + 3)) % 1
    ctx.globalAlpha = (0.2 + 0.6 * p) * tg
    ctx.fillRect(mx + dir * ((reach + 4) * (1 - p) + 2) - 0.8, my + (i - 1) * 2.6 * (1 - p) - 0.8, 1.7, 1.7)
  }
  ctx.restore()
}

function foe_ghost(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number): void {
  const cx = x + w / 2
  const d = en.dir >= 0 ? 1 : -1
  if (!en.alive) {   // the shroud collapses: a dim rag with two dead sockets
    fly_husk(ctx, x, y, w, h, '#3a4770', 0.5)
    ctx.fillStyle = 'rgba(14,18,40,0.8)'
    ctx.fillRect(Math.round(cx - 5), Math.round(y + h * 0.28), 3, Math.max(1, h * 0.4))
    ctx.fillRect(Math.round(cx + 2), Math.round(y + h * 0.28), 3, Math.max(1, h * 0.4))
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const tg = en.telegraph ?? 0
  const hunting = st === 'hunt', stunned = st === 'stun'
  const seed = ((x / TILE) | 0) * 7 + ((y / TILE) | 0) * 13
  const ph = anim * 0.08
  const bob = stunned ? 0 : Math.sin(time * 1.7 + seed) * 0.7
  // deflate on the stun: the dome sags, the hem stops rippling
  const capY = y + h * (stunned ? 0.26 : 0.05) + bob
  const hemY = y + h * (stunned ? 0.93 : 0.86) + bob * 0.4
  const rx = w * (stunned ? 0.5 : 0.44)
  const lean = hunting ? d * (2.2 + tg * 1.6) : 0
  const stream = hunting ? 7 + tg * 3.5 : stunned ? 0.5 : 1.8
  const amp = stunned ? 0.5 : hunting ? 1.3 : 2.3

  glow(ctx, C.GHOST_COOL, cx + lean * 0.5, y + h * 0.5 + bob, w * (hunting ? 1.05 : 0.82), (hunting ? 0.34 : 0.2) * pulse)
  if (hunting) {   // two faint speed lines peeling off the stream
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(190,215,255,${0.1 + 0.13 * pulse})`
    ctx.lineWidth = 1.2
    ctx.lineCap = 'round'
    for (const k of [0.34, 0.6]) {
      ctx.beginPath()
      ctx.moveTo(cx - d * (w * 0.5 + 16), y + h * k + bob)
      ctx.lineTo(cx - d * w * 0.42, y + h * (k + 0.03) + bob)
      ctx.stroke()
    }
    ctx.restore()
  }
  const veil = fly_veilPath(cx, capY, rx, hemY, ph, amp, lean, d, stream, stunned ? 2.5 : 3.5)
  // 1) the outer veil — low alpha, cool, barely there
  ctx.save()
  const vg = ctx.createLinearGradient(0, capY, 0, hemY + 4)
  vg.addColorStop(0, 'rgba(228,238,255,0.5)')
  vg.addColorStop(0.6, 'rgba(190,210,248,0.34)')
  vg.addColorStop(1, 'rgba(140,168,225,0.16)')
  ctx.fillStyle = vg
  ctx.fill(veil)
  ctx.strokeStyle = 'rgba(232,242,255,0.34)'
  ctx.lineWidth = 1
  ctx.stroke(veil)
  // 2) the core wisp — a brighter body drifting inside on its own slow phase
  ctx.clip(veil)
  const wx = cx + lean * 0.7 + Math.sin(time * 0.9 + seed) * w * 0.09 - (hunting ? d * 2.5 : 0)
  const wy = y + h * 0.46 + Math.cos(time * 0.72 + seed * 1.7) * h * 0.07 + bob
  const cg = ctx.createRadialGradient(wx - 2, wy - 3, 1, wx, wy, w * 0.36)
  cg.addColorStop(0, 'rgba(255,255,255,0.85)')
  cg.addColorStop(0.45, 'rgba(207,224,255,0.42)')
  cg.addColorStop(1, 'rgba(150,180,235,0)')
  ctx.fillStyle = cg
  ctx.fillRect(x - w * 0.6, y - h * 0.2, w * 2.2, h * 1.5)
  ctx.restore()

  const ex = cx + lean, ey = y + h * 0.38 + bob
  const dx = w * 0.16
  if (stunned) {   // dizzy spirals + a deterministic star orbit over the crown
    for (const s of [-1, 1]) {
      ctx.save()
      ctx.globalAlpha = 0.85
      fly_spiral(ctx, ex + s * dx, ey, 3.4, time * 5.5 * s, '#2c3768', 1.3)
      ctx.restore()
    }
    for (let i = 0; i < 3; i++) {
      const a = time * 2.3 + i * (Math.PI * 2 / 3)
      fly_star(ctx, ex + Math.cos(a) * w * 0.46, capY - 1 + Math.sin(a) * h * 0.11, 2.2 + Math.sin(a) * 0.5,
        time * 3 + i, C.SPARK, (0.45 + 0.3 * Math.sin(a)) * pulse)
    }
    ctx.strokeStyle = 'rgba(30,38,74,0.55)'   // a slack, dumbfounded mouth
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(ex - 3, ey + h * 0.16); ctx.quadraticCurveTo(ex, ey + h * 0.19, ex + 3, ey + h * 0.16)
    ctx.stroke()
    return
  }
  // hollow sockets — angled inward, deeper on the hunt
  for (const s of [-1, 1]) {
    ctx.save()
    ctx.translate(ex + s * dx, ey)
    ctx.rotate(s * (hunting ? 0.34 : 0.16))
    ctx.fillStyle = hunting ? 'rgba(10,8,22,0.9)' : 'rgba(20,26,54,0.72)'
    ctx.beginPath()
    ctx.ellipse(0, 0, 2.6 + (hunting ? 0.5 : 0), 3.6 + (hunting ? 0.8 : 0), 0, 0, Math.PI * 2)
    ctx.fill()
    if (hunting) {   // the sockets IGNITE — molten pupil straining toward Dana
      ctx.fillStyle = '#ff6a24'
      ctx.beginPath(); ctx.ellipse(d * 0.6, 0.3, 1.5, 2.4, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff1c0'
      ctx.beginPath(); ctx.ellipse(d * 0.7, 0.2, 0.7, 1.2, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }
  if (hunting) {
    glow(ctx, C.EMBER, ex - dx + d, ey, 4.2 + tg, (0.35 + 0.3 * tg) * pulse)
    glow(ctx, C.EMBER, ex + dx + d, ey, 4.2 + tg, (0.35 + 0.3 * tg) * pulse)
    glow(ctx, C.DEMON_RED, ex + d * 2, ey + 1, 8 + tg * 3, 0.18 * pulse)
  }
}

function foe_neul(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number, danaY: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const tone = '#a98fe0'
  if (!en.alive) {   // crumpled: a dark heap with one wing still half-open
    fly_husk(ctx, x, y, w, h, sol_shade(tone, -0.55), 0.9)
    fly_poly(ctx, sol_shade(tone, -0.68), x + w * 0.3, y + h, x + w * 0.7, y + Math.max(1, h * 0.15), x + w * 0.92, y + h)
    return
  }
  const st = en.state ?? 'hover'
  const anim = en.anim ?? 0
  const tg = en.telegraph ?? 0
  const swooping = st === 'swoop', winding = st === 'windup'
  const aligning = st === 'align', rising = st === 'rise'
  const seed = ((x / TILE) | 0) * 5 + ((y / TILE) | 0) * 11
  const rate = swooping || winding ? 0 : rising ? 0.2 : aligning ? 0.16 : 0.09
  const fp = anim * rate * 6
  // wing angle: negative = raised. Rise beats a heavy asymmetric upstroke.
  let fa: number, tipFa: number, span: number
  if (winding) { fa = -1.15; tipFa = -1.05; span = w * 0.72 }
  else if (swooping) { fa = 0.72; tipFa = 0.86; span = w * 0.56 }
  else {
    const raw = Math.sin(fp), rawLag = Math.sin(fp - 0.55)
    const gain = rising ? 1 : aligning ? 0.75 : 0.9
    fa = (raw > 0 ? raw * (rising ? 0.42 : 0.8) : raw * (rising ? 1.3 : 0.9)) * gain
    tipFa = (rawLag > 0 ? rawLag * (rising ? 0.42 : 0.8) : rawLag * (rising ? 1.3 : 0.9)) * gain
    span = w * (rising ? 0.74 : 0.7)
  }
  const stroke = rising ? Math.max(0, Math.sin(fp)) * 1.6 : 0   // body sinks on the upstroke
  const bx = x + w / 2, by = y + h * 0.5 + stroke
  const R = w * 0.29
  glow(ctx, tone, bx, by, w * (swooping ? 1.05 : 0.85), (0.16 + tg * 0.3) * pulse)

  ctx.save()
  if (winding) ctx.translate(fly_shiver(time, seed, 1.7 * tg), fly_shiver(time, seed + 5, 1.1 * tg))
  if (swooping) {   // shear the whole bat back into a dart + violet dive streaks
    ctx.translate(bx, by); ctx.transform(1, 0, -d * 0.3, 1, 0, 0); ctx.translate(-bx, -by)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(180,150,255,${0.16 + 0.16 * pulse})`
    ctx.lineWidth = 1.3
    ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(bx - d * (14 + i * 7), by + (i - 1) * 5)
      ctx.lineTo(bx - d * (2 + i * 2), by + (i - 1) * 2.4)
      ctx.stroke()
    }
    ctx.restore()
  }
  // far wing goes down first (dimmer, behind the body); the near wing lands last
  fly_wing(ctx, bx - R * 0.62, by - R * 0.2, bx - R * 0.2, by + R * 0.7, span, fa, tipFa, -1, sol_shade(tone, -0.16), pulse)
  // ears — pointed, with an inner shade
  for (const s of [-1, 1]) {
    fly_poly(ctx, sol_shade(tone, -0.22), bx + s * R * 0.34, by - R * 0.74, bx + s * R * 0.86, by - R * 1.62 - stroke * 0.4, bx + s * R * 0.82, by - R * 0.5)
    fly_poly(ctx, sol_shade(tone, -0.48), bx + s * R * 0.46, by - R * 0.72, bx + s * R * 0.76, by - R * 1.3 - stroke * 0.3, bx + s * R * 0.7, by - R * 0.56)
  }
  // fuzzy round body — a scalloped fur silhouette under a lit radial gradient
  ctx.beginPath()
  for (let i = 0; i <= 22; i++) {
    const a = (i / 22) * Math.PI * 2
    const fr = R + sol_hash(i * 13 + seed) * 1.5 + Math.sin(a * 5 + time * 1.8) * 0.3
    const px = bx + Math.cos(a) * fr, py = by + Math.sin(a) * fr * 1.04
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  const bg = ctx.createRadialGradient(bx - R * 0.4, by - R * 0.45, 1, bx, by, R * 1.35)
  bg.addColorStop(0, sol_shade('#cdb6f5', 0.2))
  bg.addColorStop(0.5, tone)
  bg.addColorStop(1, sol_shade(tone, -0.42))
  ctx.fillStyle = bg
  ctx.fill()
  ctx.strokeStyle = sol_shade(tone, -0.6)
  ctx.lineWidth = 0.9
  ctx.stroke()
  // tiny feet tucked under the belly
  ctx.strokeStyle = sol_shade(tone, -0.5)
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(bx + s * R * 0.3, by + R * 0.82)
    ctx.quadraticCurveTo(bx + s * R * 0.46, by + R * 1.12, bx + s * R * 0.2, by + R * 1.16)
    ctx.stroke()
  }
  // ONE big cyclops eye — narrowed on the stalk, dilated in the windup
  const eR = R * (0.58 + tg * 0.16) * (aligning ? 1 : 1.04)
  const eyx = bx + d * R * 0.1, eyy = by - R * 0.1
  const squint = aligning ? 0.5 : 1
  ctx.fillStyle = 'rgba(24,14,44,0.5)'   // socket shade behind the sclera
  ctx.beginPath(); ctx.ellipse(eyx, eyy + 0.6, eR * 1.12, eR * squint * 1.12, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#f4eeff'
  ctx.beginPath(); ctx.ellipse(eyx, eyy, eR, eR * squint, 0, 0, Math.PI * 2); ctx.fill()
  const track = Math.max(-1, Math.min(1, (danaY - by) / 46))
  const pR = eR * (winding ? 0.62 : swooping ? 0.5 : 0.4)
  ctx.fillStyle = '#7a4fd0'   // iris
  ctx.beginPath(); ctx.ellipse(eyx + d * eR * 0.16, eyy + track * eR * squint * 0.4, pR * 1.5, pR * 1.5 * squint, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#150a2c'   // pupil tracks Dana vertically
  ctx.beginPath(); ctx.ellipse(eyx + d * eR * 0.2, eyy + track * eR * squint * 0.46, pR, pR * squint, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath(); ctx.arc(eyx + d * eR * 0.2 - pR * 0.34, eyy + track * eR * squint * 0.46 - pR * 0.42, pR * 0.3, 0, Math.PI * 2); ctx.fill()
  if (aligning) {   // the narrowing lids themselves
    ctx.fillStyle = sol_shade(tone, -0.08)
    ctx.fillRect(eyx - eR - 1, eyy - eR - 1, eR * 2 + 2, eR * (1 - squint) + 1)
    ctx.fillRect(eyx - eR - 1, eyy + eR * squint, eR * 2 + 2, eR * (1 - squint) + 1)
  }
  if (winding || swooping) glow(ctx, tone, eyx, eyy, eR * 2.2, (0.14 + 0.3 * tg) * pulse)
  // mouth: fangs always show; the maw gapes on the dive
  const mY = by + R * 0.6
  if (swooping || tg > 0.55) {
    ctx.fillStyle = '#2a0e2c'
    ctx.beginPath(); ctx.ellipse(bx + d * R * 0.06, mY + 0.6, R * 0.34, R * 0.3 * (swooping ? 1 : tg), 0, 0, Math.PI * 2); ctx.fill()
  }
  fly_poly(ctx, '#f6f1e0', bx - R * 0.26, mY, bx - R * 0.08, mY, bx - R * 0.17, mY + R * 0.34)
  fly_poly(ctx, '#f6f1e0', bx + R * 0.08, mY, bx + R * 0.26, mY, bx + R * 0.17, mY + R * 0.34)
  fly_wing(ctx, bx + R * 0.62, by - R * 0.2, bx + R * 0.2, by + R * 0.7, span, fa, tipFa, 1, tone, pulse)
  ctx.restore()
}

let SPARK_CORE: HTMLCanvasElement | null = null
function sparkCore(): HTMLCanvasElement {
  if (SPARK_CORE) return SPARK_CORE
  const cv = document.createElement('canvas')
  cv.width = cv.height = 96
  const x = cv.getContext('2d')!
  const g = x.createRadialGradient(48, 48, 0, 48, 48, 48)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.14, 'rgba(255,253,222,0.98)')
  g.addColorStop(0.3, '#ffe14a')
  g.addColorStop(0.5, 'rgba(255,158,26,0.5)')
  g.addColorStop(0.74, 'rgba(255,92,12,0.16)')
  g.addColorStop(1, 'rgba(255,60,0,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 96, 96)
  return SPARK_CORE = cv
}

function foe_sparkball(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number): void {
  const cx = x + w / 2, cy = y + h / 2
  if (!en.alive) {   // the plasma fizzles: a cold slag pellet with two dying motes
    fly_husk(ctx, x, y, w, h, '#5c3a10', 0.85)
    glow(ctx, C.EMBER, cx, y + h * 0.5, w * 0.3, 0.12 * pulse)
    return
  }
  const st = en.state ?? 'patrol'
  const anim = en.anim ?? 0
  const tg = en.telegraph ?? 0
  const charged = st === 'attack', winding = st === 'windup'
  const throb = winding ? 1 + Math.sin(time * 30) * 0.22 * tg : 1
  const r = w * 0.4 * throb * (charged ? 1.3 : 1)
  const q = Math.floor(time * 20)
  const spin = anim * 0.3 + time * 0.6

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // 1) the core itself
  ctx.globalAlpha = Math.min(1, (0.7 + 0.3 * pulse) * (charged ? 1 : 0.92))
  ctx.drawImage(sparkCore(), cx - r * 1.7, cy - r * 1.7, r * 3.4, r * 3.4)
  // 2) arc bolts writhing around the core — doubled in the supercharge
  const bolts = charged ? 6 : 3
  const jag = charged ? 0.34 : 0.22
  for (let i = 0; i < bolts; i++) {
    const a0 = spin * (i % 2 === 0 ? 1 : -1.35) + i * (Math.PI * 2 / bolts)
    fly_bolt(ctx, cx, cy, r * (0.95 + sol_hash(q * 5 + i) * 0.5), a0, 1.5 + sol_hash(q + i * 3) * 1.1,
      q, i, jag, charged ? '#ffb43a' : '#ff9a2a', charged ? '#ffffff' : '#fff7c0',
      (0.65 + 0.3 * pulse) * (charged ? 1 : 0.85))
  }
  ctx.globalAlpha = 1
  // 3) the containment ring — tightens + throbs in the windup, SHATTERS into two
  //    counter-rotating arcs once it supercharges
  const ringR = r * (charged ? 1.6 : winding ? 1.5 - 0.45 * tg : 1.5)
  const tilt = Math.sin(time * 1.1) * 0.9
  ctx.lineWidth = charged ? 1.6 : 1.1
  ctx.lineCap = 'round'
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(spin * 0.5)
  ctx.scale(1, 0.28 + Math.abs(Math.cos(time * 0.9)) * 0.72)
  if (charged) {
    ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * pulse})`
    ctx.beginPath(); ctx.arc(0, 0, ringR, 0.3, 2.5); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, 0, ringR * 0.86, Math.PI + 0.3 - spin * 1.2, Math.PI + 2.5 - spin * 1.2); ctx.stroke()
  } else {
    ctx.strokeStyle = `rgba(255,226,120,${(winding ? 0.35 + 0.4 * tg : 0.34) * (0.6 + 0.4 * pulse)})`
    ctx.beginPath(); ctx.arc(0, 0, ringR + tilt * 0.4, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
  // 4) orbiting spark flecks with stubby trails
  for (let i = 0; i < 5; i++) {
    const a = time * (2.4 + i * 0.7) * (i % 2 === 0 ? 1 : -1) + i * 1.27
    const orb = r * (1.5 + Math.sin(time * 1.6 + i) * 0.28) * (charged ? 1.18 : 1)
    const fx = cx + Math.cos(a) * orb, fy = cy + Math.sin(a) * orb * 0.82
    ctx.globalAlpha = (0.4 + 0.35 * pulse) * (0.5 + 0.5 * sol_hash(q + i * 41))
    ctx.strokeStyle = '#ffd24a'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(fx, fy)
    ctx.lineTo(cx + Math.cos(a - 0.3) * orb, cy + Math.sin(a - 0.3) * orb * 0.82)
    ctx.stroke()
    ctx.fillStyle = '#fffbe0'
    ctx.fillRect(fx - 0.9, fy - 0.9, 1.8, 1.8)
  }
  ctx.restore()
  glow(ctx, C.SPARK, cx, cy, r * (charged ? 3 : 2.3), (0.2 + 0.2 * tg + (charged ? 0.2 : 0)) * pulse)
}

function foe_demonhead(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const cx = x + w / 2, cy = y + h / 2
  if (!en.alive) {
    fly_husk(ctx, x, y, w, h, '#5c1f1d', 0.9)
    ctx.fillStyle = 'rgba(255,225,160,0.4)'   // teeth scattered in the heap
    ctx.fillRect(Math.round(cx - 4), Math.round(y + h * 0.4), 2, 2)
    ctx.fillRect(Math.round(cx + 2), Math.round(y + h * 0.4), 2, 2)
    return
  }
  const st = en.state ?? 'drift'
  const anim = en.anim ?? 0
  const tg = en.telegraph ?? 0
  const ttl = en.ttl ?? 99
  const fading = ttl > 0 && ttl < 1.5
  const rot = fading ? Math.min(1, (1.5 - ttl) / 1.5) : 0     // 0 → 1 as it expires
  const darting = st === 'dart', winding = st === 'windup'
  const seed = ((x / TILE) | 0) * 9 + ((y / TILE) | 0) * 3

  if (fading) {   // crumble flecks fall away from the dissolving skull
    ctx.save()
    for (let i = 0; i < 2; i++) {
      const p = (time * 1.5 + sol_hash(seed + i * 37)) % 1
      ctx.globalAlpha = (1 - p) * 0.75 * rot
      ctx.fillStyle = '#6b5a56'
      ctx.fillRect(cx + (sol_hash(seed + i * 11) - 0.5) * w * 0.6, cy + h * 0.2 + p * h * 0.7, 1.6, 1.6 + p * 1.4)
    }
    ctx.restore()
  }
  // the expiry strobe: deterministic square wave — the head blinks out of being
  if (fading && Math.floor(ttl * 8) % 2 === 0) {
    glow(ctx, C.DEMON_RED, cx, cy, w * 0.5, 0.1 * (1 - rot) * pulse)
    return
  }
  const base = fading ? fly_desat(C.demon, rot * 0.85) : C.demon
  const bone = fading ? fly_desat('#9a1f1c', rot * 0.85) : '#9a1f1c'

  fly_smoke(ctx, cx, cy + h * 0.4, time, seed, d, 3, darting ? 1.3 : 1)
  glow(ctx, C.DEMON_RED, cx, cy, w * 0.8, (0.22 + tg * 0.4) * (1 - rot * 0.7) * pulse)
  if (darting) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255,90,70,${0.2 + 0.2 * pulse})`
    ctx.lineWidth = 1.4
    ctx.lineCap = 'round'
    for (const k of [-3, 2]) {
      ctx.beginPath()
      ctx.moveTo(cx - d * (w * 0.9 + 8), cy + k)
      ctx.lineTo(cx - d * w * 0.36, cy + k * 0.4)
      ctx.stroke()
    }
    ctx.restore()
  }
  // cracked horns, swept back off the temples
  for (const s of [-1, 1]) {
    fly_poly(ctx, sol_shade(bone, -0.1), cx + s * w * 0.24, cy - h * 0.22,
      cx + s * w * 0.52, cy - h * 0.58, cx + s * w * 0.6, cy - h * 0.3, cx + s * w * 0.34, cy - h * 0.1)
    fly_poly(ctx, sol_shade(bone, 0.22), cx + s * w * 0.26, cy - h * 0.22,
      cx + s * w * 0.5, cy - h * 0.54, cx + s * w * 0.52, cy - h * 0.38)
    ctx.strokeStyle = 'rgba(12,4,4,0.7)'   // the crack across each horn
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx + s * w * 0.3, cy - h * 0.24); ctx.lineTo(cx + s * w * 0.44, cy - h * 0.36)
    ctx.stroke()
  }
  // cranium — lit from the upper-left
  const g = ctx.createRadialGradient(cx - w * 0.16, cy - h * 0.28, 1, cx, cy - h * 0.06, w * 0.56)
  g.addColorStop(0, sol_shade(base, 0.3))
  g.addColorStop(0.55, base)
  g.addColorStop(1, sol_shade(base, -0.45))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.ellipse(cx, cy - h * 0.08, w * 0.38, h * 0.34, 0, 0, Math.PI * 2); ctx.fill()
  // cheekbones + maxilla — a second, cooler gradient block under the cranium
  const cg = ctx.createLinearGradient(0, cy - h * 0.05, 0, cy + h * 0.24)
  cg.addColorStop(0, sol_shade(base, 0.05))
  cg.addColorStop(1, sol_shade(base, -0.34))
  ctx.fillStyle = cg
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.36, cy - h * 0.06)
  ctx.quadraticCurveTo(cx - w * 0.3, cy + h * 0.2, cx - w * 0.19, cy + h * 0.21)
  ctx.lineTo(cx + w * 0.19, cy + h * 0.21)
  ctx.quadraticCurveTo(cx + w * 0.3, cy + h * 0.2, cx + w * 0.36, cy - h * 0.06)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = sol_shade(base, -0.55)   // zygomatic arches
  ctx.lineWidth = 1
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + s * w * 0.34, cy - h * 0.02)
    ctx.quadraticCurveTo(cx + s * w * 0.26, cy + h * 0.08, cx + s * w * 0.14, cy + h * 0.09)
    ctx.stroke()
  }
  // sockets: deep, angled inward, with pinprick eyes burning at the back
  const sy = cy - h * 0.1
  for (const s of [-1, 1]) {
    ctx.save()
    ctx.translate(cx + s * w * 0.17, sy)
    ctx.rotate(s * 0.34)
    ctx.fillStyle = '#160305'
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.13, h * 0.14 + (winding ? 1 : 0), 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.beginPath(); ctx.ellipse(0, -h * 0.03, w * 0.11, h * 0.06, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  const ex = cx + d * 1.2
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, (winding ? 0.7 + 0.3 * tg : 0.6) * (0.55 + 0.45 * pulse) * (1 - rot * 0.6))
  ctx.fillStyle = winding && tg > 0.4 ? '#ffffff' : '#ffe14d'
  const eR = 1.4 + tg * 1.1
  ctx.beginPath(); ctx.arc(ex - w * 0.17, sy + 1, eR, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(ex + w * 0.17, sy + 1, eR, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  glow(ctx, winding ? C.SPARK : C.EMBER, ex - w * 0.17, sy + 1, 3.5 + tg * 3, (0.3 + 0.4 * tg) * (1 - rot * 0.6) * pulse)
  glow(ctx, winding ? C.SPARK : C.EMBER, ex + w * 0.17, sy + 1, 3.5 + tg * 3, (0.3 + 0.4 * tg) * (1 - rot * 0.6) * pulse)
  // nasal cavity — the read that says SKULL
  fly_poly(ctx, '#1a0406', cx, cy + h * 0.01, cx + w * 0.06, cy + h * 0.12, cx - w * 0.06, cy + h * 0.12)
  // the jaw: hangs, then SNAPS through the anim phase (gapes on windup + dart)
  const swing = Math.max(0, Math.sin(anim * 0.15))
  const open = Math.max(Math.pow(swing, 0.6) * 0.55, darting ? 1 : tg * 0.9)
  const jy = cy + h * 0.21, drop = open * h * 0.24
  ctx.fillStyle = '#280305'   // gullet behind the teeth
  ctx.fillRect(Math.round(cx - w * 0.2), Math.round(jy - 1), Math.round(w * 0.4), Math.max(1, drop + 2))
  ctx.fillStyle = '#f2e6cc'   // upper teeth on the maxilla (one gap, for character)
  for (let i = 0; i < 5; i++) {
    if (i === 3) continue
    ctx.fillRect(Math.round(cx - w * 0.19 + i * w * 0.08), Math.round(jy - 1), 2.4, 2.6)
  }
  const jg = ctx.createLinearGradient(0, jy + drop - 2, 0, jy + drop + h * 0.14)
  jg.addColorStop(0, sol_shade(base, -0.1))
  jg.addColorStop(1, sol_shade(base, -0.5))
  ctx.fillStyle = jg
  ctx.beginPath()
  ctx.moveTo(cx - w * 0.22, jy + drop)
  ctx.lineTo(cx + w * 0.22, jy + drop)
  ctx.quadraticCurveTo(cx + w * 0.16, jy + drop + h * 0.15, cx, jy + drop + h * 0.16)
  ctx.quadraticCurveTo(cx - w * 0.16, jy + drop + h * 0.15, cx - w * 0.22, jy + drop)
  ctx.closePath(); ctx.fill()
  ctx.strokeStyle = sol_shade(base, -0.62)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#e8dcc0'   // lower teeth ride the jaw down
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx - w * 0.15 + i * w * 0.09), Math.round(jy + drop), 2.2, 2.2)
  if (open > 0.45) glow(ctx, C.DEMON_RED, cx, jy + drop * 0.5, 4 + open * 5, open * 0.35 * (1 - rot) * pulse)
}

function foe_panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, en: FoeView, time: number, pulse: number): void {
  const d = en.dir >= 0 ? 1 : -1
  const tg = en.telegraph ?? 0
  // the maw glow ramps as the shot cadence approaches, windup or not
  const charge = Math.max(tg, 1 - Math.min(1, (en.fireCd ?? 99) / 0.6))
  const stone = '#3c3f5e'
  const cx = x + w / 2
  const seed = (x | 0) + 3
  // 1) the block itself — it IS the wall, so it fills the tile flush
  const bg = ctx.createLinearGradient(0, y, 0, y + h)
  bg.addColorStop(0, sol_shade(stone, 0.16))
  bg.addColorStop(0.55, stone)
  bg.addColorStop(1, sol_shade(stone, -0.3))
  ctx.fillStyle = bg
  ctx.fillRect(x, y, w, h)
  // outer bevel: light catches the top/left chamfer, the bottom/right falls dark
  fly_poly(ctx, 'rgba(255,220,170,0.16)', x, y, x + w, y, x + w - 2.5, y + 2.5, x + 2.5, y + 2.5)
  fly_poly(ctx, 'rgba(255,220,170,0.1)', x, y, x + 2.5, y + 2.5, x + 2.5, y + h - 2.5, x, y + h)
  fly_poly(ctx, 'rgba(8,8,18,0.4)', x + w, y, x + w, y + h, x + w - 2.5, y + h - 2.5, x + w - 2.5, y + 2.5)
  fly_poly(ctx, 'rgba(8,8,18,0.45)', x, y + h, x + w, y + h, x + w - 2.5, y + h - 2.5, x + 2.5, y + h - 2.5)
  // 2) the recess the face is cut into — darker, with an inner cast shadow
  const rx0 = x + w * 0.16, ry0 = y + h * 0.15, rw = w * 0.68, rh = h * 0.72
  const rg = ctx.createLinearGradient(0, ry0, 0, ry0 + rh)
  rg.addColorStop(0, sol_shade(stone, -0.42))
  rg.addColorStop(0.4, sol_shade(stone, -0.12))
  rg.addColorStop(1, sol_shade(stone, -0.26))
  ctx.fillStyle = rg
  rr(ctx, rx0, ry0, rw, rh, 3); ctx.fill()
  ctx.fillStyle = 'rgba(6,6,14,0.4)'
  ctx.fillRect(rx0, ry0, rw, 2)
  ctx.strokeStyle = 'rgba(190,200,240,0.14)'   // the lower lip of the recess bounces light
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(rx0 + 1, ry0 + rh - 0.6); ctx.lineTo(rx0 + rw - 1, ry0 + rh - 0.6); ctx.stroke()
  // 3) heavy brow ridge — a proud slab with a lit crest and a hard undershadow
  const browY = y + h * 0.34
  fly_poly(ctx, sol_shade(stone, 0.24),
    cx - w * 0.3, browY, cx - w * 0.1, browY - h * 0.06, cx + w * 0.1, browY - h * 0.06, cx + w * 0.3, browY)
  fly_poly(ctx, sol_shade(stone, 0.02),
    cx - w * 0.3, browY, cx + w * 0.3, browY, cx + w * 0.26, browY + h * 0.05, cx - w * 0.26, browY + h * 0.05)
  ctx.fillStyle = 'rgba(4,4,10,0.5)'
  ctx.fillRect(cx - w * 0.26, browY + h * 0.05, w * 0.52, 1.6)
  ctx.strokeStyle = 'rgba(255,220,170,0.22)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - w * 0.24, browY - h * 0.03); ctx.lineTo(cx + w * 0.14, browY - h * 0.05); ctx.stroke()
  // 4) stone eyelids — normally SHUT; they crack open rarely to show the fire
  //    (the slow blink runs on a stretched clock so the reveal lasts)
  const open = Math.max(blink(time, seed), blink(time * 0.35, seed + 11), charge > 0.75 ? (charge - 0.75) * 3 : 0)
  const eyY = browY + h * 0.12
  for (const s of [-1, 1]) {
    const ex = cx + s * w * 0.15
    ctx.fillStyle = '#100f1c'   // the socket behind the lids
    ctx.beginPath(); ctx.ellipse(ex, eyY, w * 0.1, h * 0.07, 0, 0, Math.PI * 2); ctx.fill()
    if (open > 0.04) {   // a hot slit widens between the lids
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.min(1, open * (0.6 + 0.4 * pulse))
      ctx.fillStyle = charge > 0.5 ? '#ffd06a' : '#ff7a3a'
      ctx.beginPath(); ctx.ellipse(ex + d * w * 0.02, eyY, w * 0.075, h * 0.055 * open, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      glow(ctx, C.EMBER, ex + d * w * 0.02, eyY, 4 + open * 3, open * (0.3 + charge * 0.3) * pulse)
    }
    // the lids: two carved shutters that part
    ctx.fillStyle = sol_shade(stone, 0.1)
    const lidH = h * 0.075 * (1 - open * 0.85)
    ctx.fillRect(Math.round(ex - w * 0.1), Math.round(eyY - h * 0.075), Math.round(w * 0.2), Math.max(0, lidH))
    ctx.fillStyle = sol_shade(stone, -0.2)
    ctx.fillRect(Math.round(ex - w * 0.1), Math.round(eyY + h * 0.075 - lidH), Math.round(w * 0.2), Math.max(0, lidH))
    ctx.strokeStyle = 'rgba(6,6,14,0.5)'
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(ex - w * 0.1, eyY - h * 0.075 + lidH); ctx.lineTo(ex + w * 0.1, eyY - h * 0.075 + lidH); ctx.stroke()
  }
  // 5) the maw — a carved slot whose throat runs hotter as the charge builds
  const mw = w * 0.34, mh = h * 0.14 + charge * 2.5
  const mx = cx - mw / 2, my = y + h * 0.66
  ctx.fillStyle = '#08070f'
  rr(ctx, mx, my, mw, mh, 1.5); ctx.fill()
  const throat = ctx.createLinearGradient(mx + d * mw * 0.2, my, mx + d * mw * 0.2, my + mh)
  throat.addColorStop(0, `rgba(${(90 + charge * 165) | 0},${(30 + charge * 90) | 0},${(20 + charge * 20) | 0},${0.5 + charge * 0.5})`)
  throat.addColorStop(1, `rgba(${(40 + charge * 120) | 0},${(10 + charge * 40) | 0},12,${0.35 + charge * 0.5})`)
  ctx.fillStyle = throat
  ctx.fillRect(mx + 1, my + 1, mw - 2, mh - 2)
  ctx.fillStyle = 'rgba(20,18,32,0.9)'   // stone fangs biting into the slot
  for (let i = 0; i < 4; i++) {
    const fx = mx + 2 + i * (mw - 4) / 3.4
    fly_poly(ctx, 'rgba(20,18,32,0.9)', fx, my, fx + 3, my, fx + 1.5, my + mh * 0.55)
    fly_poly(ctx, 'rgba(20,18,32,0.75)', fx + 1.5, my + mh, fx + 4.5, my + mh, fx + 3, my + mh * 0.45)
  }
  glow(ctx, C.EMBER, cx + d * mw * 0.3, my + mh * 0.5, 4 + charge * 8, charge * 0.5 * pulse)
  glow(ctx, C.DEMON_RED, cx + d * mw * 0.42, my + mh * 0.5, 4 + charge * 10, charge * 0.6 * pulse)
  // 6) three runes around the frame, igniting in sequence as the charge climbs
  const runes: number[][] = [[x + w * 0.09, y + h * 0.72, 0], [cx, y + h * 0.08, 1], [x + w * 0.91, y + h * 0.72, 2]]
  for (let i = 0; i < 3; i++) {
    const lit = Math.max(0, Math.min(1, (charge - i * 0.3) / 0.28))
    fly_rune(ctx, runes[i][0], runes[i][1], 3.2, runes[i][2], lit, pulse)
  }
}

// ── props ───────────────────────────────────────────────────

function prop_mirror(ctx: CanvasRenderingContext2D, col: number, row: number, time: number, pulse: number, tg: number): void {
  const x = col * TILE, y = row * TILE
  const cx = x + TILE / 2, cy = y + TILE / 2
  glow(ctx, '#b478ff', cx, cy, TILE * (0.7 + tg * 0.5), (0.15 + tg * 0.45) * pulse)
  ctx.fillStyle = '#15172b'
  rr(ctx, x + 3, y + 2, TILE - 6, TILE - 4, 6); ctx.fill()
  ctx.strokeStyle = '#3a2a5a'; ctx.lineWidth = 2
  rr(ctx, x + 3, y + 2, TILE - 6, TILE - 4, 6); ctx.stroke()
  // shifting sheen — accelerates as the emission charges
  const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE)
  const p = (Math.sin(time * (2 + tg * 6)) + 1) * 0.5
  g.addColorStop(Math.max(0, p - 0.2), 'rgba(40,20,70,0.2)')
  g.addColorStop(p, `rgba(180,120,255,${0.45 + tg * 0.3})`)
  g.addColorStop(Math.min(1, p + 0.2), 'rgba(40,20,70,0.2)')
  ctx.fillStyle = g
  rr(ctx, x + 5, y + 4, TILE - 10, TILE - 8, 4); ctx.fill()
  // a violet vortex tightens toward the spawn
  if (tg > 0.1) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(200,150,255,${tg * 0.6})`
    ctx.lineWidth = 1.2
    for (let i = 0; i < 2; i++) {
      const a0 = time * (3 + tg * 5) + i * Math.PI
      const rad = (TILE * 0.32) * (1 - tg * 0.5)
      ctx.beginPath()
      ctx.arc(cx, cy, rad + i * 3, a0, a0 + 2.2)
      ctx.stroke()
    }
    ctx.restore()
  }
  // hollow sockets — glow red as the spawn nears
  ctx.fillStyle = tg > 0.7 ? '#c03030' : 'rgba(0,0,0,0.6)'
  ctx.beginPath(); ctx.arc(x + TILE * 0.38, y + TILE * 0.42, 2.4, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(x + TILE * 0.62, y + TILE * 0.42, 2.4, 0, Math.PI * 2); ctx.fill()
}

function prop_door(ctx: CanvasRenderingContext2D, col: number, row: number, anim: number, time: number, pulse: number): void {
  const x = col * TILE, y = row * TILE
  // stone arch: jambs + keystone
  ctx.fillStyle = sol_shade(C.rock, -0.05)
  ctx.fillRect(x - 2, y - TILE * 0.16, TILE + 4, TILE * 1.16)
  ctx.fillStyle = sol_shade(C.rockLite, -0.05)
  ctx.beginPath()
  ctx.moveTo(x + TILE / 2 - 5, y - TILE * 0.16)
  ctx.lineTo(x + TILE / 2, y - TILE * 0.28)
  ctx.lineTo(x + TILE / 2 + 5, y - TILE * 0.16)
  ctx.closePath(); ctx.fill()
  if (anim > 0) {
    // opening: gold spill + planks swinging away
    const g = ctx.createLinearGradient(x, y, x, y + TILE)
    g.addColorStop(0, `rgba(255,230,120,${0.5 + 0.3 * pulse})`)
    g.addColorStop(1, `rgba(255,170,40,${0.4 + 0.3 * pulse})`)
    ctx.fillStyle = g
    ctx.fillRect(x + 3, y + 1, TILE - 6, TILE - 2)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillRect(x + TILE / 2 - 1, y + 2, 2, TILE - 4)
    if (anim < 1) {
      ctx.save()
      ctx.globalAlpha = 1 - anim
      ctx.translate(x + 3, y)
      ctx.scale(1 - anim * 0.85, 1)
      door_planks(ctx, 0, 1, TILE - 6, TILE - 2)
      ctx.restore()
    }
    // rising spark motes in the doorway
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 3; i++) {
      const ph = (time * (0.6 + i * 0.2) + i * 0.37) % 1
      ctx.globalAlpha = (1 - ph) * 0.6 * anim
      ctx.fillStyle = C.DOOR_GOLD
      ctx.fillRect(x + 6 + i * 7 + Math.sin(ph * 6 + i) * 2, y + TILE - 4 - ph * (TILE - 8), 2, 2)
    }
    ctx.restore()
  } else {
    door_planks(ctx, x + 3, y + 1, TILE - 6, TILE - 2)
    // keyhole (glints faintly with the torch pulse)
    ctx.fillStyle = `rgba(255,215,106,${0.25 * pulse})`
    ctx.beginPath(); ctx.arc(x + TILE / 2, y + TILE * 0.55, 1.6, 0, Math.PI * 2); ctx.fill()
  }
}

function door_planks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, y, x + w, y)
  g.addColorStop(0, '#2e2110'); g.addColorStop(0.5, '#241a0d'); g.addColorStop(1, '#1c1409')
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#3c2c16'; ctx.lineWidth = 2
  for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 3, y); ctx.lineTo(x + i * w / 3, y + h); ctx.stroke() }
  // iron bands + rivets
  ctx.fillStyle = '#151312'
  ctx.fillRect(x, y + h * 0.22, w, 2.4)
  ctx.fillRect(x, y + h * 0.68, w, 2.4)
  ctx.fillStyle = '#4c4640'
  for (const by of [y + h * 0.22, y + h * 0.68]) {
    for (let i = 0; i < 3; i++) { ctx.fillRect(x + 2 + i * (w - 6) / 2, by + 0.5, 1.6, 1.6) }
  }
}

// ── items ───────────────────────────────────────────────────

const ITEM_GLOW: Record<string, string> = {
  key: C.DOOR_GOLD, bell: C.DOOR_GOLD, jewel: '#5fd6ff', treasure: C.DOOR_GOLD,
  jar: '#3a86ff', superjar: '#ff7a2a', scroll: '#efe2c0', hourglass: '#5fd6ff',
  hourglassHalf: '#ffb24d', fairy: C.FAIRY, life: '#78b4ff', seal: C.SEAL,
  zodiac: '#ffd76a', wings: C.DOOR_GOLD, pageTime: '#78dcff', pageSpace: '#c8a0ff',
  princess: C.FAIRY,
}

function item_draw(ctx: CanvasRenderingContext2D, kind: string, col: number, row: number, time: number, pulse: number, reveal: number, hiddenGhost: boolean): void {
  const cx = col * TILE + TILE / 2
  const cy = row * TILE + TILE / 2 + Math.sin(time * 3 + col) * 1.5
  ctx.save()
  if (hiddenGhost) ctx.globalAlpha = 0.35
  // reveal pop: easeOutBack scale-in as `reveal` decays 0.4 → 0
  if (reveal > 0) {
    const pr = 1 - reveal / 0.4
    const s = 0.4 + 0.6 * easeOutBack(Math.max(0, Math.min(1, pr)))
    ctx.translate(cx, cy)
    ctx.scale(s, s)
    ctx.translate(-cx, -cy)
    glow(ctx, '#fff6d0', cx, cy, 16 * (1 - pr) + 8, (1 - pr) * 0.8)
  }
  glow(ctx, ITEM_GLOW[kind] ?? C.DOOR_GOLD, cx, cy, 12, (0.22 + 0.14 * pulse) * (hiddenGhost ? 0.4 : 1))
  switch (kind) {
    case 'key': item_key(ctx, cx, cy, time); break
    case 'bell': item_bell(ctx, cx, cy); break
    case 'jewel': item_jewel(ctx, cx, cy, '#5fd6ff', time); break
    case 'treasure': item_treasure(ctx, cx, cy); break
    case 'jar': item_jar(ctx, cx, cy, '#3a86ff', '#bfe0ff'); break
    case 'superjar': item_jar(ctx, cx, cy, '#ff7a2a', '#ffd08a'); break
    case 'scroll': item_scroll(ctx, cx, cy); break
    case 'hourglass': item_hourglass(ctx, cx, cy, '#5fd6ff'); break
    case 'hourglassHalf': item_hourglass(ctx, cx, cy, '#ffb24d'); break
    case 'fairy': item_fairy(ctx, cx, cy, time, pulse); break
    case 'life': item_life(ctx, cx, cy); break
    case 'seal': item_seal(ctx, cx, cy, time, pulse); break
    case 'zodiac': item_zodiac(ctx, cx, cy, time); break
    case 'wings': item_wings(ctx, cx, cy, time); break
    case 'pageTime': item_page(ctx, cx, cy, time, true); break
    case 'pageSpace': item_page(ctx, cx, cy, time, false); break
    case 'princess': item_princess(ctx, cx, cy, time, pulse); break
  }
  ctx.restore()
}

function item_key(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
  // the objective — brighter aura + one orbiting glint
  glow(ctx, C.DOOR_GOLD, cx, cy, 15, 0.35)
  const a = time * 2.2
  glow(ctx, '#fff6d0', cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, 3.4, 0.7)
  ctx.strokeStyle = C.gold
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 9); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy + 9); ctx.lineTo(cx + 5, cy + 9); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx + 4, cy + 5); ctx.stroke()
  ctx.strokeStyle = 'rgba(255,246,210,0.8)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx - 1, cy - 6, 4, Math.PI * 0.7, Math.PI * 1.5); ctx.stroke()
}

function item_bell(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const g = ctx.createLinearGradient(cx - 7, cy - 7, cx + 7, cy + 5)
  g.addColorStop(0, sol_shade(C.gold, 0.3)); g.addColorStop(1, sol_shade(C.gold, -0.25))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(cx, cy - 7)
  ctx.quadraticCurveTo(cx + 7, cy - 4, cx + 6, cy + 4)
  ctx.lineTo(cx - 6, cy + 4)
  ctx.quadraticCurveTo(cx - 7, cy - 4, cx, cy - 7)
  ctx.fill()
  ctx.fillStyle = '#b8860b'; ctx.fillRect(Math.round(cx - 7), Math.round(cy + 4), 14, 2)
  ctx.beginPath(); ctx.arc(cx, cy + 7, 1.6, 0, Math.PI * 2); ctx.fill()
}

function item_jewel(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, time: number): void {
  const r = 6
  ctx.fillStyle = color
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.4, cy - r * 0.2); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill()
  // deterministic twinkle glint
  const tw = Math.max(0, Math.sin(time * 2.4 + cx))
  if (tw > 0.9) {
    ctx.strokeStyle = `rgba(255,255,255,${(tw - 0.9) * 8})`
    ctx.lineWidth = 0.8
    ctx.beginPath(); ctx.moveTo(cx - 4, cy - 3); ctx.lineTo(cx + 2, cy - 3); ctx.moveTo(cx - 1, cy - 6); ctx.lineTo(cx - 1, cy); ctx.stroke()
  }
}

function item_jar(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, flame: string): void {
  const g = ctx.createLinearGradient(cx - 5, cy, cx + 5, cy)
  g.addColorStop(0, sol_shade(body, 0.25)); g.addColorStop(1, sol_shade(body, -0.3))
  ctx.fillStyle = g
  rr(ctx, cx - 5, cy - 3, 10, 9, 3); ctx.fill()
  ctx.fillStyle = '#2a2a40'; ctx.fillRect(Math.round(cx - 3), Math.round(cy - 6), 6, 3)
  ctx.fillStyle = flame
  ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx - 3, cy - 6); ctx.lineTo(cx + 3, cy - 6); ctx.closePath(); ctx.fill()
}

function item_hourglass(ctx: CanvasRenderingContext2D, cx: number, cy: number, sand: string): void {
  ctx.fillStyle = '#caa86a'
  ctx.fillRect(Math.round(cx - 6), Math.round(cy - 8), 12, 2); ctx.fillRect(Math.round(cx - 6), Math.round(cy + 6), 12, 2)
  ctx.fillStyle = sand
  ctx.beginPath(); ctx.moveTo(cx - 5, cy - 6); ctx.lineTo(cx + 5, cy - 6); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 5, cy + 6); ctx.lineTo(cx + 5, cy + 6); ctx.closePath(); ctx.fill()
}

function item_fairy(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, pulse: number): void {
  const flap = Math.sin(time * 18) * 3
  glow(ctx, C.FAIRY, cx, cy, 10, 0.4 * pulse)
  ctx.fillStyle = 'rgba(220,200,255,0.85)'
  ctx.beginPath(); ctx.ellipse(cx - 4, cy, 3, 5 + flap, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx + 4, cy, 3, 5 + flap, 0.4, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ffd6f0'
  ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill()
}

function item_life(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = C.hat
  ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx - 6, cy - 1); ctx.lineTo(cx + 6, cy - 1); ctx.closePath(); ctx.fill()
  ctx.fillStyle = C.face; ctx.beginPath(); ctx.arc(cx, cy + 2, 4, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = C.danaRobe; ctx.fillRect(Math.round(cx - 3), Math.round(cy + 3), 6, 4)
}

function item_treasure(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const g = ctx.createLinearGradient(cx - 7, cy - 6, cx + 6, cy + 7)
  g.addColorStop(0, sol_shade('#b07a2a', 0.2)); g.addColorStop(1, sol_shade('#b07a2a', -0.25))
  ctx.fillStyle = g
  ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.quadraticCurveTo(cx + 8, cy - 2, cx + 6, cy + 7); ctx.lineTo(cx - 6, cy + 7); ctx.quadraticCurveTo(cx - 8, cy - 2, cx, cy - 6); ctx.fill()
  ctx.fillStyle = '#7a5018'; ctx.fillRect(Math.round(cx - 5), Math.round(cy - 6), 10, 2)
  ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('$', cx, cy + 2)
}

function item_scroll(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.fillStyle = '#efe2c0'
  rr(ctx, cx - 7, cy - 4, 14, 8, 2); ctx.fill()
  ctx.fillStyle = '#cdbf95'; ctx.fillRect(Math.round(cx - 7), Math.round(cy - 4), 2, 8); ctx.fillRect(Math.round(cx + 5), Math.round(cy - 4), 2, 8)
  ctx.strokeStyle = '#9a8a5a'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - 3, cy - 1); ctx.lineTo(cx + 3, cy - 1); ctx.moveTo(cx - 3, cy + 1); ctx.lineTo(cx + 3, cy + 1); ctx.stroke()
}

function item_seal(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, pulse: number): void {
  const r = 7 + Math.sin(time * 4) * 0.6
  glow(ctx, C.SEAL, cx, cy, 13, 0.4 * pulse)
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
}

function item_zodiac(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
  ctx.fillStyle = '#1b1740'
  rr(ctx, cx - 9, cy - 8, 18, 16, 3); ctx.fill()
  ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 1.5
  rr(ctx, cx - 9, cy - 8, 18, 16, 3); ctx.stroke()
  const stars: [number, number][] = [[-5, -3], [0, -5], [4, 1], [-2, 4], [6, 5]]
  ctx.strokeStyle = 'rgba(255,235,160,0.7)'; ctx.lineWidth = 1
  ctx.beginPath()
  stars.forEach(([sx, sy], i) => { i === 0 ? ctx.moveTo(cx + sx, cy + sy) : ctx.lineTo(cx + sx, cy + sy) })
  ctx.stroke()
  ctx.fillStyle = '#fff7d0'
  for (const [sx, sy] of stars) {
    const tw = 1 + (Math.sin(time * 5 + sx) + 1) * 0.6
    ctx.beginPath(); ctx.arc(cx + sx, cy + sy, tw, 0, Math.PI * 2); ctx.fill()
  }
}

function item_wings(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
  const flap = Math.sin(time * 8) * 2
  ctx.fillStyle = '#ffd24d'
  for (const s of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(cx, cy)
    ctx.quadraticCurveTo(cx + s * 12, cy - 6 - flap, cx + s * 11, cy + 4)
    ctx.quadraticCurveTo(cx + s * 7, cy + 1, cx, cy + 3)
    ctx.closePath(); ctx.fill()
  }
  ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill()
}

function item_page(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, isTime: boolean): void {
  ctx.fillStyle = '#efe2c0'
  rr(ctx, cx - 6, cy - 8, 12, 16, 2); ctx.fill()
  ctx.strokeStyle = '#bda87a'; ctx.lineWidth = 1
  rr(ctx, cx - 6, cy - 8, 12, 16, 2); ctx.stroke()
  if (isTime) {
    ctx.strokeStyle = '#2a7ad0'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke()
    const a = time * 1.5
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a * 0.2) * 2, cy + Math.sin(a * 0.2) * 2); ctx.stroke()
  } else {
    ctx.fillStyle = '#7a4fd0'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#9b7cff'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.4, time * 0.6, 0, Math.PI * 2); ctx.stroke()
    const sa = time * 1.2
    ctx.fillStyle = '#fff7d0'; ctx.beginPath(); ctx.arc(cx + Math.cos(sa) * 5, cy + Math.sin(sa) * 2.4, 1.2, 0, Math.PI * 2); ctx.fill()
  }
}

function item_princess(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, pulse: number): void {
  glow(ctx, C.FAIRY, cx, cy, 16, 0.5 * pulse)
  ctx.fillStyle = 'rgba(220,200,255,0.8)'
  ctx.beginPath(); ctx.ellipse(cx - 6, cy, 4, 8, -0.4, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx + 6, cy, 4, 8, 0.4, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ff9ed6'
  ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx - 6, cy + 10); ctx.lineTo(cx + 6, cy + 10); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#ffe0c0'; ctx.beginPath(); ctx.arc(cx, cy - 7, 4, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ffd24d'
  ctx.beginPath()
  ctx.moveTo(cx - 4, cy - 9); ctx.lineTo(cx - 4, cy - 12); ctx.lineTo(cx - 1, cy - 10)
  ctx.lineTo(cx, cy - 13); ctx.lineTo(cx + 1, cy - 10); ctx.lineTo(cx + 4, cy - 12); ctx.lineTo(cx + 4, cy - 9)
  ctx.closePath(); ctx.fill()
}

// ── projectiles ─────────────────────────────────────────────

let FIRE_CORE: HTMLCanvasElement | null = null
let FIRE_CORE_SUPER: HTMLCanvasElement | null = null
let SHOT_CORE: HTMLCanvasElement | null = null

function projCore(kind: 'fire' | 'super' | 'shot'): HTMLCanvasElement {
  const build = (stops: [number, string][]): HTMLCanvasElement => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 48
    const x = cv.getContext('2d')!
    const g = x.createRadialGradient(24, 24, 0, 24, 24, 24)
    for (const [o, c] of stops) g.addColorStop(o, c)
    x.fillStyle = g; x.fillRect(0, 0, 48, 48)
    return cv
  }
  if (kind === 'super') return FIRE_CORE_SUPER ??= build([[0, '#ffffff'], [0.35, '#ffd08a'], [0.65, '#ff8f3a'], [1, 'rgba(255,100,20,0)']])
  if (kind === 'fire') return FIRE_CORE ??= build([[0, '#ffffff'], [0.35, '#bfe0ff'], [0.65, '#4aa0ff'], [1, 'rgba(40,100,255,0)']])
  return SHOT_CORE ??= build([[0, '#ffffff'], [0.4, '#ff5a2a'], [1, 'rgba(120,20,0,0)']])
}

function proj_fireball(ctx: CanvasRenderingContext2D, f: Fireball, time: number, pulse: number): void {
  const dir = Math.sign(f.vx) || 1
  const r = f.super ? 9 : 8
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // trail: gradient streak + three fading ghost dabs
  ctx.fillStyle = f.super ? 'rgba(255,140,40,0.3)' : 'rgba(80,160,255,0.3)'
  ctx.beginPath()
  ctx.moveTo(f.x - dir * 4, f.y - 4)
  ctx.lineTo(f.x - dir * 18, f.y)
  ctx.lineTo(f.x - dir * 4, f.y + 4)
  ctx.closePath(); ctx.fill()
  const core = projCore(f.super ? 'super' : 'fire')
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.12 * i
    const gr = r * (0.5 + i * 0.14)
    ctx.drawImage(core, f.x - dir * i * 6 - gr, f.y - gr, gr * 2, gr * 2)
  }
  ctx.globalAlpha = 0.85 + 0.15 * pulse
  ctx.drawImage(core, f.x - r, f.y - r, r * 2, r * 2)
  // two spark flecks
  for (let i = 0; i < 2; i++) {
    const a = time * 14 + i * Math.PI
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#fff'
    ctx.fillRect(f.x + Math.cos(a) * r * 0.7 - 1, f.y + Math.sin(a) * r * 0.7 - 1, 2, 2)
  }
  ctx.restore()
}

function proj_shot(ctx: CanvasRenderingContext2D, s: Shot, time: number, pulse: number): void {
  const dir = Math.sign(s.vx) || 1
  // smoke dabs (non-additive, behind)
  ctx.save()
  ctx.fillStyle = 'rgba(60,50,45,0.35)'
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath()
    ctx.arc(s.x - dir * i * 6, s.y - i, 2.4 - i * 0.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'lighter'
  const flick = 0.9 + sol_hash(Math.floor(time * 30) + ((s.x | 0) & 63)) * 0.3
  const r = 6 * flick
  ctx.globalAlpha = 0.85 + 0.15 * pulse
  ctx.drawImage(projCore('shot'), s.x - r, s.y - r, r * 2, r * 2)
  ctx.restore()
}

// ── fx ──────────────────────────────────────────────────────

/** The un-revealed SECRET cue — a faint violet twinkle + a rare rising mote.
 *  Deliberately subtle: a sharp eye catches it, it's no beacon. */
function fx_secretHint(ctx: CanvasRenderingContext2D, col: number, row: number, time: number): void {
  const cx = col * TILE + TILE / 2, cy = row * TILE + TILE / 2
  const tw = Math.max(0, Math.sin(time * 1.5 + col * 1.7 + row))
  const a = 0.05 + tw * tw * 0.16
  ctx.save()
  ctx.fillStyle = `rgba(206,184,255,${a})`
  ctx.beginPath(); ctx.arc(cx, cy, 1.5 + tw * 1.3, 0, Math.PI * 2); ctx.fill()
  if (tw > 0.86) {
    ctx.strokeStyle = `rgba(232,222,255,${a})`; ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy); ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3); ctx.stroke()
    // a lone mote drifts up at the twinkle peak
    const ph = (time * 0.5 + sol_hash(col * 31 + row)) % 1
    ctx.fillStyle = `rgba(206,184,255,${(1 - ph) * 0.3})`
    ctx.fillRect(cx + Math.sin(ph * 9) * 2, cy - ph * 12, 1.4, 1.4)
  }
  ctx.restore()
}

function fx_wandTarget(ctx: CanvasRenderingContext2D, e: Engine, pulse: number): void {
  if (e.state !== 'playing') return
  const { col, row } = e.targetCell()
  if (!e.inBounds(col, row)) return
  if (e.tileAt(col, row) === WALL) return
  const breakable = e.breakableAt(col, row)
  const x = col * TILE, y = row * TILE
  ctx.save()
  ctx.strokeStyle = breakable ? 'rgba(255,140,120,0.5)' : 'rgba(150,255,200,0.45)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4)
  ctx.setLineDash([])
  // corner ticks breathe with the room's pulse
  ctx.globalAlpha = 0.25 + 0.45 * pulse
  ctx.lineWidth = 2
  const t = 5
  ctx.beginPath()
  ctx.moveTo(x + 2, y + 2 + t); ctx.lineTo(x + 2, y + 2); ctx.lineTo(x + 2 + t, y + 2)
  ctx.moveTo(x + TILE - 2 - t, y + 2); ctx.lineTo(x + TILE - 2, y + 2); ctx.lineTo(x + TILE - 2, y + 2 + t)
  ctx.moveTo(x + TILE - 2, y + TILE - 2 - t); ctx.lineTo(x + TILE - 2, y + TILE - 2); ctx.lineTo(x + TILE - 2 - t, y + TILE - 2)
  ctx.moveTo(x + 2 + t, y + TILE - 2); ctx.lineTo(x + 2, y + TILE - 2); ctx.lineTo(x + 2, y + TILE - 2 - t)
  ctx.stroke()
  ctx.restore()
}

// ── HUD ─────────────────────────────────────────────────────

function hud_bar(
  ctx: CanvasRenderingContext2D, e: Engine, time: number, viewW: number,
  panel: HTMLCanvasElement, scorePop: number, pulse: number,
): void {
  ctx.save()
  ctx.drawImage(panel, 0, 0)
  const midY = HUD_H / 2
  const font = (size: number, weight = 600) => `${weight} ${size}px "Segoe UI", system-ui, sans-serif`

  // SCORE — small-caps label + zero-padded numeral that pops on gains
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(8, 600)
  ctx.fillStyle = 'rgba(255,210,120,0.55)'
  ctx.fillText('S C O R E', 8, midY - 6)
  const popScale = 1 + 0.18 * scorePop
  ctx.save()
  ctx.translate(8, midY + 5)
  ctx.scale(popScale, popScale)
  ctx.font = font(12, 800)
  ctx.fillStyle = '#fff'
  ctx.fillText(String(e.score).padStart(7, '0'), 0, 0)
  ctx.restore()

  // LIFE — a real draining bar (the signature pressure made visible)
  const barW = 130, barH = 8
  const bx = viewW / 2 - barW / 2, by = midY - barH / 2
  const frac = Math.max(0, Math.min(1, e.life / LIFE_FULL))
  const low = e.life < 2000
  // hourglass glyph
  ctx.fillStyle = '#caa86a'
  ctx.fillRect(bx - 14, by - 1, 8, 1.6); ctx.fillRect(bx - 14, by + barH - 0.6, 8, 1.6)
  ctx.fillStyle = low ? '#ff8a5a' : '#ffd88a'
  ctx.beginPath(); ctx.moveTo(bx - 13.4, by + 0.8); ctx.lineTo(bx - 6.6, by + 0.8); ctx.lineTo(bx - 10, by + barH / 2); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(bx - 10, by + barH / 2); ctx.lineTo(bx - 13.4, by + barH - 0.8); ctx.lineTo(bx - 6.6, by + barH - 0.8); ctx.closePath(); ctx.fill()
  // track
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  rr(ctx, bx - 1, by - 1, barW + 2, barH + 2, 4); ctx.fill()
  ctx.strokeStyle = 'rgba(255,190,110,0.25)'
  ctx.lineWidth = 1
  rr(ctx, bx - 1, by - 1, barW + 2, barH + 2, 4); ctx.stroke()
  // fill: gold → amber, lerping red when low (pulses)
  if (frac > 0.004) {
    const g = ctx.createLinearGradient(bx, 0, bx + barW, 0)
    if (low) {
      const fl = Math.sin(time * 12) * 0.5 + 0.5
      g.addColorStop(0, `rgba(255,${90 + fl * 90 | 0},60,1)`)
      g.addColorStop(1, '#c22020')
    } else {
      g.addColorStop(0, '#ffe08a'); g.addColorStop(1, '#e8902c')
    }
    ctx.fillStyle = g
    rr(ctx, bx, by, Math.max(3, barW * frac), barH, 3); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    rr(ctx, bx, by, Math.max(3, barW * frac), barH * 0.45, 3); ctx.fill()
  }
  // numeric readout
  ctx.font = font(8, 700)
  ctx.textAlign = 'left'
  ctx.fillStyle = low ? '#ff9a7a' : 'rgba(255,225,160,0.75)'
  ctx.fillText(String(Math.max(0, Math.ceil(e.life / 10) * 10)).padStart(5, '0'), bx + barW + 6, midY)

  // right cluster ← ammo orbs · lives · fairy · seals · held badges
  let rx = viewW - 8
  // ammo: glowing mini-orbs, newest on the right
  for (let i = e.ammo.length - 1; i >= 0; i--) {
    const sx = rx - 5
    const sup = e.ammo[i]
    glow(ctx, sup ? '#ff8f3a' : '#4aa0ff', sx, midY, 7, 0.4 * pulse)
    ctx.fillStyle = sup ? '#ff8f3a' : '#4aa0ff'
    ctx.beginPath(); ctx.arc(sx, midY, 3.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(sx - 1, midY - 1, 1.2, 0, Math.PI * 2); ctx.fill()
    rx -= 11
  }
  if (e.ammo.length) rx -= 5
  // lives as mini Dana hats
  for (let i = 0; i < Math.min(e.lives, 5); i++) {
    const hx = rx - 5
    ctx.fillStyle = C.hat
    ctx.beginPath(); ctx.moveTo(hx, midY - 5); ctx.lineTo(hx - 5, midY + 4); ctx.lineTo(hx + 5, midY + 4); ctx.closePath(); ctx.fill()
    ctx.fillStyle = C.gold
    ctx.fillRect(hx - 0.8, midY - 6, 1.6, 1.6)
    rx -= 13
  }
  rx -= 4
  ctx.textAlign = 'right'
  ctx.font = font(11, 700)
  ctx.fillStyle = '#ffd6f0'
  ctx.fillText(`✦${e.fairyCount}`, rx, midY)
  rx -= ctx.measureText(`✦${e.fairyCount}`).width + 7
  if (e.sealCount > 0) {
    ctx.fillStyle = '#bfe0ff'
    ctx.fillText(`✡${e.sealCount}`, rx, midY)
    rx -= ctx.measureText(`✡${e.sealCount}`).width + 7
  }
  if (e.zodiacHeld) { ctx.fillStyle = '#ffd76a'; ctx.fillText('★', rx, midY); rx -= 14 }
  if (e.wingsHeld) { ctx.fillStyle = '#ffe39a'; ctx.fillText('≫', rx, midY); rx -= 14 }
  ctx.restore()
}

// ── craft-pass helpers ──────────────────────────────────────

function dana_clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function dana_lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

let dana_tipX = 0

let dana_tipY = 0

let dana_tipVX = 0

let dana_tipVY = 0

let dana_tipT = -1

function dana_tipSpring(time: number, tx: number, ty: number): void {
  let dt = dana_tipT < 0 ? 0.016 : time - dana_tipT
  dana_tipT = time
  dt = dana_clamp(dt, 0.001, 0.05)
  const K = 130, D = 12
  dana_tipVX += (K * (tx - dana_tipX) - D * dana_tipVX) * dt
  dana_tipVY += (K * (ty - dana_tipY) - D * dana_tipVY) * dt
  dana_tipX = dana_clamp(dana_tipX + dana_tipVX * dt, -7, 7)
  dana_tipY = dana_clamp(dana_tipY + dana_tipVY * dt, -6, 6)
}

/** Map a point drawn inside the squash/lean transform back to world space —
 *  lets the additive glows (star, wand spark) be blitted unsquashed. */
function dana_world(x: number, y: number, cx: number, footY: number, jx: number, sx: number, sy: number, rot: number): [number, number] {
  const lx = x - cx, ly = y - footY
  const c = Math.cos(rot), s = Math.sin(rot)
  return [cx + jx + (lx * c - ly * s) * sx, footY + (lx * s + ly * c) * sy]
}

/** Four-point star (hat tip, wand finial, cast sparkles). */
function dana_star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = rot + i * Math.PI / 4
    const rad = (i & 1) === 0 ? r : r * 0.42
    const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

/** A little leather boot: dark sole, toe cap toward facing, lit upper edge. */
function dana_boot(ctx: CanvasRenderingContext2D, x: number, y: number, f: number, tilt: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.fillStyle = 'rgba(18,12,8,0.9)'
  rr(ctx, -3.3, -1.0, 6.9, 1.2, 0.5)
  ctx.fill()
  ctx.fillStyle = sol_shade(C.danaRobeDark, -0.40)
  rr(ctx, -3.0, -3.3, 6.0, 3.0, 1.2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(f * 2.7, -1.3, 1.8, 1.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = sol_shade(C.danaRobeDark, 0.3)
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(-2.3, -3.0)
  ctx.lineTo(1.6, -3.0)
  ctx.stroke()
  ctx.restore()
}

/** A bare or clenched hand with a torch catchlight on the knuckle. */
function dana_hand(ctx: CanvasRenderingContext2D, x: number, y: number, fist: boolean): void {
  const r = fist ? 1.85 : 1.55
  ctx.fillStyle = sol_shade(C.face, -0.05)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = sol_shade(C.face, -0.48)
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  if (fist) {                                     // clenched knuckle crease
    ctx.beginPath()
    ctx.arc(x, y, r - 0.6, -0.5, 1.3)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,226,180,0.55)'
  ctx.beginPath()
  ctx.arc(x - 0.5, y - 0.6, 0.5, 0, Math.PI * 2)
  ctx.fill()
}

/** Two-segment sleeve read: a quadratic from shoulder to hand whose control
 *  point is thrown perpendicular by `bow` — the implied elbow. A lit seam
 *  runs the top of the cloth and a pale cuff band sits before the hand. */
function dana_arm(ctx: CanvasRenderingContext2D, sx0: number, sy0: number, hx: number, hy: number, bow: number, tone: number): void {
  const mx = (sx0 + hx) / 2, my = (sy0 + hy) / 2
  const dx = hx - sx0, dy = hy - sy0
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len, py = dx / len
  const ex = mx + px * bow, ey = my + py * bow
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = sol_shade(C.danaRobe, -0.10 + tone)
  ctx.lineWidth = 3.0
  ctx.beginPath()
  ctx.moveTo(sx0, sy0)
  ctx.quadraticCurveTo(ex, ey, hx, hy)
  ctx.stroke()
  ctx.strokeStyle = sol_shade(C.danaRobe, 0.24 + tone)   // torchlight seam
  ctx.lineWidth = 1.0
  ctx.beginPath()
  ctx.moveTo(sx0 - 0.3, sy0 - 0.8)
  ctx.quadraticCurveTo(ex - 0.3, ey - 1.0, hx - 0.2, hy - 0.8)
  ctx.stroke()
  const t = 0.84, u = 1 - t                              // cuff band at 84%
  const cxp = u * u * sx0 + 2 * u * t * ex + t * t * hx
  const cyp = u * u * sy0 + 2 * u * t * ey + t * t * hy
  ctx.strokeStyle = sol_shade(C.danaRobe, 0.38 + tone)
  ctx.lineWidth = 3.4
  ctx.beginPath()
  ctx.moveTo(cxp, cyp)
  ctx.lineTo(cxp + (hx - cxp) * 0.42, cyp + (hy - cyp) * 0.42)
  ctx.stroke()
  ctx.restore()
}

/** The wand: a thin worn-bright wooden stroke with a gold star finial.
 *  Returns the tip so the cast spark can ride it. */
function dana_wand(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, starK: number, time: number): [number, number] {
  const len = 8.2
  const dx = Math.cos(ang), dy = Math.sin(ang)
  const tx = x + dx * len, ty = y + dy * len
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#6b4a24'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x - dx * 2.2, y - dy * 2.2)                 // butt pokes past the grip
  ctx.lineTo(tx, ty)
  ctx.stroke()
  ctx.strokeStyle = '#9a7040'                            // handled-smooth leading half
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(x + dx * len * 0.45, y + dy * len * 0.45 - 0.4)
  ctx.lineTo(tx, ty - 0.4)
  ctx.stroke()
  dana_star(ctx, tx, ty, 1.7 * starK, time * 0.9, C.gold)
  ctx.fillStyle = '#fff8dc'
  ctx.beginPath()
  ctx.arc(tx, ty, 0.55 * starK, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return [tx, ty]
}

/** The robe silhouette: rounded shoulders, flanks flaring to a swaying,
 *  scalloped hem. `shx` shifts only the shoulders (idle weight-shift) while
 *  the hem stays planted over the feet. Built as a path so the hurt-flash
 *  can retrace the same silhouette. */
function dana_robePath(ctx: CanvasRenderingContext2D, cx: number, shx: number, robeTop: number, shW: number, hemW: number, hemY: number, sway: number, scoop: number): void {
  const midY = (robeTop + hemY) / 2
  ctx.beginPath()
  ctx.moveTo(cx + shx - shW, robeTop + 2)
  ctx.quadraticCurveTo(cx + shx, robeTop - 1.6, cx + shx + shW, robeTop + 2)
  ctx.quadraticCurveTo(cx + shx + shW + 1.2 + sway * 0.35, midY, cx + hemW + sway, hemY)
  ctx.quadraticCurveTo(cx + sway * 0.5, hemY + 2.2 + scoop, cx - hemW + sway, hemY)
  ctx.quadraticCurveTo(cx + shx - shW - 1.2 + sway * 0.35, midY, cx + shx - shW, robeTop + 2)
  ctx.closePath()
}

/** Head + face. One radial skin gradient lit upper-left, shade-side jaw
 *  contour, warm torch rim, far ear, mousy fringe, and the single big eye:
 *  white, robe-blue iris, tracked pupil, torch catchlight, lidded by openK.
 *  mood: 0 soft · 1 grim · 2 open-"oh" · 3 gritted. browK: +1 determined,
 *  −1 raised. */
function dana_face(ctx: CanvasRenderingContext2D, cx: number, hy: number, rH: number, f: number, lookX: number, lookY: number, openK: number, mood: number, browK: number): void {
  const g = ctx.createRadialGradient(cx - rH * 0.38, hy - rH * 0.42, rH * 0.18, cx, hy, rH * 1.06)
  g.addColorStop(0, sol_shade(C.face, 0.18))
  g.addColorStop(0.62, C.face)
  g.addColorStop(1, sol_shade(C.face, -0.28))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, hy, rH, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = sol_shade(C.face, -0.5)              // lower-right contour
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, hy, rH - 0.5, -0.25, 1.85)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,216,164,0.5)'              // upper-left torch rim
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.arc(cx, hy, rH - 0.6, Math.PI * 1.02, Math.PI * 1.55)
  ctx.stroke()
  // far ear
  const eaX = cx - f * rH * 0.94
  ctx.fillStyle = sol_shade(C.face, -0.12)
  ctx.beginPath()
  ctx.arc(eaX, hy + 0.6, 1.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = sol_shade(C.face, -0.42)
  ctx.lineWidth = 0.7
  ctx.beginPath()
  ctx.arc(eaX, hy + 0.6, 0.7, 0, Math.PI * 2)
  ctx.stroke()
  // fringe wisps escaping the brim
  ctx.strokeStyle = '#6b4322'
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const bx = cx + f * (i * 1.9 - 1.4)
    ctx.beginPath()
    ctx.moveTo(bx, hy - rH * 0.78)
    ctx.quadraticCurveTo(bx + f * 0.8, hy - rH * 0.5, bx + f * 0.4, hy - rH * 0.32)
    ctx.stroke()
  }
  // — the eye —
  const ex = cx + f * rH * 0.38
  const ey = hy - rH * 0.05
  if (openK > 0.18) {
    ctx.fillStyle = '#f6f9ff'
    ctx.beginPath()
    ctx.ellipse(ex, ey, 2.0, 2.3 * openK, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(60,35,20,0.4)'
    ctx.lineWidth = 0.7
    ctx.stroke()
    const ix = ex + lookX * 0.95, iy = ey + lookY * 0.9
    ctx.fillStyle = sol_shade(C.danaRobe, -0.12)         // boy-blue iris off the robe hue
    ctx.beginPath()
    ctx.arc(ix, iy, 1.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#10131f'
    ctx.beginPath()
    ctx.arc(ix + lookX * 0.2, iy + lookY * 0.2, 0.72, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.92)'             // catchlight, torch side
    ctx.beginPath()
    ctx.arc(ix - 0.5, iy - 0.55, 0.48, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.strokeStyle = '#5a3a26'
    ctx.lineWidth = 1
    ctx.beginPath()
    if (mood === 1) {                                    // wince: screwed shut
      ctx.moveTo(ex - 1.9, ey + 0.6)
      ctx.quadraticCurveTo(ex, ey - 0.9, ex + 1.9, ey + 0.6)
    } else {                                             // soft blink
      ctx.moveTo(ex - 1.8, ey + 0.2)
      ctx.quadraticCurveTo(ex, ey + 0.9, ex + 1.8, ey + 0.2)
    }
    ctx.stroke()
  }
  // brow — determined dips toward the nose, raised floats up
  const raise = Math.max(0, -browK) * 0.8
  ctx.strokeStyle = '#5a3a26'
  ctx.lineWidth = 1.1
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(ex - f * 2.1, ey - 2.6 - browK * 0.3 - raise)
  ctx.lineTo(ex + f * 1.8, ey - 2.8 + browK * 1.0 - raise)
  ctx.stroke()
  // the tiniest nose hook
  ctx.strokeStyle = sol_shade(C.face, -0.4)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(cx + f * rH * 0.66, hy + rH * 0.14)
  ctx.quadraticCurveTo(cx + f * rH * 0.78, hy + rH * 0.3, cx + f * rH * 0.6, hy + rH * 0.38)
  ctx.stroke()
  // mouth by mood
  const mxp = cx + f * rH * 0.30
  const myp = hy + rH * 0.52
  ctx.strokeStyle = '#7a4530'
  ctx.lineWidth = 1
  if (mood === 1) {                                      // grim — corners down
    ctx.beginPath()
    ctx.moveTo(mxp - 1.8, myp + 0.3)
    ctx.quadraticCurveTo(mxp + f * 0.2, myp - 0.7, mxp + 1.8, myp + 0.3)
    ctx.stroke()
  } else if (mood === 2) {                               // the apex "oh"
    ctx.fillStyle = '#4a2018'
    ctx.beginPath()
    ctx.ellipse(mxp, myp, 1.05, 1.35, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,190,170,0.5)'
    ctx.beginPath()
    ctx.ellipse(mxp, myp + 0.55, 0.6, 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (mood === 3) {                               // gritted teeth
    ctx.fillStyle = '#4a2018'
    ctx.fillRect(mxp - 1.9, myp - 0.7, 3.8, 1.5)
    ctx.fillStyle = '#e8e0d0'
    ctx.fillRect(mxp - 1.4, myp - 0.35, 2.8, 0.7)
  } else {                                               // soft default smile
    ctx.beginPath()
    ctx.moveTo(mxp - 1.7, myp - 0.3)
    ctx.quadraticCurveTo(mxp + f * 0.2, myp + 0.9, mxp + 1.8, myp - 0.4)
    ctx.stroke()
  }
}

/** The hat is the personality: brim ellipse + tall bent cone whose tip rides
 *  the spring offsets (tdx, tdy). Gradient-lit cone, fold crease chasing the
 *  bend, warm rim on the torch edge, hat band with a gold clasp, and the
 *  gold star riding the tip. Returns the star centre for the world glow. */
function dana_hat(ctx: CanvasRenderingContext2D, cx: number, brimY: number, halfBrim: number, coneH: number, f: number, tdx: number, tdy: number, time: number): [number, number] {
  const baseHalf = halfBrim * 0.66
  const tipX = cx + f * 1.4 + tdx
  const tipY = brimY - coneH + tdy
  const bendX = tdx * 0.34
  // — cone —
  const hg = ctx.createLinearGradient(cx - baseHalf, tipY, cx + baseHalf, brimY)
  hg.addColorStop(0, sol_shade(C.hat, 0.30))
  hg.addColorStop(0.5, C.hat)
  hg.addColorStop(1, sol_shade(C.hatDark, -0.20))
  ctx.fillStyle = hg
  ctx.beginPath()
  ctx.moveTo(cx - baseHalf, brimY - 0.4)
  ctx.quadraticCurveTo(cx - baseHalf * 0.58 + bendX, brimY - coneH * 0.56 + tdy * 0.35, tipX, tipY)
  ctx.quadraticCurveTo(cx + baseHalf * 0.34 + bendX, brimY - coneH * 0.50, cx + baseHalf, brimY - 0.4)
  ctx.closePath()
  ctx.fill()
  // dark contour down the shade-side edge
  ctx.strokeStyle = sol_shade(C.hatDark, -0.35)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx + baseHalf - 0.4, brimY - 0.6)
  ctx.quadraticCurveTo(cx + baseHalf * 0.34 + bendX, brimY - coneH * 0.50, tipX, tipY)
  ctx.stroke()
  // fold crease chasing the bend
  ctx.save()
  ctx.globalAlpha = 0.65
  ctx.strokeStyle = sol_shade(C.hat, -0.34)
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(cx - baseHalf * 0.16, brimY - 1.6)
  ctx.quadraticCurveTo(cx + bendX * 0.8, brimY - coneH * 0.5, tipX - (tipX - cx) * 0.16, tipY + coneH * 0.10)
  ctx.stroke()
  ctx.restore()
  // warm torch rim along the upper-left edge
  ctx.strokeStyle = 'rgba(255,208,150,0.42)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx - baseHalf + 0.8, brimY - 1.0)
  ctx.quadraticCurveTo(cx - baseHalf * 0.58 + bendX, brimY - coneH * 0.56 + tdy * 0.35, tipX - 0.4, tipY + 0.8)
  ctx.stroke()
  // — band + gold clasp —
  ctx.fillStyle = sol_shade(C.hatDark, -0.10)
  rr(ctx, cx - baseHalf * 0.92, brimY - 3.8, baseHalf * 1.84, 2.6, 1.2)
  ctx.fill()
  ctx.fillStyle = C.gold
  ctx.fillRect(cx + f * baseHalf * 0.42, brimY - 3.6, 2, 2.2)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillRect(cx + f * baseHalf * 0.42, brimY - 3.6, 1, 1)
  // — brim: dark underside, then the lit top edge —
  ctx.save()
  ctx.translate(cx, brimY)
  ctx.rotate(tdx * 0.014)
  ctx.fillStyle = sol_shade(C.hatDark, -0.05)
  ctx.beginPath()
  ctx.ellipse(0, 0, halfBrim, 2.4, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = sol_shade(C.hatDark, -0.4)
  ctx.beginPath()
  ctx.ellipse(0, 0.9, halfBrim - 0.6, 1.4, 0, 0, Math.PI)
  ctx.fill()
  ctx.strokeStyle = sol_shade(C.hat, 0.32)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.ellipse(0, -0.7, halfBrim - 1.1, 1.5, 0, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()
  ctx.restore()
  // — the gold star riding the tip —
  const twk = 1 + 0.14 * Math.sin(time * 3.1 + 1.3)
  dana_star(ctx, tipX, tipY - 0.6, 2.1 * twk, time * 0.5, C.gold)
  ctx.fillStyle = '#fff6d8'
  ctx.beginPath()
  ctx.arc(tipX, tipY - 0.6, 0.7, 0, Math.PI * 2)
  ctx.fill()
  return [tipX, tipY - 0.6]
}

/** Flat-shaded polygon — the chisel primitive (x,y pairs). */
function walk_poly(ctx: CanvasRenderingContext2D, fill: string, ...pts: number[]): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
  ctx.fill()
}

/** One-bend limb stroke (root → bowed joint → paw), round caps. */
function walk_limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, qx: number, qy: number, x2: number, y2: number, lw: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.quadraticCurveTo(qx, qy, x2, y2)
  ctx.stroke()
}

/** A knuckled fist: filled ball + dark contour. */
function walk_fist(ctx: CanvasRenderingContext2D, fx: number, fy: number, r: number, fill: string, line: string): void {
  ctx.fillStyle = fill
  ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.stroke()
}

/** Quantized hash tremble — sharp deterministic shaking, ~46 Hz. */
function walk_shiver(time: number, seed: number, amp: number): number {
  return (sol_hash((Math.floor(time * 46) * 31 + seed) | 0) - 0.5) * 2 * amp
}

/** Additive teardrop flame: outer tongue + hot inner core. */
function walk_flame(ctx: CanvasRenderingContext2D, bx: number, by: number, half: number, hgt: number, lean: number, alpha: number): void {
  if (alpha <= 0.01 || hgt <= 0.5) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.fillStyle = '#ff9a3a'
  ctx.beginPath()
  ctx.moveTo(bx - half, by)
  ctx.quadraticCurveTo(bx - half * 0.9 + lean * 0.3, by - hgt * 0.55, bx + lean, by - hgt)
  ctx.quadraticCurveTo(bx + half * 0.9 + lean * 0.3, by - hgt * 0.55, bx + half, by)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#ffe14a'
  ctx.beginPath()
  ctx.moveTo(bx - half * 0.5, by)
  ctx.quadraticCurveTo(bx + lean * 0.5, by - hgt * 0.5, bx + lean * 0.62, by - hgt * 0.64)
  ctx.quadraticCurveTo(bx + half * 0.5 + lean * 0.3, by - hgt * 0.3, bx + half * 0.5, by)
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

/** Tapered whip: a quadratic subdivided at its midpoint — thick root, slim
 *  tip, with a torch-lit highlight riding the root half. */
function walk_whip(ctx: CanvasRenderingContext2D, x0: number, y0: number, qx: number, qy: number, x1: number, y1: number, lw: number, color: string, lite: string): void {
  const h1x = (x0 + qx) / 2, h1y = (y0 + qy) / 2
  const h2x = (qx + x1) / 2, h2y = (qy + y1) / 2
  const mx = (x0 + 2 * qx + x1) / 4, my = (y0 + 2 * qy + y1) / 4
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(h1x, h1y, mx, my); ctx.stroke()
  ctx.lineWidth = lw * 0.55
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.quadraticCurveTo(h2x, h2y, x1, y1); ctx.stroke()
  ctx.strokeStyle = lite
  ctx.lineWidth = Math.max(0.8, lw * 0.3)
  ctx.beginPath(); ctx.moveTo(x0, y0 - lw * 0.24); ctx.quadraticCurveTo(h1x, h1y - lw * 0.26, mx, my - lw * 0.2); ctx.stroke()
}

/** Simple dead heap: the flattened carcass every walker collapses into. */
function walk_carcass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill
  rr(ctx, x, y + 1, w, Math.max(2, h - 1), Math.min(6, h * 0.5))
  ctx.fill()
}

// ── craft-pass helpers ──────────────────────────────────────

/** Flat-shaded polygon — the chisel primitive (x,y pairs). */
function fly_poly(ctx: CanvasRenderingContext2D, fill: string, ...pts: number[]): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(pts[0], pts[1])
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.closePath()
  ctx.fill()
}

/** Quantized hash tremble — sharp deterministic shaking, ~46 Hz. */
function fly_shiver(time: number, seed: number, amp: number): number {
  return (sol_hash((Math.floor(time * 46) * 31 + seed) | 0) - 0.5) * 2 * amp
}

/** Pull a #rrggbb toward its own luminance (t=1 → grey). Returns #rrggbb so the
 *  result still feeds sol_shade. */
function fly_desat(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const l = r * 0.3 + g * 0.59 + b * 0.11
  const mix = (c: number): number => Math.max(0, Math.min(255, Math.round(c + (l - c) * t)))
  return '#' + ((1 << 24) | (mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).slice(1)
}

/** The flattened heap a flyer drops into (the caller pre-squashes h). */
function fly_husk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  rr(ctx, x + 1, y + 1, w - 2, Math.max(2, h - 1), Math.min(5, h * 0.5))
  ctx.fill()
  ctx.restore()
}

/** 4-point additive twinkle — the stun-orbit star. */
function fly_star(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, rot: number, color: string, alpha: number): void {
  if (alpha <= 0.02 || r <= 0.2) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = rot + i * Math.PI / 4
    const rad = i % 2 === 0 ? r : r * 0.34
    const px = sx + Math.cos(a) * rad, py = sy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath(); ctx.fill()
  ctx.restore()
}

/** A dizzy spiral — cartoon concussion, spun off `rot`. */
function fly_spiral(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, rot: number, color: string, lw: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    const a = rot + t * Math.PI * 3.4
    const rad = r * t
    const px = sx + Math.cos(a) * rad, py = sy + Math.sin(a) * rad * 0.92
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

/** The ghost's silhouette: dome + shoulders + a sinusoidal hem whose trailing
 *  half streams back behind the direction of travel (a torn wisp tail falls out
 *  of the closePath). */
function fly_veilPath(cx: number, capY: number, rx: number, hemY: number, ph: number, amp: number, lean: number, d: number, stream: number, droop: number): Path2D {
  const p = new Path2D()
  const shY = capY + rx * 0.9
  p.moveTo(cx - rx, hemY)
  p.lineTo(cx - rx + lean * 0.35, shY)
  p.quadraticCurveTo(cx - rx * 0.94 + lean, capY, cx + lean, capY)
  p.quadraticCurveTo(cx + rx * 0.94 + lean, capY, cx + rx + lean * 0.35, shY)
  p.lineTo(cx + rx, hemY)
  for (let i = 0; i <= 8; i++) {
    const t = 1 - i / 8
    const rear = Math.max(0, -d * (t * 2 - 1))          // 1 at the trailing corner
    p.lineTo(cx - rx + t * rx * 2 - d * rear * stream,
      hemY + Math.sin(ph + t * 5.4) * amp - rear * stream * 0.42 + (1 - rear) * droop)
  }
  p.closePath()
  return p
}

/** One bat wing: a membrane stretched over three finger struts fanning from a
 *  wrist. `tipFa` lags `fa` by a frame so the tips whip through the stroke. */
function fly_wing(ctx: CanvasRenderingContext2D, sx: number, sy: number, rootX: number, rootY: number, span: number, fa: number, tipFa: number, s: number, tone: string, pulse: number): void {
  const wx = sx + s * Math.cos(fa) * span * 0.6, wy = sy + Math.sin(fa) * span * 0.6
  const ang = [tipFa - 0.46, tipFa + 0.16, tipFa + 0.74]
  const len = [span * 0.64, span * 0.58, span * 0.42]
  const tx: number[] = [], ty: number[] = []
  for (let i = 0; i < 3; i++) {
    tx.push(wx + s * Math.cos(ang[i]) * len[i])
    ty.push(wy + Math.sin(ang[i]) * len[i])
  }
  // membrane — scallops pull toward the wrist between consecutive strut tips
  const m = new Path2D()
  m.moveTo(sx, sy)
  m.quadraticCurveTo(sx + s * Math.cos(fa - 0.34) * span * 0.42, sy + Math.sin(fa - 0.34) * span * 0.42, tx[0], ty[0])
  for (let i = 0; i < 2; i++) {
    const mx = (tx[i] + tx[i + 1]) / 2, my = (ty[i] + ty[i + 1]) / 2
    m.quadraticCurveTo(mx + (wx - mx) * 0.34, my + (wy - my) * 0.34, tx[i + 1], ty[i + 1])
  }
  m.quadraticCurveTo(wx + (rootX - wx) * 0.5, wy + (rootY - wy) * 0.72, rootX, rootY)
  m.closePath()
  const g = ctx.createLinearGradient(sx, sy - span * 0.3, wx, wy + span * 0.4)
  g.addColorStop(0, sol_shade(tone, 0.24))
  g.addColorStop(0.55, tone)
  g.addColorStop(1, sol_shade(tone, -0.42))
  ctx.fillStyle = g
  ctx.fill(m)
  ctx.strokeStyle = sol_shade(tone, -0.6)
  ctx.lineWidth = 0.9
  ctx.stroke(m)
  // finger struts + the arm bone, drawn over the skin
  ctx.strokeStyle = sol_shade(tone, -0.5)
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 1.5 - i * 0.3
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(tx[i], ty[i]); ctx.stroke()
  }
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wx, wy); ctx.stroke()
  // torch rim along the leading edge + a hooked thumb claw at the wrist
  ctx.strokeStyle = `rgba(255,220,170,${0.16 + 0.16 * Math.min(1, pulse)})`
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(sx, sy - 0.8); ctx.lineTo(wx, wy - 0.8); ctx.stroke()
  fly_poly(ctx, sol_shade(tone, -0.24), wx, wy, wx + s * 1.2, wy - 3.4, wx + s * 2.6, wy - 0.4)
}

/** A jagged arc of lightning: a polyline swept around (cx,cy) whose radius and
 *  endpoints jitter on a quantized hash. Drawn twice — dim halo, hot filament. */
function fly_bolt(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, arc: number, q: number, seed: number, jag: number, halo: string, core: string, alpha: number): void {
  const N = 7
  const px: number[] = [], py: number[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const edge = i === 0 || i === N ? 1.8 : 1                       // endpoints jitter hardest
    const rad = r * (1 + (sol_hash(q * 131 + seed * 17 + i) - 0.5) * jag * edge)
    const a = a0 + arc * t + (sol_hash(q * 71 + seed * 29 + i) - 0.5) * 0.16
    px.push(cx + Math.cos(a) * rad); py.push(cy + Math.sin(a) * rad)
  }
  ctx.globalAlpha = Math.min(1, alpha * 0.4)
  ctx.strokeStyle = halo
  ctx.lineWidth = 2.6
  ctx.lineJoin = 'round'
  ctx.beginPath(); ctx.moveTo(px[0], py[0])
  for (let i = 1; i <= N; i++) ctx.lineTo(px[i], py[i])
  ctx.stroke()
  ctx.globalAlpha = Math.min(1, alpha)
  ctx.strokeStyle = core
  ctx.lineWidth = 0.9
  ctx.stroke()
}

/** Low-alpha dark smoke dabs — NON-additive (they must eat light, not add it). */
function fly_smoke(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, seed: number, dir: number, count: number, scale: number): void {
  ctx.save()
  for (let i = 0; i < count; i++) {
    const ph = (time * 0.8 + sol_hash(seed + i * 23)) % 1
    ctx.globalAlpha = (1 - ph) * 0.26
    ctx.fillStyle = '#120a12'
    ctx.beginPath()
    ctx.arc(sx - dir * (1 + ph * 7) + Math.sin(time * 2.1 + i * 2) * 1.4, sy + ph * 5,
      (1.2 + ph * 2.6) * scale, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** A small carved rune on the panel frame: chiselled dark strokes that ignite
 *  when its slot of the charge lights up. */
function fly_rune(ctx: CanvasRenderingContext2D, rx: number, ry: number, s: number, kind: number, lit: number, pulse: number): void {
  const seg: number[][] = kind === 0
    ? [[0, -1, 0, 1], [-0.7, -0.4, 0.7, -0.4], [-0.5, 0.6, 0.5, 0.6]]
    : kind === 1
      ? [[-0.8, 0.8, 0, -0.9], [0, -0.9, 0.8, 0.8], [-0.45, 0.1, 0.45, 0.1]]
      : [[-0.8, -0.6, 0, 0.2], [0, 0.2, 0.8, -0.6], [0, 0.2, 0, 0.9]]
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(12,13,24,0.75)'          // the chisel cut, always present
  for (const g of seg) {
    ctx.beginPath(); ctx.moveTo(rx + g[0] * s, ry + g[1] * s); ctx.lineTo(rx + g[2] * s, ry + g[3] * s); ctx.stroke()
  }
  if (lit <= 0.02) { ctx.restore(); return }
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, lit * (0.5 + 0.45 * pulse))
  ctx.strokeStyle = '#ff9a3a'
  ctx.lineWidth = 1.1
  for (const g of seg) {
    ctx.beginPath(); ctx.moveTo(rx + g[0] * s, ry + g[1] * s); ctx.lineTo(rx + g[2] * s, ry + g[3] * s); ctx.stroke()
  }
  ctx.restore()
  glow(ctx, C.EMBER, rx, ry, s * 1.6, lit * 0.4 * pulse)
}
