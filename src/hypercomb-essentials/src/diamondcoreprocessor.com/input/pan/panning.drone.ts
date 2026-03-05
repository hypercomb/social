// src/<domain>/pixi/panning.drone.ts
import { Drone } from '@hypercomb/core'
import type { HostReadyPayload } from '../../pixi/pixi-host.drone.js'

type Point = { x: number; y: number }

export class PanningDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description = 'authoritative panning controller'

  private stage: any = null
  private canvas: HTMLCanvasElement | null = null
  private activeSource: string | null = null

  protected override deps = { mousePan: '@diamondcoreprocessor.com/MousePanInput' }
  protected override listens = ['render:host-ready']

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.stage = payload.app.stage
      this.canvas = payload.canvas

      const mousePan = this.resolve<any>('mousePan')
      mousePan?.attach(this, this.canvas)
    })
  }

  public stop = async (): Promise<void> => {
    this.detach()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  private detach = (): void => {
    const mousePan = this.resolve<any>('mousePan')
    mousePan?.detach()

    this.stage = null
    this.canvas = null
    this.activeSource = null
  }

  // -------------------------------------------------
  // exclusivity
  // -------------------------------------------------

  public begin = (source: string): boolean => {
    if (this.activeSource && this.activeSource !== source) return false
    this.activeSource = source
    return true
  }

  public end = (source: string): void => {
    if (this.activeSource === source) {
      this.activeSource = null
    }
  }

  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------

  public panBy = (delta: Point, source: string): void => {
    if (!this.begin(source)) return
    if (!this.stage) return

    this.stage.position.x += delta.x
    this.stage.position.y += delta.y
  }
}

const _panning = new PanningDrone()
window.ioc.register('@diamondcoreprocessor.com/PanningDrone', _panning)
