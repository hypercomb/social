// diamondcoreprocessor.com/input/pan/panning.drone.ts
import { Drone } from '@hypercomb/core'
import type { HostReadyPayload } from '../../pixi/pixi-host.drone.js'
import type { ViewportPersistence, ViewportSnapshot } from '../zoom/zoom.drone.js'

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
  // Note: touchPan is now a math delegate — the TouchGestureCoordinator
  // calls touchPan.panUpdate() instead of touchPan managing its own pointers.
  // The coordinator is attached by ZoomDrone (which has both zoom + pan refs).
  protected override listens = ['render:host-ready']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.stage = payload.app.stage
      this.canvas = payload.canvas
      this.renderer = payload.renderer

      const spacebarPan = this.resolve<any>('spacebarPan')
      spacebarPan?.attach(this, this.canvas)

      // touchPan is a math delegate — attach with just the pan API (no canvas)
      // The TouchGestureCoordinator handles pointer events and calls touchPan.panUpdate()
      const touchPan = this.resolve<any>('touchPan')
      touchPan?.attach(this)

      // resolve ViewportPersistence and subscribe to navigation restores
      this.vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (this.vp) {
        void this.vp.read().then(snap => this.#applyPanSnapshot(snap))
        this.vp.addEventListener('restore', ((e: CustomEvent<ViewportSnapshot>) => {
          this.#applyPanSnapshot(e.detail)
        }) as EventListener)
      }
    })
  }

  #applyPanSnapshot = (snap: ViewportSnapshot): void => {
    if (!this.stage || !this.renderer) return
    const s = this.renderer.screen
    if (snap.pan) {
      this.stage.position.set(
        s.width * 0.5 + snap.pan.dx,
        s.height * 0.5 + snap.pan.dy,
      )
    } else {
      this.stage.position.set(s.width * 0.5, s.height * 0.5)
    }
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

// Co-locate pan input registration here — plain classes (no base class) get
// tree-shaken when imported from a separate module at file scope, because
// esbuild considers `new PlainClass()` pure/droppable. Importing and
// registering them from PanningDrone's module (which extends Drone and is
// therefore preserved) ensures the side-effects survive the Angular build.
import { SpacebarPanInput } from './spacebar-pan.input.js'
import { TouchPanInput } from './touch-pan.input.js'
window.ioc.register('@diamondcoreprocessor.com/SpacebarPanInput', new SpacebarPanInput())
window.ioc.register('@diamondcoreprocessor.com/TouchPanInput', new TouchPanInput())
