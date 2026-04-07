// diamondcoreprocessor.com/editor/slot.types.ts

export type SlotType = 'text' | 'checklist' | 'embed' | 'file' | 'data'

export type TextSlot = {
  type: 'text'
  contentSig: string
}

export type ChecklistItem = {
  text: string
  done: boolean
}

export type ChecklistSlot = {
  type: 'checklist'
  contentSig: string
}

export type EmbedSlot = {
  type: 'embed'
  contentSig: string
}

export type FileSlot = {
  type: 'file'
  contentSig: string
  name: string
  mime: string
  size: number
}

export type DataSlot = {
  type: 'data'
  contentSig: string
}

export type EmbedContent = {
  url: string
  thumbnailSig?: string
}

export type DataEntry = {
  key: string
  value: string
}

export type SlotContent = string | ChecklistItem[] | EmbedContent | DataEntry[] | Blob | null

export type Slot = TextSlot | ChecklistSlot | EmbedSlot | FileSlot | DataSlot
