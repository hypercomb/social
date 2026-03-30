// diamondcoreprocessor.com/link/tile-link-action.drone.ts
//
// Registers a link icon ('t') on the tile overlay.
// On click, emits `viewer:open` with a URL (hardcoded for now).

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
}

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class TileLinkActionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'link action icon — opens content viewer for tile links'

  protected override listens = ['render:host-ready', 'tile:action']
  protected override emits = ['overlay:register-action', 'viewer:open']

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

      // TODO: resolve URL from tile properties — hardcoded for testing
      EffectBus.emit('viewer:open', {
        kind: 'youtube',
        url: 'https://www.youtube.com/watch?v=4cuT-LKcmWs',
        label: payload.label,
      })
    })
  }
}

const _tileLinkAction = new TileLinkActionDrone()
window.ioc.register('@diamondcoreprocessor.com/TileLinkActionDrone', _tileLinkAction)
