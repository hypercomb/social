// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
// Orchestrator: wires tile:action effect → editor open/save/cancel.
// Manages OPFS I/O for 0000 properties file and resource storage.
// NOT a Drone subclass — follows the HistoryRecorder pattern.

import { EffectBus, get } from '@hypercomb/core'
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
  current: FileSystemDirectoryHandle
  resources: FileSystemDirectoryHandle
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
    const store = get<Store>('@hypercomb.social/Store')
    const service = get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!store || !service) return

    // 1. resolve seed directory
    let seedDir: FileSystemDirectoryHandle
    try {
      seedDir = await store.current.getDirectoryHandle(seed)
    } catch {
      // seed directory doesn't exist yet — open with empty properties
      service.open(seed, {}, null)
      return
    }

    // 2. read 0000 properties file
    let properties: Record<string, unknown> = {}
    try {
      const fileHandle = await seedDir.getFileHandle(PROPERTIES_FILE)
      const file = await fileHandle.getFile()
      const text = await file.text()
      properties = JSON.parse(text)
    } catch {
      // no properties file yet — use empty
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
    const store = get<Store>('@hypercomb.social/Store')
    const service = get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const settings = get<Settings>('@diamondcoreprocessor.com/Settings')

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

    // 4. write 0000 to seed directory
    const seedDir = await store.current.getDirectoryHandle(service.seed, { create: true })
    const fileHandle = await seedDir.getFileHandle(PROPERTIES_FILE, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(JSON.stringify(props, null, 2))
    } finally {
      await writable.close()
    }

    // 5. cleanup
    imageEditor.destroy()
    service.close()

    // 6. trigger re-render
    window.dispatchEvent(new CustomEvent('synchronize', {
      detail: { source: 'tile:save' },
    }))
  }

  // ── cancel ─────────────────────────────────────────────────────

  readonly cancelEditing = (): void => {
    const imageEditor = get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const service = get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    imageEditor?.destroy()
    service?.close()
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorDrone',
  new TileEditorDrone(),
)
