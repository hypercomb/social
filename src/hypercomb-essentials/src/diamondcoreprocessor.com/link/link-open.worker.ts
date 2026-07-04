// diamondcoreprocessor.com/link/link-open.worker.ts
// Handles the 'open' tile action — reads the tile's link property and
// routes to the photo view (image URLs) or opens in a new tab (other URLs).

import { Worker, EffectBus } from '@hypercomb/core'
import { isImageUrl, fetchImageBlob } from './photo.js'
import { parseYouTubeVideoId } from './youtube.js'
import { readCellProperties, readTilePropertiesAt, cellLocationSig, readTilePropsIndex, lookupTilePropsSig } from '../editor/tile-properties.js'
import type { PhotoView } from './photo.view.js'

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class LinkOpenWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'linking'

  public override description =
    'Handles the default tile open action — routes image links to the photo view, YouTube to the iframe viewer.'

  protected override emits: string[] = ['viewer:open']

  protected override act = async (): Promise<void> => {
    EffectBus.on<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'open') return
      void this.#handleOpen(payload.label)
    })
  }

  async #handleOpen(label: string): Promise<void> {
    const link = await this.#readTileLink(label)
    if (!link) return

    // YouTube → immersive iframe embed (viewer:open), NOT a new tab. This is
    // how link tiles opened before the emit was lost; YoutubeViewerComponent
    // listens for `viewer:open` kind:'youtube' and shows the embed overlay.
    if (parseYouTubeVideoId(link)) {
      EffectBus.emit('viewer:open', { kind: 'youtube', url: link })
      return
    }

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
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[]; explorerDir?: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const parentSegments = lineage?.explorerSegments?.() ?? []

    // Canonical path: tile's layer's `properties` slot.
    try {
      const props = await readTilePropertiesAt(parentSegments, label)
      if (typeof props['link'] === 'string' && (props['link'] as string).length > 0) {
        return props['link'] as string
      }
    } catch { /* fall through */ }

    // Legacy localStorage-keyed properties index (tile-editor save path —
    // separate from the canonical layer slot; kept while that path
    // is migrated to writeTilePropertiesAt).
    try {
      const index = readTilePropsIndex()
      const store = get('@hypercomb.social/Store') as any
      const sig = lookupTilePropsSig(index, await cellLocationSig(parentSegments, label), label)
      if (store && sig) {
        const blob = await store.getResource(sig)
        if (blob) {
          const text = await blob.text()
          const props = JSON.parse(text)
          if (typeof props.link === 'string' && props.link.length > 0) return props.link
        }
      }
    } catch { /* fall through to 0000 */ }

    // Legacy 0000 fallback for pre-migration tiles whose link was
    // written to the phantom <cellDir>/0000 file. Goes away once
    // every writer is on the canonical path and tiles have been
    // swept.
    try {
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
