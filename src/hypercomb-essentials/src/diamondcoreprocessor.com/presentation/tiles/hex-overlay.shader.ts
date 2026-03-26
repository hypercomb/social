// diamondcoreprocessor.com/pixi/hex-overlay.shader.ts
// Vector-drawn hex hover overlay with per-edge directional lighting
import { Graphics } from 'pixi.js'

// ── Light direction (top-left, 10 o'clock) ─────────────────────
const LIGHT_DIR_X = -0.5
const LIGHT_DIR_Y = -0.866

// ── Palette ────────────────────────────────────────────────────
const FILL_COLOR   = 0x000d18
const FILL_ALPHA   = 0.62

const SHADOW_COLOR = 0x0a1520   // dark bezel stop
const MID_COLOR    = 0x2a5570   // mid bezel stop
const HI_COLOR     = 0x6aafc8   // bright bezel stop

const BEZEL_OUTER  = 0.92       // outer edge fraction of circumradius
const BEZEL_INNER  = 0.84       // inner edge fraction

// ── Drop shadow ────────────────────────────────────────────────
const SHADOW_OFFSET_X = 2
const SHADOW_OFFSET_Y = 3
const SHADOW_ALPHA    = 0.35
const SHADOW_BLUR     = 6

// ── Rim + inner line ───────────────────────────────────────────
const RIM_WIDTH       = 0.75
const RIM_BASE_ALPHA  = 0.15
const RIM_HI_ALPHA    = 0.55

const INNER_WIDTH     = 0.5
const INNER_BASE_ALPHA = 0.08
const INNER_HI_ALPHA   = 0.30

// ── Corner jewels ──────────────────────────────────────────────
const JEWEL_RADIUS     = 1.4
const JEWEL_BASE_ALPHA = 0.15
const JEWEL_HI_ALPHA   = 0.65
const JEWEL_COLOR      = 0x88ccdd

// ── Specular ───────────────────────────────────────────────────
const SPEC_RADIUS      = 1.8
const SPEC_COLOR       = 0xddffff
const SPEC_ALPHA       = 0.45

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
    // outward-facing normal of edge i
    const a0 = (Math.PI / 3) * edgeIndex + (this.#flat ? 0 : Math.PI / 6)
    const a1 = (Math.PI / 3) * (edgeIndex + 1) + (this.#flat ? 0 : Math.PI / 6)
    const mx = (Math.cos(a0) + Math.cos(a1)) / 2
    const my = (Math.sin(a0) + Math.sin(a1)) / 2
    const len = Math.sqrt(mx * mx + my * my)
    const nx = mx / len
    const ny = my / len
    // dot with light direction → [-1..1], remap to [0..1]
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

  #lerpColor3(lo: number, mid: number, hi: number, t: number): number {
    if (t < 0.5) return this.#lerpColor(lo, mid, t * 2)
    return this.#lerpColor(mid, hi, (t - 0.5) * 2)
  }

  // ── main draw ──────────────────────────────────────────────────

  #draw(): void {
    const g = this.mesh
    g.clear()

    const R = this.#radiusPx
    const outerV = this.#hexVerts(R * BEZEL_OUTER)
    const innerV = this.#hexVerts(R * BEZEL_INNER)
    const fillV  = this.#hexVerts(R * BEZEL_INNER)

    // ─── 1. Drop shadow ────────────────────────────────────────
    const shadowV = this.#hexVerts(R * BEZEL_OUTER)
    g.poly(shadowV.map((v, i) => v + (i % 2 === 0 ? SHADOW_OFFSET_X : SHADOW_OFFSET_Y)))
    g.fill({ color: 0x000000, alpha: SHADOW_ALPHA })

    // penumbra — slightly larger, more transparent
    const penV = this.#hexVerts(R * BEZEL_OUTER + SHADOW_BLUR)
    g.poly(penV.map((v, i) => v + (i % 2 === 0 ? SHADOW_OFFSET_X : SHADOW_OFFSET_Y)))
    g.fill({ color: 0x000000, alpha: SHADOW_ALPHA * 0.3 })

    // ─── 2. Dark fill ──────────────────────────────────────────
    g.poly(fillV)
    g.fill({ color: FILL_COLOR, alpha: FILL_ALPHA })

    // ─── 3. Bezel trapezoids (6 segments) ──────────────────────
    let brightestEdge = 0
    let brightestVal = -1

    for (let i = 0; i < 6; i++) {
      const lighting = this.#edgeLighting(i)
      if (lighting > brightestVal) { brightestVal = lighting; brightestEdge = i }

      const i0 = i * 2, i1 = ((i + 1) % 6) * 2
      const bezelColor = this.#lerpColor3(SHADOW_COLOR, MID_COLOR, HI_COLOR, lighting)
      const bezelAlpha = 0.3 + lighting * 0.5

      // trapezoid: outer[i] → outer[i+1] → inner[i+1] → inner[i]
      g.poly([
        outerV[i0], outerV[i0 + 1],
        outerV[i1], outerV[i1 + 1],
        innerV[i1], innerV[i1 + 1],
        innerV[i0], innerV[i0 + 1],
      ])
      g.fill({ color: bezelColor, alpha: bezelAlpha })
    }

    // ─── 4. Outer rim highlight ────────────────────────────────
    for (let i = 0; i < 6; i++) {
      const lighting = this.#edgeLighting(i)
      const rimAlpha = RIM_BASE_ALPHA + (RIM_HI_ALPHA - RIM_BASE_ALPHA) * lighting
      const i0 = i * 2, i1 = ((i + 1) % 6) * 2

      g.moveTo(outerV[i0], outerV[i0 + 1])
      g.lineTo(outerV[i1], outerV[i1 + 1])
      g.stroke({ width: RIM_WIDTH, color: this.#lerpColor(MID_COLOR, HI_COLOR, lighting), alpha: rimAlpha })
    }

    // ─── 5. Inner edge lines (inverted lighting for ridge) ─────
    for (let i = 0; i < 6; i++) {
      const lighting = 1.0 - this.#edgeLighting(i) // inverted → lit edges on opposite side
      const innerAlpha = INNER_BASE_ALPHA + (INNER_HI_ALPHA - INNER_BASE_ALPHA) * lighting
      const i0 = i * 2, i1 = ((i + 1) % 6) * 2

      g.moveTo(innerV[i0], innerV[i0 + 1])
      g.lineTo(innerV[i1], innerV[i1 + 1])
      g.stroke({ width: INNER_WIDTH, color: this.#lerpColor(SHADOW_COLOR, MID_COLOR, lighting), alpha: innerAlpha })
    }

    // ─── 6. Corner jewel dots ──────────────────────────────────
    for (let i = 0; i < 6; i++) {
      // average lighting of two adjacent edges
      const l0 = this.#edgeLighting(i)
      const l1 = this.#edgeLighting((i + 5) % 6)
      const cornerLight = (l0 + l1) / 2
      const jewelAlpha = JEWEL_BASE_ALPHA + (JEWEL_HI_ALPHA - JEWEL_BASE_ALPHA) * cornerLight

      g.circle(outerV[i * 2], outerV[i * 2 + 1], JEWEL_RADIUS)
      g.fill({ color: JEWEL_COLOR, alpha: jewelAlpha })
    }

    // ─── 7. Specular dot at brightest edge midpoint ────────────
    {
      const i0 = brightestEdge * 2
      const i1 = ((brightestEdge + 1) % 6) * 2
      const sx = (outerV[i0] + outerV[i1]) / 2
      const sy = (outerV[i0 + 1] + outerV[i1 + 1]) / 2

      g.circle(sx, sy, SPEC_RADIUS)
      g.fill({ color: SPEC_COLOR, alpha: SPEC_ALPHA })
    }
  }
}
