// diamondcoreprocessor.com/link/reference-action.drone.ts
//
// Registers the REFERENCE glyph on the tile overlay. A reference tile is a
// live pointer to another lineage (a `reference` decoration carrying
// `{ targetSegments }`); the glyph marks it, and clicking either the glyph
// or the tile body portals to the target. The body-click portal lives in
// tile-overlay (#navigateInto); this drone owns the visual affordance and
// the glyph-click, mirroring TileLinkActionDrone.

import { Drone } from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'
import { hasDecorationKind, referenceTargetForLabel, REFERENCE_DECORATION_KIND } from '../commands/decoration-kind-index.js'

// A doorway/portal arrow — leave-through-a-frame. Steel-friendly stroke.
const REFERENCE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="14 7 19 12 14 17"/><line x1="19" y1="12" x2="9" y2="12"/></svg>'

const REFERENCE_OWNER = '@diamondcoreprocessor.com/ReferenceActionDrone'

const REFERENCE_ICON: OverlayActionDescriptor = {
  name: 'reference-open',
  owner: REFERENCE_OWNER,
  svgMarkup: REFERENCE_SVG,
  x: -2,
  y: -7,
  hoverTint: 0x7eb6d6, // chrome steel
  profile: 'private',
  visibleWhen: (ctx) => hasDecorationKind(ctx.label, REFERENCE_DECORATION_KIND),
  labelKey: 'action.reference',
  descriptionKey: 'action.reference.description',
}

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class ReferenceActionDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'linking'
  override description = 'reference glyph — portals a reference tile to the lineage it points at'

  protected override listens = ['render:host-ready', 'overlay:request-register', 'tile:action']
  protected override emits = ['overlay:register-action']

  #registered = false
  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect('render:host-ready', () => {
      if (this.#registered) return
      this.#registered = true
      this.emitEffect('overlay:register-action', REFERENCE_ICON)
    })

    // Re-emit on the overlay's registration handshake (name-keyed + idempotent).
    this.onEffect('overlay:request-register', () => {
      this.#registered = true
      this.emitEffect('overlay:register-action', REFERENCE_ICON)
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'reference-open') return
      const target = referenceTargetForLabel(payload.label)
      if (target === null) return
      const nav = window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      nav?.goRaw?.([...target])
    })
  }
}

const _referenceAction = new ReferenceActionDrone()
window.ioc.register('@diamondcoreprocessor.com/ReferenceActionDrone', _referenceAction)
