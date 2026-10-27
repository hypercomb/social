// presentation/caption/caption.drone.ts
//
// The bee that WIRES the caption surface (caption.view.ts): it defines the
// element and adds its tag to the ShellSurfaceRegistry so the shell mounts it
// with the other surfaces. It has no pulse of its own — the caption is driven
// entirely by `caption:show` / `caption:clear`.
//
// It is also the one place the HOVERED TILE speaks: `tile:hover` carries the
// label under the pointer, and the caption shows it big, top-centre — the name
// the tile used to draw over its own picture. An icon's hint (source
// 'icon-hint') is newer, so it sits over the tile's name while the pointer is
// on the icon and gives it back when it leaves.

import { Drone, EffectBus } from '@hypercomb/core'
import { CAPTION_OWNER, CAPTION_SURFACE, CaptionElement } from './caption.view.js'

const TILE_SOURCE = 'tile'

export class CaptionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Wires the caption: one quiet line of words, top-centre under the command line, for what is hovered or being chosen.'

  protected override listens: string[] = ['caption:show', 'caption:clear', 'tile:hover']
  protected override emits: string[] = ['caption:show', 'caption:clear']
  protected override sense = (): boolean => false
  protected override heartbeat = async (): Promise<void> => { /* driven by effects, never pulsed */ }
}

type ShowCellNames = { displayNameFor?: (label: string) => string }

EffectBus.on<{ label?: string | null }>('tile:hover', (p) => {
  const label = String(p?.label ?? '').trim()
  if (!label) { EffectBus.emit('caption:clear', { source: TILE_SOURCE }); return }
  const names = window.ioc.get<ShowCellNames>('@diamondcoreprocessor.com/ShowCellDrone')
  EffectBus.emit('caption:show', { source: TILE_SOURCE, title: names?.displayNameFor?.(label) ?? label })
})

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
