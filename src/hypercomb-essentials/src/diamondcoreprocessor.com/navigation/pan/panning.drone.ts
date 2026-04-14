// diamondcoreprocessor.com/input/pan/panning.drone.ts
import { Drone, EffectBus } from '@hypercomb/core'
import type { HostReadyPayload } from '../../presentation/tiles/pixi-host.worker.js'
import type { ViewportPersistence, ViewportSnapshot } from '../zoom/zoom.drone.js'
import type { HexGeometry } from '../../presentation/grid/hex-geometry.js'
import { DEFAULT_HEX_GEOMETRY } from '../../presentation/grid/hex-geometry.js'

type Point = { x: number; y: number }

export class PanningDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Handles touch, mouse, and keyboard panning — owns the viewport position.'
  public override effects = ['render'] as const

  private stage: any = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: any = null
  private container: any = null
  private vp: ViewportPersistence | null = null

  protected override deps = {
    spacebarPan: '@diamondcoreprocessor.com/SpacebarPanInput',
    touchPan: '@diamondcoreprocessor.com/TouchPanInput',
  }
  // Note: touchPan is now a math delegate — the TouchGestureCoordinator
  // calls touchPan.panUpdate() instead of touchPan managing its own pointers.
  // The coordinator is attached by ZoomDrone (which has both zoom + pan refs).
  protected override listens = ['render:host-ready', 'render:geometry-changed']

  #hexGeo: HexGeometry = DEFAULT_HEX_GEOMETRY

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#hexGeo = geo
    })

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.stage = payload.app.stage
      this.canvas = payload.canvas
      this.renderer = payload.renderer
      this.container = payload.container

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
    const tx = snap.pan ? s.width * 0.5 + snap.pan.dx : s.width * 0.5
    const ty = snap.pan ? s.height * 0.5 + snap.pan.dy : s.height * 0.5
    const dx = tx - this.stage.position.x
    const dy = ty - this.stage.position.y
    const clamped = this.#clampStageDelta(dx, dy)
    this.stage.position.x += clamped.x
    this.stage.position.y += clamped.y
  }

  // Locate the hex-mesh layer inside renderContainer — only user tiles,
  // not overlays/swarm/background that would inflate the bbox.
  #findContentLayer = (container: any): any | null => {
    const kids = container?.children ?? []
    for (const child of kids) {
      const grandkids = child?.children ?? []
      for (const gk of grandkids) {
        if (gk?.geometry) return child
      }
    }
    return null
  }

  // Enforce: at least one tile must remain fully on screen. Bounds come from
  // the hex-mesh layer (user content only) in world/screen coords, so the
  // proposed pan delta simply shifts them. Clamp the delta so the bounds,
  // extended outward by one tile-diameter, still intersects the viewport.
  #clampStageDelta = (dx: number, dy: number): Point => {
    if (!this.stage || !this.renderer || !this.container) return { x: dx, y: dy }
    const layer = this.#findContentLayer(this.container)
    if (!layer || !layer.getBounds) return { x: dx, y: dy }
    const b = layer.getBounds()
    if (!b || b.width <= 0 || b.height <= 0) return { x: dx, y: dy }

    const cs = this.container.scale?.x ?? 1
    const ss = this.stage.scale?.x ?? 1
    // circum-diameter is the tight square enclosing a hex in either orientation
    const tile = 2 * this.#hexGeo.circumRadiusPx * cs * ss
    const W = this.renderer.screen.width
    const H = this.renderer.screen.height

    // After delta, bounds shift to [b.x+dx, b.x+dx+b.width].
    // Require at least one tile-sized slice to fit in [0,W]:
    //   b.x + dx ≤ W - tile   AND   b.x + b.width + dx ≥ tile
    const maxDx = W - tile - b.x
    const minDx = tile - b.x - b.width
    const maxDy = H - tile - b.y
    const minDy = tile - b.y - b.height

    const cx = minDx <= maxDx ? Math.max(minDx, Math.min(maxDx, dx)) : dx
    const cy = minDy <= maxDy ? Math.max(minDy, Math.min(maxDy, dy)) : dy
    return { x: cx, y: cy }
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
    this.container = null
    this.vp = null
  }

  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------

  public panBy = (delta: Point): void => {
    if (!this.stage) return

    EffectBus.emitTransient('viewport:manual', {})

    const clamped = this.#clampStageDelta(delta.x, delta.y)
    this.stage.position.x += clamped.x
    this.stage.position.y += clamped.y

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
