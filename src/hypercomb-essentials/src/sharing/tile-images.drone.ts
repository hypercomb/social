// sharing/tile-images.drone.ts
//
// The IMAGES icon on the tile — "somebody else here has a picture for this."
//
// Registers one overlay affordance that appears on a tile you HOLD exactly
// when a participant in the room is publishing an image for that same tile,
// and opens the image hive (image-choice.view) when it is clicked. No swarm,
// no peers, or nobody carrying a picture for this tile → no icon, ever: the
// affordance is evidence of an actual choice, not a permanent button.
//
// Held tiles only (`private` = your hive, `public-own` = your tile with the
// mesh open). A peer-only tile is not yours to dress — the verb there is
// `adopt`, which brings the whole tile over with the publisher's picture.

import { Drone } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext } from '../presentation/tiles/tile-overlay.drone.js'
import { hasPeerImages } from './peer-images.js'

// collections — Material Icons Filled. A stack of pictures: several versions
// of one thing, which is exactly what the room is offering.
const IMAGES_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>'

const OWNER = '@diamondcoreprocessor.com/TileImagesDrone'

const hasThemeChoices = (): boolean => {
  try {
    return (window.ioc.get<{ themes?: readonly unknown[] }>(
      '@diamondcoreprocessor.com/BackgroundThemes',
    )?.themes?.length ?? 0) > 0
  } catch { return false }
}

const descriptor = (profile: 'private' | 'public-own'): OverlayActionDescriptor => ({
  name: 'images',
  owner: OWNER,
  svgMarkup: IMAGES_SVG,
  x: -2,
  y: -7,
  hoverTint: 0xa8d8ff,
  profile,
  // The shipped theme library guarantees choices even when this tile has only
  // one assigned image. Remote/live alternatives are the other entrance gate.
  visibleWhen: (ctx: OverlayTileContext) =>
    hasThemeChoices() || hasPeerImages(ctx.label, !ctx.noImage),
  labelKey: 'action.images',
  descriptionKey: 'action.images.description',
})

const ICONS: OverlayActionDescriptor[] = [descriptor('private'), descriptor('public-own')]

type TileActionPayload = { action: string; label: string }

export class TileImagesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description = 'images icon — pick which participant\'s picture this tile wears'

  protected override listens = ['render:host-ready', 'overlay:request-register', 'tile:action']
  protected override emits = ['overlay:register-action', 'images:open']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    // Same handshake as every other icon provider: emit once the overlay
    // exists, and again whenever it asks (idempotent — descriptors are
    // name-keyed, so a repeat is a no-op).
    this.onEffect('render:host-ready', () => this.emitEffect('overlay:register-action', ICONS))
    this.onEffect('overlay:request-register', () => this.emitEffect('overlay:register-action', ICONS))

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload?.action !== 'images') return
      const label = String(payload.label ?? '').trim()
      if (!label) return
      // The tile's PARENT path — the picker addresses the cell the same way
      // every writer does (parent segments + name).
      const segments = window.ioc.get<{ explorerSegments?: () => readonly string[] }>(
        '@hypercomb.social/Lineage',
      )?.explorerSegments?.() ?? []
      this.emitEffect('images:open', { label, segments: [...segments] })
    })
  }
}

const _tileImages = new TileImagesDrone()
window.ioc.register(OWNER, _tileImages)
