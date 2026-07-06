// diamondcoreprocessor.com/pixi/hex-label.atlas.ts
import { Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { buildSdfCell } from './sdf-glyph.js'

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

  // Reusable blit targets for writing one SDF cell into the atlas: the
  // device-sized canvas the field is written to, its Pixi texture, and the
  // logical-sized sprite that stamps it into a cell. Created lazily once.
  #sdfCanvas: HTMLCanvasElement | null = null
  #sdfCtx: CanvasRenderingContext2D | null = null
  #sdfTexture: Texture | null = null
  #sdfSprite: Sprite | null = null

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
    // resolution 2 gives 256 physical px per 128px label cell. Cells hold a
    // CPU-computed signed distance field (see sdf-glyph.ts / #bakeLabel), which
    // the shader decodes with fwidth-based AA — crisp at ANY zoom without ever
    // raising this resolution, which Edge caps (see above). The shader samples
    // a central band (LABEL_BAND in hex-sdf.shader.ts) to keep on-screen size
    // matched to the legacy 9px look.
    this.atlas = RenderTexture.create({
      width: this.cols * this.cellPx,
      height: this.rows * this.cellPx,
      resolution: 2,
    })

    // clear once so sampling starts transparent
    this.renderer.render({ container: new Container(), target: this.atlas, clear: true })
  }

  // Lazily create the reusable canvas / texture / sprite used to stamp one SDF
  // cell into the atlas. The canvas is device-sized (cellPx × RT resolution) so
  // it maps 1:1 into a cell; the sprite is logical cellPx so positions match
  // the UV math.
  #ensureSdfTargets = (): boolean => {
    if (this.#sdfSprite) return true
    const dev = this.cellPx * (this.atlas.source?.resolution ?? 2)
    const cv = document.createElement('canvas')
    cv.width = dev
    cv.height = dev
    const cx = cv.getContext('2d')
    if (!cx) return false
    this.#sdfCanvas = cv
    this.#sdfCtx = cx
    this.#sdfTexture = Texture.from(cv)
    const sp = new Sprite(this.#sdfTexture)
    sp.width = this.cellPx
    sp.height = this.cellPx
    this.#sdfSprite = sp
    return true
  }

  // Bake one label into slot (col,row): CPU signed-distance field → canvas →
  // Sprite render into the atlas. The cell is fully overwritten (every texel
  // gets a field value, A=255), so slot reuse can never superimpose. The field
  // itself is a PLAIN WHITE GLYPH — no shadow, no stroke, no edge of any kind
  // (hard user rule; legibility over images comes from the pill/banner the
  // shader draws BEHIND text, never from decorating the glyphs).
  // baseFontPx 18 is load-bearing: LABEL_BAND (2.0) in hex-sdf.shader.ts
  // compensates the sample window so on-screen size matches the legacy 9px
  // look. Keep the two in lockstep.
  #bakeLabel = (displayText: string, col: number, row: number): void => {
    if (!this.#ensureSdfTargets()) return // no 2D context → skip (Pixi itself needs one anyway)
    const img = buildSdfCell(displayText, {
      cellDevice: this.#sdfCanvas!.width,
      baseFontPx: 18,
      letterSpacingPx: 1.0,
      radiusLogical: 8,
      rotate: this.#pivot ? Math.PI / 2 : 0,
    })
    this.#sdfCtx!.putImageData(img, 0, 0)
    this.#sdfTexture!.source.update()
    this.#sdfSprite!.position.set(col * this.cellPx, row * this.cellPx)
    this.renderer.render({ container: this.#sdfSprite!, target: this.atlas, clear: false })
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

  /** True if the label currently owns a live slot — its previously-issued
   *  UV still points at its own pixels. False after eviction (a baked UV
   *  for this label now samples a DIFFERENT label's glyphs). */
  public hasLabel = (label: string): boolean => this.map.has(label)

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
        // Same contract as HexImageAtlas: announce the displacement so the
        // renderer can repaint if the victim label is on screen.
        window.dispatchEvent(new CustomEvent('hex-label-atlas:evicted', { detail: { label: previous } }))
      }

      const displayText = this.#labelResolver ? this.#labelResolver(label) : label
      this.#bakeLabel(displayText, col, row)

      const u0 = (col * this.cellPx) / this.atlas.width
      const v0 = (row * this.cellPx) / this.atlas.height
      const u1 = ((col + 1) * this.cellPx) / this.atlas.width
      const v1 = ((row + 1) * this.cellPx) / this.atlas.height
      this.map.set(label, { u0, v0, u1, v1 })
    }
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
      // Evictions can originate OUTSIDE any render pass — an in-place cell
      // update (#tryInPlaceCellUpdate) baking an uncached label after the
      // ring has wrapped displaces a slot that may belong to an ON-SCREEN
      // label, whose baked UV then samples the wrong glyphs with no pass
      // scheduled to heal it (the superimposed/wrong-label bug class).
      // Announce it so the renderer can repaint affected cells.
      window.dispatchEvent(new CustomEvent('hex-label-atlas:evicted', { detail: { label: previous } }))
    }

    // Resolve display text: label resolver (i18n) → raw directory name
    const displayText = this.#labelResolver ? this.#labelResolver(label) : label

    this.#bakeLabel(displayText, col, row)

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
