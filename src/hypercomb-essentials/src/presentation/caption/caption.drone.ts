// presentation/caption/caption.drone.ts
//
// The bee that WIRES the caption surface (caption.view.ts): it defines the
// element and adds its tag to the ShellSurfaceRegistry so the shell mounts it
// with the other surfaces. It has no pulse of its own — the caption is driven
// entirely by `caption:show` / `caption:clear`.
//
// The hovered tile no longer speaks here: its name rides on the tile itself,
// just above the icons' top row (tile-name.drone.ts, a raised name). The caption
// keeps what is not a tile's name — an icon's hint, the image wall's words.

import { Drone, EffectBus } from '@hypercomb/core'
import { CAPTION_OWNER, CAPTION_SURFACE, CaptionElement } from './caption.view.js'

export class CaptionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Wires the caption: one quiet line of words, top-centre under the command line, for an icon hint or what is being chosen.'

  protected override listens: string[] = ['caption:show', 'caption:clear']
  protected override emits: string[] = ['caption:show', 'caption:clear']
  protected override sense = (): boolean => false
  protected override heartbeat = async (): Promise<void> => { /* driven by effects, never pulsed */ }
}

const _caption = new CaptionDrone()
window.ioc.register('@diamondcoreprocessor.com/CaptionDrone', _caption)

if (typeof customElements !== 'undefined' && !customElements.get(CAPTION_SURFACE)) {
  customElements.define(CAPTION_SURFACE, CaptionElement)
}

;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    try {
      registry.add({ name: CAPTION_SURFACE, owner: CAPTION_OWNER, element: CAPTION_SURFACE, order: 520 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
