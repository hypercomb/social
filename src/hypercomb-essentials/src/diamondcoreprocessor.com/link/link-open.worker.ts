// diamondcoreprocessor.com/link/link-open.worker.ts
// Handles the 'open' tile action — reads the tile's link property and
// routes to the photo view (image URLs) or opens in a new tab (other URLs).

import { Worker, EffectBus } from '@hypercomb/core'
import { isImageUrl, fetchImageBlob } from './photo.js'
import type { PhotoView } from './photo.view.js'

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class LinkOpenWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'linking'

  public override description =
    'Handles the default tile open action — routes image links to the photo view.'

  protected override emits: string[] = []

  protected override act = async (): Promise<void> => {
    EffectBus.on<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'open') return
      void this.#handleOpen(payload.label)
    })
  }

  async #handleOpen(label: string): Promise<void> {
    const link = await this.#readTileLink(label)
    if (!link) return

    // Image URL → photo view (extension-based or HEAD probe fallback)
    const blob = await fetchImageBlob(link)
    if (blob) {
      this.#photoView?.showBlob(blob)
      return
    }

    // Non-image link → open in new tab
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  async #readTileLink(label: string): Promise<string | null> {
    try {
      // Try content-addressed properties first
      const index: Record<string, string> = JSON.parse(
        localStorage.getItem('hc:tile-props-index') ?? '{}'
      )
      const store = get('@hypercomb.social/Store') as any
      if (!store) return null

      const sig = index[label]
      if (!sig) return null

      const blob = await store.getResource(sig)
      if (!blob) return null

      const text = await blob.text()
      const props = JSON.parse(text)
      return typeof props.link === 'string' ? props.link : null
    } catch {
      return null
    }
  }

  get #photoView(): PhotoView | undefined {
    return get('@diamondcoreprocessor.com/PhotoView') as PhotoView | undefined
  }
}

const _linkOpen = new LinkOpenWorker()
window.ioc.register('@diamondcoreprocessor.com/LinkOpenWorker', _linkOpen)
