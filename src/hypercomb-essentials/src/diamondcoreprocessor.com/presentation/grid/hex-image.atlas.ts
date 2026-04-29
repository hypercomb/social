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
  readonly #failures = new Map<string, number>()
  // Parallel array tracking which signature currently occupies each
  // slot. When the monotonic allocator wraps, the slot's pixels are
  // overwritten by a new image — we must evict the old signature's
  // `#map` entry at the same moment, or `getImageUV(oldSig)` will
  // return a UV pointing at the new content and the shader will
  // render garbage. Keeping #map and #slotToSig in lockstep is the
  // load-bearing invariant of this atlas.
  readonly #slotToSig: (string | null)[]
  #nextSlot = 0
  // Monotonic counter incremented every time a slot is reused — that is,
  // every time an existing sig's map entry is evicted because its slot
  // is being overwritten with different content. Callers (the geometry
  // builder) fold this into their cache key so they know to rebuild
  // attribute buffers whose baked UVs might point at a slot that now
  // holds a different image. New loads into fresh slots do NOT bump
  // this — they can't invalidate any previously-issued UV.
  #evictionGeneration = 0

  readonly #cols: number
  readonly #rows: number
  readonly #cellPx: number
  readonly #renderer: any
  static readonly MAX_RETRIES = 3

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
    this.#slotToSig = new Array(this.#cols * this.#rows).fill(null)

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

  /**
   * Monotonic counter of eviction events — how many times a slot has
   * been reused with different content, invalidating previously-issued
   * UVs for the displaced signature. Consumers that bake UVs into
   * buffers should include this in their buffer-cache key so a
   * generation change forces a rebuild.
   */
  get evictionGeneration(): number {
    return this.#evictionGeneration
  }

  /** Returns true if the signature has permanently failed loading (exceeded max retries). */
  hasFailed(sig: string): boolean {
    return (this.#failures.get(sig) ?? 0) >= HexImageAtlas.MAX_RETRIES
  }

  /** Clear failure count for a signature so it can be retried (e.g. after re-save). */
  clearFailure(sig: string): void {
    this.#failures.delete(sig)
  }

  async loadImage(sig: string, blob: Blob): Promise<ImageUV | null> {
    const existing = this.#map.get(sig)
    if (existing) return existing

    if (this.hasFailed(sig)) return null

    const slot = this.#nextSlot % (this.#cols * this.#rows)
    this.#nextSlot++

    // Invariant maintenance: whatever sig was living in this slot is
    // about to lose its pixels. Evict its map entry now so later
    // `getImageUV(previousSig)` returns null (caller falls back to
    // label) instead of resolving to a UV whose pixels now belong to
    // a different image.
    const previous = this.#slotToSig[slot]
    if (previous !== null && previous !== sig) {
      this.#map.delete(previous)
      // Signal to consumers that a previously-issued UV is no longer
      // valid. The geometry builder reads this counter to decide
      // whether to rebuild its baked UV buffer.
      this.#evictionGeneration++
    }

    const col = slot % this.#cols
    const row = Math.floor(slot / this.#cols)

    let bitmap: ImageBitmap
    try {
      // Decode AT atlas-cell resolution rather than at the source image's
      // full size. A 2000×2000 photo previously decoded as a ~16MB
      // ImageBitmap, only to be scaled down to fit a single 256px atlas
      // cell. Resizing during decode (browser-side, optimised) drops
      // the work to roughly target² pixels instead of source². On
      // integrated graphics / Surface UHD this is the difference
      // between "instant" and "couple-hundred-ms each tile".
      //
      // Passing only resizeWidth lets the browser compute the matching
      // height to preserve aspect ratio, which the contain-fill scaling
      // below depends on. 2× the cell size keeps headroom for retina
      // sampling without paying for full source resolution.
      const targetMax = this.#cellPx * 2
      bitmap = await createImageBitmap(blob, {
        resizeWidth: targetMax,
        resizeQuality: 'medium',
      })
    } catch {
      this.#failures.set(sig, (this.#failures.get(sig) ?? 0) + 1)
      console.warn(`[HexImageAtlas] createImageBitmap failed for ${sig.slice(0, 12)}… (attempt ${this.#failures.get(sig)}/${HexImageAtlas.MAX_RETRIES})`)
      return null
    }

    let texture: Texture
    try {
      texture = Texture.from(bitmap)
    } catch {
      bitmap.close()
      this.#failures.set(sig, (this.#failures.get(sig) ?? 0) + 1)
      console.warn(`[HexImageAtlas] Texture.from failed for ${sig.slice(0, 12)}… (attempt ${this.#failures.get(sig)}/${HexImageAtlas.MAX_RETRIES})`)
      return null
    }

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
    this.#slotToSig[slot] = sig
    return uv
  }

  /** Remove a specific entry (e.g. after re-save) so next load picks up the new image */
  invalidate(sig: string): void {
    this.#map.delete(sig)
    this.#failures.delete(sig)
    // slotToSig keeps the phantom — it's harmless: either the slot is
    // reused (eviction is a no-op since #map already lacks the entry),
    // or the slot is never touched again. The invariant "any sig in
    // #map points at a slot whose current content is that sig" still
    // holds.
  }
}
