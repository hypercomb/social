// diamondcoreprocessor.com/editor/tile-editor.service.ts
import { EffectBus } from '@hypercomb/core'
import type { Slot, SlotContent, SlotType, FileSlot } from './slot.types.js'

export type EditorModePayload = { active: boolean }

export class TileEditorService extends EventTarget {

  #mode: 'idle' | 'editing' = 'idle'
  #cell = ''
  #properties: Record<string, unknown> = {}
  #largeBlob: Blob | null = null
  #slots: Slot[] = []
  #slotContents = new Map<string, SlotContent>()

  // ── getters ────────────────────────────────────────────────────

  get mode(): 'idle' | 'editing' { return this.#mode }
  get cell(): string { return this.#cell }
  get properties(): Record<string, unknown> { return this.#properties }
  get largeBlob(): Blob | null { return this.#largeBlob }

  // ── specific property accessors (object notation) ──────────────

  get slots(): Slot[] { return this.#slots }
  get slotContents(): Map<string, SlotContent> { return this.#slotContents }

  get link(): string {
    return String((this.#properties as any).link ?? '')
  }

  get borderColor(): string {
    return String((this.#properties as any).border?.color ?? '')
  }

  get backgroundColor(): string {
    return String((this.#properties as any).background?.color ?? '')
  }

  // ── state mutations ────────────────────────────────────────────

  readonly open = (
    cell: string,
    properties: Record<string, unknown>,
    largeBlob: Blob | null,
    slots?: Slot[],
    slotContents?: Map<string, SlotContent>,
  ): void => {
    this.#cell = cell
    this.#properties = { ...properties }
    this.#largeBlob = largeBlob
    this.#slots = slots ? [...slots] : []
    this.#slotContents = slotContents ? new Map(slotContents) : new Map()
    this.#mode = 'editing'
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: true })
  }

  readonly close = (): void => {
    this.#mode = 'idle'
    this.#cell = ''
    this.#properties = {}
    this.#largeBlob = null
    this.#slots = []
    this.#slotContents = new Map()
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: false })
  }

  readonly setLink = (value: string): void => {
    if (value) {
      (this.#properties as any).link = value
    } else {
      delete (this.#properties as any).link
    }
    this.#emit()
  }

  readonly setBorderColor = (value: string): void => {
    if (value) {
      if (!(this.#properties as any).border) {
        (this.#properties as any).border = {}
      }
      (this.#properties as any).border.color = value
    } else {
      if ((this.#properties as any).border) {
        delete (this.#properties as any).border.color
        if (Object.keys((this.#properties as any).border).length === 0) {
          delete (this.#properties as any).border
        }
      }
    }
    this.#emit()
  }

  readonly setBackgroundColor = (value: string): void => {
    if (value) {
      if (!(this.#properties as any).background) {
        (this.#properties as any).background = {}
      }
      (this.#properties as any).background.color = value
    } else {
      if ((this.#properties as any).background) {
        delete (this.#properties as any).background.color
        if (Object.keys((this.#properties as any).background).length === 0) {
          delete (this.#properties as any).background
        }
      }
    }
    this.#emit()
  }

  // ── slot mutations ──────────────────────────────────────────

  readonly addSlot = (type: SlotType): void => {
    const tempId = crypto.randomUUID()
    switch (type) {
      case 'text':
        this.#slots.push({ type: 'text', contentSig: tempId })
        this.#slotContents.set(tempId, '')
        break
      case 'checklist':
        this.#slots.push({ type: 'checklist', contentSig: tempId })
        this.#slotContents.set(tempId, [])
        break
      case 'embed':
        this.#slots.push({ type: 'embed', contentSig: tempId })
        this.#slotContents.set(tempId, { url: '' })
        break
      case 'file':
        this.#slots.push({ type: 'file', contentSig: tempId, name: '', mime: '', size: 0 })
        this.#slotContents.set(tempId, null)
        break
      case 'data':
        this.#slots.push({ type: 'data', contentSig: tempId })
        this.#slotContents.set(tempId, [])
        break
    }
    this.#emit()
  }

  readonly removeSlot = (index: number): void => {
    const slot = this.#slots[index]
    if (!slot) return
    this.#slotContents.delete(slot.contentSig)
    this.#slots.splice(index, 1)
    this.#emit()
  }

  readonly setSlotContent = (contentSig: string, content: SlotContent): void => {
    this.#slotContents.set(contentSig, content)
    this.#emit()
  }

  readonly moveSlot = (from: number, to: number): void => {
    if (from === to) return
    if (from < 0 || from >= this.#slots.length) return
    if (to < 0 || to >= this.#slots.length) return
    const [slot] = this.#slots.splice(from, 1)
    this.#slots.splice(to, 0, slot)
    this.#emit()
  }

  readonly updateFileSlotMeta = (index: number, name: string, mime: string, size: number): void => {
    const slot = this.#slots[index]
    if (!slot || slot.type !== 'file') return
    const fileSlot = slot as FileSlot
    fileSlot.name = name
    fileSlot.mime = mime
    fileSlot.size = size
    this.#emit()
  }

  readonly setLargeBlob = (blob: Blob): void => {
    this.#largeBlob = blob
    this.#emit()
  }

  readonly updateTransform = (x: number, y: number, scale: number, orientation: 'point-top' | 'flat-top' = 'point-top'): void => {
    if (orientation === 'flat-top') {
      if (!(this.#properties as any).flat) {
        (this.#properties as any).flat = {}
      }
      if (!(this.#properties as any).flat.large) {
        (this.#properties as any).flat.large = {}
      }
      const flatLarge = (this.#properties as any).flat.large
      flatLarge.x = x
      flatLarge.y = y
      flatLarge.scale = scale
    } else {
      if (!(this.#properties as any).large) {
        (this.#properties as any).large = {}
      }
      const large = (this.#properties as any).large
      large.x = x
      large.y = y
      large.scale = scale
    }
    // no emit — transform updates are high frequency (drag/zoom)
  }

  // ── internal ───────────────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorService',
  new TileEditorService()
)
