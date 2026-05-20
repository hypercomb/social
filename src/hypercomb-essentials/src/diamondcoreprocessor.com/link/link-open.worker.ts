// diamondcoreprocessor.com/link/link-open.worker.ts
// Handles the 'open' tile action — reads the tile's link property and
// routes to the photo view (image URLs) or opens in a new tab (other URLs).

import { Worker, EffectBus } from '@hypercomb/core'
import { isImageUrl, fetchImageBlob } from './photo.js'
import { readCellProperties } from '../editor/tile-properties.js'
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
    // Try content-addressed properties first (tile-editor save path).
    try {
      const index: Record<string, string> = JSON.parse(
        localStorage.getItem('hc:tile-props-index') ?? '{}'
      )
      const store = get('@hypercomb.social/Store') as any
      const sig = index[label]
      if (store && sig) {
        const blob = await store.getResource(sig)
        if (blob) {
          const text = await blob.text()
          const props = JSON.parse(text)
          if (typeof props.link === 'string' && props.link.length > 0) return props.link
        }
      }
    } catch { /* fall through to 0000 fallback */ }

    // Fallback: read the cell's 0000 file at the current navigation level.
    // The label-keyed index is path-blind and the headless bridge `stamp` op
    // (dashboard refresh) writes only to 0000 — without this fallback,
    // bridge-stamped links would never resolve and the open action would
    // silently no-op even though the link badge renders.
    try {
      const lineage = get('@hypercomb.social/Lineage') as { explorerDir?: () => Promise<FileSystemDirectoryHandle | null> } | undefined
      const dir = await lineage?.explorerDir?.()
      if (!dir) return null
      const cellDir = await dir.getDirectoryHandle(label, { create: false })
      const props = await readCellProperties(cellDir)
      return typeof (props as { link?: unknown }).link === 'string' ? (props as { link: string }).link : null
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
