// tile-dive.ts — ANOTHER LAYER'S TILES, PAINTED IN PLACE OF THIS ONE. A
// branch of the tile renderer (documentation/tile-renderer-tree.md). The
// wave view resolves a generation and asks for it with `render:dive`; the
// dive paints it through the SAME shader, atlases and geometry packer the
// page uses, so a dive IS the tiles underneath rather than a picture of
// them. The page's mesh is hidden (never torn down), the atlases pin the
// union of page and dive, and the renderer defers synchronize-driven passes
// while a dive is up — ending it restores the mesh, the pins and the hover.

import { Mesh, Texture, type Container, type Geometry } from 'pixi.js'
import type { FillCell } from './tile-fill-geometry.js'

/** One tile of a dive, as the wave view hands it over. */
export type DiveCell = {
  q: number
  r: number
  label: string
  imageSig?: string
  hasBranch: boolean
  hideText: boolean
  borderColor?: [number, number, number]
  /** A reference tile — hovers with the portal shimmer, as on its own page. */
  portal: boolean
}

type PinnedLabelAtlas = { setPinned(labels: string[]): void; getLabelUV(label: string): unknown }
type PinnedImageAtlas = {
  setPinned(sigs: string[]): void
  hasImage(sig: string): boolean
  hasFailed(sig: string): boolean
  loadImage(sig: string, blob: Blob): Promise<unknown>
}

export interface DiveHost {
  layer(): Container | null
  /** The page's own mesh: hidden under a dive, restored after. */
  pageMesh(): { visible: boolean; position: { x: number; y: number } } | null
  shader(): { shader: unknown; setHoveredIndex(index: number): void } | null
  labelAtlas(): PinnedLabelAtlas | null
  imageAtlas(): PinnedImageAtlas | null
  decode(sig: string): Promise<Blob | null>
  /** What the page shows, so neither page nor dive loses its pixels. */
  pageLabels(): string[]
  pageImageSigs(): string[]
  pageCount(): number
  /** The page's hovered tile index, restored when the dive ends (-1: none). */
  pageHoverIndex(): number
  /** The label the atlas keeps for a tile still being added. */
  readonly pendingLabel: string
  /** Pack cells through the page's own fill geometry, in foreign mode. */
  build(cells: FillCell[], foreign: { portals: ReadonlySet<string>; reveal: string | null }): Geometry
  hidesName(hideText: boolean | undefined, hasImage: boolean): boolean
  emit(effect: string, payload: unknown): void
  requestRender(): void
}

export class TileDive {
  #active = false
  #hidPage = false
  #mesh: any | null = null
  #geom: Geometry | null = null
  #cells: FillCell[] = []
  #portals: ReadonlySet<string> = new Set<string>()
  readonly #labelToIndex = new Map<string, number>()
  #hoverLabel: string | null = null
  #token = 0

  constructor(private readonly host: DiveHost) {}

  /** A dive owns the surface: the renderer defers synchronize-driven passes. */
  get active(): boolean { return this.#active }

  /** Paint a dive (or, with nothing to paint, give the page back). The
   *  generation lands WHOLE: every label baked and every picture decoded
   *  before the page's mesh is hidden, so a dive never trickles in over the
   *  tiles it replaces. Same slots, same offset, same shader — a dive is
   *  indistinguishable from the page it previews. */
  async paint(input: readonly DiveCell[] | null): Promise<void> {
    const token = ++this.#token
    if (!input || input.length === 0) { this.clear(); return }
    const atlas = this.host.labelAtlas(), imageAtlas = this.host.imageAtlas()
    if (!this.host.layer() || !this.host.pageMesh() || !this.host.shader() || !atlas || !imageAtlas) { this.clear(); return }

    const cells: FillCell[] = input.map(d => ({
      q: d.q, r: d.r, label: d.label, external: false, imageSig: d.imageSig,
      hasBranch: d.hasBranch, hideText: d.hideText, borderColor: d.borderColor, heat: 0,
    }))
    const portals = new Set(input.filter(d => d.portal).map(d => d.label))

    // Pin the UNION of what is on screen and what is about to be: neither the
    // page underneath nor the dive may lose its glyphs or pixels to the other.
    const pageSigs = this.host.pageImageSigs()
    atlas.setPinned([...this.host.pageLabels(), ...cells.map(c => c.label), this.host.pendingLabel])
    imageAtlas.setPinned([...pageSigs, ...cells.flatMap(c => (c.imageSig ? [c.imageSig] : []))])
    for (const c of cells) atlas.getLabelUV(c.label)

    await Promise.all(cells.map(async (c) => {
      const sig = c.imageSig
      if (!sig || imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return
      try {
        const blob = await this.host.decode(sig)
        if (blob) await imageAtlas.loadImage(sig, blob)
      } catch { /* label-only, exactly as the page would paint it */ }
    }))
    if (token !== this.#token) return
    if (!this.host.layer() || !this.host.pageMesh() || !this.host.shader()) { this.clear(); return }

    this.#cells = cells
    this.#portals = portals
    this.#rebuild()
    if (!this.#hidPage) { this.#hidPage = true; this.host.pageMesh()!.visible = false }
    this.#active = true
    this.#applyHover()
    this.host.emit('render:dive-painted', { count: cells.length })
  }

  /** (Re)pack the dive's geometry through the page's own packer, in FOREIGN
   *  mode — nothing location-scoped is read and nothing of the page's buffer
   *  bookkeeping is overwritten — and put it on a mesh that shares the page's
   *  shader, at the page's own mesh offset. */
  #rebuild(): void {
    const layer = this.host.layer(), pageMesh = this.host.pageMesh(), shader = this.host.shader()
    if (!layer || !pageMesh || !shader) return
    const geom = this.host.build(this.#cells, { portals: this.#portals, reveal: this.#hoverLabel })
    this.#labelToIndex.clear()
    this.#cells.forEach((c, i) => this.#labelToIndex.set(c.label, i))
    if (!this.#mesh) {
      this.#mesh = new Mesh({ geometry: geom as any, shader: (shader as any).shader, texture: Texture.WHITE as any } as any)
      ;(this.#mesh as any).blendMode = 'pre-multiply'
      layer.addChild(this.#mesh as any)
    } else {
      this.#mesh.geometry = geom
      this.#mesh.shader = (shader as any).shader
    }
    if (this.#geom) { try { this.#geom.destroy(true) } catch { /* gone */ } }
    this.#geom = geom
    this.#mesh.position.set(pageMesh.position.x, pageMesh.position.y)
    this.#mesh.visible = true
  }

  /** The dived tile under the pointer. A picture-only tile reveals its name
   *  while hovered, as on its own page — that is a label-UV change, so the
   *  geometry is repacked (pure CPU, no I/O) only when the hover leaves or
   *  lands on such a tile. */
  hover(label: string | null): void {
    if (label === this.#hoverLabel) return
    const hides = (l: string | null): boolean => {
      const c = l ? this.#cells.find(x => x.label === l) : undefined
      return !!c && this.host.hidesName(c.hideText, !!(c.imageSig && this.host.imageAtlas()?.hasImage(c.imageSig)))
    }
    const repack = this.#active && (hides(this.#hoverLabel) || hides(label))
    this.#hoverLabel = label
    if (repack) this.#rebuild()
    if (this.#active) this.#applyHover()
  }

  #applyHover(): void {
    const i = this.#hoverLabel ? this.#labelToIndex.get(this.#hoverLabel) : undefined
    this.host.shader()?.setHoveredIndex(i ?? -1)
  }

  /** Give the page back exactly as it was: its mesh, its pins, its hover —
   *  and the render pass a synchronize may have queued while the dive owned
   *  the surface. Safe to call twice. */
  clear(): void {
    this.#token++
    const wasActive = this.#active
    this.#active = false
    if (this.#mesh) {
      try { this.host.layer()?.removeChild(this.#mesh) } catch { /* gone */ }
      try { this.#mesh.destroy?.() } catch { /* gone */ }
      this.#mesh = null
    }
    if (this.#geom) {
      try { this.#geom.destroy(true) } catch { /* gone */ }
      this.#geom = null
    }
    this.#cells = []
    this.#portals = new Set<string>()
    this.#labelToIndex.clear()
    this.#hoverLabel = null
    if (this.#hidPage) {
      this.#hidPage = false
      const pageMesh = this.host.pageMesh()
      if (pageMesh && this.host.pageCount() > 0) pageMesh.visible = true
    }
    // Announced even when nothing was up: a dive that could not be painted
    // (no mesh yet, no shader) reads as "the page is showing" to the wave
    // view, which then lets go of the pointer instead of holding a dive that
    // never landed.
    this.host.emit('render:dive-painted', { count: 0 })
    if (!wasActive) return
    this.host.labelAtlas()?.setPinned([...this.host.pageLabels(), this.host.pendingLabel])
    this.host.imageAtlas()?.setPinned(this.host.pageImageSigs())
    this.host.shader()?.setHoveredIndex(this.host.pageHoverIndex())
    this.host.requestRender()
  }
}
