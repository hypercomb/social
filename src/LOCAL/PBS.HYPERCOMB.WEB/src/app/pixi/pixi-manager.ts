import { Injectable, Injector, computed, effect, inject, signal } from '@angular/core'
import { Application, Container, Point, WebGLRenderer } from 'pixi.js'
import { Settings } from '../core/settings'
import { AxialService } from '../services/axial-service'
import { ScreenService } from '../services/screen-service'
import { DebugService } from '../core/diagnostics/debug-service'
import { ACTION_REGISTRY } from '../shared/tokens/i-hypercomb.token'
import { BackHiveAction } from '../actions/navigation/back.action'

// global singleton for HMR
type GlobalPixi = {
  __PIXI_APP__?: Application
  __PIXI_INIT__?: Promise<Application>
  __PIXI_CONTAINER__?: Container
}
const g = globalThis as unknown as GlobalPixi

@Injectable({ providedIn: 'root' })
export class PixiManager {

  public readonly injector = inject(Injector)
  private readonly axials = inject(AxialService)
  private readonly screen = inject(ScreenService)
  private readonly settings = inject(Settings)

  private _app: Application =
    g.__PIXI_APP__ ?? (g.__PIXI_APP__ = new Application())

  private _container: Container =
    g.__PIXI_CONTAINER__ ?? (g.__PIXI_CONTAINER__ = new Container())

  private _initPromise?: Promise<Application>

  private readonly _ready = signal<Application | null>(null)
  public readonly ready = this._ready.asReadonly()

  public get container(): Container {
    return this._container
  }

  public readonly canvas = computed<HTMLCanvasElement | null>(() => {
    const app = this._ready()
    return app ? (this._app.canvas as HTMLCanvasElement) : null
  })

  public readonly rendererSig = computed<WebGLRenderer | null>(() => {
    const app = this._ready()
    return app ? (this._app.renderer as WebGLRenderer) : null
  })

  public get renderer(): WebGLRenderer {
    const r = this.rendererSig()
    if (!r) throw new Error('pixi renderer not initialized yet')
    return r
  }

  public get app(): Application {
    return this._app
  }

  constructor() {
    // keep stage centered on resize
    effect(() => {
      const size = this.screen.windowSize()
      if (this._ready()) this.setStageCenter()
    })

    DebugService.expose('container', this.container)
  }

  // -------------------------------------------------------------
  // initialize PIXI application (runs once)
  // -------------------------------------------------------------
  public initialize = async (host: HTMLElement = document.body): Promise<Application> => {
    if (this._initPromise) return this._initPromise

    this._initPromise = (async () => {

      // pixi init
      if (!(this._app as any).renderer) {
        await this._app.init({
          resizeTo: window,
          antialias: false,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        })
      }

      // ensure stage → container hookup
      if (!this._container.parent) {
        this._app.stage.addChild(this._container)
      }

      // stage positioning
      this.setStageCenter()

      // attach canvas once
      const canvas = this._app.canvas as HTMLCanvasElement
      if (!canvas.isConnected) {
        canvas.style.touchAction = 'none'
        canvas.style.userSelect = 'none'
        host.appendChild(canvas)
      }

      // mark ready
      this._ready.set(this._app)

      // -------------------------------------------------------------------
      // GLOBAL RIGHT-CLICK HANDLER (container-level back navigation)
      // -------------------------------------------------------------------
      const registry = this.injector.get(ACTION_REGISTRY)

      this._container.eventMode = "dynamic"

      this._container.on("rightclick", (evt: PointerEvent) => {
        registry.invoke(BackHiveAction.ActionId, {
          kind: "cell",
          event: evt
        })
      })

      // -------------------------------------------------------------------

      return this._app
    })()

    ; (window as any).app = this._app // debug hook
    return this._initPromise
  }

  // wait until ready
  public whenReady = async (): Promise<Application> => {
    if (this._ready()) return this._ready()!
    return this.initialize()
  }

  // -------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------
  public getOffset(index: number): Point {
    const coord = this.axials.items.get(index)
    if (!coord?.Location) return new Point(0, 0)
    const { x, y } = coord.Location
    return new Point(x, y)
  }

  private setStageCenter() {
    this._app.stage.position.set(
      this.screen.windowWidth() / 2 - this.settings.hexagonOffsetX,
      this.screen.windowHeight() / 2 - this.settings.hexagonOffsetY
    )
  }
}
