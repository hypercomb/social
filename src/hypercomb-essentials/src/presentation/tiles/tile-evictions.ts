// tile-evictions.ts
//
// AN ATLAS SLOT REUSED UNDER A TILE ON SCREEN. Each atlas hands a slot to new
// content when it is full; if the displaced picture or name belongs to a
// cell on screen, that cell's baked UV now samples someone else's pixels or
// glyphs (the superimposed-labels bug class). The renderer repaints so the
// cell reloads or falls back — bounded, because a layer with more pictures or
// names than slots evicts itself on every pass, and that must not spin the
// render loop.

/** A cell on screen, as far as its slots go. */
export type EvictedCell = { readonly label: string; readonly imageSig?: string; readonly hideText?: boolean }

/** What the renderer answers. */
export interface EvictionHost {
  imageAtlas(): { hasImage(sig: string): boolean; hasFailed(sig: string): boolean } | null
  labelAtlas(): { hasLabel(label: string): boolean } | null
  /** The cells on screen. */
  cells(): Iterable<EvictedCell>
  /** The cell draws no name (hidden behind its picture): its label UV is
   *  zeroed on purpose, so a displaced label cannot show. */
  hidesName(cell: EvictedCell): boolean
  /** PROMISE REPAIR (tile-readiness.ts). A branch that brightened promised
   *  "the inside is decoded, the click is instant"; an eviction can quietly
   *  break that. The victim is handed over so a proven click target is
   *  withdrawn and re-queued for an idle re-bake. */
  imageEvicted(sig: string | undefined): void
  labelEvicted(label: string | undefined): void
  /** The last paint pinned this label (tile-label-view.ts): an oversized
   *  layer's out-of-view cells hold no slot by design, and are owed nothing. */
  pinned(label: string): boolean
  /** A paint is baking: an eviction its own bake causes needs no repaint —
   *  that pass is the repaint, and it reads every slot after the bake. */
  baking(): boolean
  /** Paint again, past the unchanged-page fast path. */
  repaint(): void
}

/** Bound on CONSECUTIVE eviction-forced repaints while on-screen content
 *  keeps going missing. A normal layer converges in one or two passes. */
export const EVICT_REPAINT_MAX = 8

export class EvictionRepaint {
  /** Shared by both atlases: a converged paint resets it (converged). */
  #count = 0

  constructor(private readonly host: EvictionHost) {}

  /** An image slot was reused (or a failed decode may now succeed). This
   *  must run even while a pass is mid-flight: the eviction may have
   *  displaced pixels the running pass already awaited, so its rebuilt
   *  geometry is stale the moment it bakes. */
  readonly onImage = (e?: Event): void => {
    const atlas = this.host.imageAtlas()
    if (!atlas) return
    this.host.imageEvicted((e as CustomEvent<{ sig?: string }> | undefined)?.detail?.sig)
    for (const c of this.host.cells()) {
      if (c.imageSig && !atlas.hasImage(c.imageSig) && !atlas.hasFailed(c.imageSig)) {
        this.#repaint('[show-cell] atlas eviction repaint bound reached — layer likely exceeds atlas capacity')
        return
      }
    }
    // Clean scan — every on-screen sig is resolvable again; reset the bound.
    this.#count = 0
  }

  /** A label slot was reused: a displaced on-screen name would show another
   *  name's glyphs. A proven branch's child name is re-seeded during idle
   *  too — rasterising it again is the single biggest click cost (~13ms). */
  readonly onLabel = (e?: Event): void => {
    const atlas = this.host.labelAtlas()
    if (!atlas) return
    this.host.labelEvicted((e as CustomEvent<{ label?: string }> | undefined)?.detail?.label)
    if (this.host.baking()) return
    for (const c of this.host.cells()) {
      if (!this.host.pinned(c.label) || this.host.hidesName(c)) continue
      if (!atlas.hasLabel(c.label)) {
        this.#repaint('[show-cell] label-atlas eviction repaint bound reached — more on-screen labels than atlas slots')
        return
      }
    }
  }

  /** A paint with every image AND every name resolvable: the convergence
   *  point of the cycle. Eviction events alone cannot be relied on for the
   *  reset — after the reload pass converges, no further event arrives. Both
   *  halves must hold: the bound is shared, so an image-only reset let a layer
   *  with more names than slots blink its text forever (a 522-child layer). */
  converged(): void { this.#count = 0 }

  #repaint(bound: string): void {
    if (this.#count >= EVICT_REPAINT_MAX) { console.warn(bound); return }
    this.#count++
    this.host.repaint()
  }
}
