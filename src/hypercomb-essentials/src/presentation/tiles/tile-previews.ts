// tile-previews.ts — LOOKS THAT ARE NOT YET TRUE. A branch of the tile
// renderer (documentation/tile-renderer-tree.md): two previews painted
// straight into the page's buffers, never at the cost of a render pass and
// never persisted — putting them away restores the page exactly.
//
//   MarkPreview  which tiles wear these marks — a hovered pheromone, the
//                bouquet in hand, a drag — the carriers lit, the rest receding
//   TilePreview  the tile editor's edit in progress, on its own tile
//
// The renderer lends each one verb that writes its buffers in place (the host).

/** The colour a CSS hex string takes, or null if it isn't one. Colours arrive
 *  as CSS text (a pheromone from the registry, a preview border); null, never
 *  a guessed colour, so the caller keeps the last good one instead of
 *  flashing a wrong one. */
export const previewRgb = (hex: string | null | undefined): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? '').trim())
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : null
}

const trimmed = (marks: readonly unknown[] | undefined): string[] =>
  (Array.isArray(marks) ? marks : []).map(m => String(m ?? '').trim()).filter(Boolean)
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i])

// ── the marks ────────────────────────────────────────────────────────────────

type MarkShader = { setMarkPreview(k: number): void; setMarkColor(r: number, g: number, b: number): void }

export interface MarkPreviewHost {
  /** The labels on this page. */
  pageLabels(): Iterable<string>
  tagsFor(label: string): string[]
  /** Write every cell's divergence flag (given its baked value) and push it.
   *  False when there is no buffer to write. */
  writeDivergence(valueFor: (label: string, baked: number) => number): boolean
  /** The current geometry — a rebuild replaces it, and with it the flags. */
  geom(): unknown
  shader(): MarkShader | null
  /** Advance the breath clock (u_time) unless launcher drift owns it. */
  breathe(): void
}

/** The carriers are painted straight into the divergence buffer as the value
 *  3 and nothing else ever writes or persists that value — no cell record
 *  holds it, so clearing the preview is a restore from the records, not a
 *  recomputation. The flag value is deliberately outside the divergence
 *  vocabulary (0/1/2), so a rebuild bakes the tile's REAL divergence and the
 *  treatment simply repaints itself over the fresh buffer. */
export class MarkPreview {
  /** The marks under the cursor somewhere in the chrome (`tags:preview`). */
  #hovered: string[] = []
  #color: [number, number, number] = [0.55, 0.85, 1.0]
  /** THE BOUQUET IN HAND (`tags:apply-pending`) — the STANDING sibling of the
   *  hover, riding the same flag and ramp. Opposite matching rule,
   *  deliberately: a hover asks "who carries ANY of these?" and lights them;
   *  the armed bouquet asks "who already wears ALL of it?" — those stay lit
   *  as settled ground, and every tile still missing part of the set recedes,
   *  which is exactly the set a click will scent. A live hover outranks it
   *  while it lasts; ending the hover falls back to this. */
  #armed: string[] = []
  #armedColor: [number, number, number] | null = null
  /** A pheromone (or a whole bouquet) being DRAGGED out of the panel
   *  (`drop:dragging`). Same treatment and ALL-match rule as the armed
   *  bouquet, for the length of the drag. Outranks both. */
  #dragged: string[] = []
  #dragColor: [number, number, number] | null = null
  #labels = new Set<string>()
  /** 0..1 ramp — the whole treatment fades in and out (see u_markPreview). */
  #k = 0
  #target = 0
  #raf = 0
  /** The geometry the flags were painted into. A rebuild makes a NEW buffer
   *  with the baked values, so the preview repaints itself when this stops
   *  matching — one reference compare per frame, no hook into the render. */
  #paintedGeom: unknown = null

  constructor(private readonly host: MarkPreviewHost) {}

  /** A mark (or none) is under the cursor. */
  hover(marks: readonly unknown[] | undefined, color?: string): void {
    const next = trimmed(marks)
    const rgb = color ? previewRgb(color) : null
    if (rgb) this.#color = rgb
    if (same(next, this.#hovered)) return
    this.#hovered = next
    this.refresh()
  }

  /** The bouquet in hand changed (or was put down: `active` false). */
  arm(active: boolean | undefined, tags: readonly unknown[] | undefined, color?: string): void {
    const armed = active === false ? [] : trimmed(tags)
    if (color) this.#armedColor = previewRgb(color)
    if (same(armed, this.#armed)) return
    this.#armed = armed
    this.refresh()
  }

  /** Marks are riding the cursor (or the drag ended). */
  drag(active: boolean | undefined, marks: readonly unknown[] | undefined, color?: string): void {
    const held = active === true ? trimmed(marks) : []
    if (held.length === 0 && this.#dragged.length === 0) return
    if (color) this.#dragColor = previewRgb(color)
    this.#dragged = held
    this.refresh()
  }

  /** Something is asking the question now — the answer may have changed. */
  get asking(): boolean { return this.#armed.length > 0 || this.#hovered.length > 0 }

  /** Resolve the marks against this page and paint the answer. The live drag
   *  outranks the hover, the hover outranks the armed set. Drag and armed
   *  share the ALL-match rule (what would the landing change?); the hover
   *  keeps ANY-match (who carries this?). While armed, the treatment stays ON
   *  even with zero matches — a fully receded page IS the honest answer. */
  refresh(): void {
    const dragged = this.#dragged
    const all = dragged.length > 0 ? dragged : (this.#hovered.length > 0 ? null : this.#armed)
    const next = new Set<string>()
    if (all === null) {
      const marks = new Set(this.#hovered)
      for (const label of this.host.pageLabels()) {
        for (const t of this.host.tagsFor(label)) if (marks.has(t)) { next.add(label); break }
      }
    } else if (all.length > 0) {
      for (const label of this.host.pageLabels()) {
        const worn = this.host.tagsFor(label)
        if (all.every(t => worn.includes(t))) next.add(label)
      }
      const tint = dragged.length > 0 ? this.#dragColor : this.#armedColor
      if (tint) this.#color = tint
    }
    this.#labels = next
    const active = all === null ? next.size > 0 : all.length > 0
    if (active) this.#paint()
    this.#set(active)
  }

  /** The renderer is going away: stop the ramp. */
  dispose(): void {
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0 }
  }

  /** Non-carriers are restored to their BAKED divergence, which makes moving
   *  from one mark to the next a single push rather than clear-then-paint. */
  #paint(): void {
    if (this.host.writeDivergence((label, baked) => this.#labels.has(label) ? 3 : baked)) this.#paintedGeom = this.host.geom()
  }

  /** Put every cell back to its baked divergence — at the END of the fade out,
   *  not when the cursor leaves: restoring early would snap the lit tiles dark
   *  while the rest of the page was still fading back. */
  #restore(): void {
    this.#paintedGeom = null
    this.host.writeDivergence((_label, baked) => baked)
  }

  /** Ramp in or out. The rAF runs for as long as the treatment is showing: the
   *  strength ramp, the breath clock, and re-pushing the uniforms after a
   *  shader swap — which is why it asks for the shader every frame. */
  #set(active: boolean): void {
    this.#target = active ? 1 : 0
    if (!this.#raf) this.#raf = requestAnimationFrame(this.#tick)
  }

  #tick = (): void => {
    const target = this.#target
    const step = 0.11                                   // ≈ 150ms edge to edge
    const k = target > this.#k ? Math.min(target, this.#k + step) : Math.max(target, this.#k - step)
    this.#k = k
    const shader = this.host.shader()
    shader?.setMarkPreview(k)
    if (k > 0) {
      shader?.setMarkColor(this.#color[0], this.#color[1], this.#color[2])
      this.host.breathe()
      // A repaint or a navigation replaced the buffer under us — paint again.
      if (this.host.geom() !== this.#paintedGeom) this.refresh()
    }
    if (k === 0 && target === 0) {
      this.#raf = 0
      this.#restore()
      return
    }
    this.#raf = requestAnimationFrame(this.#tick)
  }
}

// ── the tile editor's edit ───────────────────────────────────────────────────

/** `tile:preview` — the tile editor's edit in progress (editor/tile-editor.view.ts).
 *  `page` is the page the tile sits on, segments joined with '/'. Pictures are
 *  the exact small pictures a save would write, under their real signatures;
 *  absent means "the stored picture", `removed` means "no picture". */
export type TilePreviewPicture = { sig: string; blob: Blob }
export type TilePreviewPayload =
  | { label: string; clear: true }
  | { label: string; clear?: false; page: string; point?: TilePreviewPicture | null; flat?: TilePreviewPicture | null; removed?: boolean; border?: string | null; hideText?: boolean }
type Preview = Extract<TilePreviewPayload, { page: string }>

/** The rim a tile wears when it names no colour — as the in-place update paints it. */
export const PREVIEW_DEFAULT_BORDER: [number, number, number] = [0.784, 0.592, 0.353]

type UV = { u0: number; v0: number; u1: number; v1: number }

export interface TilePreviewHost {
  /** The page in view, segments joined with '/'. */
  page(): string
  imageAtlas(): {
    loadImage(sig: string, blob: Blob): Promise<unknown>
    getImageUV(sig: string): UV | null
    setPinned(sigs: string[]): void
  } | null
  /** Pictures the page shows, pinned alongside the preview's. */
  pageImageSigs(): string[]
  flat(): boolean
  /** What the tile shows from its caches. */
  stored(label: string): { image: string | null; border?: [number, number, number]; hideText: boolean }
  /** The tile is in the current geometry. */
  hasTile(label: string): boolean
  /** Would a name be hidden behind this picture (the renderer's rule)? */
  hidesName(hideText: boolean | undefined, hasImage: boolean): boolean
  /** Write a tile's picture, border and name band in place. False when it cannot. */
  paintFace(label: string, uv: UV | null, border: [number, number, number], hideText: boolean | undefined): boolean
  requestRender(): void
}

/** Pictures are decoded ahead (the editor derives them with deterministic
 *  output), loaded under their real signatures — so when the save lands, its
 *  new picture is already on the GPU and nothing flashes. */
export class TilePreview {
  #preview: Preview | null = null
  #token = 0
  /** The tile the newest payload named ('' after a clear). */
  #latest = ''
  /** The tile a save just landed on — its preview's end must not repaint the
   *  old caches, because the save's own render is about to paint the truth.
   *  Held until that tile is previewed again. */
  #savedLabel = ''

  constructor(private readonly host: TilePreviewHost) {}

  /** Is this tile's name hidden by the edit in progress? Undefined when the
   *  tile is not being previewed — then what is stored decides. */
  hiddenBy(label: string): boolean | undefined {
    const preview = this.#preview
    if (preview?.label !== label) return undefined
    if (!preview.hideText || preview.removed) return false
    const picture = this.host.flat() ? preview.flat : preview.point
    const sig = picture?.sig ?? this.host.stored(label).image
    return this.host.hidesName(true, !!(sig && this.host.imageAtlas()?.getImageUV(sig)))
  }

  /** A save landed on this tile. */
  saved(label: string): void { this.#savedLabel = label }

  /** The pictures the preview shows, kept pinned. */
  sigs(): string[] {
    const p = this.#preview
    if (!p || p.removed) return []
    return [p.point?.sig, p.flat?.sig].filter((sig): sig is string => !!sig)
  }

  apply = async (payload: TilePreviewPayload | null | undefined): Promise<void> => {
    if (!payload?.label) return
    const token = ++this.#token
    this.#latest = payload.clear ? '' : payload.label

    if (payload.clear) {
      const ended = this.#preview
      this.#preview = null
      if (!ended) return
      // A save announces tile:saved in the same turn it ends the preview — or,
      // when the docked editor saves and moves to another tile, just before.
      // Wait the turn out: repaint from the caches only if no save came, and
      // only if the same tile has not been taken up again meanwhile. A preview
      // of a DIFFERENT tile arriving in between (the editor moving on) does not
      // stop this one's tile being put back.
      setTimeout(() => {
        if (this.#latest === ended.label) return
        if (this.#savedLabel === ended.label) return
        this.#restore(ended.label)
      }, 0)
      return
    }

    // Previewed again: an earlier save of this tile no longer describes it.
    if (payload.label === this.#savedLabel) this.#savedLabel = ''

    if (payload.page !== this.host.page()) return
    const atlas = this.host.imageAtlas()
    // Decode both orientations before anything is swapped, so the tile never
    // paints an empty slot mid-edit and an orientation flip finds its picture.
    if (atlas && !payload.removed) {
      const pictures = [payload.point, payload.flat].filter((p): p is TilePreviewPicture => !!p)
      await Promise.all(pictures.map(p => atlas.loadImage(p.sig, p.blob).catch(() => null)))
    }
    if (token !== this.#token) return
    this.#preview = payload
    atlas?.setPinned([...this.host.pageImageSigs(), ...this.sigs()])
    this.repaint()
  }

  /** Paint the preview onto its tile (again, after a rebuild). False when
   *  there is nothing to paint or the tile is not in the current geometry. */
  repaint(): boolean {
    const preview = this.#preview
    if (!preview || !this.host.hasTile(preview.label)) return false
    const atlas = this.host.imageAtlas()
    if (!atlas) return false

    const picture = this.host.flat() ? preview.flat : preview.point
    const stored = this.host.stored(preview.label).image
    let uv = preview.removed
      ? null
      : picture
        ? atlas.getImageUV(picture.sig)
        : (stored ? atlas.getImageUV(stored) : null)
    if (!preview.removed && picture && !uv) {
      // Evicted or not decoded yet: keep what the tile shows and paint again
      // the moment it lands.
      uv = stored ? atlas.getImageUV(stored) : null
      void atlas.loadImage(picture.sig, picture.blob)
        .then(() => { if (this.#preview === preview) this.repaint() })
        .catch(() => { /* the stored picture stays */ })
    }
    return this.host.paintFace(preview.label, uv, previewRgb(preview.border) ?? PREVIEW_DEFAULT_BORDER, preview.hideText)
  }

  /** A preview ended with no save: paint the tile from the caches again. */
  #restore(label: string): void {
    const atlas = this.host.imageAtlas()
    const stored = this.host.stored(label)
    const uv = stored.image && atlas ? atlas.getImageUV(stored.image) : null
    if (!atlas || !this.host.hasTile(label) || (stored.image && !uv)) { this.host.requestRender(); return }
    // The editor may already be previewing the next tile — keep its pictures.
    atlas.setPinned([...this.host.pageImageSigs(), ...this.sigs()])
    if (!this.host.paintFace(label, uv, stored.border ?? PREVIEW_DEFAULT_BORDER, stored.hideText)) this.host.requestRender()
  }
}
