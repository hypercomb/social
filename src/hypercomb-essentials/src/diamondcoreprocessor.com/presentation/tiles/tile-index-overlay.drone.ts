// diamondcoreprocessor.com/pixi/tile-index-overlay.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

const INDEX_STYLE = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 8,
  fill: 0xffffff,
  align: 'center',
})

const HEX_FILL = 0xffffff
const HEX_FILL_ALPHA = 0.08
const HEX_STROKE = 0xffffff
const HEX_STROKE_ALPHA = 0.15
const STROKE_WIDTH = 0.5

export class TileIndexOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'renders axial index numbers on all hex cells during move command mode'

  #renderContainer: Container | null = null
  #layer: Container | null = null
  #meshOffset = { x: 0, y: 0 }
  #cellCount = 0
  #cellLabels: string[] = []
  #visible = false

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }

  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'move:index-overlay']
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
      if (this.#visible) this.#rebuild()
    })

    this.onEffect<{ count: number; labels: string[] }>('render:cell-count', (payload) => {
      this.#cellCount = payload.count
      this.#cellLabels = payload.labels
      if (this.#visible) this.#rebuild()
    })

    this.onEffect<{ show: boolean }>('move:index-overlay', (payload) => {
      this.#visible = payload.show
      if (payload.show) {
        this.#rebuild()
      } else {
        this.#clear()
      }
    })
  }

  protected override dispose(): void {
    if (this.#layer) {
      this.#layer.destroy({ children: true })
      this.#layer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Container()
    this.#layer.zIndex = 6000
    this.#layer.visible = false
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.sortableChildren = true
  }

  #clear(): void {
    if (!this.#layer) return
    this.#layer.removeChildren()
    this.#layer.visible = false
  }

  #rebuild(): void {
    if (!this.#layer) return
    this.#layer.removeChildren()

    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    const settings = window.ioc.get<any>('@diamondcoreprocessor.com/Settings')
    const r = settings?.hexagonDimensions?.circumRadius ?? 32

    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y

    // Render index numbers on all grid positions up to the ring capacity
    const maxIndex = Math.max(this.#cellCount, axialSvc.items.size)
    const limit = Math.min(maxIndex + 20, axialSvc.items.size) // show a few extra empty positions

    for (const [index, coord] of axialSvc.items) {
      if (index >= limit) break

      const cx = coord.Location.x + ox
      const cy = coord.Location.y + oy

      // Draw semi-transparent hex silhouette
      const hex = new Graphics()
      const verts: number[] = []
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6
        verts.push(cx + r * Math.cos(angle))
        verts.push(cy + r * Math.sin(angle))
      }
      hex.poly(verts, true)
      hex.fill({ color: HEX_FILL, alpha: HEX_FILL_ALPHA })
      hex.poly(verts, true)
      hex.stroke({ color: HEX_STROKE, alpha: HEX_STROKE_ALPHA, width: STROKE_WIDTH })
      this.#layer.addChild(hex)

      // Draw index number centered in the hex
      const text = new Text({
        text: String(index),
        style: INDEX_STYLE,
        resolution: window.devicePixelRatio * 4,
      })
      text.anchor.set(0.5)
      text.position.set(cx, cy)
      text.alpha = 0.6
      this.#layer.addChild(text)
    }

    this.#layer.visible = true
  }
}

const _tileIndexOverlay = new TileIndexOverlayDrone()
window.ioc.register('@diamondcoreprocessor.com/TileIndexOverlayDrone', _tileIndexOverlay)
