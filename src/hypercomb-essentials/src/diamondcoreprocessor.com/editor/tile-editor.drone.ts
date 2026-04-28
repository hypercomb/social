// diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus } from '@hypercomb/core'
import { TILE_PROPERTIES_FILE } from './tile-properties.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

// SVG markup for the pencil "edit" icon. Owned by this drone so that
// when the editor is toggled off in DCP the icon never reaches the
// tile overlay arranger and never appears on the hex.
const EDIT_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg>`

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

    // Self-register the 'edit' tile icon. The arranger (tile-actions)
    // merges this with its own catalog, computes positions, and emits
    // the final overlay descriptors. Toggling this drone off in DCP
    // skips construction → registry never receives the entry → icon
    // never appears.
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

  // ── effect handler ─────────────────────────────────────────────

  #onTileAction = (payload: TileActionPayload): void => {
    if (payload.action !== 'edit') return
    void this.#openEditing(payload.label)
  }

  // ── open editor ────────────────────────────────────────────────

  async #openEditing(cell: string): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!store || !service) return

    // 1. read tile properties — prefer content-addressed, fall back to legacy 0000 file
    let properties: Record<string, unknown> = {}
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
      // no properties found — use empty
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

    // 5. capture cell name before closing
    const savedCell = service.cell

    // 6. cleanup
    imageEditor.destroy()
    service.close()

    // 7. notify via effect bus (processor owns synchronize; drones use effects)
    EffectBus.emit<{ cell: string }>('tile:saved', { cell: savedCell })
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
