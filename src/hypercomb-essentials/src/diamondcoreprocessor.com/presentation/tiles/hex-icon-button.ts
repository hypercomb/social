// diamondcoreprocessor.com/pixi/hex-icon-button.ts
//
// Tile overlay icon button — renders an SVG sprite, center-anchored.
// The button's .position IS the center point. No offset math.

import { Container, Graphics, Sprite, Assets, type Texture } from 'pixi.js'

// ── Hover backdrop ──────────────────────────────────────────────────

const BACKDROP_PAD = 2
const BACKDROP_RADIUS = 1.5
const BACKDROP_FILL = 0x0c0c1a
const BACKDROP_FILL_ALPHA = 0.72
const BACKDROP_STROKE = 0x6688cc
const BACKDROP_STROKE_ALPHA = 0.35
const BACKDROP_STROKE_WIDTH = 0.6

export type IconButtonConfig = {
  /** SVG markup string — rendered as a texture */
  svgMarkup: string
  /** Display size in Pixi units (square) */
  size: number
  /** Normal tint (default white) */
  tint?: number
  /** Hover tint */
  hoverTint?: number
  /** Texture cache key */
  cacheKey?: string
}

export class HexIconButton extends Container {
  #sprite: Sprite | null = null
  #backdrop: Graphics
  #config: IconButtonConfig
  #hovered = false

  constructor(config: IconButtonConfig) {
    super()
    this.#config = config
    this.#backdrop = this.#createBackdrop()
    this.addChild(this.#backdrop)
  }

  async load(): Promise<void> {
    const { svgMarkup, size, tint, cacheKey } = this.#config
    try {
      const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`
      const loadOpts: any = { src: dataUri }
      if (cacheKey) loadOpts.alias = cacheKey
      const texture: Texture = await Assets.load(loadOpts)

      const sprite = new Sprite(texture)
      sprite.width = size
      sprite.height = size
      sprite.anchor.set(0.5, 0.5)
      sprite.tint = tint ?? 0xffffff
      this.#sprite = sprite
      this.addChild(sprite)
    } catch (e) {
      console.warn('[HexIconButton] load failed:', e)
    }
  }

  get hovered(): boolean { return this.#hovered }

  set hovered(value: boolean) {
    if (this.#hovered === value) return
    this.#hovered = value
    this.#backdrop.visible = value
    if (this.#sprite) {
      this.#sprite.tint = value
        ? (this.#config.hoverTint ?? 0xc8d8ff)
        : (this.#config.tint ?? 0xffffff)
    }
  }

  containsPoint(localX: number, localY: number): boolean {
    const r = this.#config.size / 2 + BACKDROP_PAD
    return localX >= -r && localX <= r && localY >= -r && localY <= r
  }

  #createBackdrop(): Graphics {
    const r = this.#config.size / 2 + BACKDROP_PAD
    const g = new Graphics()
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS)
    g.fill({ color: BACKDROP_FILL, alpha: BACKDROP_FILL_ALPHA })
    g.roundRect(-r, -r, r * 2, r * 2, BACKDROP_RADIUS)
    g.stroke({ color: BACKDROP_STROKE, alpha: BACKDROP_STROKE_ALPHA, width: BACKDROP_STROKE_WIDTH })
    g.visible = false
    return g
  }
}
