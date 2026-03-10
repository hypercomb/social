// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
// Orchestrator: wires tile:action effect → editor open/save/cancel.
// Properties stored as content-addressed resources in __resources__/.
// NOT a Drone subclass — follows the HistoryRecorder pattern.

import { EffectBus, hypercomb, computeLineageSig } from '@hypercomb/core'
import { PROPERTIES_FILE } from './tile-properties.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

type TileActionPayload = {
  action: string
  label: string
  q: number
  r: number
  index: number
}

type Store = {
  resources: FileSystemDirectoryHandle
  liveCache: ReadonlyMap<string, any>
  getLayer(lineageSig: string): any | null
  getListResource(listSig: string): Promise<string[]>
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

type Settings = {
  width: number
  height: number
}

export class TileEditorDrone {

  constructor() {
    EffectBus.on<TileActionPayload>('tile:action', this.#onTileAction)
  }

  // ── effect handler ─────────────────────────────────────────────

  #onTileAction = (payload: TileActionPayload): void => {
    if (payload.action !== 'edit') return
    void this.#openEditing(payload.label)
  }

  // ── open editor ────────────────────────────────────────────────

  async #openEditing(seed: string): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!store || !service) return

    // 1. resolve child layer from live cache
    const lineage = window.ioc.get<any>('@hypercomb.social/Lineage')
    const segments: string[] = lineage?.explorerSegments?.() ?? []
    const childLineageSig = await computeLineageSig([...segments, seed])
    const childLayer = store.getLayer(childLineageSig)

    if (!childLayer) {
      service.open(seed, {}, null)
      return
    }

    // 2. read properties from resources (first valid JSON object)
    let properties: Record<string, unknown> = {}
    const resourceSigs = await store.getListResource(childLayer.resources)
    for (const sig of resourceSigs) {
      const blob = await store.getResource(sig)
      if (!blob) continue
      try {
        const text = await blob.text()
        const parsed = JSON.parse(text)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          properties = parsed
          break
        }
      } catch { continue }
    }

    // 3. load large image blob from __resources__ (if present)
    let largeBlob: Blob | null = null
    const largeSig = (properties as any).large?.image
    if (largeSig && typeof largeSig === 'string') {
      largeBlob = await store.getResource(largeSig)
    }

    // 4. open editor service
    service.open(seed, properties, largeBlob)
  }

  // ── save (called by Angular component) ─────────────────────────

  readonly saveAndComplete = async (): Promise<void> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const settings = window.ioc.get<Settings>('@diamondcoreprocessor.com/Settings')

    if (!store || !service || !imageEditor || !settings) return
    if (service.mode !== 'editing') return

    const props: Record<string, unknown> = { ...service.properties }

    // 1. capture small image (if image loaded)
    if (imageEditor.hasImage) {
      const smallBlob = await imageEditor.captureSmall(settings.width, settings.height)
      const smallSig = await store.putResource(smallBlob)
      ;(props as any).small = { image: smallSig }

      // 2. store large image blob
      if (service.largeBlob) {
        const largeSig = await store.putResource(service.largeBlob)
        const transform = imageEditor.getTransform()
        ;(props as any).large = {
          image: largeSig,
          x: transform.x,
          y: transform.y,
          scale: transform.scale,
        }
      }
    }

    // 3. preserve link + border.color from service
    // (already in props via service.properties — setLink/setBorderColor mutate in-place)

    // 4. store properties as content-addressed resource
    const propsBlob = new Blob([JSON.stringify(props, null, 2)], { type: 'application/json' })
    const propsSig = await store.putResource(propsBlob)

    // 5. update child layer's resources list via HistoryService
    const historyService = window.ioc.get<any>('@diamondcoreprocessor.com/HistoryService')
    if (historyService) {
      const lineage = window.ioc.get<any>('@hypercomb.social/Lineage')
      const segments: string[] = lineage?.explorerSegments?.() ?? []
      await historyService.addResource([...segments, service.seed], propsSig)
    }

    // 6. cleanup
    imageEditor.destroy()
    service.close()

    // 7. trigger processor → synchronize
    await new hypercomb().act()
  }

  // ── cancel ─────────────────────────────────────────────────────

  readonly cancelEditing = (): void => {
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    imageEditor?.destroy()
    service?.close()
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorDrone',
  new TileEditorDrone(),
)
