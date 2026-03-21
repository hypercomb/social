// diamondcoreprocessor.com/pixi/hex-icon-button.ts
import { Container, Sprite, Assets, type Texture } from 'pixi.js'

export type IconButtonConfig = {
  /** Complete SVG markup string (loaded as data URI texture) */
  svgMarkup: string
  /** Display width in Pixi coordinate pixels */
  width: number
  /** Display height in Pixi coordinate pixels */
  height: number
  /** Normal-state tint (default: 0xffffff) */
  tint?: number
  /** Hover-state tint */
  hoverTint?: number
  /** Unique alias for texture caching */
  alias?: string
}

export class HexIconButton extends Container {
  #sprite: Sprite | null = null
  #config: IconButtonConfig
  #hovered = false

  constructor(config: IconButtonConfig) {
    super()
    this.#config = config
  }

  async load(): Promise<void> {
    try {
      const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#config.svgMarkup)}`
      const loadOpts: any = { src: dataUri }
      if (this.#config.alias) loadOpts.alias = this.#config.alias
      const texture: Texture = await Assets.load(loadOpts)
      this.#sprite = new Sprite(texture)
      this.#sprite.width = this.#config.width
      this.#sprite.height = this.#config.height
      this.#sprite.tint = this.#config.tint ?? 0xffffff
      this.addChild(this.#sprite)
    } catch (e) {
      console.warn('[HexIconButton] SVG load failed:', e)
    }
  }

  get hovered(): boolean { return this.#hovered }

  set hovered(value: boolean) {
    if (this.#hovered === value) return
    this.#hovered = value
    if (!this.#sprite) return
    this.#sprite.tint = value
      ? (this.#config.hoverTint ?? 0xc8d8ff)
      : (this.#config.tint ?? 0xffffff)
  }

  containsPoint(localX: number, localY: number): boolean {
    return localX >= 0 && localX <= this.#config.width
      && localY >= 0 && localY <= this.#config.height
  }
}
