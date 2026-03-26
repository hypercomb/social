// diamondcoreprocessor.com/pixi/hex-overlay.shader.ts
// Vector-drawn neon hex hover overlay with bloom glow and lens flare
import { Graphics } from 'pixi.js'

// ── Light direction (top-left, 10 o'clock) ─────────────────────
const LIGHT_DIR_X = -0.5
const LIGHT_DIR_Y = -0.866

// ── Neon palette ─────────────────────────────────────────────────
const NEON_CORE   = 0x00ffff   // bright cyan — primary neon line
const NEON_BRIGHT = 0x44ffff   // lighter cyan for hot core overlay
const NEON_MID    = 0x0088cc   // mid blue-cyan for bloom layers
const NEON_DIM    = 0x004466   // dark teal for outermost bloom
const NEON_WHITE  = 0xccffff   // near-white for flare hotspots
const FILL_COLOR  = 0x000a14   // dark blue-black interior
const FLARE_WHITE = 0xffffff   // pure white for lens flare streaks

// ── Size fractions (of circumRadius) ─────────────────────────────
const NEON_EDGE    = 0.96      // primary neon stroke
const FILL_RADIUS  = 0.88      // dark interior fill
const GLOW_OUTER_1 = 1.02      // first outer bloom ring
const GLOW_OUTER_2 = 1.08      // second outer bloom ring (softest)
const GLOW_INNER_1 = 0.90      // first inner bloom ring
const GLOW_INNER_2 = 0.84      // second inner bloom ring (softest)

// ── Vertex flare ─────────────────────────────────────────────────
const FLARE_DOT_RADIUS  = 2.2
const FLARE_HALO_RADIUS = 4.5

// ── Lens flare cross ─────────────────────────────────────────────
const FLARE_H_LEN = 5
const FLARE_V_LEN = 3
const FLARE_CENTER_R = 1.8

export class HexOverlayMesh {
  readonly mesh: Graphics

  #radiusPx: number
  #flat: boolean

  constructor(radiusPx: number, flat: boolean) {
    this.#radiusPx = radiusPx
    this.#flat = flat
    this.mesh = new Graphics()
    this.#draw()
  }

  update(radiusPx: number, flat: boolean): void {
    if (radiusPx === this.#radiusPx && flat === this.#flat) return
    this.#radiusPx = radiusPx
    this.#flat = flat
    this.#draw()
  }

  // ── hex vertex generation ──────────────────────────────────────

  #hexVerts(r: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + (this.#flat ? 0 : Math.PI / 6)
      verts.push(Math.cos(angle) * r, Math.sin(angle) * r)
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
    for (let i = 0; i < 6; i++) {
      const lighting = this.#edgeLighting(i)
      const alpha = alphaLo + (alphaHi - alphaLo) * lighting
      const c = colorHi !== undefined ? this.#lerpColor(color, colorHi, lighting) : color
      const i0 = i * 2, i1 = ((i + 1) % 6) * 2
      g.moveTo(verts[i0], verts[i0 + 1])
      g.lineTo(verts[i1], verts[i1 + 1])
      g.stroke({ width, color: c, alpha })
    }
  }

  // ── main draw ──────────────────────────────────────────────────

  #draw(): void {
    const g = this.mesh
    g.clear()

    const R = this.#radiusPx

    // vertex sets at each radius
    const neonV    = this.#hexVerts(R * NEON_EDGE)
    const fillV    = this.#hexVerts(R * FILL_RADIUS)
    const gOuter1V = this.#hexVerts(R * GLOW_OUTER_1)
    const gOuter2V = this.#hexVerts(R * GLOW_OUTER_2)
    const gInner1V = this.#hexVerts(R * GLOW_INNER_1)
    const gInner2V = this.#hexVerts(R * GLOW_INNER_2)

    // ─── 1. Outermost bloom ring (outside) ────────────────────
    this.#strokeEdges(g, gOuter2V, 3.0, NEON_DIM, 0.04, 0.10)

    // ─── 2. Outer bloom ring ──────────────────────────────────
    this.#strokeEdges(g, gOuter1V, 2.5, NEON_MID, 0.06, 0.18)

    // ─── 3. Dark fill ─────────────────────────────────────────
    g.poly(fillV)
    g.fill({ color: FILL_COLOR, alpha: 0.55 })

    // ─── 4. Inner bloom ring (far) ────────────────────────────
    this.#strokeEdges(g, gInner2V, 2.5, NEON_DIM, 0.04, 0.10)

    // ─── 5. Inner bloom ring (near) ───────────────────────────
    this.#strokeEdges(g, gInner1V, 2.0, NEON_MID, 0.08, 0.22)

    // ─── 6. Primary neon edge (wide, saturated) ───────────────
    this.#strokeEdges(g, neonV, 1.5, NEON_MID, 0.50, 0.95, NEON_CORE)

    // ─── 7. Hot core edge (thin, bright) ──────────────────────
    this.#strokeEdges(g, neonV, 0.75, NEON_BRIGHT, 0.15, 0.70, NEON_WHITE)

    // ─── 8-9. Vertex flare dots + bloom halos ─────────────────
    let brightestEdge = 0
    let brightestVal = -1

    for (let i = 0; i < 6; i++) {
      const l0 = this.#edgeLighting(i)
      const l1 = this.#edgeLighting((i + 5) % 6)
      if (l0 > brightestVal) { brightestVal = l0; brightestEdge = i }
      const cornerLight = (l0 + l1) / 2

      const vx = neonV[i * 2], vy = neonV[i * 2 + 1]

      // bloom halo (behind)
      const haloAlpha = 0.05 + cornerLight * 0.20
      g.circle(vx, vy, FLARE_HALO_RADIUS)
      g.fill({ color: NEON_CORE, alpha: haloAlpha })

      // bright dot (on top)
      const dotAlpha = 0.10 + cornerLight * 0.50
      g.circle(vx, vy, FLARE_DOT_RADIUS)
      g.fill({ color: NEON_WHITE, alpha: dotAlpha })
    }

    // ─── 10. Lens flare cross at brightest edge midpoint ──────
    {
      const i0 = brightestEdge * 2
      const i1 = ((brightestEdge + 1) % 6) * 2
      const sx = (neonV[i0] + neonV[i1]) / 2
      const sy = (neonV[i0 + 1] + neonV[i1 + 1]) / 2

      // horizontal streak
      g.moveTo(sx - FLARE_H_LEN, sy)
      g.lineTo(sx + FLARE_H_LEN, sy)
      g.stroke({ width: 0.6, color: FLARE_WHITE, alpha: 0.40 })

      // vertical streak
      g.moveTo(sx, sy - FLARE_V_LEN)
      g.lineTo(sx, sy + FLARE_V_LEN)
      g.stroke({ width: 0.6, color: FLARE_WHITE, alpha: 0.30 })

      // central dot
      g.circle(sx, sy, FLARE_CENTER_R)
      g.fill({ color: NEON_WHITE, alpha: 0.55 })
    }
  }
}
