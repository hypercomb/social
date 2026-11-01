// comfy-desk/comfy-desk.drone.ts
//
// THE COMFY DESK IS ONE BEHAVIOUR (documentation/comfy-desk.md). This bee names
// the whole and owns no drawing: it contributes the surface and brings the view
// with the first open. The run, the host and the render stay ComfyDrone's, so
// this desk is one reading of them and another desk can replace it.

import { Drone, EffectBus } from '@hypercomb/core'
import { PART_WORDS } from './parts.js'

// The desk arrives with the first open, as the tile editor's does, and the
// element the shell's surface host already made upgrades in place. The tag and
// key are written out because importing even a constant would load the view.
const COMFY_DESK_SURFACE = 'hc-comfy-desk'
const COMFY_DESK_VIEW_KEY = '@diamondcoreprocessor.com/ComfyDeskView'

let viewLoad: Promise<unknown> | null = null

const loadView = (): Promise<unknown> => viewLoad ??= import('./desk/comfy-desk.view.js')
  .then(module => {
    if (!customElements.get(COMFY_DESK_SURFACE)) customElements.define(COMFY_DESK_SURFACE, module.ComfyDeskElement)
  })
  .catch(error => { viewLoad = null; throw error })

export class ComfyDeskDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The ComfyUI desk: one picture in the middle, its recipe labelled around it, and everything made on a shelf.'

  public override readonly traits = PART_WORDS

  protected override sense = (): boolean => false

  constructor() {
    super()
    EffectBus.on<{ open?: boolean }>('comfy:render', payload => {
      if (payload?.open) void loadView()
    })
  }
}

window.ioc.register(COMFY_DESK_VIEW_KEY, { load: loadView })
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: COMFY_DESK_SURFACE, owner: COMFY_DESK_VIEW_KEY, element: COMFY_DESK_SURFACE, order: 157 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

window.ioc.register('@diamondcoreprocessor.com/ComfyDeskDrone', new ComfyDeskDrone())
