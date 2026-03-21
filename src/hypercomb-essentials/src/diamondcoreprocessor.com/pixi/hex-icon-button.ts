// diamondcoreprocessor.com/pixi/hex-icon-button.ts
import { Container, Sprite, Text, TextStyle, Assets, type Texture } from 'pixi.js'

export type IconButtonConfig = {
  /** Complete SVG markup string (loaded as data URI texture) */
  svgMarkup?: string
  /** Single character from hypercomb-icons font */
  fontChar?: string
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
  #display: Sprite | Text | null = null
  #config: IconButtonConfig
  #hovered = false

  constructor(config: IconButtonConfig) {
    super()
    this.#config = config
  }

  async load(): Promise<void> {
    try {
      if (this.#config.fontChar) {
        await document.fonts.ready
        const style = new TextStyle({
          fontFamily: 'hypercomb-icons',
          fontSize: this.#config.width,
          fill: this.#config.tint ?? 0xffffff,
        })
        const text = new Text({ text: this.#config.fontChar, style, resolution: window.devicePixelRatio * 4 })
        text.anchor.set(0.5, 0.5)
        text.position.set(this.#config.width / 2, this.#config.height / 2)
        this.#display = text
        this.addChild(text)
      } else if (this.#config.svgMarkup) {
        const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#config.svgMarkup)}`
        const loadOpts: any = { src: dataUri }
        if (this.#config.alias) loadOpts.alias = this.#config.alias
        const texture: Texture = await Assets.load(loadOpts)
        const sprite = new Sprite(texture)
        sprite.width = this.#config.width
        sprite.height = this.#config.height
        sprite.tint = this.#config.tint ?? 0xffffff
        this.#display = sprite
        this.addChild(sprite)
      }
    } catch (e) {
      console.warn('[HexIconButton] load failed:', e)
    }
  }

  get hovered(): boolean { return this.#hovered }

  set hovered(value: boolean) {
    if (this.#hovered === value) return
    this.#hovered = value
    if (!this.#display) return
    this.#display.tint = value
      ? (this.#config.hoverTint ?? 0xc8d8ff)
      : (this.#config.tint ?? 0xffffff)
  }

  containsPoint(localX: number, localY: number): boolean {
    return localX >= 0 && localX <= this.#config.width
      && localY >= 0 && localY <= this.#config.height
  }
}
