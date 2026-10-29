// sharing/tile-images.drone.ts
//
// The IMAGES icon on the tile — "this tile can wear another picture."
//
// One overlay affordance that appears on a tile you HOLD when there is a
// picture it is not already wearing: one it holds (a paste while the pointer
// rests on the tile), one a domain publishes for the name, or one another
// participant in the swarm is showing for that same name. The picture the
// tile already wears, alone, is no choice, so no icon. The icon opens the
// images wall when it is clicked.
//
// Held tiles only (`private` = your hive, `public-own` = your tile with the
// mesh open). A peer-only tile is not yours to dress — the verb there is
// `adopt`, which brings the whole tile over with the publisher's picture.

import { Drone, EffectBus } from '@hypercomb/core'
import type { OverlayActionDescriptor, OverlayTileContext } from '../presentation/tiles/tile-overlay.drone.js'
import { galleryImageSigsAt } from '../commands/lightbox-kind.js'
import { imagesButtonVisible, offeredPictureCount } from './image-collection.js'
import { offeredPictures } from './image-updates.js'
import { peerImageCandidates } from './peer-images.js'
import { wornPictureSig } from './tile-image-intake.js'

// collections — Material Icons Filled. A stack of pictures: several versions
// of one thing, which is exactly what the room is offering.
const IMAGES_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z"/></svg>'

const OWNER = '@diamondcoreprocessor.com/TileImagesDrone'

const lineageSegments = (): readonly string[] =>
  window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    ?.explorerSegments?.() ?? []

// Visibility is asked synchronously, the collection is read asynchronously: a
// tile's count is fetched the first time it is asked about. The answer emits
// `images:recounted` so the button can appear without another hover. A save
// clears the entry so the icon follows the collection.
const heldCounts = new Map<string, number>()
const pending = new Set<string>()
const heldSigs = new Map<string, ReadonlySet<string>>()
const wornSigs = new Map<string, string>()
const generation = new Map<string, number>()
const keyOf = (segments: readonly string[], label: string): string => [...segments, label].join('/')

/** Ask again once the count has landed. The first hover starts the read and
 *  answers "no" until it does; the recount is what puts the button up without
 *  waiting for the pointer to move. */
const recount = (key: string, sigs: readonly string[], worn: string): void => {
  heldCounts.set(key, sigs.length)
  heldSigs.set(key, new Set(sigs))
  wornSigs.set(key, worn)
}

/** Drop a cached count. A read already in flight must not write the old
 *  answer back over the drop that just landed. */
const forget = (key: string): void => {
  heldCounts.delete(key)
  heldSigs.delete(key)
  wornSigs.delete(key)
  pending.delete(key)
  generation.set(key, (generation.get(key) ?? 0) + 1)
}

/** True when the images button should be on this tile. */
const offerChoice = (label: string): boolean => {
  const segments = lineageSegments()
  const key = keyOf(segments, label)
  const known = heldCounts.get(key)
  if (known === undefined && !pending.has(key)) {
    pending.add(key)
    const parent = [...segments]
    const gen = generation.get(key) ?? 0
    void Promise.all([
      galleryImageSigsAt([...parent, label]),
      wornPictureSig(parent, label),
    ])
      .then(([sigs, worn]) => { if ((generation.get(key) ?? 0) === gen) recount(key, sigs, worn) })
      .catch(() => { if ((generation.get(key) ?? 0) === gen) recount(key, [], '') })
      .finally(() => {
        if ((generation.get(key) ?? 0) !== gen) return
        pending.delete(key)
        EffectBus.emit('images:recounted', {})
      })
  }
  const held = heldSigs.get(key)
  const worn = wornSigs.get(key) ?? ''
  const offered = [
    ...offeredPictures(label),
    ...peerImageCandidates(label).map(candidate => candidate.previewSig),
  ]
  return imagesButtonVisible({
    held: [...(held ?? [])],
    worn,
    extra: offeredPictureCount(worn, held, offered),
  })
}

const descriptor = (profile: 'private' | 'public-own'): OverlayActionDescriptor => ({
  name: 'images',
  owner: OWNER,
  svgMarkup: IMAGES_SVG,
  x: -2,
  y: -7,
  hoverTint: 0xa8d8ff,
  profile,
  visibleWhen: (ctx: OverlayTileContext) => offerChoice(ctx.label),
  labelKey: 'action.images',
  descriptionKey: 'action.images.description',
})

const ICONS: OverlayActionDescriptor[] = [descriptor('private'), descriptor('public-own')]

type TileActionPayload = { action: string; label: string }

export class TileImagesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description = 'images icon — pick which participant\'s picture this tile wears'

  protected override listens = ['render:host-ready', 'overlay:request-register', 'tile:action', 'tile:saved']
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

    this.onEffect<{ cell?: string; segments?: readonly string[] }>('tile:saved', (payload) => {
      if (payload?.cell) {
        forget(keyOf(payload.segments ?? [], payload.cell))
      }
    })

    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload?.action !== 'images') return
      const label = String(payload.label ?? '').trim()
      if (!label) return
      // The tile's PARENT path — the wall addresses the cell the same way
      // every writer does (parent segments + name).
      this.emitEffect('images:open', { label, segments: [...lineageSegments()] })
    })
  }
}

const _tileImages = new TileImagesDrone()
window.ioc.register(OWNER, _tileImages)
