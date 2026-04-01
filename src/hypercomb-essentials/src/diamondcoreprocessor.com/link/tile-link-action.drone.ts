// diamondcoreprocessor.com/link/tile-link-action.drone.ts
//
// Registers a link icon on the tile overlay.
// Only visible when a tile has both a link and children — leaf tiles with
// links are opened directly by clicking the tile itself.

import { Drone, EffectBus } from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'

const LINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'

const LINK_ICON: OverlayActionDescriptor = {
  name: 'link',
  svgMarkup: LINK_SVG,
  x: -2,
  y: -7,
  hoverTint: 0xa8d8ff,
  profile: 'private',
  visibleWhen: (ctx) => ctx.isBranch && ctx.hasLink,
}

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileLinkActionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'link action icon — opens content viewer for tile links'

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action']

  #registered = false
  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', LINK_ICON)
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'link') return

      // Re-emit as 'open' — LinkOpenWorker reads the link from tile properties
      // and routes to the photo viewer or opens in a new tab
      EffectBus.emit('tile:action', {
        action: 'open',
        label: payload.label,
        q: payload.q,
        r: payload.r,
        index: payload.index,
      })
    })
  }
}

const _tileLinkAction = new TileLinkActionDrone()
window.ioc.register('@diamondcoreprocessor.com/TileLinkActionDrone', _tileLinkAction)
