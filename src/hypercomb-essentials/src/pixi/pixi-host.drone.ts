// src/hypercomb-drones/pixi/add-pixi.drone.ts

import { Drone, has } from '@hypercomb/core'
import * as pixi from 'pixi.js'
import type { Application, Container } from 'pixi.js'

export class PixiHostDrone extends Drone {

  // -------------------------------------------------
  // capability surface
  // -------------------------------------------------

  public app: Application | null = null
  public host: HTMLDivElement | null = null
  public container!: Container
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

  public description =
    'Provides a single PIXI application for rendering drones.'

  public grammar = [
    { example: 'add pixi' },
    { example: 'pixi' }
  ]

  public effects = ['render'] as const


  // -------------------------------------------------
  // sense (idempotent)
  // -------------------------------------------------

  protected override sense = (_grammar: string): boolean | Promise<boolean> => {
    // already registered → nothing to do
    if (has(this.name)) return false

    // not registered yet → run heartbeat
    return true
  }

  // -------------------------------------------------
  // heartbeat (idempotent)
  // -------------------------------------------------

  protected override heartbeat = async (_grammar: string): Promise<void> => {
    // -------------------------------------------------
    // already registered?
    // -------------------------------------------------
    if (has(this.name)) {
      return
    }

    // -------------------------------------------------
    // already mounted? (dom guard, avoids double hosts)
    // -------------------------------------------------
    const existing = document.querySelector('[data-hypercomb-pixi="root"]')
    if (existing) {
      return
    }

    // -------------------------------------------------
    // host element
    // -------------------------------------------------
    const host = document.createElement('div')
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
      backgroundAlpha: 0
    })

    host.appendChild(app.canvas)

    // -------------------------------------------------
    // center stage (pure math)
    // -------------------------------------------------
    const centerX =
      window.innerWidth / 2 - this.hexagonOffsetX

    const centerY =
      window.innerHeight / 2 - this.hexagonOffsetY

    app.stage.position.set(centerX, centerY)

    // -------------------------------------------------
    // visual proof
    // -------------------------------------------------
    const g = new pixi.Graphics() 
    g.circle(0, 0, 18)
    g.fill(0xffffff)

    app.stage.addChild(g)
  }
}
