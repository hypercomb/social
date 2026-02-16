// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/pixi-host.drone.ts
// @hypercomb/pixi

import { Drone } from '@hypercomb/core'
import { Application, Container } from 'pixi.js'

export class PixiHostDrone extends Drone {
  public app: Application | null = null
  public host: HTMLDivElement | null = null

  // stable render root for all drones (this is what ZoomDrone scales/translates)
  public container!: Container

  protected override heartbeat = async (): Promise<void> => {
    if (this.app) return

    const { get, register, list } = window.ioc

    // axial must be initialized before any drone tries to use index->axial lookups
    // if settings aren't ready yet, just wait for the next heartbeat
    const settings = get('Settings') as any
    if (!settings) return

    const axial = get('AxialService') as any
    if (axial?.initialize) axial.initialize(settings)

    // -------------------------------------------------
    // dom root (single, inert)
    // -------------------------------------------------

    const host = this.host = document.getElementById('pixi-host') as HTMLDivElement
    host.dataset['hypercombPixi'] = 'root'
    host.style.position = 'fixed'
    host.style.inset = '0'
    host.style.zIndex = '489989'
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
  }
}

window.ioc.register('PixiHost', new PixiHostDrone())
