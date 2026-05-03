// diamondcoreprocessor.com/pixi/move-preview.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type MovePreviewPayload = {
  names: string[]
  movedLabels: Set<string>
} | null

type DropIntoPayload = {
  label: string
} | null

// swap target indicators
const SWAP_FILL = 0xff8844
const SWAP_FILL_ALPHA = 0.2
const SWAP_STROKE = 0xff8844
const SWAP_STROKE_ALPHA = 0.5
const STROKE_WIDTH = 0.5

// drop-into indicators (Ctrl held — tile becomes a parent of the dragged set)
const DROP_FILL = 0x2299aa
const DROP_FILL_ALPHA = 0.35
const DROP_STROKE = 0x33bbcc
const DROP_STROKE_ALPHA = 0.85
const DROP_STROKE_WIDTH = 2
const DROP_INSET_FACTOR = 0.55     // inner hex radius as fraction of outer
const DROP_INSET_FILL_ALPHA = 0.55
const DROP_CHEVRON_WIDTH = 2.5

export class MovePreviewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  override description =
    'Draws swap-indicator overlays showing where tiles will land during a move.'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #dropIntoLayer: Graphics | null = null
  #meshOffset = { x: 0, y: 0 }
  #originalNames: string[] = []
  #cellCoords: { q: number; r: number }[] = []
  #cellCount = 0

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'move:preview', 'move:drop-into']
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

    this.onEffect<DropIntoPayload>('move:drop-into', (payload) => {
      this.#redrawDropInto(payload)
    })
  }

  protected override dispose(): void {
    if (this.#dropIntoLayer) {
      this.#dropIntoLayer.parent?.removeChild(this.#dropIntoLayer)
      this.#dropIntoLayer.destroy()
      this.#dropIntoLayer = null
    }
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy()
      this.#layer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 7000
    this.#dropIntoLayer = new Graphics()
    this.#dropIntoLayer.zIndex = 7001
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.addChild(this.#dropIntoLayer)
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

  // ── drop-into hex (Ctrl-modifier preview) ─────────────────

  #redrawDropInto(payload: DropIntoPayload): void {
    if (!this.#dropIntoLayer) return
    this.#dropIntoLayer.clear()

    if (!payload) return

    const { label } = payload

    const idx = this.#originalNames.indexOf(label)
    if (idx < 0) return

    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    const coord = this.#cellCoords[idx]
    if (!coord) return

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
    this.#drawDropIntoHex(px + ox, py + oy)
  }

  /**
   * Visualise "drop these tiles into this tile's children": a thick outer
   * hex highlighting the target, an inset hex suggesting nesting/depth, and
   * a downward chevron at center reading as "going in".
   */
  #drawDropIntoHex(cx: number, cy: number): void {
    if (!this.#dropIntoLayer) return

    const settings = window.ioc.get<any>('@diamondcoreprocessor.com/Settings')
    const r = settings?.hexagonDimensions?.circumRadius ?? 32

    const buildHexVerts = (radius: number): number[] => {
      const verts: number[] = []
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2
        verts.push(cx + radius * Math.cos(angle))
        verts.push(cy + radius * Math.sin(angle))
      }
      return verts
    }

    // outer hex — fill + stroke
    const outer = buildHexVerts(r)
    this.#dropIntoLayer.poly(outer, true)
    this.#dropIntoLayer.fill({ color: DROP_FILL, alpha: DROP_FILL_ALPHA })
    this.#dropIntoLayer.poly(outer, true)
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: DROP_STROKE_ALPHA, width: DROP_STROKE_WIDTH })

    // inset hex — suggests "interior" / children container
    const inset = buildHexVerts(r * DROP_INSET_FACTOR)
    this.#dropIntoLayer.poly(inset, true)
    this.#dropIntoLayer.fill({ color: DROP_FILL, alpha: DROP_INSET_FILL_ALPHA })
    this.#dropIntoLayer.poly(inset, true)
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: DROP_STROKE_ALPHA, width: 1 })

    // downward chevron — reads as "going in"
    const cw = r * 0.32  // half-width of chevron
    const ch = r * 0.18  // chevron vertical extent
    const cyOffset = r * 0.05
    this.#dropIntoLayer.moveTo(cx - cw, cy - ch + cyOffset)
    this.#dropIntoLayer.lineTo(cx, cy + ch + cyOffset)
    this.#dropIntoLayer.lineTo(cx + cw, cy - ch + cyOffset)
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: 1, width: DROP_CHEVRON_WIDTH })
  }
}

const _movePreview = new MovePreviewDrone()
window.ioc.register('@diamondcoreprocessor.com/MovePreviewDrone', _movePreview)
