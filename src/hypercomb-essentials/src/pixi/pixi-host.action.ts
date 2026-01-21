// src/hypercomb-actions/pixi/add-pixi.action.ts

import { Action } from '@hypercomb/core'

export class PixiHostAction extends Action {

  // -------------------------------------------------
  // constants (pure, safe)
  // -------------------------------------------------

  public readonly hexagonSide = 200

  public get height(): number {
    return this.hexagonSide * 2
  }

  public get width(): number {
    return this.hexagonSide * Math.sqrt(3)
  }

  public get hexagonOffsetX(): number {
    return this.width / 2
  }

  public get hexagonOffsetY(): number {
    return this.height / 2
  }

  // -------------------------------------------------
  // metadata
  // -------------------------------------------------

  public description =
    'Adds a PIXI canvas to the page (single global instance) so future actions can draw to it.'

  public grammar = [
    { example: 'add pixi' },
    { example: 'pixi' }
  ]

  public effects = ['memory', 'render'] as const

  public links = [
    {
      label: 'PixiJS docs',
      url: 'https://pixijs.com/',
      trust: 'official',
      purpose: 'PIXI renderer docs and examples'
    } as const
  ]

  // -------------------------------------------------
  // runtime
  // -------------------------------------------------

  protected override run = async (): Promise<void> => {
    // -------------------------------------------------
    // hard runtime guard (Node / build safety)
    // -------------------------------------------------
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }

    // -------------------------------------------------
    // already mounted?
    // -------------------------------------------------
    const existing = document.querySelector('[data-hypercomb-pixi="root"]')
    if (existing) {
      console.log('[pixi] already mounted')
      return
    }

    // -------------------------------------------------
    // pixi availability
    // -------------------------------------------------
    const pixi = (window as any).__hypercomb_libs__?.pixi
    if (!pixi) {
      console.warn('[pixi] pixi library not available')
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
    const app = new pixi.Application()

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

    // -------------------------------------------------
    // temporary global (migration seam for IoC later)
    // -------------------------------------------------
    ;(window as any).__hypercomb_pixi__ = {
      app,
      host
    }

    console.log('[pixi] mounted')
  }
}
