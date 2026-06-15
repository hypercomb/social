// diamondcoreprocessor.com/pixi/pixi-host.worker.ts
import { Worker } from '@hypercomb/core'
import { Application, Container } from 'pixi.js'
import {
  computeStageCenter,
  computeViewportOrigin,
  computePhysicalAnchor,
  computePinnedStage,
  shouldRefit,
  type WindowMetrics,
  type PhysicalAnchor,
} from './stage-centering.js'

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
  protected override emits = ['render:host-ready', 'render:unsupported']

  /** WebGL/WebGPU both refused → the tile scene cannot render. Replace the
   *  (empty) canvas host with a plain-DOM explanation of what to enable.
   *  Localized when the i18n provider is up; English otherwise. `diag` is
   *  the context-probe summary, shown small so a screenshot of this note
   *  carries the evidence needed to diagnose the machine. */
  #showWebglRequired(host: HTMLDivElement, diag?: string): void {
    const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
      ?.get?.('@hypercomb.social/I18n') as
      { t: (k: string, p?: Record<string, string | number>) => string } | undefined
    const title = i18n?.t('webgl.required') ?? 'Hardware graphics is turned off'
    const body = i18n?.t('webgl.howto')
      ?? 'Hypercomb draws its tiles with WebGL, which this browser is blocking. '
      + 'Safari: turn off Lockdown Mode for this site (Settings → Privacy & Security). '
      + 'Chrome: turn on "Use graphics acceleration when available" (Settings → System) and relaunch. '
      + 'Then reload this page.'
    const note = document.createElement('div')
    note.dataset['hypercombPixi'] = 'webgl-required'
    note.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
      + 'justify-content:center;gap:0.6rem;padding:2rem;text-align:center;'
      + 'pointer-events:auto;background:#0a0a0a;color:rgba(245,245,245,0.85);'
      + 'font-family:var(--hc-font, system-ui, sans-serif);'
    const h = document.createElement('div')
    h.style.cssText = 'font-size:1.1rem;font-weight:600;'
    h.textContent = title
    const p = document.createElement('div')
    p.style.cssText = 'max-width:34rem;font-size:0.85rem;line-height:1.6;color:rgba(245,245,245,0.6);'
    p.textContent = body
    note.append(h, p)
    if (diag) {
      const d = document.createElement('div')
      d.style.cssText = 'font:0.65rem ui-monospace,monospace;color:rgba(245,245,245,0.3);'
      d.textContent = diag
      note.append(d)
    }
    host.appendChild(note)
  }

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

    ;(window as any).__hcBoot?.('PixiHostWorker.act → Application.init() starting')
    const tPixiInit = performance.now()
    // Mobile: cap DPR at 1.5. iPhone Pro has DPR=3 → ~3M-pixel framebuffer at
    // 60fps which pushes the iOS GPU process over its memory limit → repeated
    // WKWebView crash → Safari "A problem repeatedly occurred". DPR=1.5 is
    // imperceptible at mobile viewing distance. Desktop caps at 2 — above that
    // MSAA is redundant and the gain is invisible.
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    const dpr = Math.min(devicePixelRatio || 1, isMobile ? 1.5 : 2)
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
      // Hint iOS to use the efficiency GPU core — larger memory headroom
      // relative to workload than the performance core.
      powerPreference: 'low-power',
    })
    const pixiInitMs = performance.now() - tPixiInit
    console.log(`[pixi-host] Application.init() ${pixiInitMs.toFixed(0)}ms`)
    ;(window as any).__hcBoot?.(`Application.init() done (${pixiInitMs.toFixed(0)}ms)`)

    // The hive's tiles are Mesh + custom shaders — pipes that exist only on
    // the WebGL/WebGPU renderers. When the browser refuses both contexts
    // (Safari Lockdown Mode, Chrome with hardware acceleration off),
    // autoDetectRenderer silently falls back to the experimental canvas
    // renderer, which has no 'mesh' pipe — the first render pass then
    // throws "undefined (reading 'validateRenderable')" on every ticker
    // frame forever. Detect the fallback, shut the app down cleanly, and
    // tell the participant what to enable instead of grinding a black
    // canvas. render:host-ready never fires, so every render drone stays
    // dormant.
    if ((app.renderer as unknown as { name?: string })?.name === 'canvas') {
      // Probe each context family so the report (console + on-screen note)
      // says exactly WHAT the browser refused — distinguishes "WebGL2 works
      // but the probe was too strict" from "all GPU contexts blocked".
      const diag = (() => {
        try {
          const gl1 = !!document.createElement('canvas').getContext('webgl')
          const gl2 = !!document.createElement('canvas').getContext('webgl2')
          const gpu = !!(navigator as Navigator & { gpu?: unknown }).gpu
          return `webgl1=${gl1} webgl2=${gl2} webgpu=${gpu}`
        } catch { return 'context-probe-threw' }
      })()
      console.error(`[pixi-host] WebGL/WebGPU unavailable (${diag}) — Pixi fell back to the canvas renderer, which cannot draw the mesh-based tile scene. Halting render boot.`)
      this.emitEffect('render:unsupported', { renderer: 'canvas', diag })
      try { app.ticker?.stop() } catch { /* already stopped */ }
      try { app.destroy(true) } catch { /* canvas may not be attached yet */ }
      this.app = null
      this.#showWebglRequired(host, diag)
      return
    }

    app.stage.scale.set(1.8, 1.8)
    app.stage.interactiveChildren = false
    host.appendChild(app.canvas)

    // Mobile: cap at 30fps — the tile shaders are complex and 60fps on a
    // small screen is pure GPU waste, and a direct contributor to the GPU
    // memory pressure behind the repeated-crash error.
    if (isMobile) app.ticker.maxFPS = 30

    // Confirmation marker: proves THIS (post-fix) bee is the one running on the
    // device. If this line is absent from the console, the new bee never
    // reached the phone (stale OPFS / DCP not redeployed), not that the cap
    // failed. Remove once mobile boot is confirmed stable.
    console.log(`[pixi-host] mobile-perf-guard dpr=${dpr} isMobile=${isMobile} maxFPS=${isMobile ? 30 : 'uncapped'}`)

    // Pause the ticker when the tab is hidden — a backgrounded page burning
    // GPU cycles is a leading cause of the iOS GPU-process kill behind
    // Safari's "A problem repeatedly occurred".
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

    // Pixel-perfect centering: read renderer.screen (the canonical canvas
    // size in CSS pixels — same coordinate space stage children render in)
    // and apply `stage = roundedCenter + pan` (see stage-centering.ts).
    // Pan is the participant's offset-from-center and survives every size
    // change untouched; the stage absorbs the full center delta, so
    // content stays centered relative to its current position no matter
    // what size the screen becomes.
    // Fullscreen must not move a PIXEL — and never rezoom. A toggle
    // changes the viewport's physical origin asymmetrically (the top
    // gains the browser chrome, the bottom only the taskbar), so the
    // recenter-by-center-delta policy below would lift content by the
    // asymmetry (~45px on a maximized 1536×695 window → 864 fullscreen:
    // top edge rises 129px, center descends only 84px). Instead, any
    // applyCenter that observes the fullscreenElement flip pins the
    // content's physical screen anchor for the whole transition: the
    // stage absorbs the full origin delta and the resulting
    // offset-from-center is folded into pan (setPan 'auto' — in-memory
    // only, never committed). An exit transition reverses it exactly.
    // The refit path is also skipped for the transition so a saved fit
    // can't rezoom.
    const windowMetrics = (): WindowMetrics => ({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    })
    let lastFullscreen = !!document.fullscreenElement
    let lastOrigin = computeViewportOrigin(windowMetrics())
    let pinnedAnchor: PhysicalAnchor | null = null
    let suppressRefitUntil = 0

    // The PRE-transition origin must be tracked continuously — by the
    // time fullscreenchange/resize fire, the window already has its new
    // geometry. The poll skips while a flip is pending (state differs
    // from lastFullscreen) so the pre-transition value survives until
    // applyCenter consumes it.
    setInterval(() => {
      if (!!document.fullscreenElement === lastFullscreen) {
        lastOrigin = computeViewportOrigin(windowMetrics())
      }
    }, 1000)

    const applyCenter = (): void => {
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      const fullscreenNow = !!document.fullscreenElement
      const originNow = computeViewportOrigin(windowMetrics())

      if (fullscreenNow !== lastFullscreen) {
        lastFullscreen = fullscreenNow
        suppressRefitUntil = performance.now() + 1000
        // capture where the content physically sits, using the
        // pre-transition origin and the not-yet-recentered stage
        pinnedAnchor = computePhysicalAnchor(lastOrigin, app.stage.position)
      }

      if (performance.now() < suppressRefitUntil && pinnedAnchor) {
        // fullscreen transition: hold the anchor still on the physical
        // screen; fold the offset-from-center into pan so the viewport
        // model (stage = center + pan) stays coherent afterwards
        const pinned = computePinnedStage(pinnedAnchor, originNow)
        app.stage.position.set(pinned.x, pinned.y)
        const c = computeStageCenter(app.renderer.screen)
        vp?.setPan?.(pinned.x - c.x, pinned.y - c.y, 'auto')
        lastOrigin = originNow
        return
      }
      pinnedAnchor = null
      lastOrigin = originNow

      const pos = computeStageCenter(app.renderer.screen, vp?.lastPan)
      app.stage.position.set(pos.x, pos.y)

      // If the saved zoom was a fit AND the user hasn't panned away
      // from it, recompute the fit for the new viewport. The fit's
      // saved (cx, cy) was derived from the previous safe area
      // (header + control pill bounding rects + window size); on
      // resize/rotation those change, and applying the stale coords
      // leaves the content shrunk and off-center. Refit against the
      // new viewport produces a clean centered fit.
      // shouldRefit only fires on a KNOWN zero pan — a user pan means
      // they moved away from the fit (refitting would clobber it), and
      // an undefined pan means the VP read may still be in flight
      // (defer to show-cell's #applyViewportFromSnapshot).
      if (shouldRefit(vp?.lastZoom, vp?.lastPan)) {
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
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
    // Fullscreen goes through the same deferred path, but applyCenter
    // detects the fullscreenElement flip and pins the content's
    // physical screen anchor for the transition — no visible movement,
    // no refit/rezoom. (Recentering alone is not enough: the viewport
    // gains more height at the top than the bottom, so splitting the
    // delta evenly lifted content by the asymmetry — about 45px on a
    // maximized window.) F11 browser-chrome fullscreen never flips
    // fullscreenElement and stays on the plain recenter policy.
    document.addEventListener('fullscreenchange', center)

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
