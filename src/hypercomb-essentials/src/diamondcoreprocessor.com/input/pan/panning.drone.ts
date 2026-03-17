// src/<domain>/pixi/panning.drone.ts
import { Drone } from '@hypercomb/core'
import type { HostReadyPayload } from '../../pixi/pixi-host.drone.js'
import type { ViewportPersistence } from '../zoom/zoom.drone.js'

type Point = { x: number; y: number }

export class PanningDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description = 'authoritative panning controller'

  private stage: any = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: any = null
  private vp: ViewportPersistence | null = null

  protected override deps = {
    spacebarPan: '@diamondcoreprocessor.com/SpacebarPanInput',
    touchPan: '@diamondcoreprocessor.com/TouchPanInput',
  }
  protected override listens = ['render:host-ready']

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.stage = payload.app.stage
      this.canvas = payload.canvas
      this.renderer = payload.renderer

      const spacebarPan = this.resolve<any>('spacebarPan')
      spacebarPan?.attach(this, this.canvas)

      const touchPan = this.resolve<any>('touchPan')
      touchPan?.attach(this, this.canvas)

      // restore saved pan offset from 0000 viewport state
      this.vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (this.vp && this.stage && this.renderer) {
        void this.vp.read().then((snap) => {
          if (snap.pan && this.stage && this.renderer) {
            const s = this.renderer.screen
            this.stage.position.set(
              s.width * 0.5 + snap.pan.dx,
              s.height * 0.5 + snap.pan.dy,
            )
          }
        })
      }
    })
  }

  public stop = async (): Promise<void> => {
    this.detach()
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  private detach = (): void => {
    const spacebarPan = this.resolve<any>('spacebarPan')
    spacebarPan?.detach()

    const touchPan = this.resolve<any>('touchPan')
    touchPan?.detach()

    this.stage = null
    this.canvas = null
    this.renderer = null
    this.vp = null
  }

  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------

  public panBy = (delta: Point): void => {
    if (!this.stage) return

    this.stage.position.x += delta.x
    this.stage.position.y += delta.y

    // persist pan offset relative to center
    if (this.renderer && this.vp) {
      const s = this.renderer.screen
      this.vp.setPan(
        this.stage.position.x - s.width * 0.5,
        this.stage.position.y - s.height * 0.5,
      )
    }
  }
}

const _panning = new PanningDrone()
window.ioc.register('@diamondcoreprocessor.com/PanningDrone', _panning)
