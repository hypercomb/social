// tile-label-view.ts
//
// A PAGE WITH MORE NAMES THAN LABEL SLOTS (SCALE-1). The renderer pinned
// EVERY cell of the layer in the label atlas before baking. Past the atlas's
// capacity every slot was pinned, so zooming in could never give the cells in
// view their text — and a 307-name page spent 72 s of 74 s re-baking labels it
// evicted from itself. An oversized layer now pins only what is in view (plus
// a one-ring margin), bakes only that, never claims a slot for an out-of-view
// cell, and a settled gesture repaints when it brings unslotted cells into
// view. A layer that fits is untouched: its view is null, and every cell pins
// and bakes as before.

import { axialToPixel } from './tile-fill-geometry.js'

type Point = { x: number; y: number }

/** What a cell needs for this: its name and its place. */
export type ViewCell = { readonly label: string; readonly q: number; readonly r: number }

/** What the renderer answers. */
export interface LabelViewHost {
  atlas(): { readonly capacity: number; hasLabel(label: string): boolean } | null
  /** The page mesh's local-to-screen transform; null before there is a mesh. */
  toGlobal(): ((p: Point) => Point) | null
  screen(): { readonly width: number; readonly height: number } | null
  /** A recenter, fit or offset restore is still to run in this paint. */
  viewportPending(): boolean
  /** The distance between neighbouring centres, before the mesh's scale. */
  spacing(): number
  flat(): boolean
  /** The cells on the page now. */
  cells(): Iterable<ViewCell>
  /** Paint again, past the unchanged-page fast path. */
  repaint(): void
}

export class LabelView {
  /** The labels the last paint pinned when the layer held more names than
   *  the atlas has slots; null — the normal case — when it fits. */
  #view: ReadonlySet<string> | null = null
  /** A settled gesture brought cells without a slot into view: the next paint
   *  must rebuild even though the cells did not change. */
  stale = false
  /** True while a paint bakes and builds. An eviction its own bake causes
   *  needs no repaint — this pass is the repaint, and it reads every cell's
   *  slot after the bake. Without this, a zoom into an oversized layer counted
   *  the same pass's not-yet-baked cells as owed, spent the repaint bound and
   *  warned per eviction. */
  baking = false

  constructor(private readonly host: LabelViewHost) {}

  /** The pin set for one paint, remembered as the view: null while the layer
   *  fits the atlas, otherwise the cells in view (inView). */
  forPaint(cells: readonly ViewCell[]): Set<string> | null {
    const atlas = this.host.atlas()
    const view = !atlas || cells.length + 1 <= atlas.capacity ? null : this.inView(cells)
    this.#view = view
    return view
  }

  /** The last paint pinned this label — every label, on a layer that fits.
   *  Only those can be owed their glyphs. */
  pinned(label: string): boolean {
    return !this.#view || this.#view.has(label)
  }

  /** An out-of-view cell holding no slot draws without baked text: baking it
   *  would take a slot from another out-of-view cell, every pass. */
  unbaked(label: string, atlasLabel: string): boolean {
    return !!this.#view && !this.#view.has(label) && !this.host.atlas()?.hasLabel(atlasLabel)
  }

  /** Labels of the cells whose centres sit inside the screen grown by one hex
   *  ring. Null while the viewport cannot be trusted — no mesh yet, or a
   *  recenter, fit or offset restore still to run in this paint (the fit about
   *  to run shows every cell anyway); the caller then pins every cell. */
  inView(cells: Iterable<ViewCell>): Set<string> | null {
    const toGlobal = this.host.toGlobal()
    const screen = this.host.screen()
    if (!toGlobal || !screen || !(screen.width > 0) || !(screen.height > 0)) return null
    if (this.host.viewportPending()) return null
    const o = toGlobal({ x: 0, y: 0 })
    const ex = toGlobal({ x: 1, y: 0 })
    const ey = toGlobal({ x: 0, y: 1 })
    const ax = ex.x - o.x, ay = ex.y - o.y, bx = ey.x - o.x, by = ey.y - o.y
    const scale = Math.hypot(ax, ay)
    if (!Number.isFinite(scale) || scale <= 0) return null
    const spacing = this.host.spacing()
    const flat = this.host.flat()
    // One ring: a neighbour's centre is √3·spacing from a cell's, and a cell
    // straddling the edge reaches ~1.2·spacing past its own centre.
    const margin = (Math.sqrt(3) + 1.2) * spacing * scale
    const right = screen.width + margin
    const bottom = screen.height + margin
    const view = new Set<string>()
    for (const c of cells) {
      const p = axialToPixel(c.q, c.r, spacing, flat)
      const x = o.x + ax * p.x + bx * p.y
      const y = o.y + ay * p.x + by * p.y
      if (x >= -margin && y >= -margin && x <= right && y <= bottom) view.add(c.label)
    }
    return view
  }

  /** A gesture settled (the viewport persisted). On an oversized layer the
   *  slots belong to the cells that were in view at the last paint; when the
   *  view now holds cells with no slot, repaint so they pin and bake. A view
   *  identical to the pinned one would repaint to the same result (a fitted
   *  page with more names than slots), so it does not. A layer that fits
   *  returns on the first line. */
  refresh(): void {
    const atlas = this.host.atlas()
    const pinned = this.#view
    if (!atlas || !pinned) return
    const view = this.inView(this.host.cells())
    if (!view) return
    let unslotted = false
    for (const label of view) if (!atlas.hasLabel(label)) { unslotted = true; break }
    if (!unslotted) return
    let same = view.size === pinned.size
    if (same) for (const label of view) if (!pinned.has(label)) { same = false; break }
    if (same) return
    this.stale = true
    this.host.repaint()
  }
}
