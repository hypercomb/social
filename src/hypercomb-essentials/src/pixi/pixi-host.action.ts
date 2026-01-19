// src/hypercomb-actions/pixi/add-pixi.action.ts

import { Action } from '@hypercomb/core'

export class PixiHostAction extends Action {

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

  protected override run = async (): Promise<void> => {
    const existing = document.querySelector('[data-hypercomb-pixi="root"]')
    if (existing) {
      console.log('[pixi] already mounted')
      return
    }

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

   const pixi = (window as any).__hypercomb_libs__?.pixi


    const app = new pixi.Application()

    await app.init({
      resizeTo: window,
      antialias: true,
      backgroundAlpha: 0
    })

    host.appendChild(app.canvas)

    // quick visual proof it works (a small hex-ish dot)
    const g = new pixi.Graphics()
    g.circle(80, 80, 18)
    g.fill(0xffffff)

    app.stage.addChild(g)

    ;(window as any).__hypercomb_pixi__ = {
      app,
      host
    }

    console.log('[pixi] mounted and stored at window.__hypercomb_pixi__')
  }
}
