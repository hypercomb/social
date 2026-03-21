// diamondcoreprocessor.com/pixi/hex-image.atlas.ts
import { Container, RenderTexture, Sprite, Texture } from 'pixi.js'

export interface ImageUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

export class HexImageAtlas {
  #atlas: RenderTexture
  readonly #map = new Map<string, ImageUV>()
  #nextSlot = 0

  readonly #cols: number
  readonly #rows: number
  readonly #cellPx: number
  readonly #renderer: any

  constructor(renderer: any, cellPx = 256, cols = 8, rows = 8) {
    this.#renderer = renderer
    this.#cellPx = Math.max(1, cellPx)
    this.#cols = Math.max(1, cols)
    this.#rows = Math.max(1, rows)

    this.#atlas = RenderTexture.create({
      width: this.#cols * this.#cellPx,
      height: this.#rows * this.#cellPx,
      resolution: 2,
      scaleMode: 'linear',
      antialias: true,
    })

    // clear so sampling starts transparent
    this.#renderer.render({ container: new Container(), target: this.#atlas, clear: true })
  }

  getAtlasTexture(): Texture {
    return this.#atlas
  }

  hasImage(sig: string): boolean {
    return this.#map.has(sig)
  }

  getImageUV(sig: string): ImageUV | null {
    return this.#map.get(sig) ?? null
  }

  async loadImage(sig: string, blob: Blob): Promise<ImageUV> {
    const existing = this.#map.get(sig)
    if (existing) return existing

    const slot = this.#nextSlot % (this.#cols * this.#rows)
    this.#nextSlot++

    const col = slot % this.#cols
    const row = Math.floor(slot / this.#cols)

    const bitmap = await createImageBitmap(blob)
    const texture = Texture.from(bitmap)
    const sprite = new Sprite(texture)

    // contain-fill: scale image to fit entirely within the atlas cell (no overflow)
    const scaleX = this.#cellPx / bitmap.width
    const scaleY = this.#cellPx / bitmap.height
    const scale = Math.min(scaleX, scaleY)
    sprite.scale.set(scale)

    // center the image in the cell
    sprite.anchor.set(0.5)
    sprite.position.set(
      col * this.#cellPx + this.#cellPx * 0.5,
      row * this.#cellPx + this.#cellPx * 0.5,
    )

    // render into atlas (keep previous images)
    this.#renderer.render({ container: sprite, target: this.#atlas, clear: false })
    sprite.destroy()

    // UV bounds reference the image content within the cell (skip padding).
    // Contain-fill guarantees padding ≥ 0, so UVs stay within the cell.
    const imgW = bitmap.width * scale
    const imgH = bitmap.height * scale
    const padX = (this.#cellPx - imgW) / 2
    const padY = (this.#cellPx - imgH) / 2

    const u0 = (col * this.#cellPx + padX) / this.#atlas.width
    const v0 = (row * this.#cellPx + padY) / this.#atlas.height
    const u1 = (col * this.#cellPx + padX + imgW) / this.#atlas.width
    const v1 = (row * this.#cellPx + padY + imgH) / this.#atlas.height

    const uv: ImageUV = { u0, v0, u1, v1 }
    this.#map.set(sig, uv)
    return uv
  }

  /** Remove a specific entry (e.g. after re-save) so next load picks up the new image */
  invalidate(sig: string): void {
    this.#map.delete(sig)
  }
}
