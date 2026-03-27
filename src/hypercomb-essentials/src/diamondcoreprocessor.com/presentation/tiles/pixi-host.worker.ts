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

    await app.init({
      resizeTo: window,
      backgroundAlpha: 0,
      resolution: devicePixelRatio || 1,
      autoDensity: true,
      antialias: true,
    })

    app.stage.scale.set(1.8, 1.8)
    app.stage.interactiveChildren = false
    host.appendChild(app.canvas)
    app.canvas.style.pointerEvents = 'auto'
    app.canvas.style.touchAction   = 'none'

    // -------------------------------------------------
    // root render container
    // -------------------------------------------------

    this.container = new Container()
    app.stage.addChild(this.container)

    // -------------------------------------------------
    // center stage (no scaling!) + keep coordinates in renderer.screen units
    // -------------------------------------------------

    const center = (): void => {
      const s = app.renderer.screen
      const cx = s.width * 0.5
      const cy = s.height * 0.5
      const vp = (window as any).ioc?.get('@diamondcoreprocessor.com/ViewportPersistence')
      const pan = vp?.lastPan
      app.stage.position.set(cx + (pan?.dx ?? 0), cy + (pan?.dy ?? 0))
    }

    center()
    // synchronous: Pixi's ResizeObserver updates renderer.screen before the resize event fires
    window.addEventListener('resize', center)

    // -------------------------------------------------
    // broadcast pixi resources to other drones via effect bus
    // -------------------------------------------------

    this.emitEffect<HostReadyPayload>('render:host-ready', {
      app: this.app,
      container: this.container,
      canvas: this.app.canvas as HTMLCanvasElement,
      renderer: this.app.renderer,
    })
  }
}

const _pixiHost = new PixiHostWorker()
window.ioc.register('@diamondcoreprocessor.com/PixiHostWorker', _pixiHost)
