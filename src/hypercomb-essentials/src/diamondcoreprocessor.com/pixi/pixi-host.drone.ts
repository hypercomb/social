// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/pixi-host.drone.ts
// @hypercomb/pixi

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
  public app: Application | null = null
  public host: HTMLDivElement | null = null

  // stable render root for all drones (this is what ZoomDrone scales/translates)
  public container!: Container

  protected override deps = { settings: '@diamondcoreprocessor.com/Settings', axial: '@diamondcoreprocessor.com/AxialService' }
  protected override emits = ['render:host-ready']

  protected override heartbeat = async (): Promise<void> => {
    if (this.app) return

    // axial must be initialized before any drone tries to use index->axial lookups
    // if settings aren't ready yet, just wait for the next heartbeat
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
      autoDensity: true
    })

    app.stage.scale.set(1.8, 1.8)
    host.appendChild(app.canvas)

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
      app.stage.position.set(s.width * 0.5, s.height * 0.5)
    }

    center()
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
