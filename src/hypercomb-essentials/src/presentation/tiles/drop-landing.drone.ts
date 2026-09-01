// presentation/tiles/drop-landing.drone.ts
//
// WHERE WILL THIS LAND? — the target drawn under a drag that is carrying
// meaning onto the hive (a Portal row, a structure, a file).
//
// The drag already knows what it is carrying and the overlay already knows what
// is under the pointer. What neither said, until this drone, is the one thing
// the participant is actually asking while the pointer is in the air. Releasing
// used to be the first moment you found out — and the two outcomes are not
// variations of one act, they are different acts:
//
//   over an OCCUPIED tile → the drop is refused/attaches according to its owner.
//   over EMPTY hive       → an ordinary full-size target tile appears on the
//                           exact cursor hex and that exact slot is committed.
//
// The drop target carries the reverse-mapped AxialService index, including for
// empty hexes. That is what turns the cursor's position into a durable slot
// instead of silently demoting the new tile to the lowest free index.
//
// ── Geometry is mirrored, not asked for ─────────────────────────────────────
//
// Same render-space transform tile-overlay.drone and move-preview.drone each
// carry: mesh spacing (~38) and orientation, NOT AxialService's 200-scale
// Location. Three copies is the established cost of keeping hex geometry the
// renderer's business rather than inventing a fourth service for it.

import { Drone } from '@hypercomb/core'
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
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

type TargetTile = { label: string; imageSig?: string }

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

const TILE_FILL = 0x0e1722
const TILE_BORDER = 0x7eb6d6
const TILE_LABEL = 0xe8f2f8
const TARGET_TILE_Z = 7000

const STROKE_WIDTH = 2
/** Above the mesh, below the move drone's held cluster (7001/7002). */
const LANDING_Z = 6999

type AxialLike = { q: number; r: number }
type AxialServiceLike = { items?: Map<number, AxialLike> }

export class DropLandingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Shows the exact hive tile a drag will occupy, including the carried Portal image.'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #targetTile: Container | null = null
  #targetTexture: Texture | null = null
  #targetSpec: TargetTile | null = null
  #targetBuildToken = 0
  #meshOffset = { x: 0, y: 0 }
  #coords: AxialLike[] = []
  #cellCount = 0
  #spacing = 38
  #flat = false

  #dragging = false
  /** This drag mints its tile in the FIRST slot (a dropped link). */
  #landsAtTop = false
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
      if (this.#targetSpec) this.#rebuildTargetTile()
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
      if (this.#targetSpec) this.#rebuildTargetTile()
      this.#redraw()
    })

    this.onEffect<{ active: boolean; atTop?: boolean; targetTile?: TargetTile }>('drop:dragging', ({ active, atTop, targetTile }) => {
      this.#dragging = !!active
      // A drag that MINTS AT THE TOP lands in slot 0, not the tail of the
      // spiral. Ringing the append slot would promise a place the tile is not
      // going to take. Absent flag = the old behaviour, unchanged.
      this.#landsAtTop = !!active && atTop === true
      const spec = active && targetTile?.label
        ? { label: String(targetTile.label), ...(targetTile.imageSig ? { imageSig: String(targetTile.imageSig) } : {}) }
        : null
      if (JSON.stringify(spec) !== JSON.stringify(this.#targetSpec)) {
        this.#targetSpec = spec
        this.#rebuildTargetTile()
      }
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
    this.#destroyTargetTile()
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
    const targetVisible = !!this.#targetTile && this.#dragging && !!t && t.over !== false && !t.occupied
    if (this.#targetTile) {
      this.#targetTile.visible = targetVisible
      if (targetVisible && t) {
        const center = this.#centerOfAxial(t.q, t.r)
        if (center) this.#targetTile.position.set(center.x, center.y)
        else this.#targetTile.visible = false
      }
    }
    if (!this.#dragging || !t || t.over === false) return

    // A Portal supplies its own full target tile. Occupied hex refusal is drawn
    // by tile-overlay; empty hexes need no extra ring fighting the image.
    if (this.#targetSpec) return

    const center = t.occupied
      ? this.#centerOfIndex(t.index)
      : this.#centerOfIndex(t.index >= 0 ? t.index : (this.#landsAtTop ? 0 : this.#cellCount))
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

  /** Build the Portal's ordinary target tile once per drag. Pointer movement
   *  only repositions this container; image decoding never runs per hex. */
  #rebuildTargetTile(): void {
    this.#destroyTargetTile()
    const spec = this.#targetSpec
    const host = this.#renderContainer
    if (!spec || !host) { this.#redraw(); return }

    const token = this.#targetBuildToken
    const node = this.#buildTargetTileNode(spec.label, null)
    node.zIndex = TARGET_TILE_Z
    node.visible = false
    host.addChild(node)
    host.sortableChildren = true
    this.#targetTile = node
    this.#redraw()

    if (!spec.imageSig) return
    void this.#loadTexture(spec.imageSig).then(texture => {
      if (!texture) return
      if (token !== this.#targetBuildToken || this.#targetSpec?.imageSig !== spec.imageSig || !this.#renderContainer) {
        texture.destroy(true)
        return
      }
      const previous = this.#targetTile
      const replacement = this.#buildTargetTileNode(spec.label, texture)
      replacement.zIndex = TARGET_TILE_Z
      replacement.visible = previous?.visible ?? false
      if (previous) replacement.position.copyFrom(previous.position)
      previous?.parent?.removeChild(previous)
      previous?.destroy({ children: true })
      this.#renderContainer.addChild(replacement)
      this.#renderContainer.sortableChildren = true
      this.#targetTile = replacement
      this.#targetTexture = texture
      this.#redraw()
    })
  }

  #destroyTargetTile(): void {
    this.#targetBuildToken++
    if (this.#targetTile) {
      this.#targetTile.parent?.removeChild(this.#targetTile)
      this.#targetTile.destroy({ children: true })
      this.#targetTile = null
    }
    if (this.#targetTexture) {
      try { this.#targetTexture.destroy(true) } catch { /* already released */ }
      this.#targetTexture = null
    }
  }

  #buildTargetTileNode(label: string, texture: Texture | null): Container {
    const node = new Container()
    const radius = this.#hexRadius()
    const width = this.#flat ? radius * 2 : Math.sqrt(3) * radius
    const height = this.#flat ? Math.sqrt(3) * radius : radius * 2
    const verts = this.#hexVerts(0, 0, radius)

    const body = new Graphics()
    body.poly(verts, true)
    body.fill({ color: TILE_FILL, alpha: 1 })
    node.addChild(body)

    if (texture) {
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5)
      const scale = Math.max(width / Math.max(1, texture.width), height / Math.max(1, texture.height))
      sprite.scale.set(scale)
      const mask = new Graphics()
      mask.poly(this.#hexVerts(0, 0, radius * 0.985), true)
      mask.fill({ color: 0xffffff })
      node.addChild(sprite)
      node.addChild(mask)
      sprite.mask = mask
    }

    // The same centered name band an ordinary tile presents. It stays on the
    // preview even with an image, so the target is the Portal tile rather than
    // an anonymous picture floating over a hex.
    const bandHeight = Math.max(16, radius * 0.42)
    const band = new Graphics()
    band.rect(-width * 0.49, -bandHeight / 2, width * 0.98, bandHeight)
    band.fill({ color: 0x071018, alpha: 0.62 })
    node.addChild(band)

    const text = new Text({
      text: label,
      style: {
        fontFamily: 'DM Mono, ui-monospace, monospace',
        fontSize: Math.max(8, radius * 0.27),
        fill: TILE_LABEL,
        align: 'center',
      },
    })
    text.anchor.set(0.5)
    if (text.width > width * 0.82) text.scale.set((width * 0.82) / text.width)
    node.addChild(text)

    const border = new Graphics()
    border.poly(verts, true)
    border.stroke({ color: TILE_BORDER, alpha: 0.96, width: 1.4, join: 'round' })
    node.addChild(border)
    return node
  }

  async #loadTexture(sig: string): Promise<Texture | null> {
    try {
      const store = window.ioc.get<{ getResource?: (value: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (!blob) return null
      const bitmap = await createImageBitmap(blob)
      return Texture.from(bitmap)
    } catch { return null }
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

  #centerOfAxial(q: number, r: number): { x: number; y: number } {
    const p = this.#axialToPixel(q, r)
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
    const start = this.#flat ? 0 : -Math.PI / 2
    for (let i = 0; i < 6; i++) {
      const angle = start + (Math.PI / 3) * i
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
