// diamondcoreprocessor.com/pixi/hex-overlay.shader.ts
// Vector-drawn neon hex hover overlay with bloom glow and animated ember
import { BlurFilter, Container, Graphics } from 'pixi.js'

// ── Light direction (top-left, 10 o'clock) ─────────────────────
const LIGHT_DIR_X = -0.5
const LIGHT_DIR_Y = -0.866

// ── Neon color presets ──────────────────────────────────────────────
export type NeonPalette = {
  core: number; bright: number; mid: number; dim: number; white: number
  fill: number
  embers: { glow: number; core: number; startEdge: number }[]
}

export const NEON_PRESETS: NeonPalette[] = [
  { // 0 — Cyan (default)
    core: 0x00ffff, bright: 0x44ffff, mid: 0x0088cc, dim: 0x004466, white: 0xccffff,
    fill: 0x000a14,
    embers: [
      { glow: 0x44aaff, core: 0xccddff, startEdge: 0 },
      { glow: 0x66ddff, core: 0xeeffff, startEdge: 2 },
      { glow: 0xcc66ff, core: 0xffccff, startEdge: 4 },
    ],
  },
  { // 1 — Magenta / Hot Pink
    core: 0xff00ff, bright: 0xff44ff, mid: 0xcc0088, dim: 0x660044, white: 0xffccff,
    fill: 0x0a000a,
    embers: [
      { glow: 0xff44aa, core: 0xffccdd, startEdge: 0 },
      { glow: 0xff66dd, core: 0xffeeff, startEdge: 2 },
      { glow: 0xaa44ff, core: 0xddccff, startEdge: 4 },
    ],
  },
  { // 2 — Green / Emerald
    core: 0x00ff88, bright: 0x44ffaa, mid: 0x00cc66, dim: 0x004422, white: 0xccffee,
    fill: 0x000a06,
    embers: [
      { glow: 0x44ffaa, core: 0xccffdd, startEdge: 0 },
      { glow: 0x66ffcc, core: 0xeeffee, startEdge: 2 },
      { glow: 0x44aaff, core: 0xccddff, startEdge: 4 },
    ],
  },
  { // 3 — Gold / Amber
    core: 0xffcc00, bright: 0xffdd44, mid: 0xcc8800, dim: 0x664400, white: 0xffeecc,
    fill: 0x0a0800,
    embers: [
      { glow: 0xffaa44, core: 0xffddcc, startEdge: 0 },
      { glow: 0xffcc66, core: 0xffeeee, startEdge: 2 },
      { glow: 0xff6644, core: 0xffcccc, startEdge: 4 },
    ],
  },
  { // 4 — Violet / Purple
    core: 0x8844ff, bright: 0xaa66ff, mid: 0x6622cc, dim: 0x331166, white: 0xddccff,
    fill: 0x06000a,
    embers: [
      { glow: 0x8866ff, core: 0xccbbff, startEdge: 0 },
      { glow: 0xaa88ff, core: 0xeeddff, startEdge: 2 },
      { glow: 0xff66aa, core: 0xffccdd, startEdge: 4 },
    ],
  },
]

const STORAGE_KEY = 'hc:neon-color'

// ── Overall transparency ───────────────────────────────────────────
const OVERLAY_ALPHA = 0.85     // slight see-through so grid bleeds faintly

// ── Breathe animation (slow pulse on neon intensity) ───────────────
const BREATHE_PERIOD = 4.0     // seconds per full breathe cycle
const BREATHE_LO     = 0.80   // minimum intensity multiplier
const BREATHE_HI     = 1.00   // maximum intensity multiplier

// ── Active palette (resolved at runtime) ───────────────────────────

// ── Size fractions (of circumRadius) ─────────────────────────────
const NEON_EDGE    = 1.15      // primary neon stroke — deep into gap
const FILL_RADIUS  = 1.07      // dark interior fill
const GLOW_OUTER_1 = 1.21      // first outer bloom ring
const GLOW_OUTER_2 = 1.27      // second outer bloom ring (softest)
const GLOW_INNER_1 = 1.09      // first inner bloom ring
const GLOW_INNER_2 = 1.03      // second inner bloom ring (softest)

// ── Ember config ─────────────────────────────────────────────────
const EMBER_CORE_R = 1.0       // bright center radius
const EMBER_GLOW_R = 1.8       // glow radius
const EMBER_BLUR   = 2         // blur filter strength (reduced for clarity)

// ── Ember timing ─────────────────────────────────────────────────
const MOVE_DUR     = 3.0       // seconds moving
const DWELL_DUR    = 3.0       // seconds stopped
const CYCLE_PERIOD = MOVE_DUR + DWELL_DUR  // 6 seconds total
const MOVE_FRAC    = MOVE_DUR / CYCLE_PERIOD  // 0.5
const FLASH_START  = 0.48      // flash right as it arrives
const FLASH_END    = 0.58      // brief flash

// ── Supersampling ────────────────────────────────────────────────
const SS = 8                   // 8× supersample — drawn once, reused; embers are trivial

export class HexOverlayMesh {
  readonly mesh: Container

  #radiusPx: number
  #flat: boolean
  #palette: NeonPalette
  #hex: Graphics       // static hex glow (drawn once)
  #ember: Graphics     // animated ember dot (redrawn per frame)
  #neonVerts: number[] = []  // cached neon edge verts for ember path
  #edgeLengths: number[] = []
  #totalPerimeter = 0

  constructor(radiusPx: number, flat: boolean) {
    this.#radiusPx = radiusPx
    this.#flat = flat
    this.#palette = NEON_PRESETS[loadNeonIndex()]

    this.mesh = new Container()
    this.mesh.scale.set(1 / SS)
    this.mesh.alpha = OVERLAY_ALPHA

    this.#hex = new Graphics()
    this.#ember = new Graphics()
    this.#ember.filters = [new BlurFilter({ strength: EMBER_BLUR * SS })]

    this.mesh.addChild(this.#hex, this.#ember)

    this.#draw()
  }

  update(radiusPx: number, flat: boolean): void {
    if (radiusPx === this.#radiusPx && flat === this.#flat) return
    this.#radiusPx = radiusPx
    this.#flat = flat
    this.#draw()
  }

  setColorIndex(index: number): void {
    const clamped = Math.max(0, Math.min(index, NEON_PRESETS.length - 1))
    this.#palette = NEON_PRESETS[clamped]
    localStorage.setItem(STORAGE_KEY, String(clamped))
    this.#draw()
  }

  setTime(t: number): void {
    // breathe: slow sine pulse on hex glow intensity
    const breathe = Math.sin((t / BREATHE_PERIOD) * Math.PI * 2) * 0.5 + 0.5
    this.#hex.alpha = BREATHE_LO + (BREATHE_HI - BREATHE_LO) * breathe

    this.#drawEmber(t)
  }

  // ── hex vertex generation ──────────────────────────────────────

  #hexVerts(r: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + (this.#flat ? 0 : Math.PI / 6)
      verts.push(Math.cos(angle) * r * SS, Math.sin(angle) * r * SS)
    }
    return verts
  }

  // ── per-edge directional lighting ──────────────────────────────

  #edgeLighting(edgeIndex: number): number {
    const a0 = (Math.PI / 3) * edgeIndex + (this.#flat ? 0 : Math.PI / 6)
    const a1 = (Math.PI / 3) * (edgeIndex + 1) + (this.#flat ? 0 : Math.PI / 6)
    const mx = (Math.cos(a0) + Math.cos(a1)) / 2
    const my = (Math.sin(a0) + Math.sin(a1)) / 2
    const len = Math.sqrt(mx * mx + my * my)
    const nx = mx / len
    const ny = my / len
    const dot = nx * LIGHT_DIR_X + ny * LIGHT_DIR_Y
    return dot * 0.5 + 0.5
  }

  // ── color interpolation ────────────────────────────────────────

  #lerpColor(lo: number, hi: number, t: number): number {
    const lr = (lo >> 16) & 0xff, lg = (lo >> 8) & 0xff, lb = lo & 0xff
    const hr = (hi >> 16) & 0xff, hg = (hi >> 8) & 0xff, hb = hi & 0xff
    const r = Math.round(lr + (hr - lr) * t)
    const g = Math.round(lg + (hg - lg) * t)
    const b = Math.round(lb + (hb - lb) * t)
    return (r << 16) | (g << 8) | b
  }

  // ── per-edge bloom stroke helper ───────────────────────────────

  #strokeEdges(
    g: Graphics,
    verts: number[],
    width: number,
    color: number,
    alphaLo: number,
    alphaHi: number,
    colorHi?: number,
  ): void {
    // draw as closed polygon — sharp corners, no gaps
    g.poly(verts)
    g.closePath()
    // use average lighting for uniform alpha, or blend per-edge for variation
    let avgLight = 0
    for (let i = 0; i < 6; i++) avgLight += this.#edgeLighting(i)
    avgLight /= 6
    const alpha = alphaLo + (alphaHi - alphaLo) * avgLight
    const c = colorHi !== undefined ? this.#lerpColor(color, colorHi, avgLight) : color
    g.stroke({ width: width * SS, color: c, alpha, join: 'miter' })
  }

  // ── point along hex perimeter (0..1 → x,y) ────────────────────

  #perimeterPoint(t: number): { x: number; y: number } {
    const v = this.#neonVerts
    const frac = ((t % 1) + 1) % 1 // normalize to [0..1)
    let target = frac * this.#totalPerimeter
    for (let i = 0; i < 6; i++) {
      if (target <= this.#edgeLengths[i]) {
        const i0 = i * 2, i1 = ((i + 1) % 6) * 2
        const lerp = target / this.#edgeLengths[i]
        return {
          x: v[i0] + (v[i1] - v[i0]) * lerp,
          y: v[i0 + 1] + (v[i1 + 1] - v[i0 + 1]) * lerp,
        }
      }
      target -= this.#edgeLengths[i]
    }
    return { x: v[0], y: v[1] }
  }

  // ── ease in-out cubic ──────────────────────────────────────────

  #ease(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  // ── draw embers (per frame) ─────────────────────────────────────

  #drawEmber(t: number): void {
    const g = this.#ember
    g.clear()

    // each ember hops 1 full edge per cycle (1/6 of perimeter)
    const STEP = 1 / 6

    for (const spec of this.#palette.embers) {
      // offset start: midpoint of startEdge = (startEdge + 0.5) / 6
      const origin = (spec.startEdge + 0.5) / 6

      const cycleIndex = Math.floor(t / CYCLE_PERIOD)
      const phase = (t % CYCLE_PERIOD) / CYCLE_PERIOD

      const fromT = (origin + cycleIndex * STEP) % 1
      const toT = (origin + (cycleIndex + 1) * STEP) % 1

      // compute position along perimeter
      let perimT: number
      if (phase < MOVE_FRAC) {
        const eased = this.#ease(phase / MOVE_FRAC)
        let delta = toT - fromT
        if (delta < 0) delta += 1
        perimT = fromT + delta * eased
      } else {
        perimT = toT
      }

      const pos = this.#perimeterPoint(perimT)

      // flash intensity
      let flash = 0
      if (phase >= FLASH_START && phase <= FLASH_END) {
        const flashPhase = (phase - FLASH_START) / (FLASH_END - FLASH_START)
        flash = Math.sin(flashPhase * Math.PI)
      }

      const baseAlpha = phase < MOVE_FRAC ? 0.35 : 0.50
      g.circle(pos.x, pos.y, EMBER_GLOW_R * SS)
      g.fill({ color: spec.glow, alpha: baseAlpha + flash * 0.30 })

      g.circle(pos.x, pos.y, EMBER_CORE_R * SS)
      g.fill({ color: spec.core, alpha: baseAlpha + flash * 0.45 })

      if (flash > 0.01) {
        g.circle(pos.x, pos.y, (EMBER_GLOW_R + 2.0 * flash) * SS)
        g.fill({ color: spec.glow, alpha: flash * 0.20 })
      }
    }
  }

  // ── main draw (static hex, drawn once) ─────────────────────────

  #draw(): void {
    const g = this.#hex
    g.clear()

    const R = this.#radiusPx

    // vertex sets at each radius
    const neonV    = this.#hexVerts(R * NEON_EDGE)
    const fillV    = this.#hexVerts(R * FILL_RADIUS)
    const gOuter1V = this.#hexVerts(R * GLOW_OUTER_1)
    const gOuter2V = this.#hexVerts(R * GLOW_OUTER_2)
    const gInner1V = this.#hexVerts(R * GLOW_INNER_1)
    const gInner2V = this.#hexVerts(R * GLOW_INNER_2)

    // cache neon verts + perimeter for ember path
    this.#neonVerts = neonV
    this.#edgeLengths = []
    this.#totalPerimeter = 0
    for (let i = 0; i < 6; i++) {
      const i0 = i * 2, i1 = ((i + 1) % 6) * 2
      const dx = neonV[i1] - neonV[i0]
      const dy = neonV[i1 + 1] - neonV[i0 + 1]
      const len = Math.sqrt(dx * dx + dy * dy)
      this.#edgeLengths.push(len)
      this.#totalPerimeter += len
    }

    const p = this.#palette

    // ─── 1. Outermost bloom ring (outside) ────────────────────
    this.#strokeEdges(g, gOuter2V, 3.0, p.dim, 0.04, 0.10)

    // ─── 2. Outer bloom ring ──────────────────────────────────
    this.#strokeEdges(g, gOuter1V, 2.5, p.mid, 0.06, 0.18)

    // ─── 3. Dark fill ─────────────────────────────────────────
    g.poly(fillV)
    g.fill({ color: p.fill, alpha: 0.55 })

    // ─── 4. Inner bloom ring (far) ────────────────────────────
    this.#strokeEdges(g, gInner2V, 2.5, p.dim, 0.04, 0.10)

    // ─── 5. Inner bloom ring (near) ───────────────────────────
    this.#strokeEdges(g, gInner1V, 2.0, p.mid, 0.08, 0.22)

    // ─── 6. Primary neon edge (wide, saturated) ───────────────
    this.#strokeEdges(g, neonV, 2.0, p.mid, 0.45, 0.90, p.core)

    // ─── 7. Hot core edge (bright, narrower) ─────────────────
    this.#strokeEdges(g, neonV, 1.0, p.bright, 0.20, 0.75, p.white)
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

function loadNeonIndex(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return 0
  const n = parseInt(stored, 10)
  return (n >= 0 && n < NEON_PRESETS.length) ? n : 0
}

export function cycleNeonColor(): number {
  const next = (loadNeonIndex() + 1) % NEON_PRESETS.length
  localStorage.setItem(STORAGE_KEY, String(next))
  return next
}
