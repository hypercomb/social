// @hypercomb/pixi

import { Drone } from '@hypercomb/core'
import { Application, Container } from 'pixi.js'

export class PixiHostDrone extends Drone {

  public app: Application | null = null
  public host: HTMLDivElement | null = null


  // stable render root for all drones
  public container!: Container

  protected override heartbeat = async (): Promise<void> => {
    if (this.app) return

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
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    host.appendChild(app.canvas)

    // -------------------------------------------------
    // center stage (no scaling!)
    // -------------------------------------------------

    const center = (): void => {
      app.stage.position.set(
        app.renderer.width * 0.5,
        app.renderer.height * 0.5
      )
    }
    

    center()
    window.addEventListener('resize', center)

    // -------------------------------------------------
    // root render container
    // -------------------------------------------------

    this.container = new Container()
    app.stage.addChild(this.container)

  }
}
