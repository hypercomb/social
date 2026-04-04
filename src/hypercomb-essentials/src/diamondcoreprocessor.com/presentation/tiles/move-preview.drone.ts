// diamondcoreprocessor.com/pixi/move-preview.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type MovePreviewPayload = {
  names: string[]
  movedLabels: Set<string>
} | null

type LayerDwellPayload = {
  label: string
  progress: number
} | null

// swap target indicators
const SWAP_FILL = 0xff8844
const SWAP_FILL_ALPHA = 0.2
const SWAP_STROKE = 0xff8844
const SWAP_STROKE_ALPHA = 0.5
const STROKE_WIDTH = 0.5

// layer dwell hourglass indicators
const DWELL_FILL = 0x2299aa
const DWELL_FILL_ALPHA = 0.45
const DWELL_STROKE = 0x33bbcc
const DWELL_STROKE_ALPHA = 0.7
const DWELL_STROKE_WIDTH = 1.5

export class MovePreviewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  override description =
    'Draws swap-indicator overlays showing where tiles will land during a move.'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #dwellLayer: Graphics | null = null
  #meshOffset = { x: 0, y: 0 }
  #originalNames: string[] = []
  #cellCoords: { q: number; r: number }[] = []
  #cellCount = 0

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'move:preview', 'move:layer-dwell']
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
    })

    this.onEffect<{ count: number; labels: string[]; coords?: { q: number; r: number }[] }>('render:cell-count', (payload) => {
      this.#originalNames = payload.labels
      this.#cellCoords = payload.coords ?? []
      this.#cellCount = payload.count
    })

    this.onEffect<MovePreviewPayload>('move:preview', (payload) => {
      this.#redraw(payload)
    })

    this.onEffect<LayerDwellPayload>('move:layer-dwell', (payload) => {
      this.#redrawDwell(payload)
    })
  }

  protected override dispose(): void {
    if (this.#layer) {
      this.#layer.destroy()
      this.#layer = null
    }
    if (this.#dwellLayer) {
      this.#dwellLayer.destroy()
      this.#dwellLayer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 7000
    this.#dwellLayer = new Graphics()
    this.#dwellLayer.zIndex = 7001
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.addChild(this.#dwellLayer)
    this.#renderContainer.sortableChildren = true
  }

  #redraw(payload: MovePreviewPayload): void {
    if (!this.#layer) return
    this.#layer.clear()

    if (!payload) return

    const { names, movedLabels } = payload
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y

    // draw indicators for swapped tiles: labels that changed index but aren't in movedLabels
    for (let i = 0; i < this.#cellCount; i++) {
      const label = names[i]
      if (!label) break
      if (movedLabels.has(label)) continue
      if (label === this.#originalNames[i]) continue // not displaced

      const coord = axialSvc.items.get(i)
      if (!coord) break

      this.#drawSwapHex(coord.Location.x + ox, coord.Location.y + oy)
    }
  }

  #drawSwapHex(cx: number, cy: number): void {
    if (!this.#layer) return

    const settings = window.ioc.get<any>('@diamondcoreprocessor.com/Settings')
    const r = settings?.hexagonDimensions?.circumRadius ?? 32

    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6
      verts.push(cx + r * Math.cos(angle))
      verts.push(cy + r * Math.sin(angle))
    }

    this.#layer.poly(verts, true)
    this.#layer.fill({ color: SWAP_FILL, alpha: SWAP_FILL_ALPHA })

    this.#layer.poly(verts, true)
    this.#layer.stroke({ color: SWAP_STROKE, alpha: SWAP_STROKE_ALPHA, width: STROKE_WIDTH })
  }

  // ── layer dwell hourglass ─────────────────────────────────

  #redrawDwell(payload: LayerDwellPayload): void {
    if (!this.#dwellLayer) return
    this.#dwellLayer.clear()

    if (!payload) return

    const { label, progress } = payload

    // find the axial coord for this label
    const idx = this.#originalNames.indexOf(label)
    if (idx < 0) return

    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    const coord = this.#cellCoords[idx]
    if (!coord) return

    // look up pixel position from axial service by finding matching coord
    let px = 0
    let py = 0
    for (const [, item] of axialSvc.items) {
      if (item.q === coord.q && item.r === coord.r) {
        px = item.Location.x
        py = item.Location.y
        break
      }
    }

    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y
    this.#drawHourglassHex(px + ox, py + oy, progress)
  }

  /**
   * Draw a point-top hex that fills from bottom vertex to top vertex.
   * progress 0 = empty, progress 1 = full hex.
   */
  #drawHourglassHex(cx: number, cy: number, progress: number): void {
    if (!this.#dwellLayer) return

    const settings = window.ioc.get<any>('@diamondcoreprocessor.com/Settings')
    const r = settings?.hexagonDimensions?.circumRadius ?? 32

    // point-top hex vertices (vertex 0 = top, going clockwise)
    // angle starts at -π/2 (top) for point-top orientation
    const verts: { x: number; y: number }[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      })
    }

    // hex bounds: top vertex at cy - r, bottom vertex at cy + r
    const topY = cy - r
    const bottomY = cy + r
    const totalHeight = bottomY - topY

    // clip line rises from bottom to top as progress goes 0 → 1
    const clipY = bottomY - progress * totalHeight

    // draw the outline (always visible)
    const outlineVerts: number[] = []
    for (const v of verts) {
      outlineVerts.push(v.x, v.y)
    }
    this.#dwellLayer.poly(outlineVerts, true)
    this.#dwellLayer.stroke({ color: DWELL_STROKE, alpha: DWELL_STROKE_ALPHA, width: DWELL_STROKE_WIDTH })

    if (progress <= 0) return

    // build clipped polygon: hex intersected with half-plane y >= clipY
    // walk hex edges, collect vertices below clipY, interpolate at crossings
    const clipped: number[] = []
    for (let i = 0; i < 6; i++) {
      const a = verts[i]
      const b = verts[(i + 1) % 6]
      const aBelow = a.y >= clipY
      const bBelow = b.y >= clipY

      if (aBelow) {
        clipped.push(a.x, a.y)
      }

      if (aBelow !== bBelow) {
        // edge crosses clipY — interpolate
        const t = (clipY - a.y) / (b.y - a.y)
        clipped.push(a.x + t * (b.x - a.x), clipY)
      }
    }

    if (clipped.length >= 6) {
      this.#dwellLayer.poly(clipped, true)
      this.#dwellLayer.fill({ color: DWELL_FILL, alpha: DWELL_FILL_ALPHA })
    }
  }
}

const _movePreview = new MovePreviewDrone()
window.ioc.register('@diamondcoreprocessor.com/MovePreviewDrone', _movePreview)
