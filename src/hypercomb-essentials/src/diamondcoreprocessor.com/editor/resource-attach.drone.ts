// diamondcoreprocessor.com/editor/resource-attach.drone.ts
//
// Listens for `cell:attach-resource` (emitted by the command-line when the
// user presses Enter with an armed resource) and writes the resource
// signatures + link into the cell's content-addressed tile properties.
// Emits `tile:saved` so the renderer picks up the new image/link without
// the user ever opening the tile editor UI.

import { EffectBus } from '@hypercomb/core'
import { writeTilePropertiesAt, cellLocationSig, readTilePropsIndex, writeTilePropsIndex } from './tile-properties.js'

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

    // Build props exactly like the tile editor's saveAndComplete and the
    // substrate service do: one `small.image` per orientation plus the
    // `large.image` + transforms. Never set `substrate: true` — this is
    // a user-provided image, so the reroll affordance must stay hidden.
    const props: Record<string, unknown> = {}

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
    }

    // persist as content-addressed resource + update cell → props-sig index
    const json = JSON.stringify(props, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const propsSig = await store.putResource(blob)

    // Keyed by full lineage so a same-named tile at another hive location
    // can never collide. segments bound at handler entry.
    const indexCellKey = await cellLocationSig(segments, payload.cell)
    const index = readTilePropsIndex()
    index[indexCellKey || payload.cell] = propsSig
    writeTilePropsIndex(index)

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
      await writeTilePropertiesAt(segments, payload.cell, props)
    } catch (err) {
      console.warn('[resource-attach] canonical props write failed', err)
    }

    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', { cell: payload.cell, segments })

    // Release the substrate lock — the cell is now fully described by its props.
    EffectBus.emit('cell:attach-pending', { cell: payload.cell, pending: false })
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/ResourceAttachDrone',
  new ResourceAttachDrone(),
)
