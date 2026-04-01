// diamondcoreprocessor.com/pixi/hex-icon-button.ts
//
// Tile overlay icon button — renders an SVG sprite, center-anchored.
// The button's .position IS the center point. No offset math needed.

import { Container, Graphics, Sprite, Texture } from 'pixi.js'

// ── Hover backdrop ──────────────────────────────────────────────────

const BACKDROP_PAD = 2
const BACKDROP_RADIUS = 1.5
const BACKDROP_FILL = 0x0c0c1a
const BACKDROP_FILL_ALPHA = 0.72
const BACKDROP_STROKE = 0x6688cc
const BACKDROP_STROKE_ALPHA = 0.35
const BACKDROP_STROKE_WIDTH = 0.6

// SVG source dimensions (viewBox coordinate space)
const SVG_VIEWBOX = 24

// Render resolution multiplier — rasterise SVGs at 4× viewBox size
// so the downscale to display size stays sharp at any zoom level.
const SVG_RENDER_SCALE = 4

export type IconButtonConfig = {
  /** Display size in Pixi units (square) */
  size: number
  /** Normal tint (default white) */
  tint?: number
  /** Hover tint */
  hoverTint?: number
}

export class HexIconButton extends Container {
  #sprite: Sprite | null = null
  #backdrop: Graphics
  #size: number
  #normalTint: number
  #hoverTint: number
  #hovered = false
  #alive = true

  constructor(config: IconButtonConfig) {
    super()
    this.#size = config.size
    this.#normalTint = config.tint ?? 0xffffff
    this.#hoverTint = config.hoverTint ?? 0xc8d8ff
    this.#backdrop = this.#buildBackdrop()
    this.addChild(this.#backdrop)
  }

  // ── Async icon load ────────────────────────────────────────────────

  async load(svgMarkup: string): Promise<void> {
    if (!this.#alive) return

    try {
      const texture = await this.#rasterise(svgMarkup)
      if (!this.#alive) return

      const sprite = new Sprite(texture)
      sprite.width = this.#size
      sprite.height = this.#size
      sprite.anchor.set(0.5, 0.5)
      sprite.tint = this.#normalTint
      this.#sprite = sprite
      this.addChild(sprite)
    } catch (e) {
      console.warn('[HexIconButton] load failed:', e)
    }
  }

  // ── Hover state ────────────────────────────────────────────────────

  get hovered(): boolean { return this.#hovered }

  set hovered(value: boolean) {
    if (this.#hovered === value) return
    this.#hovered = value
    this.#backdrop.visible = value
    if (this.#sprite) {
      this.#sprite.tint = value ? this.#hoverTint : this.#normalTint
    }
  }

  // ── Hit testing ────────────────────────────────────────────────────

  containsPoint(localX: number, localY: number): boolean {
    const r = this.#size / 2 + BACKDROP_PAD
    return localX >= -r && localX <= r && localY >= -r && localY <= r
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    this.#alive = false
    super.destroy(options)
  }

  // ── Internals ──────────────────────────────────────────────────────

  #buildBackdrop(): Graphics {
    const r = this.#size / 2 + BACKDROP_PAD
    const g = new Graphics()
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS)
    g.fill({ color: BACKDROP_FILL, alpha: BACKDROP_FILL_ALPHA })
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS)
    g.stroke({ color: BACKDROP_STROKE, alpha: BACKDROP_STROKE_ALPHA, width: BACKDROP_STROKE_WIDTH })
    g.visible = false
    return g
  }

  /** Rasterise SVG at high resolution via an offscreen Image → Canvas → Texture pipeline. */
  async #rasterise(svgMarkup: string): Promise<Texture> {
    const renderPx = SVG_VIEWBOX * SVG_RENDER_SCALE   // 96

    // Inject higher render dimensions while keeping the viewBox
    const hiResSvg = svgMarkup
      .replace(`width="${SVG_VIEWBOX}"`, `width="${renderPx}"`)
      .replace(`height="${SVG_VIEWBOX}"`, `height="${renderPx}"`)

    // Decode SVG via Image element
    const img = new Image(renderPx, renderPx)
    const blob = new Blob([hiResSvg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    try {
      img.src = url
      await img.decode()
    } finally {
      URL.revokeObjectURL(url)
    }

    // Draw to canvas at exact resolution — no browser DPR ambiguity
    const canvas = document.createElement('canvas')
    canvas.width = renderPx
    canvas.height = renderPx
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, renderPx, renderPx)

    return Texture.from({ resource: canvas, alphaMode: 'premultiply-alpha-on-upload' })
  }
}
