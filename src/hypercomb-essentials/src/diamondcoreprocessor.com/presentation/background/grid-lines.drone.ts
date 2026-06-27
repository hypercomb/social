// diamondcoreprocessor.com/presentation/background/grid-lines.drone.ts
//
// Substrate grid lines — drawn INTO the zoom container (the same Container the
// hex tiles live in), so they PAN and SCALE WITH the grid. This is the
// content-space half of the two-layer backdrop:
//
//   • Lighting (base colour + glow + vignette) → screen-fixed CSS on <body>
//     (CanvasBackgroundService). Stays put as a calm ambient frame.
//   • Lines (grid / dots / honeycomb) → THIS drone, in the zoom container, so
//     they move and scale with the tiles like a real substrate.
//
// CanvasBackgroundService owns the choice (which pattern, which palette) and
// broadcasts it via the `canvas:lines` effect; this drone just draws it. One
// persistent TilingSprite, re-textured on pattern/palette/theme change, hidden
// for the gradient-only archetypes (depth / sheen / mesh / contour).

import { Drone } from '@hypercomb/core'
import { Container, TilingSprite, Texture } from 'pixi.js'
import type { HostReadyPayload } from '../tiles/pixi-host.worker.js'

type LinesKind = 'grid' | 'dots' | 'honeycomb'
interface LinesPayload { kind: LinesKind | null; accent: string; alpha: number }

// Large enough to cover the full pan/zoom range — matches the legacy background
// rect. A TilingSprite is ONE quad with a wrapping texture, so the size doesn't
// multiply draw calls.
const COVER = 200000

// Per-pattern tile size + the sub-pixel offset of the feature that should sit
// on the centre. The grid lines are drawn crisp at 0.5; the dot / honeycomb
// lattice features sit at 0. Used to PHASE the tiling so a feature lands exactly
// on container (0,0) — the centred tile's centre — so a grid line runs straight
// up the middle, balanced on both sides.
const TILE_SPEC: Record<LinesKind, { tw: number; th: number; ax: number; ay: number }> = {
  grid: { tw: 44, th: 44, ax: 0.5, ay: 0.5 },
  dots: { tw: 90, th: 52, ax: 0, ay: 0 },
  honeycomb: { tw: 90, th: 52, ax: 0, ay: 0 },
}

// Pointy-edge flat-top honeycomb tile (period 90 × 51.96), same lattice the
// tiles use. Drawn into a 90×52 canvas; the 0.04px rounding is imperceptible.
const HONEY_POLYS = [
  '75,25.98 60,51.96 30,51.96 15,25.98 30,0 60,0',
  '30,0 15,25.98 -15,25.98 -30,0 -15,-25.98 15,-25.98',
  '120,0 105,25.98 75,25.98 60,0 75,-25.98 105,-25.98',
  '30,51.96 15,77.94 -15,77.94 -30,51.96 -15,25.98 15,25.98',
  '120,51.96 105,77.94 75,77.94 60,51.96 75,25.98 105,25.98',
]

export class GridLinesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description =
    'Draws the substrate lines (grid/dots/honeycomb) into the zoom container so they pan and scale with the hex grid; the colour/lighting wash stays a screen-fixed CSS layer.'

  protected override listens = ['render:host-ready', 'canvas:lines']
  protected override emits: string[] = []

  #container: Container | null = null
  #sprite: TilingSprite | null = null
  #payload: LinesPayload | null = null
  #registered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#registered) return
    this.#registered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#container = payload.container
      this.#container.sortableChildren = true
      this.#redraw()
    })

    this.onEffect<LinesPayload>('canvas:lines', (payload) => {
      this.#payload = payload
      this.#redraw()
    })
  }

  #redraw(): void {
    const container = this.#container
    const payload = this.#payload
    if (!container) return

    // Gradient-only archetype, disabled, or not yet told what to draw → hide.
    if (!payload || !payload.kind) {
      if (this.#sprite) this.#sprite.visible = false
      return
    }

    const spec = TILE_SPEC[payload.kind]
    const texture = this.#buildTexture(payload.kind, payload.accent, payload.alpha)
    if (!texture) {
      if (this.#sprite) this.#sprite.visible = false
      return
    }

    if (!this.#sprite) {
      this.#sprite = new TilingSprite({ texture, width: COVER, height: COVER })
      // Behind the tiles (default zIndex 0), above the move/editor tint (-1000).
      this.#sprite.zIndex = -950
      this.#sprite.eventMode = 'none'
      container.addChild(this.#sprite)
    } else {
      const prev = this.#sprite.texture
      this.#sprite.texture = texture
      // Each build mints a fresh texture from a unique canvas — free the old one.
      if (prev && prev !== texture) prev.destroy(true)
    }

    // Phase the tiling so a pattern feature lands EXACTLY on container (0,0) —
    // the centred tile's centre — so a vertical line runs straight up the middle
    // (and a horizontal line across it), the hex's top/bottom points sitting on
    // it. Both the lines and the tiles live in this container, so the line stays
    // glued to the centre tile through every pan and zoom. The top-left is
    // snapped to a whole number of tiles back from centre, minus the feature's
    // sub-pixel offset, so the feature aligns to 0 and the sheet still covers.
    this.#sprite.position.set(
      -Math.ceil((COVER / 2) / spec.tw) * spec.tw - spec.ax,
      -Math.ceil((COVER / 2) / spec.th) * spec.th - spec.ay,
    )
    this.#sprite.visible = true
  }

  /** Build one repeating pattern tile as a canvas → Texture. The lines are
   *  baked at the accent colour + alpha; the TilingSprite wraps it across the
   *  whole COVER area. */
  #buildTexture(kind: LinesKind, accent: string, alpha: number): Texture | null {
    const w = kind === 'grid' ? 44 : 90
    const h = kind === 'grid' ? 44 : 52
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const color = `rgba(${accent},${alpha})`

    if (kind === 'grid') {
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0.5, 0); ctx.lineTo(0.5, h)   // left edge → vertical lines
      ctx.moveTo(0, 0.5); ctx.lineTo(w, 0.5)   // top edge → horizontal lines
      ctx.stroke()
    } else if (kind === 'dots') {
      ctx.fillStyle = color
      for (const [x, y] of [[0, 0], [90, 0], [0, 52], [90, 52], [45, 26]] as const) {
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
      }
    } else {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2
      for (const poly of HONEY_POLYS) {
        const pts = poly.split(' ').map(s => s.split(',').map(Number))
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
        ctx.closePath()
        ctx.stroke()
      }
    }
    return Texture.from(canvas)
  }

  protected override dispose(): void {
    if (this.#sprite) {
      this.#sprite.parent?.removeChild(this.#sprite)
      this.#sprite.destroy()
      this.#sprite = null
    }
    this.#container = null
  }
}

const _gridLines = new GridLinesDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/GridLinesDrone',
  _gridLines,
)
