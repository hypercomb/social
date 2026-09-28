// tile-hover.ts — THE TILE UNDER THE POINTER. A branch of the tile renderer
// (documentation/tile-renderer-tree.md): one hovered tile, and everything
// that describes it at once — its hidden name revealed, its label band as
// tall as its menu, its cell lit, its shade lifted. ONE path (apply), so the
// band and the icons can never end up describing different tiles, whichever
// message carried the news. A shaded tile is NOT out of reach: hovering lifts
// the shade and lights its ring like any other, because "this isn't loaded
// yet" must never become "you may not go here".
//
// Every write is to one or two cells, never a render pass; the renderer
// lends the writes (the host).

export interface HoverHost {
  shader(): { setHoveredIndex(index: number): void; setBandRows(rows: number): void } | null
  indexOf(label: string): number | undefined
  hasTile(label: string): boolean
  /** The tile hides its name behind its picture, as stored (the reveal aside). */
  hidesBehindPicture(label: string): boolean
  /** Rewrite these tiles' name bands to what they should show now, and push. */
  repaintNames(labels: string[]): void
  /** Rewrite one tile's shade (null: nothing). */
  paintShade(label: string | null): void
}

export class TileHover {
  /** The hideText tile currently under the pointer, if any. A tile that
   *  hides its name gets it back for as long as it is hovered — nothing else
   *  about the tile changes, and no other tile is touched. The reveal is
   *  purely a label-UV flip, so the text returns in its normal place with
   *  its normal backing band. */
  #reveal: string | null = null
  /** The tile under the pointer, shown opaque while hovered (never proof). */
  #opaque: string | null = null
  /** Rows the hovered tile's label band must hold (overlay:band-rows). Held
   *  here, not just pushed at the shader, because a render pass can REBUILD
   *  the shader — and the overlay only re-lays-out when the hovered hex
   *  changes, so it would not re-send. Without this the band silently
   *  reverted to one row under two rows of icons. Restored with the other
   *  uniforms on every pass (applyBandRows). */
  #bandRows = 1
  /** The tile the row count was computed FOR. A row count is only ever true
   *  of one tile, so it is stored with its owner and pushed only while that
   *  tile is the hover. Navigating in used to carry the LEAVING tile's count
   *  into the arriving level — a band drawn for one icon row under a tile
   *  whose icons wrapped to two. */
  #bandRowsLabel: string | null = null

  constructor(private readonly host: HoverHost) {}

  /** The tile whose name is revealed (the hover), if any. */
  get reveal(): string | null { return this.#reveal }
  /** The tile shown opaque, if any. */
  get opaque(): string | null { return this.#opaque }

  /** How many rows `label`'s menu needs (null: no owner). */
  bandRows(label: string | null, rows: number): void {
    this.#bandRowsLabel = label
    this.#bandRows = Math.max(1, rows)
  }

  /** Put the hover on `label` (null = nothing hovered). */
  apply(label: string | null): void {
    this.#setReveal(label)
    this.applyBandRows()
    const shader = this.host.shader()
    if (!shader) return
    shader.setHoveredIndex(label !== null ? this.host.indexOf(label) ?? -1 : -1)
    this.#setOpaque(label)
  }

  /** Push the band height at the shader. The ONE place that decides it: the
   *  stored count applies only to the tile it was computed for, and any other
   *  tile — including one that merely shares a name with a tile on the level
   *  just left — gets the resting single row. */
  applyBandRows(): void {
    const owned = this.#reveal !== null && this.#bandRowsLabel === this.#reveal
    this.host.shader()?.setBandRows(owned ? this.#bandRows : 1)
  }

  /** The mesh is gone: the pointer is on no tile of it. Left set, a
   *  same-named tile on the NEXT layer would bake in revealed — and inherit
   *  its band height — so the row count's owner goes on the same breath. */
  forget(): void {
    this.#reveal = null
    this.#bandRowsLabel = null
  }

  /** Point the reveal at `next` and repaint just the tiles whose hidden-ness
   *  actually flipped — at most two cells. Each is judged as the reveal
   *  actually leaves it: `prev` re-hides, `next` reveals. */
  #setReveal(next: string | null): void {
    const prev = this.#reveal
    if (prev === next) return
    const prevFlips = !!prev && this.host.hidesBehindPicture(prev)
    const nextFlips = !!next && this.host.hidesBehindPicture(next)
    this.#reveal = next
    const flipped = [prevFlips ? prev : null, nextFlips ? next : null].filter((l): l is string => !!l)
    if (flipped.length) this.host.repaintNames(flipped)
  }

  /** The tile under the pointer shows at full opacity while hovered, and only
   *  while hovered: the one entered and the one left, never a pass (and never
   *  a render:cell-count, which doubles as the navigation guard's release). */
  #setOpaque(label: string | null): void {
    const next = label && this.host.hasTile(label) ? label : null
    if (next === this.#opaque) return
    const previous = this.#opaque
    this.#opaque = next
    this.host.paintShade(previous)   // back to its honest state
    this.host.paintShade(next)       // lifted under the pointer
  }
}
