// presentation/tiles/badge-layer.ts
//
// The corner-badge placement primitive — the geometry every per-tile
// notification ornament needs and none of the painting any of them does.
//
// A badge is a small mark pinned to a corner of a hex: it must track that
// hex through pan, zoom, orientation flips and mesh re-offsets, and it must
// never intercept a pointer. That plumbing is identical for every badge and
// was written twice before this module existed (presence count, holder
// count), so it lives here once and each drone keeps only its own drawing.
//
// The layer is a child of the zoom/pan render root (HostReadyPayload.container),
// so tracking is free: a badge placed at axialToPixel(coord) + meshOffset
// moves with its tile without a per-frame update.

import type { Container as PixiContainer } from 'pixi.js'
import { Container } from 'pixi.js'

import type { Axial } from './wave-layout.js'
export type { Axial }

/** Which corner of the hex a badge sits on, as a fraction of the
 *  circumradius. Kept as named corners so two badges on one tile can be
 *  told apart at a glance instead of by two anonymous number pairs. */
export const BADGE_CORNER = {
  /** Right shoulder — the pill extends rightward from the anchor. */
  topRight: { x: 0.42, y: -0.78 },
  /** Left shoulder — the pill extends leftward from the anchor. */
  topLeft: { x: -0.42, y: -0.78 },
} as const

export class TileBadgeLayer {
  #container: PixiContainer | null = null
  #layer: Container | null = null
  #zIndex: number

  // Geometry mirrors the tile overlay: spacing drives axialToPixel,
  // circumRadius sizes the corner offset, flat selects the axial formula.
  #spacing = 38
  #circum = 32
  #flat = false
  #meshOffset = { x: 0, y: 0 }

  constructor(zIndex: number) { this.#zIndex = zIndex }

  /** Attach to the render root. Idempotent — `render:host-ready` is sticky
   *  and can replay, and a second attach must not mint a second layer. */
  attach(container: PixiContainer): Container {
    if (this.#layer && this.#container === container) return this.#layer
    if (this.#layer) this.#layer.destroy({ children: true })
    this.#container = container
    const layer = new Container()
    layer.zIndex = this.#zIndex
    layer.eventMode = 'none'          // notification only — never takes a click
    container.addChild(layer)
    container.sortableChildren = true
    this.#layer = layer
    return layer
  }

  get layer(): Container | null { return this.#layer }
  get circumRadius(): number { return this.#circum }

  setGeometry(geo: { spacing?: number; circumRadiusPx?: number } | undefined): void {
    if (typeof geo?.spacing === 'number' && geo.spacing > 0) this.#spacing = geo.spacing
    if (typeof geo?.circumRadiusPx === 'number' && geo.circumRadiusPx > 0) this.#circum = geo.circumRadiusPx
  }

  setOrientation(flat: boolean): void { this.#flat = flat }

  setMeshOffset(offset: { x?: number; y?: number } | undefined): void {
    this.#meshOffset = { x: offset?.x ?? 0, y: offset?.y ?? 0 }
  }

  /** Pin `box` to a corner of the hex at `coord`. */
  place(box: PixiContainer, coord: Axial, corner: { x: number; y: number }): void {
    const px = this.#axialToPixel(coord.q, coord.r)
    box.position.set(
      px.x + this.#meshOffset.x + this.#circum * corner.x,
      px.y + this.#meshOffset.y + this.#circum * corner.y,
    )
  }

  destroy(): void {
    if (this.#layer) { this.#layer.destroy({ children: true }); this.#layer = null }
    this.#container = null
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}
