// diamondcoreprocessor.com/presentation/tiles/drop-landing.drone.ts
//
// WHERE WILL THIS LAND? — the ring drawn under a drag that is carrying meaning
// onto the hive (a row dragged out of the portals index, a structure, a file).
//
// The drag already knows what it is carrying and the overlay already knows what
// is under the pointer. What neither said, until this drone, is the one thing
// the participant is actually asking while the pointer is in the air. Releasing
// used to be the first moment you found out — and the two outcomes are not
// variations of one act, they are different acts:
//
//   over an OCCUPIED tile → the drop attaches to THAT TILE. Amber ring on it.
//   over EMPTY hive       → the drop MINTS A TILE, and it lands in the next free
//                           slot. Teal ring THERE — not under the pointer.
//
// ── The ring is not always under the cursor, deliberately ────────────────────
//
// A new tile's position is its INDEX in the parent's children, resolved through
// the spiral (AxialService.items). There is no such thing as "this arbitrary
// empty hex": `#occupiedByAxial` only knows occupied hexes, and the layout gives
// the next child the next slot. Drawing the ring under the cursor would promise
// a placement the model cannot keep, so it is drawn where the tile will actually
// be. Pointing at empty space anywhere is a perfectly good way to say "not onto
// a tile" — the ring then answers "so here, then".
//
// ── Geometry is mirrored, not asked for ─────────────────────────────────────
//
// Same render-space transform tile-overlay.drone and move-preview.drone each
// carry: mesh spacing (~38) and orientation, NOT AxialService's 200-scale
// Location. Three copies is the established cost of keeping hex geometry the
// renderer's business rather than inventing a fourth service for it.

import { Drone } from '@hypercomb/core'
import { Graphics } from 'pixi.js'
import type { Container } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

/** The `drop:target` broadcast. `over` is absent on payloads written before the
 *  pointer path started reporting, and absent reads as "yes, over the hive" —
 *  which is what those payloads meant. */
type DropTarget = {
  q: number
  r: number
  occupied: boolean
  label: string | null
  index: number
  hasImage: boolean
  over?: boolean
}

// Landing on a TILE — the drop attaches to what is already there.
const ATTACH_FILL = 0xff8844
const ATTACH_FILL_ALPHA = 0.16
const ATTACH_STROKE = 0xffa866
const ATTACH_STROKE_ALPHA = 0.9

// Landing on the HIVE — the drop mints a tile in this slot.
const LAND_FILL = 0x2299aa
const LAND_FILL_ALPHA = 0.18
const LAND_STROKE = 0x33bbcc
const LAND_STROKE_ALPHA = 0.9

const STROKE_WIDTH = 2
/** Above the mesh, below the move drone's held cluster (7001/7002). */
const LANDING_Z = 6999

type AxialLike = { q: number; r: number }
type AxialServiceLike = { items?: Map<number, AxialLike> }

export class DropLandingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Rings the hex a drag will land on — the tile it attaches to, or the free slot a new tile will occupy.'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #meshOffset = { x: 0, y: 0 }
  #coords: AxialLike[] = []
  #cellCount = 0
  #spacing = 38
  #flat = false

  #dragging = false
  #target: DropTarget | null = null

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:cell-count',
    'render:geometry-changed', 'render:set-orientation',
    'drop:dragging', 'drop:target',
  ]
  protected override emits: string[] = []

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#initLayer()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
      this.#redraw()
    })

    this.onEffect<{ count: number; coords?: AxialLike[] }>('render:cell-count', (payload) => {
      this.#coords = payload.coords ?? []
      this.#cellCount = payload.count ?? 0
      this.#redraw()
    })

    this.onEffect<{ spacing?: number }>('render:geometry-changed', (geo) => {
      if (geo?.spacing) { this.#spacing = geo.spacing; this.#redraw() }
    })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => {
      this.#flat = !!p?.flat
      this.#redraw()
    })

    this.onEffect<{ active: boolean }>('drop:dragging', ({ active }) => {
      this.#dragging = !!active
      // The target that arrives with the NEXT move is the only one this drag
      // owns. Clearing on arm rather than trusting the previous drag's farewell
      // keeps a replayed last-value from painting a ring before the pointer has
      // moved anywhere.
      if (!this.#dragging) this.#target = null
      this.#redraw()
    })

    this.onEffect<DropTarget>('drop:target', (t) => {
      this.#target = t ?? null
      this.#redraw()
    })
  }

  protected override dispose(): void {
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy()
      this.#layer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = LANDING_Z
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.sortableChildren = true
  }

  #redraw(): void {
    if (!this.#layer) return
    this.#layer.clear()

    const t = this.#target
    if (!this.#dragging || !t || t.over === false) return

    const center = t.occupied
      ? this.#centerOfIndex(t.index)
      : this.#centerOfIndex(this.#cellCount)   // the slot a NEW tile will take
    if (!center) return

    const fill = t.occupied ? ATTACH_FILL : LAND_FILL
    const fillAlpha = t.occupied ? ATTACH_FILL_ALPHA : LAND_FILL_ALPHA
    const stroke = t.occupied ? ATTACH_STROKE : LAND_STROKE
    const strokeAlpha = t.occupied ? ATTACH_STROKE_ALPHA : LAND_STROKE_ALPHA

    const verts = this.#hexVerts(center.x, center.y, this.#hexRadius())
    this.#layer.poly(verts, true)
    this.#layer.fill({ color: fill, alpha: fillAlpha })
    this.#layer.poly(verts, true)
    this.#layer.stroke({ color: stroke, alpha: strokeAlpha, width: STROKE_WIDTH })
  }

  /** Container-space center of a SLOT by its index.
   *
   *  Occupied slots come from the render snapshot (`render:cell-count` coords,
   *  index-aligned with labels). The next free slot is past the end of that
   *  array, so it comes from the spiral itself — `AxialService.items` is the
   *  index → axial map the layout is built from, which is why asking it gives
   *  the same answer the renderer will reach on its own. */
  #centerOfIndex(index: number): { x: number; y: number } | null {
    if (index < 0) return null
    const coord = this.#coords[index] ?? this.#spiralCoord(index)
    if (!coord) return null
    const p = this.#axialToPixel(coord.q, coord.r)
    return { x: p.x + this.#meshOffset.x, y: p.y + this.#meshOffset.y }
  }

  #spiralCoord(index: number): AxialLike | null {
    const axial = this.resolve<AxialServiceLike>('axial')
    return axial?.items?.get(index) ?? null
  }

  #hexRadius(): number {
    const settings = window.ioc.get<{ hexagonDimensions?: { circumRadius?: number } }>(
      '@diamondcoreprocessor.com/Settings')
    return settings?.hexagonDimensions?.circumRadius ?? 32
  }

  /** Pointy-top hex vertices about (cx, cy) — matches move-preview's rings. */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }

  /** Render-space pixel for an axial, matching the MESH spacing — NOT
   *  AxialService's 200-scale Location. Identical to tile-overlay.drone.ts. */
  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}

const _dropLanding = new DropLandingDrone()
window.ioc.register('@diamondcoreprocessor.com/DropLandingDrone', _dropLanding)
