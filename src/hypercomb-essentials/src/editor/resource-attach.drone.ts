// editor/resource-attach.drone.ts
//
// Listens for `cell:attach-resource` (emitted by the command-line when the
// user presses Enter with an armed resource) and writes the resource
// signatures + link into the cell's content-addressed tile properties.
// Emits `tile:saved` so the renderer picks up the new image/link without
// the user ever opening the tile editor UI.

import { EffectBus, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { isSignature, readOwnTilePropertiesAt, writeTilePropertiesAt } from './tile-properties.js'
import { referenceEditsRootDefaultForLabel, referenceTargetForLabel } from '../commands/decoration-kind-index.js'
import { holdPictures } from '../commands/lightbox-kind.js'
import { wornPictureSig } from '../sharing/tile-image-intake.js'
import { portalEditTarget } from './portal-edit-target.js'

type Store = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

type AttachPayload = {
  cell: string
  largeSig: string
  smallPointSig: string | null
  smallFlatSig: string | null
  url: string | null
  type: 'image' | 'youtube' | 'link' | 'document'
  /** Pin this tile to the first slot. A dropped link lands on TOP, where the
   *  participant is looking, instead of at the tail of the spiral. `index` is
   *  the pinned-layout slot — the same property the layout pass writes. */
  atTop?: boolean
  /** The page the cell was MADE on, when that is not the page stood on — a
   *  tile typed on a holder is made in the group it gathers from
   *  (commands/create-landing.ts), and its picture belongs there. */
  segments?: readonly string[]
  /** The generation record for this picture. Absent on a picture that was
   *  not generated here, which clears any record the tile was wearing. */
  generationSig?: string
}

type YouTubeMetadataQueue = {
  enqueue(input: { segments: readonly string[]; cell: string; url: string }): string
}

export class ResourceAttachDrone {

  constructor() {
    EffectBus.on<AttachPayload>('cell:attach-resource', this.#onAttach)
  }

  #onAttach = (payload: AttachPayload): void => {
    void this.#attach(payload)
  }

  async #attach(payload: AttachPayload): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return

    // Bind the ADDRESS at handler entry, before any await. The attach
    // spans a putResource write; reading lineage at write time used to
    // stamp the image against wherever the user had navigated to in the
    // meantime — a cross-layer content graft.
    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const segments: readonly string[] = payload.segments ?? lineage?.explorerSegments?.() ?? []
    const target = portalEditTarget(
      segments,
      payload.cell,
      // The label index reads the page stood on — it says nothing about a
      // cell made elsewhere.
      !payload.segments && referenceEditsRootDefaultForLabel(payload.cell)
        ? referenceTargetForLabel(payload.cell)
        : null,
    )

    // Build props exactly like the tile editor's saveAndComplete and the
    // substrate service do: one `small.image` per orientation plus the
    // `large.image` + transforms. Never set `substrate: true` — this is
    // a user-provided image, so the reroll affordance must stay hidden.
    const props: Record<string, unknown> = {}

    // The seat belongs to this PAGE, never the canonical default: it is the
    // page's order (history/tile-order.ts), so a Portal may override content
    // at the root without teleporting every use to the Portal row's layout
    // position, and no tile is re-minted to carry where it sits.
    if (payload.atTop) {
      const committer = window.ioc.get<{ commitOrder?: (segments: readonly string[], order: { set: Record<string, number> }) => Promise<string> }>(
        '@diamondcoreprocessor.com/LayerCommitter',
      )
      try { await committer?.commitOrder?.(segments, { set: { [payload.cell]: 0 } }) } catch { /* content can still land */ }
    }

    if (payload.smallPointSig) {
      ;(props as any).small = { image: payload.smallPointSig }
    }
    if (payload.smallFlatSig) {
      if (!(props as any).flat) (props as any).flat = {}
      ;(props as any).flat.small = { image: payload.smallFlatSig }
    }

    // The original, with NO framing: absent framing is the default (centred,
    // covering), which is exactly how the smalls above were captured. The
    // placeholder `{ x: 0, y: 0, scale: 1 }` this used to write reads as the
    // picture at native pixel size — see `readFraming` in crop-math.ts.
    if (payload.largeSig) {
      ;(props as any).large = { image: payload.largeSig }
    }
    // The owner's properties are read FIRST (cold-guarded): the owner's link
    // and generation record win, the armed image only fills what is absent.
    const ownStats = { cold: false }
    const own = await readOwnTilePropertiesAt(target.parentSegments, target.cell, ownStats)
    const ownLink = typeof own['link'] === 'string' ? own['link'] as string : ''
    const ownLarge = (own['large'] as { image?: unknown } | undefined)?.image
    // the link is the owner's unless it is only the previous picture's own resource link
    const linkPinned = Array.isArray(own['propertyPins']) && (own['propertyPins'] as unknown[]).includes('link')
    const linkIsFree = !ownStats.cold && !linkPinned && (
      ownLink === '' || (typeof ownLarge === 'string' && ownLink === `${RESOURCE_URL_PREFIX}${ownLarge}`))
    const hadGeneration = typeof own['generation'] === 'string' && own['generation'] !== ''

    if (payload.type === 'image') {
      const sig = payload.generationSig
      const valid = typeof sig === 'string' && /^[0-9a-f]{64}$/.test(sig)
      if (valid) (props as any).generation = sig
      else if (!ownStats.cold && !hadGeneration) (props as any).generation = undefined
    }

    if (payload.url) {
      // an armed link/youtube drop supplies its own url; it only fills a free link
      if (linkIsFree || ownStats.cold) (props as any).link = payload.url
    } else if (payload.type === 'image' && payload.largeSig && linkIsFree) {
      // (cold: own unknown, so the owner's link is never risked)
      // A dropped image IS the tile's content, so it is also its LINK — the
      // picture at full size is what "open this tile" should mean. That makes
      // the drop flow whole with nothing else to type: clicking a leaf image
      // tile shows the picture, `name@lightbox` turns it (or its container)
      // into a lightbox, and the lightbox view reads exactly this link.
      // Only when the arming flow supplied no url of its own and the tile has
      // no link of its own (a dropped youtube/link arms with one).
      ;(props as any).link = `${RESOURCE_URL_PREFIX}${payload.largeSig}`
    }

    // CANONICAL WRITE — a user-supplied image is creation-time CONTENT, so
    // it must land in the tile's canonical 0000 (the layer's properties
    // slot), not just this browser's label index. Without this the tile is
    // blank on every other device/witness/adopt and the substrate hands it
    // a RANDOM image; with it, everyone sees the exact supplied image.
    // writeTilePropertiesAt merges over existing canonical props (index,
    // viewport, …), commits through the LayerCommitter cascade, and
    // broadcasts cell:0000-changed — which SwarmDrone already listens to,
    // so the swarm republishes with the image inlined automatically.
    //
    // The picture the tile wears now is read FIRST. The write replaces it,
    // and the images button can only offer the previous one if it was kept.
    const previous = payload.type === 'image' && isSignature(payload.largeSig)
      ? await wornPictureSig(target.parentSegments, target.cell)
      : ''
    try {
      // segments bound at handler entry — never re-read after the awaits.
      await writeTilePropertiesAt(target.parentSegments, target.cell, props)
    } catch (err) {
      console.warn('[resource-attach] canonical props write failed', err)
    }

    if (payload.type === 'image' && isSignature(payload.largeSig)) {
      const keep = [previous, payload.largeSig].filter((sig, index, all) =>
        isSignature(sig) && all.indexOf(sig) === index)
      if (keep.length > 0) {
        await holdPictures([...target.parentSegments, target.cell], keep).catch(err => {
          console.warn('[resource-attach] the previous picture could not be kept', err)
        })
      }
    }

    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', {
      cell: target.cell,
      segments: target.parentSegments,
    })

    if (payload.type === 'youtube' && payload.url) {
      window.ioc.get<YouTubeMetadataQueue>('@diamondcoreprocessor.com/YouTubeMetadataQueue')
        ?.enqueue({ segments: target.parentSegments, cell: target.cell, url: payload.url })
    }

    // Release the substrate lock — the cell is now fully described by its props.
    EffectBus.emit('cell:attach-pending', { cell: payload.cell, pending: false })
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/ResourceAttachDrone',
  new ResourceAttachDrone(),
)
