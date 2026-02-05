// src/pixi/pixi-host.drone.ts
import { Drone, has, register } from '@hypercomb/core'
import * as pixi from 'pixi.js'

const HOST_SIGNATURE =
  'ddd2317a1089b8b067a2d1f1e48c0ddcc3f8a9fe49333e1a8a868c9f69e39a31'

export class PixiHostDrone extends Drone {

  public app: pixi.Application | null = null
  public host: HTMLDivElement | null = null

  // stable render root for all drones
  public container!: pixi.Container

  // expose pixi namespace intentionally
  public pixi = pixi

  protected override sense = (): boolean => {
    if (!has(HOST_SIGNATURE)) {
      register(HOST_SIGNATURE, this, 'pixi-host')
    }
    return true
  }

  protected override heartbeat = async (): Promise<void> => {
    if (this.app) return

    // -------------------------------------------------
    // dom root (single, inert)
    // -------------------------------------------------

    const host = this.host = document.createElement('div')
    host.dataset['hypercombPixi'] = 'root'
    host.style.position = 'fixed'
    host.style.inset = '0'
    host.style.pointerEvents = 'none'
    document.body.appendChild(host)

    // -------------------------------------------------
    // pixi app
    // -------------------------------------------------

    const app = this.app = new pixi.Application()

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

    this.container = new pixi.Container()
    app.stage.addChild(this.container)

        const g = new pixi.Graphics()
    g.circle(0, 0, 18)
    g.fill('red')

    // drawn at (0,0) → exact screen center
    this.container.addChild(g)
  }
}
