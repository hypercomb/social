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
 * Decode an SVG string to something drawable.
 *
 * The Image element leads: `createImageBitmap` REJECTS an SVG blob outright in
 * Chromium (InvalidStateError — verified in the dev shell), so trying it first
 * would just burn a rejected promise per icon. It stays as the fallback for
 * engines that do support it, on the off chance the Image path is the one that
 * fails.
 *
 * Both paths are best-effort and BOTH can fail — a decode that rejects used to
 * leave the button permanently blank, which is why callers park for repair
 * rather than swallowing the error.
 */
async function decodeSvg(hiResSvg: string, renderPx: number): Promise<CanvasImageSource> {
  const blob = new Blob([hiResSvg], { type: 'image/svg+xml' })

  const img = new Image(renderPx, renderPx)
  const url = URL.createObjectURL(blob)
  try {
    img.src = url
    await img.decode()
    return img
  } catch (e) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob) } catch { /* both paths out */ }
    }
    throw e
  } finally {
    URL.revokeObjectURL(url)
  }
}

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
  if (!svgMarkup) throw new Error('rasteriseSvgToTexture: empty markup')
  const renderPx = viewBox * renderScale

  // Inject higher render dimensions while keeping the viewBox
  const hiResSvg = svgMarkup
    .replace(`width="${viewBox}"`, `width="${renderPx}"`)
    .replace(`height="${viewBox}"`, `height="${renderPx}"`)

  const source = await decodeSvg(hiResSvg, renderPx)

  // Draw to canvas at exact resolution — no browser DPR ambiguity
  const canvas = document.createElement('canvas')
  canvas.width = renderPx
  canvas.height = renderPx
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0, renderPx, renderPx)
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()

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
  const fonts = (document as unknown as {
    fonts?: { load?: (f: string, t?: string) => Promise<unknown>; check?: (f: string, t?: string) => boolean }
  }).fonts
  try {
    await fonts?.load?.(font, ligature)
  } catch { /* best effort — verified below */ }

  // VERIFY, don't assume. If the face never arrived (cold cache, offline, a
  // navigation that dropped the font before the overlay rebuilt), `fillText`
  // renders the LIGATURE AS LITERAL WORDS — "edit", "delete" — sitting in the
  // icon band looking like labels. Throwing here is what makes the caller fall
  // back to the author SVG, which is always a real glyph.
  if (fonts?.check && !fonts.check(font, ligature)) {
    throw new Error(`Material Symbols unavailable for "${ligature}"`)
  }

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

// ── Deferred repair ─────────────────────────────────────────────────
//
// A button whose icon failed to rasterise is NOT left as a labelled blank. It
// parks here, and the next time the document becomes visible (or is restored
// from the back/forward cache — the "diverted to another origin and came back"
// path) every parked button retries. Repair is idempotent: a button that
// succeeds unparks itself, and one that is destroyed drops out.

const AWAITING_REPAIR = new Set<HexIconButton>()
let repairArmed = false

function armRepair(): void {
  if (repairArmed || typeof document === 'undefined') return
  repairArmed = true
  const retry = () => {
    if (document.visibilityState !== 'visible') return
    for (const btn of [...AWAITING_REPAIR]) void btn.repair()
  }
  document.addEventListener('visibilitychange', retry)
  window.addEventListener('pageshow', retry)
  window.addEventListener('focus', retry)
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
  /** Last requested artwork — kept so a failed load can be retried, never lost. */
  #svgMarkup: string | null = null
  #glyph: string | null = null

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
    this.#svgMarkup = svgMarkup
    this.#glyph = null

    try {
      const texture = await this.#rasterise(svgMarkup)
      if (!this.#alive) { texture.destroy(); return }
      this.#adopt(texture)
      this.#park(false)
    } catch (e) {
      console.warn('[HexIconButton] load failed — parked for repair:', e)
      this.#park(true)
    }
  }

  /** True once a glyph is actually on screen. A false here with the button in
   *  the scene IS the labels-without-icons state. */
  get loaded(): boolean { return this.#sprite !== null }

  /**
   * Retry whatever this button was last asked to show. Safe to call any number
   * of times; a no-op once a sprite is present. A glyph override that still
   * cannot render falls back to the author SVG rather than staying blank.
   */
  async repair(): Promise<void> {
    if (!this.#alive || this.#sprite) { this.#park(false); return }
    if (this.#glyph) {
      await this.setGlyph(this.#glyph)
      if (this.#sprite) return
    }
    if (this.#svgMarkup) await this.load(this.#svgMarkup)
  }

  #park(pending: boolean): void {
    if (pending) { AWAITING_REPAIR.add(this); armRepair() }
    else AWAITING_REPAIR.delete(this)
  }

  #adopt(texture: Texture): void {
    if (this.#sprite) { this.#sprite.destroy(); this.#sprite = null }
    const sprite = new Sprite(texture)
    sprite.width = this.#size
    sprite.height = this.#size
    sprite.anchor.set(0.5, 0.5)
    sprite.tint = this.#hovered ? this.#hoverTint : this.#normalTint
    this.#sprite = sprite
    this.addChild(sprite)
  }

  /**
   * Reskin this button with a Material Symbols glyph (icon-protocol override) —
   * replaces the SVG sprite with a font-rendered glyph texture.
   */
  async setGlyph(materialName: string): Promise<void> {
    if (!this.#alive) return
    this.#glyph = materialName
    try {
      const texture = await renderMaterialGlyphToTexture(materialName)
      if (!this.#alive) { texture.destroy(); return }
      this.#adopt(texture)
      this.#park(false)
    } catch (e) {
      // The reskin could not render (font missing / unknown ligature). Keep the
      // author SVG rather than an empty button — an override must never be able
      // to erase an icon.
      console.warn('[HexIconButton] setGlyph failed — falling back to author SVG:', e)
      if (this.#svgMarkup) {
        await this.load(this.#svgMarkup)
        this.#glyph = materialName   // keep the override so a later repair retries it
      } else this.#park(true)
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
    AWAITING_REPAIR.delete(this)
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
