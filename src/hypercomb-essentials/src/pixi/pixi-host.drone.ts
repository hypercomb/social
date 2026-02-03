// src/hypercomb-drones/pixi/add-pixi.drone.ts

import { Drone } from '@hypercomb/core'
import * as pixi from 'pixi.js'

export class PixiHostDrone extends Drone {

  // -------------------------------------------------
  // capability surface
  // -------------------------------------------------

  public app: pixi.Application | null = null
  public host: HTMLDivElement | null = null
  public container!: pixi.Container
  public pixi = pixi

  // -------------------------------------------------
  // constants
  // -------------------------------------------------

  private readonly hexagonSide = 200

  private get height(): number {
    return this.hexagonSide * 2
  }

  private get width(): number {
    return this.hexagonSide * Math.sqrt(3)
  }

  private get hexagonOffsetX(): number {
    return this.width / 2
  }

  private get hexagonOffsetY(): number {
    return this.height / 2
  }

  // -------------------------------------------------
  // metadata
  // -------------------------------------------------

  public override description =
    'Provides a single PIXI application for rendering drones.'

  public override grammar = [
    { example: 'add pixi' },
    { example: 'pixi' }
  ]

  public override effects = ['render'] as const

  // -------------------------------------------------
  // sense (idempotent)
  // -------------------------------------------------

  protected override sense = (_grammar: string): boolean | Promise<boolean> => {
    return true
  }

  // -------------------------------------------------
  // heartbeat (idempotent)
  // -------------------------------------------------

  protected override heartbeat = async (_grammar: string): Promise<void> => {

    // -------------------------------------------------
    // dom guard
    // -------------------------------------------------

    const existing = document.querySelector('[data-hypercomb-pixi="root"]')
    if (existing) return

    // -------------------------------------------------
    // host element
    // -------------------------------------------------

    const host = this.host = document.createElement('div')
    host.dataset['hypercombPixi'] = 'root'
    host.style.position = 'fixed'
    host.style.left = '0'
    host.style.top = '0'
    host.style.width = '100vw'
    host.style.height = '100vh'
    host.style.zIndex = '9999'
    host.style.pointerEvents = 'none'

    document.body.appendChild(host)

    // -------------------------------------------------
    // pixi app
    // -------------------------------------------------

    const app = this.app = new pixi.Application()

    await app.init({
      resizeTo: window,
      antialias: true,
      backgroundAlpha: 0,

      // 👇 THIS IS THE KEY
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })


    host.appendChild(app.canvas)

    // -------------------------------------------------
    // center stage so (0,0) === screen center
    // -------------------------------------------------

    const centerStage = (): void => {
      app.stage.position.set(
        app.renderer.width / 2,
        app.renderer.height / 2
      )
    }

    centerStage()
    window.addEventListener('resize', centerStage)

    // -------------------------------------------------
    // optional root container (future-proofing)
    // -------------------------------------------------

    this.container = new pixi.Container()
    app.stage.addChild(this.container)

  }
}
