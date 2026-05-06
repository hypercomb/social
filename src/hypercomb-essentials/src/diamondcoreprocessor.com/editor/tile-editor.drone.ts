// diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus } from '@hypercomb/core'
import { TILE_PROPERTIES_FILE, readCellProperties, readTilePropertiesAt, writeTilePropertiesAt } from './tile-properties.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

// SVG markup for the pencil "edit" icon. Owned by this drone so that
// when the editor is toggled off in DCP the icon never reaches the
// tile overlay arranger and never appears on the hex. Material Design
// `edit` (filled) — solid white fill so the Pixi sprite-tint pipeline
// preserves colour; matches the rest of the tile-overlay icon set.
const EDIT_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`

type IconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistry = {
  add(p: IconProvider): void
  remove(name: string): void
}

type TileActionPayload = {
  action: string
  label: string
  q: number
  r: number
  index: number
}

type Store = {
  resources: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

type Settings = {
  editorSize: number
  hexWidth: (orientation: 'point-top' | 'flat-top') => number
  hexHeight: (orientation: 'point-top' | 'flat-top') => number
}

export class TileEditorDrone {

  constructor() {
    EffectBus.on<TileActionPayload>('tile:action', this.#onTileAction)
    EffectBus.on('controls:camera-open', this.#onCameraOpen)

    // Self-register the 'edit' tile icon. The arranger (tile-actions)
    // merges this with its own catalog, computes positions, and emits
    // the final overlay descriptors. Toggling this drone off in DCP
    // skips construction → registry never receives the entry → icon
    // never appears.
    const isMobile = window.matchMedia('(max-width: 599px)').matches || 'ontouchstart' in window
    if (!isMobile) {
      const registry = window.ioc.get<IconProviderRegistry>('@hypercomb.social/IconProviderRegistry')
      registry?.add({
        name: 'edit',
        owner: '@diamondcoreprocessor.com/TileEditorDrone',
        svgMarkup: EDIT_ICON_SVG,
        profile: 'private',
        hoverTint: 0xc8d8ff,
        labelKey: 'action.edit',
        descriptionKey: 'action.edit.description',
      })
    }
  }

  // ── effect handler ─────────────────────────────────────────────

  #onTileAction = (payload: TileActionPayload): void => {
    if (payload.action !== 'edit') return
    void this.#openEditing(payload.label)
  }

  #onCameraOpen = (): void => {
    const selection = window.ioc.get<{ active: string | null }>('@diamondcoreprocessor.com/SelectionService')
    const activeCell = selection?.active
    if (!activeCell) return
    void this.#openEditingWithCamera(activeCell)
  }

  async #openEditingWithCamera(cell: string): Promise<void> {
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!service) return
    service.autoCamera = true
    await this.#openEditing(cell)
  }

  // ── open editor ────────────────────────────────────────────────

  async #openEditing(cell: string): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!store || !service) return

    // 1. read tile properties — canonical path is the cell's layer's
    // `properties` slot (`readTilePropertiesAt`). Falls back to:
    //   - the localStorage label-keyed sig index (tile-editor save path
    //     not yet migrated to layer slots), and
    //   - the legacy 0000 file (pre-migration tiles whose properties
    //     were written to <cellDir>/0000).
    // The canonical-first ordering means freshly-edited tiles whose
    // properties live in the layer slot always show up correctly in
    // the editor without needing a label-keyed cache hit.
    const lineage = window.ioc.get<{
      explorerSegments?: () => readonly string[]
      explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
    }>('@hypercomb.social/Lineage')
    const parentSegments = lineage?.explorerSegments?.() ?? []
    let properties: Record<string, unknown> = {}
    try {
      const layerProps = await readTilePropertiesAt(parentSegments, cell)
      if (Object.keys(layerProps).length > 0) {
        properties = layerProps
      } else {
        throw new Error('no layer-slot properties')
      }
    } catch {
      try {
        const indexKey = 'hc:tile-props-index'
        const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
        const propsSig = index[cell]
        if (!propsSig) throw new Error('no index entry')
        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) throw new Error('props blob missing')
        const text = await propsBlob.text()
        properties = JSON.parse(text)
      } catch {
        try {
          const dir = await lineage?.explorerDir?.()
          if (dir) {
            const cellDir = await dir.getDirectoryHandle(cell, { create: false })
            properties = await readCellProperties(cellDir)
          }
        } catch {
          // truly nothing — leave properties empty
        }
      }
    }

    // 2. load large image blob from __resources__ (if present)
    let largeBlob: Blob | null = null
    const largeSig = (properties as any).large?.image
    if (largeSig && typeof largeSig === 'string') {
      largeBlob = await store.getResource(largeSig)
    }

    // 3. open editor service
    service.open(cell, properties, largeBlob)
  }

  // ── save (called by Angular component) ─────────────────────────

  readonly saveAndComplete = async (): Promise<void> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const settings = window.ioc.get<Settings>('@diamondcoreprocessor.com/Settings')

    if (!store || !service || !imageEditor || !settings) return
    if (service.mode !== 'editing') return

    // capture cell name up front so we can emit tile:saved if save succeeds.
    // The whole save body runs inside try/finally — without this guarantee
    // a thrown step (image capture, OPFS write, etc.) would leave the
    // editor open and the InputGate locked, permanently blocking zoom.
    const savedCell = service.cell
    let saveSucceeded = false

    try {
    const props: Record<string, unknown> = { ...service.properties }
    const currentOrientation = imageEditor.orientation ?? 'point-top'

    // 1. capture small image for CURRENT orientation (if image loaded)
    if (imageEditor.hasImage) {
      // save current orientation's transform before switching
      const currentTransform = imageEditor.getTransform()
      service.updateTransform(currentTransform.x, currentTransform.y, currentTransform.scale, currentOrientation)

      // capture current orientation snapshot
      const curW = settings.hexWidth(currentOrientation)
      const curH = settings.hexHeight(currentOrientation)
      const currentBlob = await imageEditor.captureSmall(curW, curH)
      const currentSig = await store.putResource(currentBlob)

      // determine the other orientation
      const otherOrientation = currentOrientation === 'point-top' ? 'flat-top' as const : 'point-top' as const
      const otherW = settings.hexWidth(otherOrientation)
      const otherH = settings.hexHeight(otherOrientation)

      // switch to the other orientation, capture snapshot + transform, then switch back
      const savedOtherTransform = otherOrientation === 'flat-top'
        ? (props as any).flat?.large
        : (props as any).large
      await imageEditor.setOrientation(otherOrientation,
        savedOtherTransform ? { x: savedOtherTransform.x ?? 0, y: savedOtherTransform.y ?? 0, scale: savedOtherTransform.scale ?? 1 } : undefined)
      const otherBlob = await imageEditor.captureSmall(otherW, otherH)
      const otherSig = await store.putResource(otherBlob)

      // capture the actual transform while still in the other orientation
      const otherActualTransform = imageEditor.getTransform()

      // switch back to the current orientation
      await imageEditor.setOrientation(currentOrientation,
        { x: currentTransform.x, y: currentTransform.y, scale: currentTransform.scale })

      // store point-top snapshot + transform
      if (currentOrientation === 'point-top') {
        ;(props as any).small = { image: currentSig }
        if (!(props as any).flat) (props as any).flat = {}
        ;(props as any).flat.small = { image: otherSig }
      } else {
        ;(props as any).small = { image: otherSig }
        if (!(props as any).flat) (props as any).flat = {}
        ;(props as any).flat.small = { image: currentSig }
      }

      // 2. store large image blob + transforms
      if (service.largeBlob) {
        const largeSig = await store.putResource(service.largeBlob)

        // assign the correct transform to each orientation
        const pointyTransform = currentOrientation === 'point-top' ? currentTransform : otherActualTransform
        const flatTransform = currentOrientation === 'flat-top' ? currentTransform : otherActualTransform

        ;(props as any).large = {
          image: largeSig,
          x: pointyTransform.x,
          y: pointyTransform.y,
          scale: pointyTransform.scale,
        }
        if (!(props as any).flat) (props as any).flat = {}
        ;(props as any).flat.large = {
          x: flatTransform.x,
          y: flatTransform.y,
          scale: flatTransform.scale,
        }
      }
    }

    // 3. preserve link + border.color from service
    // (already in props via service.properties — setLink/setBorderColor mutate in-place)

    // 4. write tile properties as content-addressed resource
    const json = JSON.stringify(props, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const propsSig = await store.putResource(blob)

    // persist cell → resource sig mapping
    const indexKey = 'hc:tile-props-index'
    const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
    index[service.cell] = propsSig
    localStorage.setItem(indexKey, JSON.stringify(index))

    // CANONICAL WRITE — the edited image/link is the user's content, so it
    // must land in the tile's canonical 0000 (the layer's properties slot),
    // not just this browser's label index. Merges over existing canonical
    // props, commits via the LayerCommitter cascade, and broadcasts
    // cell:0000-changed — SwarmDrone republishes with it inlined.
    try {
      const lineageForSave = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      const segmentsForSave = lineageForSave?.explorerSegments?.() ?? []
      await writeTilePropertiesAt(segmentsForSave, service.cell, props as Record<string, unknown>)
    } catch (err) {
      console.warn('[tile-editor] canonical props write failed', err)
    }

    saveSucceeded = true
    } finally {
      // 6. cleanup — always runs so editor:mode {active:false} is emitted
      // and InputGate.unlock() fires even if any step above threw.
      imageEditor.destroy()
      service.close()
    }

    // 7. notify via effect bus (processor owns synchronize; drones use effects)
    if (saveSucceeded) {
      EffectBus.emit<{ cell: string }>('tile:saved', { cell: savedCell })
    }
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
