// input/pan/panning.drone.ts
import { Drone, EffectBus } from '@hypercomb/core'
import type { HostReadyPayload } from '../../presentation/tiles/pixi-host.worker.js'
import type { ViewportPersistence, ViewportSnapshot } from '../zoom/zoom.drone.js'
import type { HexGeometry } from '../../presentation/grid/hex-geometry.js'
import { DEFAULT_HEX_GEOMETRY } from '../../presentation/grid/hex-geometry.js'
import { getLaneScrollAxis, laneStopDelta, type LaneScrollAxis } from '../../sequence/lane-viewport-mode.js'
import { viewportIsFramed } from '../../sequence/frame-lock.js'

type Point = { x: number; y: number }

/** The fit's own margin (ZoomDrone.zoomToFit `padding`), so a lane strip
 *  pulled back to its start rests exactly where the fit put it. */
const LANE_MARGIN_PX = 5

/** Below this a clamped pan is float noise, not travel. */
const STILL_PX = 0.01

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
  // A phone reading in lanes is stricter along its scroll axis: see below.
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

    // A PHONE STRIP STOPS AT ITS ENDS. "One tile left on screen" let a pull
    // carry the whole strip away but a sliver — the first tile ended up at the
    // bottom of the screen, the last at the top. Along the scroll axis the
    // first tile now stops at the start of the window and the last one the
    // moment it is fully on screen; the cross axis is fitted and keeps the
    // rule above.
    const laneAxis = getLaneScrollAxis()
    if (!laneAxis) return { x: cx, y: cy }
    const { near, far } = this.#laneWindow(laneAxis)
    return laneAxis === 'y'
      ? { x: cx, y: laneStopDelta(dy, b.y, b.y + b.height, near, far) }
      : { x: laneStopDelta(dx, b.x, b.x + b.width, near, far), y: cy }
  }

  /** The window a lane strip is read through, along its axis, in canvas px:
   *  below the header (as the fit measures it) and above the portrait bar, or
   *  right of the landscape rail — inset by the fit's margin. The bar's edges
   *  come from the inline custom properties the controls bar writes, so a
   *  move never pays for a style recalc. */
  #laneWindow = (axis: LaneScrollAxis): { near: number; far: number } => {
    const screen = this.renderer.screen
    const rect = this.canvas?.getBoundingClientRect()
    const style = document.documentElement.style
    const px = (name: string): number => Number.parseFloat(style.getPropertyValue(name)) || 0
    if (axis === 'x') {
      const left = Math.max(0, px('--hc-controls-left') - (rect?.left ?? 0))
      return { near: left + LANE_MARGIN_PX, far: screen.width - px('--hc-controls-right') - LANE_MARGIN_PX }
    }
    const top = rect?.top ?? 0
    const headerBottom = document.querySelector('.header-bar')?.getBoundingClientRect().bottom ?? 0
    const barTop = window.innerHeight - px('--hc-controls-bottom') - top
    return {
      near: Math.max(0, headerBottom - top) + LANE_MARGIN_PX,
      far: Math.min(screen.height, barTop) - LANE_MARGIN_PX,
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
    this.container = null
    this.vp = null
  }

  // -------------------------------------------------
  // pan api (used by inputs)
  // -------------------------------------------------

  /** Returns the travel actually applied — zero when nothing moved (a lane
   *  stop, a framed page), which is how a coast knows to end. */
  public panBy = (delta: Point): Point => {
    if (!this.stage) return { x: 0, y: 0 }

    // A FRAMED page does not pan. The frame's promise is that the slots stay
    // where they are, sized to the window — one drag of the canvas and that is
    // gone. The travel gesture is not lost, it is re-pointed: spacebar-drag
    // walks the TILES through the frame instead (spacebar-pan.input), and it
    // returns before ever reaching this method. Anything else that still calls
    // in here (touch pan, a keybinding) is asking to move the camera, which is
    // the one thing a frame forbids.
    if (viewportIsFramed()) return { x: 0, y: 0 }

    const laneAxis = getLaneScrollAxis()
    const dx = laneAxis === 'y' ? 0 : delta.x
    const dy = laneAxis === 'x' ? 0 : delta.y
    const clamped = this.#clampStageDelta(dx, dy)

    // Nothing moved — a pull against a lane stop, a strip that already fits.
    // Announcing it anyway handed the page away from the global fit (the
    // control bar reads `viewport:manual` as "the participant framed this")
    // and persisted a pan that never changed. A strip resting on its stop
    // reads back ~1e-13 px from it, so "nothing" is anything under STILL_PX.
    if (Math.abs(clamped.x) < STILL_PX && Math.abs(clamped.y) < STILL_PX) return { x: 0, y: 0 }

    EffectBus.emitTransient('viewport:manual', {})

    this.stage.position.x += clamped.x
    this.stage.position.y += clamped.y

    // Defense-in-depth: if heartbeat-time vp resolution failed (race
    // with VP registration), fall back to a fresh IoC lookup. Cache
    // on success so future calls take the fast path. Zoom save works
    // because mousewheel doesn't fire until the user can interact —
    // by then everything has settled. Spacebar pan can fire much
    // earlier (user holds space during page load).
    let vp = this.vp
    if (!vp) {
      vp = window.ioc.get<ViewportPersistence>('@diamondcoreprocessor.com/ViewportPersistence') ?? null
      if (vp) this.vp = vp
    }

    // persist pan offset relative to center
    if (this.renderer && vp) {
      const s = this.renderer.screen
      const dx = this.stage.position.x - s.width * 0.5
      const dy = this.stage.position.y - s.height * 0.5
      // 'user' source so the new-path debounced commit fires; the user
      // gesture is what we want preserved across nav.
      vp.setPan(dx, dy, 'user')
    }
    return clamped
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
