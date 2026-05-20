// diamondcoreprocessor.com/pixi/pixi-host.worker.ts
import { Worker } from '@hypercomb/core'
import { Application, Container } from 'pixi.js'

export type HostReadyPayload = {
  app: Application
  container: Container
  canvas: HTMLCanvasElement
  renderer: Application['renderer']
}

export class PixiHostWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Initializes the Pixi.js application, canvas, and root container for all rendering drones.'
  public override effects = ['render'] as const

  public app: Application | null = null
  public host: HTMLDivElement | null = null

  // stable render root for all drones (this is what ZoomDrone scales/translates)
  public container!: Container

  protected override deps = { settings: '@diamondcoreprocessor.com/Settings', axial: '@diamondcoreprocessor.com/AxialService' }
  protected override listens = ['editor:mode']
  protected override emits = ['render:host-ready']

  constructor() {
    super()
    this.onEffect<{ active: boolean }>('editor:mode', ({ active }) => {
      if (!this.host) return
      this.host.style.visibility = active ? 'hidden' : 'visible'
    })
    this.onEffect<{ active: boolean }>('view:active', ({ active }) => {
      if (!this.host) return
      this.host.style.visibility = active ? 'hidden' : 'visible'
    })
  }

  protected override ready = async (): Promise<boolean> => {
    if (this.app) return false

    // guard: another PixiHostWorker instance already created a canvas
    if (document.querySelector('[data-hypercomb-pixi="root"] canvas')) return false

    const settings = this.resolve<any>('settings')
    const host = document.getElementById('pixi-host') as HTMLDivElement | null

    return !!settings && !!host
  }

  protected override act = async (): Promise<void> => {
    // guard: prevent duplicate canvas from double-loaded modules
    if (document.querySelector('[data-hypercomb-pixi="root"] canvas')) return

    const settings = this.resolve<any>('settings')
    if (!settings) return

    const axial = this.resolve<any>('axial')
    if (axial?.initialize) axial.initialize(settings)

    // -------------------------------------------------
    // dom root (single, inert)
    // -------------------------------------------------

    const host = this.host = document.getElementById('pixi-host') as HTMLDivElement
    if (!host) return
    host.dataset['hypercombPixi'] = 'root'
    host.style.position = 'fixed'
    host.style.inset = '0'
    host.style.zIndex = '59989'
    host.style.pointerEvents = 'none'

    document.body.appendChild(host)

    // -------------------------------------------------
    // pixi app
    // -------------------------------------------------

    const app = this.app = new Application()

    // Mobile: cap DPR at 1.5. iPhone Pro has DPR=3 → 3M-pixel framebuffer at 60fps which
    // pushes the iOS GPU process over its memory limit → repeated WKWebView crash → Safari
    // "A problem repeatedly occurred". DPR=1.5 is imperceptible at mobile viewing distance.
    // Desktop caps at 2 — above that MSAA is redundant and the gain is invisible.
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    const dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2)

    ;(window as any).__hcBoot?.('PixiHostWorker.act → Application.init() starting')
    const tPixiInit = performance.now()
    await app.init({
      // Size to the host element, not the window, so anything that
      // narrows the host (the history sidebar taking a column on the
      // left via its injected CSS) also narrows the canvas. Without
      // this, resizeTo: window would keep the canvas at full viewport
      // width and the sidebar ended up painted on top of live tile
      // pixels, with hit-testing still firing through the overlay.
      resizeTo: host,
      backgroundAlpha: 0,
      resolution: dpr,
      autoDensity: true,
      antialias: dpr < 2,
      // Hint to iOS to use the efficiency GPU core — it has a larger
      // memory headroom relative to workload than the performance core.
      powerPreference: 'low-power',
    })
    const pixiInitMs = performance.now() - tPixiInit
    console.log(`[pixi-host] Application.init() ${pixiInitMs.toFixed(0)}ms`)
    ;(window as any).__hcBoot?.(`Application.init() done (${pixiInitMs.toFixed(0)}ms)`)

    // On mobile, cap at 30fps. The shaders are complex and running all
    // tickers at 60fps on a small screen is pure GPU waste.
    if (isMobile) app.ticker.maxFPS = 30

    app.stage.scale.set(1.8, 1.8)
    app.stage.interactiveChildren = false
    host.appendChild(app.canvas)

    // Pause the ticker when the tab is hidden — a backgrounded page
    // burning GPU cycles at 30-60fps is a leading cause of iOS GPU
    // process kills that trigger "A problem repeatedly occurred".
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { app.ticker.stop() } else { app.ticker.start() }
    })

    // Pixi's built-in resizeTo polling did not reliably react to CSS
    // changes that narrowed the host (the history sidebar's injected
    // stylesheet setting #pixi-host's width via a CSS variable) —
    // the canvas stayed at its init-time window width while the host
    // shrunk under it, leaving the sidebar painted over live tile
    // pixels. An explicit ResizeObserver on host calls app.resize()
    // so the renderer picks up every host size change immediately.
    if ('ResizeObserver' in globalThis) {
      const ro = new ResizeObserver(() => { try { app.resize() } catch { /* app may be disposed */ } })
      ro.observe(host)
    }
    app.canvas.style.pointerEvents = 'auto'
    app.canvas.style.touchAction   = 'none'

    // -------------------------------------------------
    // root render container
    // -------------------------------------------------

    this.container = new Container()
    app.stage.addChild(this.container)

    // -------------------------------------------------
    // center stage (no scaling!) — use window dimensions directly
    // -------------------------------------------------
    // renderer.screen may lag behind the actual viewport when DPR changes
    // (e.g. desktop → mobile DevTools emulation) because Pixi's internal
    // resize fires on the same event and the resolution/autoDensity
    // recalculation can return stale CSS-pixel values.  window.innerWidth
    // and window.innerHeight are guaranteed correct at resize-event time.

    let fullscreenTransition = false

    // Pixel-perfect centering: read renderer.screen (the canonical canvas
    // size in CSS pixels — same coordinate space stage children render in),
    // round to integer pixels, and apply pan as an offset from that exact
    // center. When pan is (0, 0), the centered grid lands on whole pixels
    // with zero sub-pixel drift after rotation/resize/fullscreen.
    const applyCenter = (): void => {
      const screenSize = app.renderer.screen
      const cx = Math.round(screenSize.width * 0.5)
      const cy = Math.round(screenSize.height * 0.5)
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      const pan = vp?.lastPan
      app.stage.position.set(cx + (pan?.dx ?? 0), cy + (pan?.dy ?? 0))

      // If the saved zoom was a fit, recompute it for the new viewport.
      // The fit's saved (cx, cy) was derived from the previous safe
      // area (header + control pill bounding rects + window size); on
      // resize/rotation/fullscreen those change, and applying the
      // stale coords leaves the content shrunk and off-center. Refit
      // against the new viewport produces a clean centered fit.
      if (vp?.lastZoom?.fit) {
        const zoom = (window as any).ioc?.get('@diamondcoreprocessor.com/ZoomDrone')
        zoom?.zoomToFit?.(true)
      }
    }

    // Pixi's ResizePlugin defers renderer.resize() via requestAnimationFrame
    // in response to window 'resize'. If we recenter synchronously inside the
    // resize event, renderer.screen is still STALE — we'd be centering against
    // the previous frame's canvas dimensions and the grid would land off-centre
    // after rotation. We must run AFTER Pixi's RAF so renderer.screen reflects
    // the new canvas size. We chain two RAFs as belt-and-braces because some
    // browsers (notably mobile Safari) settle layout a frame later than the
    // resize event itself, especially on device orientation rotation.
    const center = (): void => {
      if (fullscreenTransition) return
      requestAnimationFrame(() => {
        if (fullscreenTransition) return
        requestAnimationFrame(() => {
          if (fullscreenTransition) return
          applyCenter()
        })
      })
    }

    // Initial centering — also deferred so we wait for Pixi's first resize RAF.
    center()
    // Window resize covers desktop resize and most device rotations.
    window.addEventListener('resize', center)
    // orientationchange + screen.orientation.change cover the cases where
    // resize fires inconsistently or after a delay during device rotation.
    window.addEventListener('orientationchange', center)
    if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
      screen.orientation.addEventListener('change', center)
    }
    // Fullscreen: keep tiles perfectly still — never move the stage.
    // Capture where the stage is right now (ground truth for tile
    // positions), block all center() calls during the transition, then
    // once the renderer has settled at the new viewport size, derive the
    // pan offset that keeps stage.position unchanged:
    //   new_pan = current_stage_pos - new_viewport_center
    // The stage itself is never touched, so zero flicker.
    document.addEventListener('fullscreenchange', () => {
      fullscreenTransition = true
      const stageX = app.stage.position.x
      const stageY = app.stage.position.y

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const newCx = Math.round(app.renderer.screen.width * 0.5)
          const newCy = Math.round(app.renderer.screen.height * 0.5)
          const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
          if (vp) {
            vp.setPan(stageX - newCx, stageY - newCy)
          }
          fullscreenTransition = false
        })
      })
    })

    // -------------------------------------------------
    // broadcast pixi resources to other drones via effect bus
    // -------------------------------------------------

    this.emitEffect<HostReadyPayload>('render:host-ready', {
      app: this.app,
      container: this.container,
      canvas: this.app.canvas as HTMLCanvasElement,
      renderer: this.app.renderer,
    })
    ;(window as any).__hcBoot?.('render:host-ready emitted')
  }
}

const _pixiHost = new PixiHostWorker()
window.ioc.register('@diamondcoreprocessor.com/PixiHostWorker', _pixiHost)
