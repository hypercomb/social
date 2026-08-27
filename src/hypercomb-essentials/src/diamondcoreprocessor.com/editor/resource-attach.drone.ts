// diamondcoreprocessor.com/editor/resource-attach.drone.ts
//
// Listens for `cell:attach-resource` (emitted by the command-line when the
// user presses Enter with an armed resource) and writes the resource
// signatures + link into the cell's content-addressed tile properties.
// Emits `tile:saved` so the renderer picks up the new image/link without
// the user ever opening the tile editor UI.

import { EffectBus, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { writeTilePropertiesAt } from './tile-properties.js'
import { referenceEditsRootDefaultForLabel, referenceTargetForLabel } from '../commands/decoration-kind-index.js'
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
    const segments: readonly string[] = lineage?.explorerSegments?.() ?? []
    const target = portalEditTarget(
      segments,
      payload.cell,
      referenceEditsRootDefaultForLabel(payload.cell)
        ? referenceTargetForLabel(payload.cell)
        : null,
    )

    // Build props exactly like the tile editor's saveAndComplete and the
    // substrate service do: one `small.image` per orientation plus the
    // `large.image` + transforms. Never set `substrate: true` — this is
    // a user-provided image, so the reroll affordance must stay hidden.
    const props: Record<string, unknown> = {}

    // Slot index belongs to this appearance, never the canonical default. A
    // Portal may override content at the root without teleporting every use to
    // the Portal row's layout position.
    if (payload.atTop && target.throughPortal) {
      try { await writeTilePropertiesAt(segments, payload.cell, { index: 0 }) } catch { /* content can still land */ }
    } else if (payload.atTop) {
      props['index'] = 0
    }

    if (payload.smallPointSig) {
      ;(props as any).small = { image: payload.smallPointSig }
    }
    if (payload.smallFlatSig) {
      if (!(props as any).flat) (props as any).flat = {}
      ;(props as any).flat.small = { image: payload.smallFlatSig }
    }

    if (payload.largeSig) {
      ;(props as any).large = {
        image: payload.largeSig,
        x: 0,
        y: 0,
        scale: 1,
      }
      if (!(props as any).flat) (props as any).flat = {}
      ;(props as any).flat.large = { x: 0, y: 0, scale: 1 }
    }

    if (payload.url) {
      ;(props as any).link = payload.url
    } else if (payload.type === 'image' && payload.largeSig) {
      // A dropped image IS the tile's content, so it is also its LINK — the
      // picture at full size is what "open this tile" should mean. That makes
      // the drop flow whole with nothing else to type: clicking a leaf image
      // tile shows the picture, `name@lightbox` turns it (or its container)
      // into a lightbox, and the lightbox view reads exactly this link.
      // Only when the arming flow supplied no url of its own (a dropped
      // youtube/link arms with one and keeps it).
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
    try {
      // segments bound at handler entry — never re-read after the awaits.
      await writeTilePropertiesAt(target.parentSegments, target.cell, props)
    } catch (err) {
      console.warn('[resource-attach] canonical props write failed', err)
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
