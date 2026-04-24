// diamondcoreprocessor.com/pixi/hex-label.atlas.ts
import { Container, RenderTexture, Text, TextStyle, Texture } from 'pixi.js'

export interface LabelUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

export class HexLabelAtlas {
  private readonly atlas: RenderTexture
  private readonly map = new Map<string, LabelUV>()
  // Parallel array tracking which label currently owns each slot.
  // Same invariant as HexImageAtlas: when the allocator wraps, the
  // slot's pixels are overwritten, so the previous label's UV entry
  // must be evicted in the same step or `getLabelUV(oldLabel)` will
  // return pixels belonging to a different label.
  private readonly slotToLabel: (string | null)[]
  private nextIndex = 0
  #pivot = false
  #labelResolver: ((directoryName: string) => string) | null = null

  private readonly cols: number
  private readonly rows: number
  private readonly style: TextStyle

  public constructor(
    private readonly renderer: any,
    private readonly cellPx = 128,
    cols = 8,
    rows = 8
  ) {
    this.cols = Math.max(1, cols)
    this.rows = Math.max(1, rows)
    this.slotToLabel = new Array(this.cols * this.rows).fill(null)

    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 8,
    })

    // clear once so sampling starts transparent
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true })

    const hcFont = getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()

    this.style = new TextStyle({
      fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
      fontSize: 9,
      fill: 0xffffff,
      align: 'center',
      letterSpacing: 0.5,
      dropShadow: {
        alpha: 0.35,
        angle: Math.PI / 2,
        blur: 1,
        color: 0x000000,
        distance: 1,
      },
    })
  }

  public setPivot = (pivot: boolean): void => {
    if (this.#pivot === pivot) return
    this.#pivot = pivot
    // clear cache so all labels re-render with new rotation
    this.map.clear()
    this.slotToLabel.fill(null)
    this.nextIndex = 0
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true })
  }

  /**
   * Set a function that resolves directory names to display labels.
   * When set, getLabelUV will render the resolved text instead of the raw directory name.
   */
  public setLabelResolver = (resolver: ((directoryName: string) => string) | null): void => {
    this.#labelResolver = resolver
  }

  /**
   * Flush the entire label cache — all labels will re-render on next getLabelUV call.
   * Call this when the locale changes so labels re-resolve through the label resolver.
   */
  public invalidateLabels = (): void => {
    this.map.clear()
    this.slotToLabel.fill(null)
    this.nextIndex = 0
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true })
  }

  public getAtlasTexture = (): Texture => {
    return this.atlas
  }

  /**
   * Pre-rasterize a batch of labels into the atlas in a single render pass.
   * Idempotent — labels already in the cache are skipped. Call after
   * construction with the set of labels you know will appear on first paint,
   * so `getLabelUV()` never rasterizes on the render-hot path.
   */
  public seed = (labels: readonly string[]): void => {
    if (!labels.length) return

    const batch = new Container()
    const created: Text[] = []

    for (const label of labels) {
      if (!label || this.map.has(label)) continue

      const slot = this.nextIndex % (this.cols * this.rows)
      this.nextIndex++

      // Evict the previous occupant's map entry before overwriting
      // its slot's pixels. Keeps map ⇔ slot content in lockstep.
      const previous = this.slotToLabel[slot]
      if (previous !== null && previous !== label) this.map.delete(previous)
      this.slotToLabel[slot] = label

      const col = slot % this.cols
      const row = Math.floor(slot / this.cols)

      const displayText = this.#labelResolver ? this.#labelResolver(label) : label
      const text = new Text({ text: displayText, style: this.style })
      text.resolution = 8
      text.anchor.set(0.5)
      text.position.set(
        col * this.cellPx + this.cellPx * 0.5,
        row * this.cellPx + this.cellPx * 0.5
      )
      if (this.#pivot) text.rotation = Math.PI / 2

      batch.addChild(text)
      created.push(text)

      const u0 = (col * this.cellPx) / this.atlas.width
      const v0 = (row * this.cellPx) / this.atlas.height
      const u1 = ((col + 1) * this.cellPx) / this.atlas.width
      const v1 = ((row + 1) * this.cellPx) / this.atlas.height
      this.map.set(label, { u0, v0, u1, v1 })
    }

    if (!created.length) return

    this.renderer.render({ container: batch, target: this.atlas, clear: false })
    for (const text of created) text.destroy()
  }

  public getLabelUV = (label: string): LabelUV => {
    const cached = this.map.get(label)
    if (cached) return cached

    // wrap if you exceed capacity (production-safe: no crash, just overwrites old slots)
    const slot = this.nextIndex % (this.cols * this.rows)
    this.nextIndex++

    // Evict the previous occupant so its map entry stops pointing at
    // a slot whose pixels are about to become a different label.
    const previous = this.slotToLabel[slot]
    if (previous !== null && previous !== label) this.map.delete(previous)
    this.slotToLabel[slot] = label

    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)

    // Resolve display text: label resolver (i18n) → raw directory name
    const displayText = this.#labelResolver ? this.#labelResolver(label) : label

    const text = new Text({ text: displayText, style: this.style })
    text.resolution = 8

    text.anchor.set(0.5)
    text.position.set(
      col * this.cellPx + this.cellPx * 0.5,
      row * this.cellPx + this.cellPx * 0.5
    )

    // rotate text 90° CW when pivot is active (pre-baked rotation)
    if (this.#pivot) {
      text.rotation = Math.PI / 2
    }

    // render into the atlas (keep previous labels)
    this.renderer.render({ container: text, target: this.atlas, clear: false })
    text.destroy()

    const u0 = (col * this.cellPx) / this.atlas.width
    const v0 = (row * this.cellPx) / this.atlas.height
    const u1 = ((col + 1) * this.cellPx) / this.atlas.width
    const v1 = ((row + 1) * this.cellPx) / this.atlas.height

    const uv: LabelUV = { u0, v0, u1, v1 }
    this.map.set(label, uv)
    return uv
  }
}

export class HexLabelAtlasFactory {
  public create = (renderer: any, cellPx = 128, cols = 8, rows = 8): HexLabelAtlas => {
    return new HexLabelAtlas(renderer, cellPx, cols, rows)
  }
}

window.ioc.register('@diamondcoreprocessor.com/HexLabelAtlasFactory', new HexLabelAtlasFactory())
