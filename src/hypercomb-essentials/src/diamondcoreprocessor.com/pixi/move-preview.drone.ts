// diamondcoreprocessor.com/pixi/move-preview.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'

type MovePreviewPayload = {
  names: string[]
  movedLabels: Set<string>
} | null

// swap target indicators
const SWAP_FILL = 0xff8844
const SWAP_FILL_ALPHA = 0.2
const SWAP_STROKE = 0xff8844
const SWAP_STROKE_ALPHA = 0.5
const STROKE_WIDTH = 0.5

export class MovePreviewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'swap indicator overlays during tile move'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #meshOffset = { x: 0, y: 0 }
  #originalNames: string[] = []
  #cellCount = 0

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'move:preview']
  protected override emits: string[] = []

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#initLayer()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
    })

    this.onEffect<{ count: number; labels: string[] }>('render:cell-count', (payload) => {
      this.#originalNames = payload.labels
      this.#cellCount = payload.count
    })

    this.onEffect<MovePreviewPayload>('move:preview', (payload) => {
      this.#redraw(payload)
    })
  }

  protected override dispose(): void {
    if (this.#layer) {
      this.#layer.destroy()
      this.#layer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 7000
    this.#renderContainer.addChild(this.#layer)
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
}

const _movePreview = new MovePreviewDrone()
window.ioc.register('@diamondcoreprocessor.com/MovePreviewDrone', _movePreview)
