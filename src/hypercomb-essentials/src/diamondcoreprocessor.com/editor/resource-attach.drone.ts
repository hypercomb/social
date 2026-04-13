// diamondcoreprocessor.com/editor/resource-attach.drone.ts
//
// Listens for `cell:attach-resource` (emitted by the command-line when the
// user presses Enter with an armed resource) and writes the resource
// signatures + link into the cell's content-addressed tile properties.
// Emits `tile:saved` so the renderer picks up the new image/link without
// the user ever opening the tile editor UI.

import { EffectBus } from '@hypercomb/core'

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

const PROPS_INDEX_KEY = 'hc:tile-props-index'

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

    const index: Record<string, string> = JSON.parse(localStorage.getItem(PROPS_INDEX_KEY) ?? '{}')
    index[payload.cell] = propsSig
    localStorage.setItem(PROPS_INDEX_KEY, JSON.stringify(index))

    EffectBus.emit<{ cell: string }>('tile:saved', { cell: payload.cell })

    // Release the substrate lock — the cell is now fully described by its props.
    EffectBus.emit('cell:attach-pending', { cell: payload.cell, pending: false })
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/ResourceAttachDrone',
  new ResourceAttachDrone(),
)
