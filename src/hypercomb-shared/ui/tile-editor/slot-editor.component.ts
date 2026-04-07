// hypercomb-shared/ui/tile-editor/slot-editor.component.ts

import {
  Component,
  computed,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'

type SlotType = 'text' | 'checklist' | 'embed' | 'file' | 'data'
type Slot = { type: SlotType; contentSig: string; name?: string; mime?: string; size?: number }
type ChecklistItem = { text: string; done: boolean }
type EmbedContent = { url: string; thumbnailSig?: string }
type DataEntry = { key: string; value: string }
type SlotContent = string | ChecklistItem[] | EmbedContent | DataEntry[] | Blob | null

type TileEditorService = EventTarget & {
  mode: 'idle' | 'editing'
  slots: Slot[]
  slotContents: Map<string, SlotContent>
  addSlot: (type: SlotType) => void
  removeSlot: (index: number) => void
  setSlotContent: (contentSig: string, content: SlotContent) => void
  moveSlot: (from: number, to: number) => void
  updateFileSlotMeta: (index: number, name: string, mime: string, size: number) => void
}

@Component({
  selector: 'hc-slot-editor',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './slot-editor.component.html',
  styleUrls: ['./slot-editor.component.scss'],
})
export class SlotEditorComponent implements OnInit, OnDestroy {

  #service(): TileEditorService | undefined {
    return window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService') as TileEditorService | undefined
  }

  // ── reactive state ─────────────────────────────────────────

  #target = window.ioc.get<EventTarget>('@diamondcoreprocessor.com/TileEditorService') as EventTarget | undefined

  readonly slots$ = this.#target
    ? fromRuntime(this.#target, () => this.#service()?.slots ?? [])
    : computed(() => [] as Slot[])

  // ── add slot ───────────────────────────────────────────────

  showAddMenu = false

  readonly toggleAddMenu = (): void => {
    this.showAddMenu = !this.showAddMenu
  }

  readonly addSlot = (type: SlotType): void => {
    this.#service()?.addSlot(type)
    this.showAddMenu = false
  }

  readonly removeSlot = (index: number): void => {
    this.#service()?.removeSlot(index)
  }

  // ── collapse/expand ────────────────────────────────────────

  #collapsedSlots = new Set<string>()

  readonly isCollapsed = (slot: Slot): boolean =>
    this.#collapsedSlots.has(slot.contentSig)

  readonly toggleCollapse = (slot: Slot): void => {
    if (this.#collapsedSlots.has(slot.contentSig)) {
      this.#collapsedSlots.delete(slot.contentSig)
    } else {
      this.#collapsedSlots.add(slot.contentSig)
    }
  }

  // ── drag-to-reorder ────────────────────────────────────────

  dragIndex: number | null = null
  dragOverIndex: number | null = null

  readonly onDragStart = (index: number, event: PointerEvent): void => {
    this.dragIndex = index
    ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  readonly onDragOverSlot = (index: number): void => {
    if (this.dragIndex !== null && this.dragIndex !== index) {
      this.dragOverIndex = index
    }
  }

  readonly onDragEnd = (): void => {
    if (this.dragIndex !== null && this.dragOverIndex !== null) {
      this.#service()?.moveSlot(this.dragIndex, this.dragOverIndex)
    }
    this.dragIndex = null
    this.dragOverIndex = null
  }

  readonly onDragCancel = (): void => {
    this.dragIndex = null
    this.dragOverIndex = null
  }

  // ── text slot ──────────────────────────────────────────────

  readonly getTextContent = (slot: Slot): string => {
    const content = this.#service()?.slotContents.get(slot.contentSig)
    return typeof content === 'string' ? content : ''
  }

  readonly setTextContent = (slot: Slot, value: string): void => {
    this.#service()?.setSlotContent(slot.contentSig, value)
  }

  // ── checklist slot ─────────────────────────────────────────

  readonly getChecklistItems = (slot: Slot): ChecklistItem[] => {
    const content = this.#service()?.slotContents.get(slot.contentSig)
    return Array.isArray(content) && content.length > 0 && 'done' in content[0] ? content as ChecklistItem[] : []
  }

  readonly addChecklistItem = (slot: Slot): void => {
    const items = [...this.getChecklistItems(slot), { text: '', done: false }]
    this.#service()?.setSlotContent(slot.contentSig, items)
  }

  readonly removeChecklistItem = (slot: Slot, itemIndex: number): void => {
    const items = this.getChecklistItems(slot).filter((_, i) => i !== itemIndex)
    this.#service()?.setSlotContent(slot.contentSig, items)
  }

  readonly toggleChecklistItem = (slot: Slot, itemIndex: number): void => {
    const items = this.getChecklistItems(slot).map((item, i) =>
      i === itemIndex ? { ...item, done: !item.done } : item
    )
    this.#service()?.setSlotContent(slot.contentSig, items)
  }

  readonly setChecklistItemText = (slot: Slot, itemIndex: number, text: string): void => {
    const items = this.getChecklistItems(slot).map((item, i) =>
      i === itemIndex ? { ...item, text } : item
    )
    this.#service()?.setSlotContent(slot.contentSig, items)
  }

  readonly onChecklistKeydown = (event: KeyboardEvent, slot: Slot, itemIndex: number): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      this.addChecklistItem(slot)
      setTimeout(() => {
        const items = document.querySelectorAll('hc-slot-editor .checklist-input')
        const next = items[items.length - 1] as HTMLInputElement | undefined
        next?.focus()
      }, 0)
    }
  }

  // ── embed slot ─────────────────────────────────────────────

  readonly getEmbedContent = (slot: Slot): EmbedContent => {
    const content = this.#service()?.slotContents.get(slot.contentSig)
    if (content && typeof content === 'object' && !Array.isArray(content) && !(content instanceof Blob) && 'url' in content) {
      return content as EmbedContent
    }
    return { url: '' }
  }

  readonly setEmbedUrl = (slot: Slot, url: string): void => {
    const existing = this.getEmbedContent(slot)
    this.#service()?.setSlotContent(slot.contentSig, { ...existing, url })
  }

  readonly getYouTubeId = (url: string): string | null => {
    if (!url) return null
    let parsed: URL
    try { parsed = new URL(url) } catch { return null }
    const host = parsed.hostname.toLowerCase()
    let videoId: string | null = null
    if (host === 'youtu.be') {
      videoId = parsed.pathname.split('/').filter(Boolean)[0] || null
    }
    if (!videoId && host.includes('youtube.com')) {
      if (parsed.pathname === '/watch') videoId = parsed.searchParams.get('v')
      else if (parsed.pathname.startsWith('/embed/')) videoId = parsed.pathname.split('/')[2] || null
      else if (parsed.pathname.startsWith('/shorts/')) videoId = parsed.pathname.split('/')[2] || null
    }
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null
    return videoId
  }

  readonly getYouTubeThumbnail = (url: string): string => {
    const id = this.getYouTubeId(url)
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : ''
  }

  // ── file slot ──────────────────────────────────────────────

  readonly getFileName = (slot: Slot): string => slot.name || ''
  readonly getFileMime = (slot: Slot): string => slot.mime || ''

  readonly getFileSize = (slot: Slot): string => {
    const bytes = slot.size || 0
    if (bytes === 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  readonly getFileMimeIcon = (slot: Slot): string => {
    const mime = slot.mime || ''
    if (mime.startsWith('image/')) return 'U'
    if (mime.startsWith('audio/')) return '~'
    if (mime.startsWith('video/')) return '~'
    if (mime === 'application/pdf') return 'b'
    return 'b'
  }

  readonly onFilePick = (slot: Slot, event: Event, slotIndex: number): void => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const blob = new Blob([file], { type: file.type })
    this.#service()?.setSlotContent(slot.contentSig, blob)
    this.#service()?.updateFileSlotMeta(slotIndex, file.name, file.type, file.size)
    input.value = ''
  }

  readonly onFileDrop = (slot: Slot, event: DragEvent, slotIndex: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    const blob = new Blob([file], { type: file.type })
    this.#service()?.setSlotContent(slot.contentSig, blob)
    this.#service()?.updateFileSlotMeta(slotIndex, file.name, file.type, file.size)
  }

  readonly downloadFile = (slot: Slot): void => {
    const content = this.#service()?.slotContents.get(slot.contentSig)
    if (!(content instanceof Blob)) return
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = slot.name || 'file'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── data slot ──────────────────────────────────────────────

  readonly getDataEntries = (slot: Slot): DataEntry[] => {
    const content = this.#service()?.slotContents.get(slot.contentSig)
    if (Array.isArray(content) && (content.length === 0 || (content.length > 0 && 'key' in content[0]))) {
      return content as DataEntry[]
    }
    return []
  }

  readonly addDataRow = (slot: Slot): void => {
    const entries = [...this.getDataEntries(slot), { key: '', value: '' }]
    this.#service()?.setSlotContent(slot.contentSig, entries)
  }

  readonly removeDataRow = (slot: Slot, index: number): void => {
    const entries = this.getDataEntries(slot).filter((_, i) => i !== index)
    this.#service()?.setSlotContent(slot.contentSig, entries)
  }

  readonly setDataKey = (slot: Slot, index: number, key: string): void => {
    const entries = this.getDataEntries(slot).map((e, i) =>
      i === index ? { ...e, key } : e
    )
    this.#service()?.setSlotContent(slot.contentSig, entries)
  }

  readonly setDataValue = (slot: Slot, index: number, value: string): void => {
    const entries = this.getDataEntries(slot).map((e, i) =>
      i === index ? { ...e, value } : e
    )
    this.#service()?.setSlotContent(slot.contentSig, entries)
  }

  // ── helpers ────────────────────────────────────────────────

  readonly slotTypeKey = (slot: Slot): string => `slots.${slot.type}`

  // ── lifecycle ──────────────────────────────────────────────

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.#collapsedSlots.clear()
  }
}
