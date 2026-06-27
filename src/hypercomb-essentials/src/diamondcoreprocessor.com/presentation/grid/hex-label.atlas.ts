// diamondcoreprocessor.com/pixi/hex-label.atlas.ts
import { Container, Graphics, RenderTexture, Text, TextStyle, Texture } from 'pixi.js'

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
  // Bumped whenever a slot is REUSED for a different label. Mirrors
  // HexImageAtlas.evictionGeneration: show-cell folds this into
  // buildCellsKey so the fill geometry rebuilds (re-baking on-screen
  // labels into fresh slots) whenever wrap-around evicts a slot — without
  // it, a cell's baked UV would keep pointing at a slot whose pixels are
  // now a different label.
  #evictionGeneration = 0
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

    // resolution 2 (NOT 8). At resolution 8 this becomes an 8192×8192
    // physical render target (1024 logical × 8). Edge's ANGLE/D3D11 backend
    // mis-samples that target's transparent texels as bright/garbage — the
    // shader's label-mix (`mix(color, white, labelAlpha)`) then washes every
    // tile pearlescent-white. Proven via the Claude driver in real Edge:
    // swapping this exact RenderTexture to resolution 2 (2048×2048) made the
    // wash vanish while labels stayed crisp. Keep this in lockstep with the
    // known-good HexImageAtlas, which renders fine in Edge at resolution 2.
    // resolution 2 still gives 256 physical px per 128px label cell — far more
    // than a 9px font needs.
    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 2,
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

  /** Incremented each time a slot is reused for a different label. */
  public get evictionGeneration(): number {
    return this.#evictionGeneration
  }

  /**
   * Zero a single slot's pixels before a reused slot is overwritten.
   * Labels are mostly transparent (only the glyph strokes have alpha), so
   * a plain `clear:false` redraw leaves the PREVIOUS label's strokes
   * showing through the new one — the superimposed-labels bug. We must wipe
   * exactly this one cell; a global `clear:true` would wipe the other 63
   * live slots. (HexImageAtlas doesn't need this: its images are opaque and
   * fully overdraw the slot.)
   *
   * THE EDGE WHITE-OVERLAY BUG (root cause): this used to draw a white rect
   * with `blendMode = 'erase'`. Edge's ANGLE/D3D11 backend does NOT honor the
   * `erase` blend mode when rendering into a RenderTexture — the white eraser
   * composites as OPAQUE WHITE instead of zeroing alpha. Every evicted slot
   * then turns solid white, and the SDF shader's label-mix
   * (`mix(color, white, labelAlpha)`) washes the whole tile pearlescent-white.
   * This only triggers once the atlas wraps (>64 labels), which is why small
   * hives (root) render fine while large ones (e.g. a 79-tile hive) wash —
   * and why it "sticks": the bogus white never clears, so it accumulates
   * across slots on every re-bake. Proven via the Claude driver in real Edge:
   * forcing 16 evictions left exactly 16/64 slots opaque white.
   *
   * A scissored `gl.clear` zeroes the slot's texels directly, bypassing blend
   * modes entirely — works identically in Chrome and Edge. The `erase` path is
   * kept only as a WebGPU fallback (no `gl` context; `erase` is fine there).
   */
  #clearSlot = (col: number, row: number): void => {
    const renderer = this.renderer
    const gl: WebGL2RenderingContext | WebGLRenderingContext | undefined = renderer.gl

    if (gl && renderer.renderTarget && typeof renderer.renderTarget.bind === 'function') {
      const resolution = this.atlas.source?.resolution ?? 1
      const phys = this.cellPx * resolution
      const physHeight = this.rows * this.cellPx * resolution
      // Bind the atlas framebuffer WITHOUT clearing the whole target.
      renderer.renderTarget.bind(this.atlas, false)
      gl.enable(gl.SCISSOR_TEST)
      gl.clearColor(0, 0, 0, 0)
      // WebGL framebuffer origin is bottom-left → flip the row.
      gl.scissor(col * phys, physHeight - (row + 1) * phys, phys, phys)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.disable(gl.SCISSOR_TEST)
      return
    }

    // Fallback (WebGPU / no GL context): the original erase-blend wipe.
    const eraser = new Graphics()
      .rect(col * this.cellPx, row * this.cellPx, this.cellPx, this.cellPx)
      .fill(0xffffff)
    eraser.blendMode = 'erase'
    this.renderer.render({ container: eraser, target: this.atlas, clear: false })
    eraser.destroy()
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

      const previous = this.slotToLabel[slot]
      this.slotToLabel[slot] = label

      const col = slot % this.cols
      const row = Math.floor(slot / this.cols)

      // Reusing this slot for a different label: evict the old map entry,
      // bump the generation (forces a geometry rebake), and ERASE the old
      // pixels so the new label doesn't superimpose on them.
      if (previous !== null && previous !== label) {
        this.map.delete(previous)
        this.#evictionGeneration++
        this.#clearSlot(col, row)
      }

      const displayText = this.#labelResolver ? this.#labelResolver(label) : label
      const text = new Text({ text: displayText, style: this.style })
      text.resolution = 2
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

    const previous = this.slotToLabel[slot]
    this.slotToLabel[slot] = label

    const col = slot % this.cols
    const row = Math.floor(slot / this.cols)

    // Reusing this slot for a different label: evict the old map entry,
    // bump the generation (forces a geometry rebake so cells re-point at
    // fresh slots), and ERASE the old pixels so the new label doesn't
    // superimpose on the previous label's strokes.
    if (previous !== null && previous !== label) {
      this.map.delete(previous)
      this.#evictionGeneration++
      this.#clearSlot(col, row)
    }

    // Resolve display text: label resolver (i18n) → raw directory name
    const displayText = this.#labelResolver ? this.#labelResolver(label) : label

    const text = new Text({ text: displayText, style: this.style })
    text.resolution = 2 // match the atlas RenderTexture resolution (see constructor) and seed(); baking at 8 wasted 16× the glyph pixels per label on the re-bake-heavy path

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
