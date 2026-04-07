// diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus } from '@hypercomb/core'
import { TILE_PROPERTIES_FILE } from './tile-properties.js'
import type { Slot, SlotContent, FileSlot, EmbedContent } from './slot.types.js'
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

    // 3. load slot content from __resources__
    const rawSlots = Array.isArray((properties as any).slots) ? (properties as any).slots as Slot[] : []
    const slotContents = new Map<string, SlotContent>()
    for (const slot of rawSlots) {
      const blob = await store.getResource(slot.contentSig)
      if (slot.type === 'text') {
        slotContents.set(slot.contentSig, blob ? await blob.text() : '')
      } else if (slot.type === 'checklist' || slot.type === 'data') {
        if (blob) { try { slotContents.set(slot.contentSig, JSON.parse(await blob.text())) } catch { /* skip corrupt */ } }
      } else if (slot.type === 'embed') {
        if (blob) { try { slotContents.set(slot.contentSig, JSON.parse(await blob.text()) as EmbedContent) } catch { /* skip */ } }
      } else if (slot.type === 'file') {
        slotContents.set(slot.contentSig, blob)
      }
    }

    // 4. open editor service
    service.open(cell, properties, largeBlob, rawSlots, slotContents)
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

    // 3b. serialize slot content to signatures
    const savedSlots: Slot[] = []
    for (let si = 0; si < service.slots.length; si++) {
      const slot = service.slots[si]
      const content = service.slotContents.get(slot.contentSig)
      if (content === undefined) continue

      if (slot.type === 'text') {
        if (typeof content !== 'string' || !content.trim()) continue
        const sig = await store.putResource(new Blob([content], { type: 'text/plain' }))
        savedSlots.push({ type: 'text', contentSig: sig })
      } else if (slot.type === 'checklist') {
        if (!Array.isArray(content) || content.length === 0) continue
        const sig = await store.putResource(new Blob([JSON.stringify(content)], { type: 'application/json' }))
        savedSlots.push({ type: 'checklist', contentSig: sig })
      } else if (slot.type === 'embed') {
        const embed = content as EmbedContent | null
        if (!embed || !embed.url) continue
        const sig = await store.putResource(new Blob([JSON.stringify(embed)], { type: 'application/json' }))
        savedSlots.push({ type: 'embed', contentSig: sig })
      } else if (slot.type === 'file') {
        if (!(content instanceof Blob)) continue
        const fileSlot = slot as FileSlot
        const sig = await store.putResource(content)
        savedSlots.push({ type: 'file', contentSig: sig, name: fileSlot.name, mime: fileSlot.mime, size: fileSlot.size })
      } else if (slot.type === 'data') {
        if (!Array.isArray(content) || content.length === 0) continue
        const sig = await store.putResource(new Blob([JSON.stringify(content)], { type: 'application/json' }))
        savedSlots.push({ type: 'data', contentSig: sig })
      }
    }
    if (savedSlots.length > 0) {
      (props as any).slots = savedSlots
    } else {
      delete (props as any).slots
    }

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
