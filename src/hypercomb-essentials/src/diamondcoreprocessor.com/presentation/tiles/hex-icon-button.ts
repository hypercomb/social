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

// Render resolution multiplier — rasterise SVGs at 8× viewBox size so the
// glyph carries enough texels to stay crisp both when minified onto the
// tiny tile icon AND when the camera zooms in past 1:1. 4× left the icons
// visibly soft at zoom; 8× (192px for a 24px viewBox) is the headroom that
// reads as a sharp, professional glyph. Cost is a few hundred KB of
// transient canvas per distinct icon — negligible.
const SVG_RENDER_SCALE = 8

/**
 * Rasterise an SVG string at high resolution into a Pixi Texture via an
 * offscreen Image → Canvas pipeline. Shared by the hover-overlay icon
 * buttons and the persistent per-tile badge layer so both render the same
 * crisp, tintable (pure-white-fill) glyphs. The returned texture is owned
 * by the caller — destroy it when done if you created it standalone.
 */
export async function rasteriseSvgToTexture(
  svgMarkup: string,
  viewBox = SVG_VIEWBOX,
  renderScale = SVG_RENDER_SCALE,
): Promise<Texture> {
  const renderPx = viewBox * renderScale

  // Inject higher render dimensions while keeping the viewBox
  const hiResSvg = svgMarkup
    .replace(`width="${viewBox}"`, `width="${renderPx}"`)
    .replace(`height="${viewBox}"`, `height="${renderPx}"`)

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

  const texture = Texture.from({
    resource: canvas,
    alphaMode: 'premultiply-alpha-on-upload',
    scaleMode: 'linear',
  })
  // The glyph is rasterised large and drawn small. Plain bilinear
  // minification leaves it soft and makes it shimmer as the camera moves;
  // mipmaps give a clean, stable downscale at every zoom level — the
  // difference between a crisp icon and a "lame" blurry one. Guarded: a
  // texture-source shape without these knobs still returns a usable texture.
  try {
    texture.source.autoGenerateMipmaps = true
    texture.source.update()
  } catch { /* mipmaps optional — texture still renders without them */ }
  return texture
}

/**
 * Render a Material Symbols ligature (an icon NAME, e.g. "edit") to a high-res,
 * tintable (white-fill) Pixi Texture using the Material Symbols Outlined font on
 * a canvas. The universal icon protocol uses this to reskin a Pixi overlay icon
 * with a user-chosen Material glyph — the DOM surfaces just swap the ligature
 * string, but Pixi needs it baked to a texture.
 */
export async function renderMaterialGlyphToTexture(ligature: string): Promise<Texture> {
  const px = SVG_VIEWBOX * SVG_RENDER_SCALE
  const fontSize = Math.round(px * 0.82)
  const font = `${fontSize}px "Material Symbols Outlined"`
  // Ensure the font (+ this ligature) is loaded before rasterising, else the
  // canvas draws the literal text or tofu.
  try {
    await (document as unknown as { fonts?: { load?: (f: string, t?: string) => Promise<unknown> } })
      .fonts?.load?.(font, ligature)
  } catch { /* best effort — proceed */ }

  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, px, px)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font
  ctx.fillText(ligature, px / 2, px / 2)

  const texture = Texture.from({
    resource: canvas,
    alphaMode: 'premultiply-alpha-on-upload',
    scaleMode: 'linear',
  })
  try {
    texture.source.autoGenerateMipmaps = true
    texture.source.update()
  } catch { /* mipmaps optional */ }
  return texture
}

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

  /**
   * Reskin this button with a Material Symbols glyph (icon-protocol override) —
   * replaces the SVG sprite with a font-rendered glyph texture.
   */
  async setGlyph(materialName: string): Promise<void> {
    if (!this.#alive) return
    try {
      const texture = await renderMaterialGlyphToTexture(materialName)
      if (!this.#alive) { texture.destroy(); return }
      if (this.#sprite) { this.#sprite.destroy(); this.#sprite = null }
      const sprite = new Sprite(texture)
      sprite.width = this.#size
      sprite.height = this.#size
      sprite.anchor.set(0.5, 0.5)
      sprite.tint = this.#hovered ? this.#hoverTint : this.#normalTint
      this.#sprite = sprite
      this.addChild(sprite)
    } catch (e) {
      console.warn('[HexIconButton] setGlyph failed:', e)
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

  /**
   * Set the tint applied when the icon is not hovered. Used by per-tile
   * `tintWhen` predicates so an icon can advertise per-cell state (e.g.
   * "this tile contains notes") via colour. Pass null to reset to white.
   */
  setNormalTint(tint: number | null): void {
    this.#normalTint = tint ?? 0xffffff
    if (this.#sprite && !this.#hovered) {
      this.#sprite.tint = this.#normalTint
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
    return rasteriseSvgToTexture(svgMarkup, SVG_VIEWBOX, SVG_RENDER_SCALE)
  }
}
